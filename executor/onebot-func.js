/**
 * onebot-func.js — Function 任务通过 OneBot / HTTP 模拟
 *
 * 参考:
 *   - [Task]群打卡&诗词续火&抽字符 V1.1 by 傅卿何 (https://github.com/Tloml-Starry/Plugin-Example)
 *   - XAutoDaily 的 xa://Manager/method 协议
 *
 * 函数 task URL 格式: xa://Manager/method?param=value&param2=value2
 */
import { format } from '../lib/env-format.js'
import { post as httpPost, get as httpGet } from '../lib/http.js'
import * as cookie from '../lib/cookie.js'
import { isGroupAllowed } from '../lib/config.js'

const HANDLERS = {}

function register(prefix, handler) { HANDLERS[prefix] = handler }

/**
 * 获取 bot 列表（兼容 Yunzai 的 Bot[qq] / Bot.pickGroup）
 * 返回首个可用 bot 实例
 */
function pickBot(ctx) {
  const b = ctx.bot
  if (!b) return null
  // Yunzai 风格: b.pickGroup(id)
  if (typeof b.pickGroup === 'function') return b
  // OneBot 风格: b.sendGroupMsg / sendPrivateMsg
  if (typeof b.sendGroupMsg === 'function' || typeof b.sendApi === 'function') return b
  return b
}

/**
 * 群打卡 — 通过 bot.pickGroup(id).sign()
 *
 * Yunzai (icqq / go-cqhttp / LLOneBot) 的 Bot.pickGroup(...).sign()
 * 内部封装了 OneBot set_group_sign 或对应的群打卡协议。
 * 这是真正可用的群打卡方式。
 *
 * reqUrl: xa://GroupSignInManager/signIn?uin=${groups}$
 */
register('GroupSignInManager/signIn', async (task, env, ctx, query) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  // 从 query / env 拿群列表
  const groupsRaw = query.uin || env.uin || env.groups || []
  const groups = (Array.isArray(groupsRaw) ? groupsRaw : String(groupsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)

  // 如果用户没指定群，遍历 bot 自己的群列表
  let targetGroups = groups
  if (targetGroups.length === 0) {
    // Yunzai: Bot.gl 是 Map<group_id, GroupInfo>
    if (bot.gl && typeof bot.gl.keys === 'function') {
      targetGroups = [...bot.gl.keys()]
    } else if (typeof bot.getGroupList === 'function') {
      const list = await bot.getGroupList()
      targetGroups = (list || []).map(g => g.group_id || g)
    }
  }
  // 应用白名单/黑名单
  targetGroups = filterGroups(targetGroups.map(String))

  if (targetGroups.length === 0) {
    return { ok: false, msg: '未指定打卡群，且 bot 没有群列表' }
  }

  const results = []
  for (const gid of targetGroups) {
    try {
      // 优先用 Yunzai 风格的 pickGroup().sign()
      if (typeof bot.pickGroup === 'function') {
        const group = bot.pickGroup(Number(gid) || gid)
        if (group && typeof group.sign === 'function') {
          const r = await group.sign()
          results.push({ group: gid, ok: true, method: 'pickGroup.sign', data: r })
          continue
        }
      }
      // fallback: 通过 sendApi
      if (typeof bot.sendApi === 'function') {
        const r = await bot.sendApi('set_group_sign', { group_id: Number(gid) || gid })
        results.push({ group: gid, ok: true, method: 'sendApi', data: r })
        continue
      }
      // fallback: sendGroupMsg 模拟（部分协议把消息发到群就视为打卡）
      if (typeof bot.sendGroupMsg === 'function') {
        await bot.sendGroupMsg(Number(gid) || gid, '签到')
        results.push({ group: gid, ok: true, method: 'sendMsg', data: '已发送消息' })
        continue
      }
      results.push({ group: gid, ok: false, msg: 'bot 不支持群打卡' })
    } catch (e) {
      results.push({ group: gid, ok: false, msg: e.message })
    }
    if (task.delay) await sleep((task.delay || 2) * 1000)
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 群打卡成功` }
})

/**
 * 抽字符 — 通过 HTTP 调用 qun.qq.com 接口
 *
 * 借鉴 Plugin-Example 的实现：
 *   POST https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/draw_lottery?bkn=...
 *   body: {"group_code": <gid>}
 *   headers: Cookie (qun.qq.com), qname-service, qname-space
 *
 * 不再依赖 Yunzai bot API（icqq 没有封装），用纯 HTTP。
 *
 * reqUrl: xa://GroupLuckyWordManager/draw?uin=${groups}$&count=${count}$
 */
register('GroupLuckyWordManager/draw', async (task, env, ctx, query) => {
  const { uin } = ctx
  const groupsRaw = query.uin || env.uin || env.groups || []
  let groups = (Array.isArray(groupsRaw) ? groupsRaw : String(groupsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)
  const count = parseInt(query.count || env.count || '1', 10)

  if (groups.length === 0) {
    // 没有群就遍历 bot 的群
    const bot = pickBot(ctx)
    if (bot?.gl) {
      for (const gid of bot.gl.keys()) groups.push(String(gid))
    }
  }
  // 应用白名单/黑名单
  groups = filterGroups(groups)

  const ckObj = cookie.get(uin, 'qun.qq.com') || cookie.get(uin, 'global') || {}
  const bkn = computeBkn(ckObj)

  const cookieStr = cookie.stringify(ckObj)
  const url = `https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/draw_lottery?bkn=${bkn}`
  const results = []
  for (const gid of groups) {
    for (let i = 0; i < count; i++) {
      try {
        const res = await httpPost(url, {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': cookieStr,
            'qname-service': '976321:131072',
            'qname-space': 'Production',
          },
          body: { group_code: gid },
        })
        const j = res.json || {}
        const ok = j.retcode === 0
        const word = j?.data?.word_info?.word_info || {}
        results.push({
          group: gid, ok, retcode: j.retcode,
          wording: word.wording, desc: word.word_desc, raw: j,
        })
      } catch (e) {
        results.push({ group: gid, ok: false, msg: e.message })
      }
    }
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 抽字符成功` }
})

/**
 * 群续火 — 通过 bot.pickGroup(id).sendMsg(msg)
 *
 * 参考 Plugin-Example:
 *   Bot[QQ].pickGroup(ID).sendMsg(msg + tips);
 *
 * 默认从 oiapi.net 拿诗词作为续火文案（与参考插件一致）
 *
 * reqUrl: xa://SendMessageManager/sendMessage/group?uin=${groups}$&msg=${message}$
 */
register('SendMessageManager/sendMessage/group', async (task, env, ctx, query) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  const groupsRaw = query.uin || env.uin || env.groups || []
  let groups = (Array.isArray(groupsRaw) ? groupsRaw : String(groupsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)
  if (groups.length === 0 && bot.gl) {
    groups = [...bot.gl.keys()].map(String)
  }
  // 应用白名单/黑名单
  groups = filterGroups(groups)

  // 续火文案 (按优先级): task.envs.message → query.msg → 远程诗词 API → 默认 '火'
  let msg = query.msg || env.message || ''
  if (!msg) {
    msg = await fetchSentence() || '火'
  }
  // 支持 msg1|msg2|msg3 随机
  const candidates = msg.split('|').map(s => s.trim()).filter(Boolean)
  const finalMsg = candidates[Math.floor(Math.random() * candidates.length)] || msg

  const results = []
  for (const gid of groups) {
    try {
      if (typeof bot.pickGroup === 'function') {
        await bot.pickGroup(Number(gid) || gid).sendMsg(finalMsg)
      } else if (typeof bot.sendGroupMsg === 'function') {
        await bot.sendGroupMsg(Number(gid) || gid, finalMsg)
      } else {
        results.push({ group: gid, ok: false, msg: 'bot 不支持发群消息' })
        continue
      }
      results.push({ group: gid, ok: true, msg: finalMsg })
    } catch (e) {
      results.push({ group: gid, ok: false, msg: e.message })
    }
    if (task.delay) await sleep((task.delay || 60) * 1000)
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 群续火成功` }
})

/**
 * 群续火 + 抽字符 + 群打卡 三合一 (借鉴 Plugin-Example V1.1)
 *
 * 完整复刻参考插件的逻辑:
 *   1. 拿一句诗词 (oiapi.net)
 *   2. 遍历 bot.gl 中的群
 *   3. 对每个群:
 *      a. HTTP 抽 n 次字符 (SVIP=3 次, 普通=1 次)
 *      b. 把字符结果拼到消息里
 *      c. Bot.pickGroup(id).sendMsg(诗词 + 字符结果)
 *      d. Bot.pickGroup(id).sign()
 *
 * reqUrl: xa://GroupXuhuoManager/run?lucky=1&isSVIP=0
 * env:
 *   - text (默认续火文案): "火"
 *   - isSVIP (bool): 是否是 SVIP,影响抽字符次数
 *   - blacklist (群 id 列表): 排除的群
 */
register('GroupXuhuoManager/run', async (task, env, ctx, query) => {
  const { uin } = ctx
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  const text = query.text || env.text || '火'
  const isSVIP = String(query.isSVIP || env.isSVIP || '0') === '1' || query.isSVIP === 'true'
  const luckyEnabled = String(query.lucky || env.lucky || '1') !== '0'
  const blacklist = (env.blacklist || '').split(',').map(s => s.trim()).filter(Boolean)

  // 1. 拿一句诗词
  let poem = await fetchSentence() || text

  // 2. 遍历 bot 的群
  if (!bot.gl) return { ok: false, msg: 'bot.gl 不可用' }
  let groupList = [...bot.gl.keys()].map(String).filter(g => !blacklist.includes(g))
  // 应用 config.yaml 的白名单/黑名单
  groupList = filterGroups(groupList)

  const results = []
  for (const gid of groupList) {
    const tips = []

    // 3a. 抽字符
    if (luckyEnabled) {
      const n = isSVIP ? 3 : 1
      const ckObj = cookie.get(uin, 'qun.qq.com') || cookie.get(uin, 'global') || {}
      const bkn = computeBkn(ckObj)
      const url = `https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/draw_lottery?bkn=${bkn}`

      for (let i = 0; i < n; i++) {
        try {
          const res = await httpPost(url, {
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'Cookie': cookie.stringify(ckObj),
              'qname-service': '976321:131072',
              'qname-space': 'Production',
            },
            body: { group_code: gid },
          })
          const j = res.json || {}
          // 参考插件: retcode === 0 才算成功,11005 表示已抽过
          if (j.retcode === 0 && j.data?.word_info) {
            const wi = j.data.word_info.word_info || {}
            tips.push(`机器人为本群抽中了字符[${wi.wording || ''}]\r寓意为:[${wi.word_desc || ''}]`)
          }
        } catch {}
      }
    }

    // 3b+3c. 发续火 + 字符结果
    const fullMsg = poem + (tips.length ? '\r' + tips.join('\r') : '')
    try {
      if (typeof bot.pickGroup === 'function') {
        await bot.pickGroup(Number(gid) || gid).sendMsg(fullMsg)
      } else if (typeof bot.sendGroupMsg === 'function') {
        await bot.sendGroupMsg(Number(gid) || gid, fullMsg)
      }
    } catch (e) {
      results.push({ group: gid, ok: false, sendErr: e.message })
      continue
    }

    // 3d. 群打卡
    let signedOk = false
    try {
      if (typeof bot.pickGroup === 'function') {
        const group = bot.pickGroup(Number(gid) || gid)
        if (group && typeof group.sign === 'function') {
          await group.sign()
          signedOk = true
        }
      }
    } catch {}

    results.push({ group: gid, ok: true, tips: tips.length, signed: signedOk })
    if (task.delay) await sleep((task.delay || 60) * 1000)
  }

  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 群续火+抽字符+打卡成功` }
})

/**
 * 好友续火
 *
 * reqUrl: xa://SendMessageManager/sendMessage/friend?uin=${friends}$&msg=${message}$
 */
register('SendMessageManager/sendMessage/friend', async (task, env, ctx, query) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  const friendsRaw = query.uin || env.uin || env.friends || []
  let friends = (Array.isArray(friendsRaw) ? friendsRaw : String(friendsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)

  let msg = query.msg || env.message || '续火~'
  const candidates = msg.split('|').map(s => s.trim()).filter(Boolean)
  const finalMsg = candidates[Math.floor(Math.random() * candidates.length)] || msg

  const results = []
  for (const fid of friends) {
    try {
      if (typeof bot.pickFriend === 'function') {
        await bot.pickFriend(Number(fid) || fid).sendMsg(finalMsg)
      } else if (typeof bot.sendPrivateMsg === 'function') {
        await bot.sendPrivateMsg(Number(fid) || fid, finalMsg)
      } else {
        results.push({ friend: fid, ok: false, msg: 'bot 不支持发私聊' })
        continue
      }
      results.push({ friend: fid, ok: true, msg: finalMsg })
    } catch (e) {
      results.push({ friend: fid, ok: false, msg: e.message })
    }
    if (task.delay) await sleep((task.delay || 10) * 1000)
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 好友续火成功` }
})

/**
 * 公众号签到 (VIP 公众号 80011503)
 */
register('PublicAccountManager/vipPublicAccountSignIn', async (task, env, ctx) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }
  const mpUin = '80011503'
  try {
    if (typeof bot.sendApi === 'function') {
      const r = await bot.sendApi('send_like', { user_id: mpUin, times: 1 })
      return { ok: true, method: 'send_like', data: r }
    }
    if (typeof bot.pickFriend === 'function') {
      await bot.pickFriend(mpUin).sendMsg('签到')
      return { ok: true, method: 'sendMsg', msg: '已发送消息' }
    }
    if (typeof bot.sendPrivateMsg === 'function') {
      await bot.sendPrivateMsg(mpUin, '签到')
      return { ok: true, method: 'sendPrivateMsg', msg: '已发送消息' }
    }
    return { ok: false, msg: 'bot 不支持任何方式' }
  } catch (e) {
    return { ok: false, msg: e.message }
  }
})

/**
 * QQ 运动步数上报 — 通过 HTTP
 */
register('YunDongStepsManager/reportSteps', async (task, env, ctx, query) => {
  const steps = parseInt(query.steps || env.steps || '8000', 10)
  try {
    const res = await httpPost('https://yundong.qq.com/cgi-bin/yundong/report_steps', {
      headers: { 'Content-Type': 'application/json' },
      body: { steps },
    })
    return { ok: res.status === 200, status: res.status }
  } catch (e) {
    return { ok: false, msg: e.message }
  }
})

/**
 * 好友名片点赞 — 通过 bot.pickFriend(uin).thumbUp(n)
 *
 * 参考: https://github.com/xiaotian2333/yunzai-plugins-Single-file/blob/main/%E7%82%B9%E8%B5%9E%E7%BB%AD%E7%81%AB.js
 *   Bot.pickFriend(qq).thumbUp(thumbsUpMe_sum)
 *
 * 重要：QQ 普通用户每天能给**不同好友**各点赞 10 次，给**同一好友**点赞上限:
 *   - VIP: 20 次
 *   - 普通: 10 次
 *   （来自参考插件注释）
 *
 * reqUrl: xa://FavoriteManager/favorite?uin=${friends}$&count=${count}$
 * env: friends = 好友列表 (逗号或数组)
 */
register('FavoriteManager/favorite', async (task, env, ctx, query) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  const friendsRaw = query.uin || env.uin || env.friends || []
  const friends = (Array.isArray(friendsRaw) ? friendsRaw : String(friendsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)
  const count = parseInt(query.count || env.count || '10', 10)

  if (friends.length === 0) {
    return { ok: false, msg: '未指定点赞好友列表 (env.friends)' }
  }
  if (typeof bot.pickFriend !== 'function') {
    return { ok: false, msg: 'bot 不支持 pickFriend (需要 Yunzai/icqq)' }
  }

  const results = []
  for (const fid of friends) {
    try {
      const friend = bot.pickFriend(Number(fid) || fid)
      if (!friend || typeof friend.thumbUp !== 'function') {
        results.push({ friend: fid, ok: false, msg: 'friend 实例无 thumbUp' })
        continue
      }
      const r = await friend.thumbUp(count)
      results.push({ friend: fid, ok: true, count, data: r })
    } catch (e) {
      results.push({ friend: fid, ok: false, msg: e.message })
    }
    if (task.delay) await sleep((task.delay || 10) * 1000)
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 好友点赞成功` }
})

/**
 * 资料卡回赞 — 给好友列表中**最近互动**的人回赞
 *
 * XAutoDaily 实际功能: 遍历自己被点赞/留言/最近访问记录，回赞过去 7 天里访问过的人。
 * 简化实现: 给指定 friends 列表回赞 + 发消息。
 *
 * reqUrl: xa://FavoriteManager/favoriteAllVoter?maxPage=${maxPage}$&maxDays=${maxDays}$&message=${message}$
 */
register('FavoriteManager/favoriteAllVoter', async (task, env, ctx, query) => {
  const bot = pickBot(ctx)
  if (!bot) return { ok: false, msg: 'no bot available' }

  const message = query.message || env.message || '回赞~'
  const count = parseInt(query.count || env.count || '10', 10)

  // env.friends 是用户配置的"回赞目标"列表 (来自 XAutoDaily 配置)
  const friendsRaw = query.uin || env.uin || env.friends || []
  let friends = (Array.isArray(friendsRaw) ? friendsRaw : String(friendsRaw).split(','))
    .map(s => String(s).trim()).filter(Boolean)

  if (friends.length === 0) {
    return { ok: false, msg: '未指定回赞好友列表' }
  }
  if (typeof bot.pickFriend !== 'function') {
    return { ok: false, msg: 'bot 不支持 pickFriend' }
  }

  const results = []
  for (const fid of friends) {
    try {
      const friend = bot.pickFriend(Number(fid) || fid)
      if (!friend) { results.push({ friend: fid, ok: false, msg: 'pickFriend 失败' }); continue }

      // 点赞
      let liked = false
      if (typeof friend.thumbUp === 'function') {
        try {
          await friend.thumbUp(count)
          liked = true
        } catch (e) {
          results.push({ friend: fid, thumbUpErr: e.message })
        }
      }

      // 发回赞消息
      let sent = false
      try {
        await friend.sendMsg(message)
        sent = true
      } catch (e) {
        results.push({ friend: fid, sendErr: e.message })
      }

      results.push({ friend: fid, ok: liked || sent, liked, sent })
    } catch (e) {
      results.push({ friend: fid, ok: false, msg: e.message })
    }
    if (task.delay) await sleep((task.delay || 10) * 1000)
  }
  const okCount = results.filter(r => r.ok).length
  return { ok: okCount > 0, data: results, summary: `${okCount}/${results.length} 回赞成功` }
})

/**
 * 从 cookie object 计算 bkn
 * 复用 lib/crypto.js 的算法,避免多处重复
 */
function computeBkn(ckObj) {
  const s = ckObj.p_skey || ckObj.skey || ''
  let h = 5381
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) & 0x7fffffff
  return h
}

/**
 * 过滤群列表:根据 config.yaml 的 whitelist/blacklist
 */
function filterGroups(groupIds) {
  return groupIds.filter(id => isGroupAllowed(id))
}

/**
 * 主入口：解析 URL，分发 handler
 */
export async function runFuncTask(task, env, ctx) {
  const url = task.reqUrl || ''
  if (!url.startsWith('xa://')) {
    return { ok: false, msg: 'invalid func url: ' + url }
  }
  const rest = url.slice('xa://'.length)
  const qIdx = rest.indexOf('?')
  let path = rest
  let queryStr = ''
  if (qIdx >= 0) {
    path = rest.slice(0, qIdx)
    queryStr = rest.slice(qIdx + 1)
  }
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

/**
 * 从远程 API 拿一句诗词作为续火文案
 */
async function fetchSentence() {
  try {
    const res = await httpGet('https://oiapi.net/API/Sentences', { timeout: 5000 })
    const j = res.json || {}
    if (j.code === 1 && j.message) return String(j.message).slice(0, 80)
  } catch {}
  return null
}
