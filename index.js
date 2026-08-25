/**
 * yunzai_qqlevel/index.js
 * Yunzai-Bot 插件入口
 *
 * 命令:
 *   #qq登录 [domain]       - QR 登录获取 cookie (domain 可选,默认 vip.qq.com)
 *   #qq登录 all            - 多域扫码登录 (会连续弹出多个二维码,按提示扫码)
 *   #qq登录 列表           - 显示支持的登录域列表
 *   #qq签到                - 立即执行所有启用的任务
 *   #qq任务列表            - 列出所有任务
 *   #qq启用任务 <id>       - 启用任务
 *   #qq禁用任务 <id>       - 禁用任务
 *   #qq任务详情 <id>       - 任务详情
 *   #qq刷新ck [domain]     - 同 #qq登录
 *   #qq签到帮助            - 显示帮助
 *   #qqck                  - 查看当前 cookie 状态
 *
 * 支持的登录域 (来自 PyQQSkeyTool):
 *   qzone.qq.com, qun.qq.com, vip.qq.com, mail.qq.com, weiyun.com, accounts.qq.com
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { loginFlow, loginDomain, loginMultiDomain, fetchQRCode, cleanupQRCache, LOGIN_DOMAINS, DEFAULT_DOMAIN } from './lib/login.js'
import * as cookie from './lib/cookie.js'
import { getTaskGroups, getStats } from './lib/conf-loader.js'
import { runTask } from './executor/task-runner.js'
import { scheduleAll, stopAll } from './executor/scheduler.js'
import { loadConfig, reloadConfig, isTaskEnabledByConfig, isGroupAllowed } from './lib/config.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')
const STATE_FILE = path.join(DATA_DIR, 'tasks-state.json')

function loadState() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '{}', 'utf8')
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8')
}

function isEnabled(taskId) {
  // config.yaml 中的 taskOverrides 优先
  return isTaskEnabledByConfig(taskId, (id) => {
    const s = loadState()
    return s[id] !== false
  })
}

function setEnabled(taskId, enabled) {
  const s = loadState()
  s[taskId] = enabled
  saveState(s)
}

export default async function (e) {
  if (!e || !e.msg) return
  const msg = e.msg.trim()
  const cmd = msg.split(/\s+/)[0]
  const arg = msg.slice(cmd.length).trim()

  switch (cmd) {
    case '#qq登录':
    case '#qq刷新ck':
      return doLogin(e, arg)
    case '#qqck':
      return showCookie(e)
    case '#qq签到':
      return runAll(e)
    case '#qq一键':
    case '#qq一键签到':
    case '#qq全部':
      return doOneClick(e, arg)
    case '#qq任务列表':
    case '#qq列表':
      return listTasks(e)
    case '#qq任务详情':
    case '#qq详情':
      return showTask(e, arg)
    case '#qq统计':
    case '#qqstats':
      return showStats(e)
    case '#qq启用任务':
      return setTask(e, arg, true)
    case '#qq禁用任务':
      return setTask(e, arg, false)
    case '#qq签到帮助':
    case '#qq帮助':
      return showHelp(e)
    case '#qq重载配置':
    case '#qq配置重载':
      return reloadCfgCmd(e)
    case '#qq配置':
    case '#qq配置查看':
      return showConfigCmd(e)
  }
}

async function sendImage(e, filePath) {
  if (e.group && e.group.sendImage) {
    await e.group.sendImage(filePath)
  } else if (e.friend && e.friend.sendImage) {
    await e.friend.sendImage(filePath)
  } else if (e.bot && e.bot.sendApi) {
    const groupId = e.group_id
    const userId = e.user_id
    const base64 = fs.readFileSync(filePath).toString('base64')
    if (groupId) await e.bot.sendApi('send_group_msg', { group_id: groupId, message: [{ type: 'image', data: { base64 } }] })
    else if (userId) await e.bot.sendApi('send_private_msg', { user_id: userId, message: [{ type: 'image', data: { base64 } }] })
  } else if (e.reply) {
    try {
      const base64 = fs.readFileSync(filePath).toString('base64')
      await e.reply(segment.image(`base64://${base64}`))
    } catch {
      await e.reply(`QR 已保存到: ${filePath}`)
    }
  }
}

async function doLogin(e, arg) {
  arg = (arg || '').trim()
  // 显示支持的域
  if (arg === '列表' || arg === 'list') {
    const list = Object.keys(LOGIN_DOMAINS).map(d => `  - ${d}  (appid=${LOGIN_DOMAINS[d].appid})`).join('\n')
    return e.reply(`支持的登录域:\n${list}\n\n默认域: ${DEFAULT_DOMAIN}\n用法: #qq登录 <域>  或  #qq登录 all`)
  }
  // 多域登录
  if (arg === 'all') {
    await e.reply('开始多域登录，将依次显示二维码，请按顺序扫码...')
    const r = await loginMultiDomain(Object.keys(LOGIN_DOMAINS), {
      onDomainStart: async (d) => { await e.reply(`准备登录域: ${d}`) },
      onQR: async ({ path, domain }) => {
        await sendImage(e, path)
        await e.reply(`请扫描此二维码登录 [${domain}]`)
      },
      onStatus: async (s) => { /* keep silent */ },
      onDomainDone: async (d, r) => {
        await e.reply(`${d} 登录${r.ok ? '成功' : '失败: ' + r.error}`)
      },
      onAllDone: async (all) => {
        const ok = Object.entries(all).filter(([_, r]) => r.ok).map(([d]) => d).join(', ')
        const fail = Object.entries(all).filter(([_, r]) => !r.ok).map(([d]) => d).join(', ')
        await e.reply(`多域登录完成\n成功: ${ok || '(无)'}\n失败: ${fail || '(无)'}`)
      }
    })
    return
  }
  // 单域登录
  const domain = arg || DEFAULT_DOMAIN
  if (!LOGIN_DOMAINS[domain]) {
    return e.reply(`未知登录域: ${domain}\n支持: ${Object.keys(LOGIN_DOMAINS).join(', ')}\n查看: #qq登录 列表`)
  }
  try {
    await e.reply(`开始扫码登录 [${domain}]，请在 60 秒内扫描二维码...`)
    const r = await loginDomain(domain, {
      onQR: async ({ path }) => {
        await sendImage(e, path)
      },
      onStatus: (s) => {
        const map = { '66': '等待扫码', '67': '已扫码待确认', '65': '已扫码', '68': '二维码已失效', '0': '成功' }
        e.reply(`状态: ${map[s.status] || s.message || s.status}`)
      },
    })
    cookie.set(r.uin, domain, r.cookies)
    await e.reply(`登录成功！\nQQ: ${r.uin}\n域: ${r.domain}\np_skey: ${(r.cookies.p_skey || '').slice(0, 8)}...`)
  } catch (err) {
    await e.reply('登录失败: ' + err.message)
  }
}

async function showCookie(e) {
  const all = cookie.readAll()
  const uins = Object.keys(all)
  if (uins.length === 0) return e.reply('当前未登录任何账号，请先 #qq登录')
  let text = '当前账号:\n'
  for (const u of uins) {
    text += `\nQQ: ${u}\n`
    for (const [d, ck] of Object.entries(all[u])) {
      const skey = cookie.extractSkey(ck || {})
      text += `  ${d}: skey=${skey ? skey.slice(0, 8) + '...' : '(无)'}\n`
    }
  }
  await e.reply(text)
}

async function runAll(e) {
  const groups = getTaskGroups()
  const all = cookie.readAll()
  const uins = Object.keys(all)
  if (uins.length === 0) return e.reply('请先 #qq登录')
  await e.reply(`开始执行签到任务，账号: ${uins.join(', ')}`)
  for (const uin of uins) {
    const ctx = { uin, bot: e.bot || global.Bot, logger: global.logger || console }
    const summary = []
    for (const g of groups) {
      for (const t of (g.tasks || [])) {
        if (!isEnabled(t.id)) continue
        try {
          const r = await runTask(t, ctx)
          summary.push(`${t.id}: ${r.ok ? '✓' : '✗ ' + (r.msg || '')}`)
        } catch (err) {
          summary.push(`${t.id}: ✗ ${err.message}`)
        }
      }
    }
    await e.reply(`QQ ${uin} 执行结果:\n${summary.join('\n')}`)
  }
}

/**
 * 一键签到 — 智能执行：自动检查 cookie,缺啥补啥,然后跑全部任务
 *
 * 流程:
 *   1. 检查当前所有账号的 cookie 状态
 *   2. 计算所有任务所需的域 (从 xa_conf.yaml 反推)
 *   3. 对缺失的域,自动发起 QR 登录 (按用户回复确认)
 *   4. 登录完成后,跑全部已启用任务
 *
 * 用法:
 *   #qq一键              - 智能模式,只登录缺失的域
 *   #qq一键 all          - 强制重新登录所有域
 *   #qq一键 force        - 同 all
 */
async function doOneClick(e, arg = '') {
  const force = arg === 'all' || arg === 'force'
  const all = cookie.readAll()
  const uins = Object.keys(all)

  // 1. 计算需要的域
  const needDomains = new Set()
  for (const g of getTaskGroups()) {
    for (const t of (g.tasks || [])) {
      if (!isEnabled(t.id)) continue
      // 推断域
      let host = ''
      try { host = new URL(t.reqUrl).hostname } catch { continue }
      if (host) needDomains.add(host)
    }
  }

  // 映射到我们支持的登录域
  const LOGIN_MAP = {
    'act.qzone.qq.com': 'qzone.qq.com',
    'h5.qzone.qq.com': 'qzone.qq.com',
    'user.qzone.qq.com': 'qzone.qq.com',
    'qun.qq.com': 'qun.qq.com',
    'vip.video.qq.com': 'vip.qq.com',
    'club.vip.qq.com': 'vip.qq.com',
    'act.vip.qq.com': 'vip.qq.com',
  }
  const requiredLogins = new Set()
  for (const d of needDomains) {
    const mapped = LOGIN_MAP[d] || d
    if (LOGIN_DOMAINS[mapped]) requiredLogins.add(mapped)
  }

  // 2. 检查已登录域
  const loggedDomains = new Set()
  for (const u of uins) {
    for (const d of Object.keys(all[u] || {})) loggedDomains.add(d)
  }

  const missing = [...requiredLogins].filter(d => force || !loggedDomains.has(d))

  // 3. 报告状态
  let status = `[一键签到] 任务需要的登录域: ${[...requiredLogins].join(', ') || '(无)'}\n`
  status += `[一键签到] 已登录域: ${[...loggedDomains].join(', ') || '(无)'}\n`
  if (missing.length > 0) {
    status += `[一键签到] 缺失域: ${missing.join(', ')}\n`
  } else {
    status += `[一键签到] 所有域已登录 ✓\n`
  }
  await e.reply(status)

  // 4. 登录缺失的域
  if (missing.length > 0) {
    await e.reply(`开始登录缺失域,共 ${missing.length} 个. 每个 QR 60s 内有效,请按提示扫码...`)
    const loginResults = {}
    for (const domain of missing) {
      try {
        const r = await loginDomain(domain, {
          onQR: async ({ path: p }) => {
            await sendImage(e, p)
            await e.reply(`请扫描此二维码登录 [${domain}]`)
          },
          onStatus: (s) => {
            const map = { '66': '等待扫码', '67': '已扫码待确认', '65': '已扫码', '68': '失效', '0': '成功' }
            e.reply(`状态: ${map[s.status] || s.status}`)
          },
        })
        cookie.set(r.uin, domain, r.cookies)
        loginResults[domain] = { ok: true, uin: r.uin }
        await e.reply(`✓ ${domain} 登录成功 (QQ ${r.uin})`)
      } catch (err) {
        loginResults[domain] = { ok: false, error: err.message }
        await e.reply(`✗ ${domain} 登录失败: ${err.message}`)
      }
    }
    const failed = Object.entries(loginResults).filter(([_, r]) => !r.ok).map(([d]) => d)
    if (failed.length === missing.length) {
      return e.reply(`所有登录尝试均失败,跳过签到`)
    }
  }

  // 5. 跑全部任务
  await e.reply('开始执行所有已启用任务...')
  await runAll(e)
}

/**
 * 统计信息
 */
async function showStats(e) {
  const stats = getStats()
  const cookies = cookie.readAll()
  const uins = Object.keys(cookies)
  const cfg = loadConfig()
  const lines = [
    'yunzai_qqlevel 统计',
    '',
    `任务配置 (xa_conf v${stats.version}):`,
    `  任务组: ${stats.totalGroups}`,
    `  任务总数: ${stats.totalTasks}`,
    `  web: ${stats.byType.web}`,
    `  func: ${stats.byType.func}`,
    `  mini: ${stats.byType.mini || 0}`,
    '',
    `已登录账号: ${uins.length}`,
    ...uins.map(u => `  QQ ${u}: ${Object.keys(cookies[u]).join(', ')}`),
    '',
    `配置 (config/config.yaml):`,
    `  群白名单: ${cfg.whitelist.length === 0 ? '(不限)' : cfg.whitelist.length + ' 个'}`,
    `  群黑名单: ${cfg.blacklist.length === 0 ? '(无)' : cfg.blacklist.length + ' 个'}`,
    `  taskOverrides: ${Object.keys(cfg.taskOverrides).length} 个`,
    `  taskCronOverrides: ${Object.keys(cfg.taskCronOverrides).length} 个`,
    `  luckyChar: ${cfg.luckyChar.enabled ? '启用' : '禁用'} (${cfg.luckyChar.isSVIP ? 'SVIP' : '普通'})`,
  ]
  await e.reply(lines.join('\n'))
}

async function listTasks(e) {
  const groups = getTaskGroups()
  const lines = ['任务列表（共 ' + groups.reduce((a, g) => a + (g.tasks || []).length, 0) + ' 个）:']
  for (const g of groups) {
    lines.push(`\n【${g.id}】`)
    for (const t of (g.tasks || [])) {
      const mark = isEnabled(t.id) ? '✓' : '✗'
      lines.push(`  ${mark} ${t.id}${t.desc ? ' — ' + t.desc : ''}`)
    }
  }
  await e.reply(lines.join('\n'))
}

async function showTask(e, arg) {
  if (!arg) return e.reply('用法: #qq任务详情 <任务ID>')
  const groups = getTaskGroups()
  for (const g of groups) {
    const t = (g.tasks || []).find(x => x.id === arg)
    if (t) {
      const lines = [
        `任务: ${t.id}`,
        `描述: ${t.desc || '-'}`,
        `类型: ${t.type || 'web'}`,
        `URL: ${t.reqUrl}`,
        `Method: ${t.reqMethod}`,
        `Cron: ${t.cron || '(手动)'}`,
        `启用: ${isEnabled(t.id) ? '是' : '否'}`,
      ]
      return e.reply(lines.join('\n'))
    }
  }
  await e.reply('找不到任务: ' + arg)
}

async function setTask(e, arg, enabled) {
  if (!arg) return e.reply(`用法: #qq${enabled ? '启用' : '禁用'}任务 <任务ID>`)
  const groups = getTaskGroups()
  let found = false
  for (const g of groups) {
    for (const t of (g.tasks || [])) {
      if (t.id === arg) {
        setEnabled(t.id, enabled)
        found = true
        break
      }
    }
    if (found) break
  }
  await e.reply(found ? `${arg} 已${enabled ? '启用' : '禁用'}` : '找不到任务: ' + arg)
}

async function showHelp(e) {
  await e.reply([
    'yunzai_qqlevel 签到插件 帮助',
    '',
    '【一键】',
    '#qq一键            - 智能签到(检查缺失 cookie → 自动登录 → 执行任务)',
    '#qq一键 all        - 强制重新登录所有域再签到',
    '',
    '【登录】',
    '#qq登录 [domain]   - 扫码登录指定域',
    '#qq登录 all        - 多域连续扫码登录',
    '#qq登录 列表       - 查看支持的登录域',
    '#qq刷新ck [domain] - 同 #qq登录',
    '',
    '【Cookie】',
    '#qqck              - 查看当前 cookie',
    '',
    '【任务】',
    '#qq签到            - 立即执行所有已启用任务',
    '#qq任务列表        - 列出所有任务',
    '#qq任务详情 <id>   - 查看任务详情',
    '#qq启用任务 <id>   - 启用指定任务',
    '#qq禁用任务 <id>   - 禁用指定任务',
    '#qq统计            - 查看任务/账号/配置统计',
    '',
    '【配置】',
    '#qq配置            - 查看当前配置',
    '#qq重载配置        - 重新加载 config/config.yaml',
    '',
    '【帮助】',
    '#qq签到帮助        - 本帮助',
    '',
    `支持的登录域: ${Object.keys(LOGIN_DOMAINS).join(', ')}`,
  ].join('\n'))
}

async function reloadCfgCmd(e) {
  try {
    const cfg = reloadConfig()
    await e.reply([
      '✓ 配置已重载',
      `defaultUin: ${cfg.defaultUin || '(空)'}`,
      `dailyRunTime: ${cfg.dailyRunTime || '(每任务各自)'}`,
      `oneClickScope: ${cfg.oneClickScope}`,
      `whitelist: ${cfg.whitelist.length === 0 ? '(不限)' : cfg.whitelist.join(',')}`,
      `blacklist: ${cfg.blacklist.length === 0 ? '(无)' : cfg.blacklist.join(',')}`,
      `luckyChar: enabled=${cfg.luckyChar.enabled} isSVIP=${cfg.luckyChar.isSVIP}`,
      `taskOverrides: ${Object.keys(cfg.taskOverrides).length} 个任务被覆盖`,
    ].join('\n'))
  } catch (e) {
    await e.reply('重载失败: ' + e.message)
  }
}

async function showConfigCmd(e) {
  const cfg = loadConfig()
  await e.reply([
    '当前配置 (config/config.yaml):',
    `  defaultUin: ${cfg.defaultUin || '(未设置)'}`,
    `  dailyRunTime: ${cfg.dailyRunTime || '(每任务各自)'}`,
    `  oneClickScope: ${cfg.oneClickScope}`,
    `  whitelist: ${cfg.whitelist.length === 0 ? '(不限)' : cfg.whitelist.join(',')}`,
    `  blacklist: ${cfg.blacklist.length === 0 ? '(无)' : cfg.blacklist.join(',')}`,
    `  luckyChar: enabled=${cfg.luckyChar.enabled} isSVIP=${cfg.luckyChar.isSVIP}`,
    `  defaultMessage: ${cfg.defaultMessage}`,
    `  customLoginDomains: ${Object.keys(cfg.customLoginDomains).length} 个`,
    `  taskOverrides: ${JSON.stringify(cfg.taskOverrides)}`,
  ].join('\n'))
}

export async function onFirstLaunch() {
  console.log('[yunzai_qqlevel] 启动，初始化数据目录...')
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  // 清理 24 小时前的 QR 临时文件
  try {
    const removed = cleanupQRCache()
    if (removed > 0) console.log(`[yunzai_qqlevel] 清理 ${removed} 个过期 QR 文件`)
  } catch (e) {
    console.warn('[yunzai_qqlevel] QR 清理失败:', e.message)
  }

  const ctx = { uin: Object.keys(cookie.readAll())[0] || '', bot: global.Bot, logger: console }
  try {
    scheduleAll(ctx)
    console.log('[yunzai_qqlevel] cron 任务已注册')
  } catch (e) {
    console.error('[yunzai_qqlevel] cron 注册失败:', e.message)
  }
}
