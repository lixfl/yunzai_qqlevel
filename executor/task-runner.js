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
 * 解析 ${u1, u2, u3}$ 形式的多值 (按 , 分割)
 */
function parseListVar(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * 解析 env 字符串"u1|u2|u3"或"u1,u2,u3"
 */
function parseEnvValue(env) {
  const out = { ...env }
  for (const e of Object.keys(out)) {
    const v = out[e]
    if (typeof v === 'string' && v.includes('|')) {
      out[e] = v.split('|').map(s => s.trim()).filter(Boolean)
    } else if (typeof v === 'string' && /\d/.test(v) && /,\d/.test(v)) {
      // 形如 "123,456" 数字数组
      out[e] = v.split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return out
}

/**
 * 执行单个 task
 * @param {object} task task 描述
 * @param {object} ctx { uin, groupId?, bot, logger }
 * @returns {Promise<{ok: boolean, msg: string, data?: any}>}
 */
export async function runTask(task, ctx = {}) {
  const { uin, groupId, bot, logger } = ctx
  const skeyFromConf = getSkey(cookie.getAll(uin))
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
  }
  // 把 task.envs 的 default 值注入
  for (const e of (task.envs || [])) {
    if (baseEnv[e.name] == null) baseEnv[e.name] = e.default
  }
  // 解析 list 形式
  const env = parseEnvValue(baseEnv)

  const type = task.type || 'web'

  try {
    if (task.reqUrl.startsWith('xa://')) {
      return await oneBot.runFuncTask(task, env, ctx)
    }
    // 普通 HTTP
    return await runHttpTask(task, env, ctx)
  } catch (e) {
    logger && logger.error && logger.error('[xa]', task.id, 'failed:', e.message)
    return { ok: false, msg: e.message }
  }
}

async function runHttpTask(task, env, ctx) {
  const { uin } = ctx
  const domain = task.domain || guessDomainFromUrl(task.reqUrl)
  const cookieObj = cookie.get(uin, domain) || cookie.get(uin, 'global') || {}
  const cookieStr = cookie.stringify(cookieObj)

  const urls = formatList(task.reqUrl, env)
  const headers = { 'User-Agent': USER_AGENT_QQ, ...(task.reqHeaders || {}) }
  if (cookieStr) headers['Cookie'] = cookieStr
  headers['Referer'] = headers['Referer'] || `https://${domain}/`

  let result = { ok: false, msg: 'no response' }
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const body = task.reqData ? format(task.reqData, env) : null
    const repeat = parseInt(task.repeat || '1', 10)
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
  for (const task of (group.tasks || [])) {
    // 检查 enabled 标志（默认启用）
    if (task.enable === false) continue
    // 先执行 preTasks
    for (const pre of (group.preTasks || [])) {
      out.push(await runTask(pre, ctx))
    }
    // 然后执行 task（处理 relay/rear 顺序）
    if (task.relay) {
      // relay 表示需要前面 task 的结果，跳过单独执行（由用户配置）
    }
    out.push(await runTask(task, ctx))
  }
  return out
}
