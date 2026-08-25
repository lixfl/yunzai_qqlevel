/**
 * apps/index.js
 * 主插件 - 继承 Yunzai plugin 基类
 * 参考 yeqiu6080/yunzai-plugin-skill 5.2 插件基类使用
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { Config, Data } from '../components/index.js'
import { loginFlow, loginDomain, loginMultiDomain, fetchQRCode, cleanupQRCache, LOGIN_DOMAINS, DEFAULT_DOMAIN } from '../lib/login.js'
import * as cookie from '../lib/cookie.js'
import { getTaskGroups, getStats } from '../lib/conf-loader.js'
import { runTask } from '../executor/task-runner.js'
import { scheduleAll, stopAll } from '../executor/scheduler.js'

// 尝试加载 Yunzai plugin 基类 (运行时才有,开发测试时不存在)
// 参考 yeqiu6080/yunzai-plugin-skill 5.2 插件基类使用
const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const _candidates = [
  path.resolve(__dirname, '../../../../lib/plugins/plugin.js'),
  path.resolve(__dirname, '../../../lib/plugins/plugin.js'),
  path.resolve(__dirname, '../../lib/plugins/plugin.js'),
  path.resolve(__dirname, '../lib/plugins/plugin.js'),
]
let plugin = null
for (const p of _candidates) {
  if (fs.existsSync(p)) {
    try { plugin = (await import(p)).default } catch {}
    break
  }
}

if (!plugin) {
  // 离线 fallback: 简单基类,便于开发和独立测试
  plugin = class {
    constructor(opts) {
      Object.assign(this, opts || {})
      this.rule = (opts && opts.rule) || []
    }
  }
}

const logger = global.logger || console

export class QqLevelPlugin extends plugin {
  constructor() {
    super({
      name: 'yunzai_qqlevel',
      dsc: 'QQ 自动签到 / 续火 / 抽字符 / 点赞 等任务插件',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#qq登录\\s*(列表|list)?\\s*$', fnc: 'qqLoginList', permission: 'master' },
        { reg: '^#qq登录\\s*all\\s*$', fnc: 'qqLoginAll', permission: 'master' },
        { reg: '^#qq登录\\s*(\S+)$', fnc: 'qqLoginDomain', permission: 'master' },
        { reg: '^#qq刷新ck\\s*(.*)$', fnc: 'qqRefreshCk', permission: 'master' },
        { reg: '^#qqck\\s*$', fnc: 'qqCk' },
        { reg: '^#qq签到\\s*$', fnc: 'qqSign' },
        { reg: '^#qq一键(\\s+all)?\\s*$', fnc: 'qqOneClick' },
        { reg: '^#qq任务列表\\s*$', fnc: 'qqTaskList' },
        { reg: '^#qq列表\\s*$', fnc: 'qqTaskList' },
        { reg: '^#qq任务详情\\s+(\S+)$', fnc: 'qqTaskDetail' },
        { reg: '^#qq详情\\s+(\S+)$', fnc: 'qqTaskDetail' },
        { reg: '^#qq启用任务\\s+(\S+)$', fnc: 'qqEnableTask' },
        { reg: '^#qq禁用任务\\s+(\S+)$', fnc: 'qqDisableTask' },
        { reg: '^#qq统计\\s*$', fnc: 'qqStats' },
        { reg: '^#qq配置\\s*$', fnc: 'qqConfig' },
        { reg: '^#qq重载配置\\s*$', fnc: 'qqReloadConfig' },
        { reg: '^#qq签到帮助\\s*$', fnc: 'qqHelp' },
        { reg: '^#qq帮助\\s*$', fnc: 'qqHelp' },
      ],
    })
  }

  // ==================== 登录相关 ====================

  async qqLoginList(e) {
    const list = Object.keys(LOGIN_DOMAINS).map(d => `  - ${d}  (appid=${LOGIN_DOMAINS[d].appid})`).join('\n')
    await e.reply(`支持的登录域:\n${list}\n\n默认域: ${DEFAULT_DOMAIN}\n用法: #qq登录 <域>  或  #qq登录 all`)
    return true
  }

  async qqLoginDomain(e) {
    const domain = (e.msg.match(/^#qq登录\s+(\S+)$/) || [])[1]
    if (!LOGIN_DOMAINS[domain]) {
      return e.reply(`未知登录域: ${domain}\n支持: ${Object.keys(LOGIN_DOMAINS).join(', ')}`)
    }
    try {
      await e.reply(`开始扫码登录 [${domain}],请在 60 秒内扫描二维码...`)
      const r = await loginDomain(domain, {
        onQR: async ({ pngBuffer, path }) => {
          // 直接传 Buffer,避免落盘后读文件丢失 mime 信息
          await QqLevelPlugin._sendImage(e, pngBuffer || path)
          await e.reply('请扫描此二维码登录 [' + domain + ']')
        },
        onStatusChange: (s) => {
          // 只在状态变化时回调,避免重复刷屏
          const map = { '66': '⏳ 等待扫码', '67': '📱 已扫码待确认', '65': '✓ 已扫码', '68': '❌ 二维码已失效', '0': '✅ 成功' }
          if (s.status === '-2') {
            e.reply(`❌ 网络错误: ${s.message || '服务器拒绝'}`)
          } else {
            e.reply(`${map[s.status] || (s.message || s.status)}`)
          }
        },
      })
      cookie.set(r.uin, domain, r.cookies)
      await e.reply(`登录成功!\nQQ: ${r.uin}\n域: ${r.domain}\np_skey: ${(r.cookies.p_skey || '').slice(0, 8)}...`)
    } catch (err) {
      await e.reply('登录失败: ' + err.message)
    }
    return true
  }

  async qqLoginAll(e) {
    await e.reply('开始多域登录,将依次显示二维码,请按顺序扫码...')
    await loginMultiDomain(Object.keys(LOGIN_DOMAINS), {
      onDomainStart: async (d) => { await e.reply(`准备登录域: ${d}`) },
      onQR: async ({ pngBuffer, path, domain }) => {
        await QqLevelPlugin._sendImage(e, pngBuffer || path)
        await e.reply(`请扫描此二维码登录 [${domain}]`)
      },
      onStatusChange: (s) => {
        const map = { '66': '⏳ 等待扫码', '67': '📱 已扫码待确认', '65': '✓ 已扫码', '68': '❌ 二维码已失效', '0': '✅ 成功' }
        if (s.status === '-2') {
          e.reply(`❌ 网络错误: ${s.message || '服务器拒绝'}`)
        } else {
          e.reply(`${map[s.status] || (s.message || s.status)}`)
        }
      },
      onDomainDone: async (d, r) => { await e.reply(`${d} 登录${r.ok ? '成功' : '失败: ' + r.error}`) },
      onAllDone: async (all) => {
        const ok = Object.entries(all).filter(([_, r]) => r.ok).map(([d]) => d).join(', ')
        const fail = Object.entries(all).filter(([_, r]) => !r.ok).map(([d]) => d).join(', ')
        await e.reply(`多域登录完成\n成功: ${ok || '(无)'}\n失败: ${fail || '(无)'}`)
      },
    })
    return true
  }

  async qqRefreshCk(e) {
    const arg = (e.msg.match(/^#qq刷新ck\s*(.*)$/) || [])[1].trim() || DEFAULT_DOMAIN
    return this.qqLoginDomain({ ...e, msg: `#qq登录 ${arg}` })
  }

  // ==================== Cookie ====================

  async qqCk(e) {
    const all = cookie.readAll()
    const uins = Object.keys(all)
    if (uins.length === 0) return e.reply('当前未登录任何账号,请先 #qq登录')
    let text = '当前账号:\n'
    for (const u of uins) {
      text += `\nQQ: ${u}\n`
      for (const [d, ck] of Object.entries(all[u])) {
        const skey = cookie.extractSkey(ck || {})
        text += `  ${d}: skey=${skey ? skey.slice(0, 8) + '...' : '(无)'}\n`
      }
    }
    await e.reply(text)
    return true
  }

  // ==================== 任务执行 ====================

  async qqSign(e) {
    const groups = getTaskGroups()
    const all = cookie.readAll()
    const cfg = Config.getConfig('config')
    const uins = Object.keys(all)
    if (uins.length === 0) return e.reply('请先 #qq登录')
    // 显示 QQ 时去除前导 0 (QQ 内部用 10 位表示)
    const display = uins.map(u => u.replace(/^0+/, '') || '0').join(', ')
    const cfgInfo = [
      `whitelist: ${cfg.whitelist?.length ? cfg.whitelist.length + ' 群' : '(不限)'}`,
      `blacklist: ${cfg.blacklist?.length ? cfg.blacklist.length + ' 群' : '(无)'}`,
      `taskOverrides: ${Object.keys(cfg.taskOverrides || {}).length}`,
    ].join(', ')
    await e.reply(`开始执行签到任务,账号: ${display}\n配置: ${cfgInfo}`)
    for (const uin of uins) {
      const ctx = {
        uin,
        bot: e.bot || global.Bot,
        logger,
        config: cfg,
      }
      const summary = []
      for (const g of groups) {
        for (const t of (g.tasks || [])) {
          if (!Data.getTaskEnabled(t.id)) continue
          try {
            const r = await runTask(t, ctx)
            summary.push(`${t.id}: ${r.ok ? '✓' : '✗ ' + (r.msg || '')}`)
          } catch (err) {
            summary.push(`${t.id}: ✗ ${err.message}`)
          }
        }
      }
      const uinDisplay = uin.replace(/^0+/, '') || '0'
      await e.reply(`QQ ${uinDisplay} 执行结果:\n${summary.join('\n')}`)
    }
    return true
  }

  async qqOneClick(e) {
    const force = /\ball\b/.test(e.msg)
    const all = cookie.readAll()
    const cfg = Config.getConfig('config')
    const uins = Object.keys(all)
    if (uins.length === 0) return e.reply('请先 #qq登录')
    const needDomains = new Set()
    for (const g of getTaskGroups()) {
      for (const t of (g.tasks || [])) {
        if (!Data.getTaskEnabled(t.id)) continue
        try { needDomains.add(new URL(t.reqUrl).hostname) } catch {}
      }
    }
    const LOGIN_MAP = {
      'act.qzone.qq.com': 'qzone.qq.com', 'h5.qzone.qq.com': 'qzone.qq.com',
      'user.qzone.qq.com': 'qzone.qq.com', 'qun.qq.com': 'qun.qq.com',
      'vip.video.qq.com': 'vip.qq.com', 'club.vip.qq.com': 'vip.qq.com',
      'act.vip.qq.com': 'vip.qq.com',
    }
    const requiredLogins = new Set()
    for (const d of needDomains) {
      const mapped = LOGIN_MAP[d] || d
      if (LOGIN_DOMAINS[mapped]) requiredLogins.add(mapped)
    }
    const loggedDomains = new Set()
    for (const u of uins) for (const d of Object.keys(all[u] || {})) loggedDomains.add(d)
    const missing = [...requiredLogins].filter(d => force || !loggedDomains.has(d))

    const uinDisplay = uins.map(u => u.replace(/^0+/, '') || '0').join(', ')
    let status = `[一键签到] 账号: ${uinDisplay}\n`
    status += `[一键签到] 任务需要的登录域: ${[...requiredLogins].join(', ') || '(无)'}\n`
    status += `[一键签到] 已登录域: ${[...loggedDomains].join(', ') || '(无)'}\n`
    status += missing.length > 0 ? `[一键签到] 缺失域: ${missing.join(', ')}\n` : `[一键签到] 所有域已登录 ✓\n`
    status += `[一键签到] 配置: 白名单=${cfg.whitelist?.length || 0}群, 黑名单=${cfg.blacklist?.length || 0}群, taskOverrides=${Object.keys(cfg.taskOverrides || {}).length}\n`
    await e.reply(status)

    if (missing.length > 0) {
      await e.reply(`开始登录缺失域,共 ${missing.length} 个. 每个 QR 60s 内有效,请按提示扫码...`)
      for (const domain of missing) {
        try {
          const r = await loginDomain(domain, {
            onQR: async ({ pngBuffer, path: p }) => {
              await QqLevelPlugin._sendImage(e, pngBuffer || p)
              await e.reply(`请扫描此二维码登录 [${domain}]`)
            },
            onStatusChange: (s) => {
              // 只在状态变化时回调,避免重复刷屏
              const map = { '66': '⏳ 等待扫码', '67': '📱 已扫码待确认', '65': '✓ 已扫码', '68': '❌ 二维码已失效', '0': '✅ 成功' }
              if (s.status === '-2') {
                e.reply(`❌ ${domain} 网络错误: ${s.message || '服务器拒绝'}`)
              } else {
                e.reply(`${map[s.status] || (s.message || s.status)}`)
              }
            },
          })
          cookie.set(r.uin, domain, r.cookies)
          await e.reply(`✓ ${domain} 登录成功 (QQ ${r.uin})`)
        } catch (err) {
          await e.reply(`✗ ${domain} 登录失败: ${err.message}`)
        }
      }
    }
    await e.reply('开始执行所有已启用任务...')
    return this.qqSign(e)
  }

  // ==================== 任务管理 ====================

  async qqTaskList(e) {
    const groups = getTaskGroups()
    const lines = ['任务列表(共 ' + groups.reduce((a, g) => a + (g.tasks || []).length, 0) + ' 个):']
    for (const g of groups) {
      lines.push(`\n【${g.id}】`)
      for (const t of (g.tasks || [])) {
        const mark = Data.getTaskEnabled(t.id) ? '✓' : '✗'
        lines.push(`  ${mark} ${t.id}${t.desc ? ' — ' + t.desc : ''}`)
      }
    }
    await e.reply(lines.join('\n'))
    return true
  }

  async qqTaskDetail(e) {
    const id = (e.msg.match(/\S+\s+(\S+)$/) || [])[1]
    for (const g of getTaskGroups()) {
      const t = (g.tasks || []).find(x => x.id === id)
      if (t) {
        const lines = [
          `任务: ${t.id}`, `描述: ${t.desc || '-'}`,
          `类型: ${t.type || 'web'}`, `URL: ${t.reqUrl}`,
          `Method: ${t.reqMethod}`, `Cron: ${t.cron || '(手动)'}`,
          `启用: ${Data.getTaskEnabled(t.id) ? '是' : '否'}`,
        ]
        await e.reply(lines.join('\n'))
        return true
      }
    }
    await e.reply('找不到任务: ' + id)
    return true
  }

  async qqEnableTask(e) {
    const id = (e.msg.match(/^#qq启用任务\s+(\S+)$/) || [])[1]
    return this._toggleTask(e, id, true)
  }

  async qqDisableTask(e) {
    const id = (e.msg.match(/^#qq禁用任务\s+(\S+)$/) || [])[1]
    return this._toggleTask(e, id, false)
  }

  async _toggleTask(e, id, enabled) {
    if (!id) return e.reply(`用法: #qq${enabled ? '启用' : '禁用'}任务 <任务ID>`)
    let found = false
    for (const g of getTaskGroups()) {
      for (const t of (g.tasks || [])) {
        if (t.id === id) { Data.setTaskEnabled(t.id, enabled); found = true; break }
      }
      if (found) break
    }
    await e.reply(found ? `${id} 已${enabled ? '启用' : '禁用'}` : '找不到任务: ' + id)
    return true
  }

  async qqStats(e) {
    const stats = getStats()
    const cookies = cookie.readAll()
    const uins = Object.keys(cookies)
    const cfg = Config.getConfig('config')
    const lines = [
      'yunzai_qqlevel 统计', '',
      `任务配置 (xa_conf v${stats.version}):`,
      `  任务组: ${stats.totalGroups}`,
      `  任务总数: ${stats.totalTasks}`,
      `  web: ${stats.byType.web}`, `  func: ${stats.byType.func}`,
      `  mini: ${stats.byType.mini || 0}`, '',
      `已登录账号: ${uins.length}`,
      ...uins.map(u => `  QQ ${u}: ${Object.keys(cookies[u]).join(', ')}`),
      '',
      `配置:`,
      `  群白名单: ${cfg.whitelist?.length === 0 ? '(不限)' : (cfg.whitelist?.length || 0) + ' 个'}`,
      `  群黑名单: ${cfg.blacklist?.length === 0 ? '(无)' : (cfg.blacklist?.length || 0) + ' 个'}`,
      `  taskOverrides: ${Object.keys(cfg.taskOverrides || {}).length} 个`,
      `  taskCronOverrides: ${Object.keys(cfg.taskCronOverrides || {}).length} 个`,
      `  luckyChar: ${cfg.luckyChar?.enabled ? '启用' : '禁用'} (${cfg.luckyChar?.isSVIP ? 'SVIP' : '普通'})`,
    ]
    await e.reply(lines.join('\n'))
    return true
  }

  // ==================== 配置 ====================

  async qqConfig(e) {
    const cfg = Config.getConfig('config')
    await e.reply([
      '当前配置 (config/config.yaml):',
      `  defaultUin: ${cfg.defaultUin || '(未设置)'}`,
      `  dailyRunTime: ${cfg.dailyRunTime || '(每任务各自)'}`,
      `  oneClickScope: ${cfg.oneClickScope || 'all'}`,
      `  whitelist: ${cfg.whitelist?.length === 0 ? '(不限)' : (cfg.whitelist || []).join(',')}`,
      `  blacklist: ${cfg.blacklist?.length === 0 ? '(无)' : (cfg.blacklist || []).join(',')}`,
      `  luckyChar: enabled=${cfg.luckyChar?.enabled} isSVIP=${cfg.luckyChar?.isSVIP}`,
      `  defaultMessage: ${cfg.defaultMessage}`,
      `  customLoginDomains: ${Object.keys(cfg.customLoginDomains || {}).length} 个`,
      `  taskOverrides: ${JSON.stringify(cfg.taskOverrides || {})}`,
    ].join('\n'))
    return true
  }

  async qqReloadConfig(e) {
    Config.copyDefault('config')
    await e.reply('✓ 配置已重载')
    return true
  }

  // ==================== 帮助 ====================

  async qqHelp(e) {
    await e.reply([
      'yunzai_qqlevel 签到插件 帮助', '',
      '【一键】',
      '#qq一键 / #qq一键签到 - 智能签到(检查缺失 cookie → 自动登录 → 执行任务)',
      '#qq一键 all          - 强制重新登录所有域再签到', '',
      '【登录】',
      '#qq登录 [domain]      - 扫码登录指定域',
      '#qq登录 all           - 多域连续扫码登录',
      '#qq登录 列表          - 查看支持的登录域',
      '#qq刷新ck [domain]    - 同 #qq登录', '',
      '【Cookie】',
      '#qqck                 - 查看当前 cookie', '',
      '【任务】',
      '#qq签到               - 立即执行所有已启用任务',
      '#qq任务列表           - 列出所有任务',
      '#qq任务详情 <id>      - 查看任务详情',
      '#qq启用任务 <id>      - 启用指定任务',
      '#qq禁用任务 <id>      - 禁用指定任务',
      '#qq统计               - 查看任务/账号/配置统计', '',
      '【配置】',
      '#qq配置               - 查看当前配置',
      '#qq重载配置           - 重新加载 config/config.yaml', '',
      '【帮助】',
      '#qq签到帮助           - 本帮助', '',
      `支持的登录域: ${Object.keys(LOGIN_DOMAINS).join(', ')}`,
    ].join('\n'))
    return true
  }

  // ==================== 工具方法 ====================

  /**
   * 发送图片到群/私聊
   * @param {object} e Yunzai 事件
   * @param {Buffer|string} input - Buffer / 文件路径 / base64 / dataURI
   * 参考 yunzai-plugin-qqlevel 实现: Buffer.from(base64,'base64') -> segment.image(buffer)
   */
  static async _sendImage(e, input) {
    let buffer = null
    let fallbackPath = null
    try {
      // 1. 标准化输入 -> Buffer
      if (Buffer.isBuffer(input)) {
        buffer = input
      } else if (typeof input === 'string') {
        if (input.startsWith('data:image')) {
          buffer = Buffer.from(input.split(',', 2)[1] || '', 'base64')
        } else if (/^[A-Za-z0-9+/=]{100,}$/.test(input)) {
          // 纯 base64 字符串
          buffer = Buffer.from(input, 'base64')
        } else {
          // 文件路径
          fallbackPath = input
          buffer = fs.readFileSync(input)
        }
      }
      if (!buffer || buffer.length === 0) throw new Error('图片数据为空')

      // 2. Yunzai e.reply + segment.image(Buffer) - 参考 yunzai-plugin-qqlevel
      if (typeof e.reply === 'function') {
        const _seg = global.segment || (await import('oicq').then(m => m.segment).catch(() => null))
        if (_seg && _seg.image) {
          await e.reply(_seg.image(buffer))
          return
        }
        // segment 不可用, 直接用 Yunzai 通用方法
        await e.reply(Buffer.from(buffer))
        return
      }

      // 3. 降级 OneBot sendApi (base64://)
      if (e.bot && typeof e.bot.sendApi === 'function') {
        const base64 = buffer.toString('base64')
        const msg = [{ type: 'image', data: { file: `base64://${base64}` } }]
        if (e.group_id) {
          await e.bot.sendApi('send_group_msg', { group_id: e.group_id, message: msg })
        } else if (e.user_id) {
          await e.bot.sendApi('send_private_msg', { user_id: e.user_id, message: msg })
        }
        return
      }

      // 4. 兜底
      await e.reply?.(`QR 已保存到: ${fallbackPath || '(内存数据, 未发送)'}`)
    } catch (err) {
      logger.error('[yunzai_qqlevel] 发送图片失败:', err.message)
      try { await e.reply?.(`QR 已保存到: ${fallbackPath || '(发送失败)'}\n原因: ${err.message}`) } catch {}
    }
  }
}

// 默认导出: 实例化的插件,供 Yunzai 直接加载
export default new QqLevelPlugin()
