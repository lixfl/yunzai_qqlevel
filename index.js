/**
 * yunzai_qqlevel/index.js
 * Yunzai-Bot 插件入口
 *
 * 命令:
 *   #qq登录                  - QR 登录获取 cookie
 *   #qq签到                  - 立即执行所有启用的任务
 *   #qq任务列表              - 列出所有任务
 *   #qq启用任务 <id>         - 启用任务
 *   #qq禁用任务 <id>         - 禁用任务
 *   #qq任务详情 <id>         - 任务详情
 *   #qq刷新ck                - 同 #qq登录
 *   #qq签到帮助              - 显示帮助
 *   #qqck                    - 查看当前 cookie 状态
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { loginFlow, fetchQRCode } from './lib/login.js'
import * as cookie from './lib/cookie.js'
import { getTaskGroups } from './lib/conf-loader.js'
import { runTask } from './executor/task-runner.js'
import { scheduleAll, stopAll } from './executor/scheduler.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')
const STATE_FILE = path.join(DATA_DIR, 'tasks-state.json')

// 任务启用状态（持久化）
function loadState() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, '{}', 'utf8')
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8')
}

function isEnabled(taskId) {
  const s = loadState()
  // 默认启用，除非显式禁用
  return s[taskId] !== false
}

function setEnabled(taskId, enabled) {
  const s = loadState()
  s[taskId] = enabled
  saveState(s)
}

/**
 * Yunzai 插件主入口（接收消息事件）
 */
export default async function (e) {
  if (!e || !e.msg) return
  const msg = e.msg.trim()
  const cmd = msg.split(/\s+/)[0]
  const arg = msg.slice(cmd.length).trim()

  switch (cmd) {
    case '#qq登录':
    case '#qq刷新ck':
      return doLogin(e)
    case '#qqck':
      return showCookie(e)
    case '#qq签到':
      return runAll(e)
    case '#qq任务列表':
    case '#qq列表':
      return listTasks(e)
    case '#qq任务详情':
    case '#qq详情':
      return showTask(e, arg)
    case '#qq启用任务':
      return setTask(e, arg, true)
    case '#qq禁用任务':
      return setTask(e, arg, false)
    case '#qq签到帮助':
    case '#qq帮助':
      return showHelp(e)
  }
}

async function doLogin(e) {
  try {
    await e.reply('开始扫码登录，请在 60 秒内扫描二维码...')
    const { pngBuffer, path } = await fetchQRCode()
    // 发送图片
    if (e.group && e.group.sendImage) {
      await e.group.sendImage(path)
    } else if (e.friend && e.friend.sendImage) {
      await e.friend.sendImage(path)
    } else if (e.reply) {
      await e.reply([{ type: 'image', data: { file: `file://${path}` } }])
    }
    const { uin, cookie: cookieObj } = await loginFlow({
      onStatus: (r) => {
        const map = { '66': '等待扫码', '67': '已扫码待确认', '65': '已扫码' }
        e.reply(`登录状态: ${map[r.status] || r.status}`)
      },
    })
    await e.reply(`登录成功，QQ: ${uin}`)
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
    const skey = cookie.extractSkey(cookie.get(u, 'global') || {})
    text += `- ${u}  skey: ${skey ? skey.slice(0, 6) + '...' : '(无)'}\n`
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
    '#qq登录           - 扫码登录获取 cookie',
    '#qq刷新ck         - 同上',
    '#qqck             - 查看当前 cookie',
    '#qq签到           - 立即执行所有任务',
    '#qq任务列表       - 列出所有任务',
    '#qq任务详情 <id>  - 查看任务详情',
    '#qq启用任务 <id>  - 启用指定任务',
    '#qq禁用任务 <id>  - 禁用指定任务',
    '#qq签到帮助       - 本帮助',
  ].join('\n'))
}

/**
 * Yunzai bot 启动钩子
 */
export async function onFirstLaunch() {
  console.log('[yunzai_qqlevel] 启动，初始化数据目录...')
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  // 注册 cron 任务
  const ctx = { uin: Object.keys(cookie.readAll())[0] || '', bot: global.Bot, logger: console }
  try {
    scheduleAll(ctx)
    console.log('[yunzai_qqlevel] cron 任务已注册')
  } catch (e) {
    console.error('[yunzai_qqlevel] cron 注册失败:', e.message)
  }
}
