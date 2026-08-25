/**
 * onebot-func.js — Function 任务通过 OneBot API 模拟
 *
 * XAutoDaily 通过 Xposed Hook 调用 QQ 内部 SDK 实现:
 *   - 群打卡 OIDB 0xeb7 → Yunzai 无法直接发 OIDB，退化为通过 bot.sendGroupMsg 等
 *   - 好友名片点赞 OIDB → 暂不支持
 *   - 续火 sendMsg → 通过 bot.sendGroupMsg / sendPrivateMsg
 *   - 公众号签到 → 通过 sendGroupMsg 给公众号
 *   - QZone 亲密空间签到 → 暂不支持
 *   - YunDong 步数上报 → HTTP 调用
 *   - Favorite 收藏点赞 → 暂不支持
 *
 * 函数 task URL 格式: xa://Manager/method?param=value&param2=value2
 */
import { format } from '../lib/env-format.js'

const HANDLERS = {}

function register(prefix, handler) { HANDLERS[prefix] = handler }

/**
 * 群打卡 — 通过 Yunzai 的 bot API
 * 注: 真正 OIDB 0xeb7 需要 QQ 客户端进程内部权限，外部 bot 难以发
 * 这里用兼容做法：调用 Yunzai 的 Bot.sendApi('group_sign', { group_id })
 */
register('GroupSignInManager/signIn', async (task, env, ctx, query) => {
  const { bot } = ctx
  const uin = query.uin || env.uin || env.groups
  if (!uin) return { ok: false, msg: 'missing group uin' }
  const uins = Array.isArray(uin) ? uin : [uin]
  const results = []
  for (const gid of uins) {
    try {
      if (bot && bot.sendApi) {
        try {
          const r = await bot.sendApi('group_sign', { group_id: gid })
          results.push({ group: gid, ok: true, data: r })
          continue
        } catch {}
      }
      results.push({ group: gid, ok: false, msg: 'OneBot 不支持群打卡 OIDB，需要 Xposed' })
    } catch (e) {
      results.push({ group: gid, ok: false, msg: e.message })
    }
  }
  return { ok: results.some(r => r.ok), data: results }
})

/**
 * 群组续火 — 发送消息
 * reqUrl: xa://SendMessageManager/sendMessage/group?uin=${groups}$&msg=${message}$
 */
register('SendMessageManager/sendMessage/group', async (task, env, ctx, query) => {
  const { bot } = ctx
  const groups = Array.isArray(query.uin) ? query.uin : (query.uin ? [query.uin] : (Array.isArray(env.groups) ? env.groups : []))
  const message = query.msg || env.message || '续火~'
  if (!bot || !bot.sendGroupMsg) return { ok: false, msg: 'no bot api' }
  const results = []
  for (const gid of groups) {
    try {
      const msgs = message.split('|').map(s => s.trim()).filter(Boolean)
      const msg = msgs[Math.floor(Math.random() * msgs.length)] || message
      await bot.sendGroupMsg(gid, msg)
      results.push({ group: gid, ok: true, msg })
      if (task.delay) await sleep((task.delay || 10) * 1000)
    } catch (e) {
      results.push({ group: gid, ok: false, msg: e.message })
    }
  }
  return { ok: results.every(r => r.ok), data: results }
})

/**
 * 好友续火
 */
register('SendMessageManager/sendMessage/friend', async (task, env, ctx, query) => {
  const { bot } = ctx
  const friends = Array.isArray(query.uin) ? query.uin : (query.uin ? [query.uin] : (Array.isArray(env.friends) ? env.friends : []))
  const message = query.msg || env.message || '续火~'
  if (!bot || !bot.sendPrivateMsg) return { ok: false, msg: 'no bot api' }
  const results = []
  for (const fid of friends) {
    try {
      const msgs = message.split('|').map(s => s.trim()).filter(Boolean)
      const msg = msgs[Math.floor(Math.random() * msgs.length)] || message
      await bot.sendPrivateMsg(fid, msg)
      results.push({ friend: fid, ok: true, msg })
      if (task.delay) await sleep((task.delay || 10) * 1000)
    } catch (e) {
      results.push({ friend: fid, ok: false, msg: e.message })
    }
  }
  return { ok: results.every(r => r.ok), data: results }
})

/**
 * 公众号签到
 */
register('PublicAccountManager/vipPublicAccountSignIn', async (task, env, ctx) => {
  const { bot } = ctx
  if (!bot || !bot.sendPrivateMsg) return { ok: false, msg: 'no bot api' }
  const mpUin = '80011503'
  try {
    if (bot.sendApi) {
      try {
        const r = await bot.sendApi('send_like', { user_id: mpUin, times: 1 })
        return { ok: true, data: r }
      } catch {}
    }
    await bot.sendPrivateMsg(mpUin, '签到')
    return { ok: true, msg: '已发送消息' }
  } catch (e) {
    return { ok: false, msg: e.message }
  }
})

/**
 * QQ 运动步数上报 — 通过 HTTP
 */
register('YunDongStepsManager/reportSteps', async (task, env, ctx, query) => {
  const steps = parseInt(query.steps || env.steps || '8000', 10)
  const { post } = await import('../lib/http.js')
  try {
    const res = await post('https://yundong.qq.com/cgi-bin/yundong/report_steps', {
      headers: { 'Content-Type': 'application/json' },
      body: { steps },
    })
    return { ok: res.status === 200, status: res.status }
  } catch (e) {
    return { ok: false, msg: e.message }
  }
})

/**
 * QZone 亲密空间签到 — 暂不支持
 */
register('QZIntimateSpaceManager/doCheckInRequest', async () => {
  return { ok: false, msg: 'QZone 亲密空间签到需要 Xposed 注入 QQ 客户端，外部 bot 无法实现' }
})

/**
 * 好友点赞
 */
register('FavoriteManager/favoriteAllVoter', async () => {
  return { ok: false, msg: '好友名片点赞需要 OIDB 协议，外部 bot 暂不支持' }
})

register('FavoriteManager/favorite', async () => {
  return { ok: false, msg: '好友名片点赞需要 OIDB 协议，外部 bot 暂不支持' }
})

/**
 * 主入口：解析 URL，分发 handler
 */
export async function runFuncTask(task, env, ctx) {
  const url = task.reqUrl || ''
  if (!url.startsWith('xa://')) {
    return { ok: false, msg: 'invalid func url: ' + url }
  }
  // 解析 xa://Manager/method?param=value
  const rest = url.slice('xa://'.length)
  const qIdx = rest.indexOf('?')
  let path = rest
  let queryStr = ''
  if (qIdx >= 0) {
    path = rest.slice(0, qIdx)
    queryStr = rest.slice(qIdx + 1)
  }
  // 把 query 参数解析成对象，并执行 ${var}$ 替换
  const query = parseQuery(queryStr, env)
  const handler = HANDLERS[path]
  if (!handler) {
    return { ok: false, msg: `未实现 func 任务: ${path}` }
  }
  return handler(task, env, ctx, query)
}

function parseQuery(qs, env) {
  const out = {}
  if (!qs) return out
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq)
    const v = format(part.slice(eq + 1), env)
    out[k] = v
  }
  return out
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
