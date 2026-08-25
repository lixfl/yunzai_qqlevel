/**
 * task-runner.js — 通用任务执行器
 *
 * 支持 XAutoDaily task 描述:
 *   - type: 'web'           → HTTP 任务
 *   - type: 'func'          → Function 任务 (通过 OneBot 模拟)
 *   - type: 'mini|<id>|<name>' → 小程序任务 (暂不支持)
 *
 * task 字段:
 *   id, desc, cron, envs, conditions, repeat, delay,
 *   reqUrl, reqMethod, reqHeaders, reqData, domain,
 *   callback: { dataRegex, extracts, assert, sucMsg, errMsg }
 */
import { format, formatList } from '../lib/env-format.js'
import { post, get as httpGet } from '../lib/http.js'
import * as cookie from '../lib/cookie.js'
import { gtk, getSkey } from '../lib/crypto.js'
import * as oneBot from './onebot-func.js'

const USER_AGENT_QQ = 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

/**
 * 把所有域的 cookie 收集合并 (腾讯多域 SSO 用)
 * @returns {string} 合并后的 cookie 字符串
 */
function collectAllDomainCookies(uin) {
  const all = cookie.getAll(uin)
  const seen = new Set()
  const pairs = []
  for (const [, cobj] of Object.entries(all)) {
    for (const [k, v] of Object.entries(cobj)) {
      if (v && !seen.has(k)) {
        seen.add(k)
        pairs.push(`${k}=${v}`)
      }
    }
  }
  return pairs.join('; ')
}

/**
 * 合并两个 cookie 字符串，去重
 */
function mergeCookies(a, b) {
  const seen = new Map()
  for (const p of (a || '').split(';')) {
    const i = p.indexOf('=')
    if (i > 0) seen.set(p.slice(0, i).trim(), p.slice(i + 1).trim())
  }
  for (const p of (b || '').split(';')) {
    const i = p.indexOf('=')
    if (i > 0) seen.set(p.slice(0, i).trim(), p.slice(i + 1).trim())
  }
  return [...seen.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * 解析 ${u1, u2, u3}$ 形式的多值 (按 , 分割)
 */
function parseListVar(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * 解析 env 字符串"u1|u2|u3"
 * 不再用 , 分割（避免误判"8,5"为数组）
 */
function parseEnvValue(env) {
  const out = { ...env }
  for (const e of Object.keys(out)) {
    const v = out[e]
    if (typeof v === 'string' && v.includes('|')) {
      out[e] = v.split('|').map(s => s.trim()).filter(Boolean)
    }
  }
  return out
}

/**
 * 执行单个 task
 */
/**
 * 查找同 group 中指定 id 的 task (用于 relay/rear 引用)
 */
function findTaskById(taskId, ctx) {
  // 先查 ctx.currentGroup
  const grp = ctx.currentGroup
  if (grp && grp.tasks) {
    const t = grp.tasks.find(x => x.id === taskId)
    if (t) return t
  }
  if (grp && grp.preTasks) {
    const t = grp.preTasks.find(x => x.id === taskId)
    if (t) return t
  }
  return null
}

/**
 * 执行 relay 链 (前置任务,如"加好友")
 */
async function runRelayChain(task, ctx) {
  if (!task.relay) return { ok: true, skipped: true }
  const relayNames = String(task.relay).split('|').map(s => s.trim()).filter(Boolean)
  const out = []
  for (const name of relayNames) {
    const subTask = findTaskById(name, ctx)
    if (!subTask) {
      out.push({ relay: name, ok: false, msg: 'relay task not found' })
      continue
    }
    const r = await runTask(subTask, ctx)
    out.push({ relay: name, ok: r.ok, msg: r.msg || '' })
  }
  return { ok: out.every(r => r.ok), chain: out }
}

/**
 * 执行 rear 链 (后置任务,如"删好友")
 */
async function runRearChain(task, ctx) {
  if (!task.rear) return { ok: true, skipped: true }
  const rearNames = String(task.rear).split('|').map(s => s.trim()).filter(Boolean)
  const out = []
  for (const name of rearNames) {
    const subTask = findTaskById(name, ctx)
    if (!subTask) {
      out.push({ rear: name, ok: false, msg: 'rear task not found' })
      continue
    }
    const r = await runTask(subTask, ctx)
    out.push({ rear: name, ok: r.ok, msg: r.msg || '' })
  }
  return { ok: out.every(r => r.ok), chain: out }
}

export async function runTask(task, ctx = {}) {
  const { uin, groupId, bot, logger } = ctx
  const allCks = cookie.getAll(uin)
  const skeyFromConf = getSkey(allCks)
  const baseEnv = {
    uin,
    skey: skeyFromConf,
    p_skey: skeyFromConf,
    ps_tk: gtk(skeyFromConf),
    bkn: gtk(skeyFromConf),
    random: Math.random(),
    time: Date.now(),
    microsecond: Date.now() * 1000,
    timeSecond: Math.floor(Date.now() / 1000),
    // ti.qq.com 接口需要的 qua 字段 (QQ 标准 UA)
    qua: 'V1_IPH_SQ_9.1.0_0_TIM_YYB_9.1.0_8_a52b32d3',
  }
  for (const e of (task.envs || [])) {
    if (baseEnv[e.name] == null) baseEnv[e.name] = e.default
  }
  const env = parseEnvValue(baseEnv)

  const type = task.type || 'web'

  try {
    // 1. 执行 relay 链 (前置任务)
    if (task.relay) {
      const relay = await runRelayChain(task, ctx)
      if (!relay.ok) {
        return { ok: false, msg: 'relay failed', relay }
      }
    }

    // 2. 执行主任务
    let mainResult
    if ((task.reqUrl || '').startsWith('xa://')) {
      mainResult = await oneBot.runFuncTask(task, env, ctx)
    } else {
      mainResult = await runHttpTask(task, env, ctx)
    }

    // 3. 执行 rear 链 (后置任务) - 即使主任务失败也要执行清理
    if (task.rear) {
      const rear = await runRearChain(task, ctx)
      mainResult.rear = rear
    }

    return mainResult
  } catch (e) {
    logger && logger.error && logger.error('[xa]', task.id, 'failed:', e.message)
    return { ok: false, msg: e.message }
  }
}

async function runHttpTask(task, env, ctx) {
  const { uin } = ctx
  const urlDomain = guessDomainFromUrl(task.reqUrl)
  const domain = task.domain || urlDomain
  // 优先取 task.domain 对应 cookie，否则按 URL 域名，最后 global
  let cookieObj = cookie.get(uin, domain) || cookie.get(uin, urlDomain) || cookie.get(uin, 'global') || {}
  let cookieStr = cookie.stringify(cookieObj)

  const urls = formatList(task.reqUrl, env)
  const headers = { 'User-Agent': USER_AGENT_QQ, ...(task.reqHeaders || {}) }
  if (cookieStr) headers['Cookie'] = cookieStr
  headers['Referer'] = headers['Referer'] || `https://${domain}/`

  // 合并所有已收集的域 cookie (腾讯某些接口需要在 Host header 之外注入多域 cookie)
  const allCookies = collectAllDomainCookies(uin)
  if (allCookies) headers['Cookie'] = mergeCookies(headers['Cookie'], allCookies)

  let result = { ok: false, msg: 'no response' }
  // 支持 task.repeat 为模板字符串 (如 "$repeat")
  const repeatStr = format(String(task.repeat || '1'), env)
  const repeat = Math.max(1, parseInt(repeatStr, 10) || 1)
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const body = task.reqData ? format(task.reqData, env) : null
    for (let r = 0; r < repeat; r++) {
      try {
        const res = task.reqMethod && task.reqMethod.toUpperCase() === 'GET'
          ? await httpGet(url, { headers, timeout: 15000 })
          : await post(url, { headers, body, timeout: 15000 })
        result = { ok: res.status === 200, status: res.status, body: res.body, json: res.json }
        if (task.delay) await sleep(task.delay * 1000)
      } catch (e) {
        result = { ok: false, msg: e.message }
      }
    }
  }

  // callback 处理
  if (task.callback && task.callback.assert) {
    const c = task.callback.assert
    const key = format(c.key, env)
    const expected = format(c.value, env)
    if (key === 'status') {
      result.ok = String(result.status) === expected
    }
  }

  return result
}

function guessDomainFromUrl(url) {
  try { return new URL(url).hostname } catch { return '' }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/**
 * 批量执行 task group 中的所有 task
 */
export async function runTaskGroup(group, ctx = {}) {
  const out = []
  // 把 currentGroup 注入 ctx,供 relay/rear 查找同组内的 task
  const groupCtx = { ...ctx, currentGroup: group }
  for (const task of (group.tasks || [])) {
    for (const pre of (group.preTasks || [])) {
      out.push(await runTask(pre, groupCtx))
    }
    out.push(await runTask(task, groupCtx))
  }
  return out
}
