/**
 * cookie.js — Cookie 管理
 * - 多域名 cookie（skey/p_skey/pt_key/g_tk/qq...）
 * - 文件持久化 plugins/yunzai_qqlevel/data/cookies.json
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const COOKIE_FILE = path.join(DATA_DIR, 'cookies.json')

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(COOKIE_FILE)) fs.writeFileSync(COOKIE_FILE, '{}', 'utf8')
}

/**
 * 读全部账号 cookies
 * @returns {Object<string, Object<string,string>>} { uin: { domain: 'k=v;k2=v2' } }
 */
export function readAll() {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * @param {Object<string, Object<string,string>>} data
 */
export function writeAll(data) {
  ensure()
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * 给指定 uin 设置 cookie (key 是域名，比如 qzone.qq.com, vip.qq.com)
 */
export function set(uin, domain, cookieObj) {
  const all = readAll()
  if (!all[uin]) all[uin] = {}
  all[uin][domain] = cookieObj
  writeAll(all)
}

export function get(uin, domain) {
  const all = readAll()
  return (all[uin] && all[uin][domain]) || null
}

export function getAll(uin) {
  const all = readAll()
  return (all[uin]) || {}
}

/**
 * 把 cookie object 序列化为 "k=v; k2=v2" 字符串
 */
export function stringify(cookieObj) {
  if (!cookieObj) return ''
  return Object.entries(cookieObj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/**
 * 把 cookie 字符串解析成 object
 */
export function parse(cookieStr) {
  const out = {}
  if (!cookieStr) return out
  for (const part of cookieStr.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = decodeURIComponent(part.slice(i + 1).trim())
    out[k] = v
  }
  return out
}

/**
 * 提取 skey (p_skey 优先)
 */
export function extractSkey(cookieObj) {
  return (cookieObj && (cookieObj.p_skey || cookieObj.skey)) || ''
}
