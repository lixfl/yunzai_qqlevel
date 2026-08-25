/**
 * login.js — 多域 QR 扫码登录获取 Cookie
 *
 * 借鉴:
 *   - PyQQSkeyTool (https://github.com/sun589/PyQQSkeyTool) by sun589
 *     - 多域登录支持 (qzone.qq.com / qun.qq.com / vip.qq.com / 自定义)
 *     - bkn / g_tk 算法
 *     - login_datas 表
 *   - aioqzone/qqqr — Node.js QR 登录流程参考
 *
 * 流程:
 *   1. 用 xlogin 拿 pt_login_sig
 *   2. 用 ptqrshow 拿 QR PNG + qrsig
 *   3. 轮询 ptqrlogin
 *   4. 跟随重定向 URL 拿 cookie
 *   5. 按域写入 data/cookies.json
 *
 * 关键改进 (相对 PyQQSkeyTool):
 *   - 支持一次性登录多个域
 *   - Cookie 按 domain 维度存储
 *   - 兼容 Yunzai 内置运行 (sse 回调模式)
 */
import { get } from './http.js'
import { ptqrtoken, gtk, bkn } from './crypto.js'
import * as cookie from './cookie.js'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const QR_DIR = path.resolve(__dirname, '../data/qr')
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true })

/**
 * 清理 24 小时前的 QR 文件 (防止 data/qr 无限增长)
 */
export function cleanupQRCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(QR_DIR)) return 0
  const now = Date.now()
  let removed = 0
  for (const f of fs.readdirSync(QR_DIR)) {
    const p = path.join(QR_DIR, f)
    try {
      const st = fs.statSync(p)
      if (now - st.mtimeMs > maxAgeMs) {
        fs.unlinkSync(p)
        removed++
      }
    } catch {}
  }
  return removed
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

/**
 * 内置支持的登录域 (来自 PyQQSkeyTool._core + clientkey.py)
 * key 是在用户命令里使用的简短名, value 是 login 用的 {s_url, daid, appid}
 */
export const LOGIN_DOMAINS = {
  'qzone.qq.com':    { s_url: 'https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone', daid: '5',   appid: '549000912' },
  'qun.qq.com':      { s_url: 'https://qun.qq.com/',                                    daid: '73',  appid: '715030901' },
  'vip.qq.com':      { s_url: 'https://vip.qq.com/loginsuccess.html',                  daid: '18',  appid: '8000201' },
  'mail.qq.com':     { s_url: 'https://wx.mail.qq.com/list/readtemplate?name=login_jump.html', daid: '4', appid: '522005705' },
  'weiyun.com':      { s_url: 'https://www.weiyun.com/web/callback/common_qq_login_ok.html?login_succ', daid: '372', appid: '527020901' },
  'accounts.qq.com': { s_url: 'https://accounts.qq.com/homepage#/',                     daid: '761', appid: '1600001573' },
}

export const DEFAULT_DOMAIN = 'vip.qq.com'

/**
 * 从 URL/cookie header 解析 set-cookie
 */
function parseSetCookie(arr) {
  const out = {}
  for (const line of (Array.isArray(arr) ? arr : [arr])) {
    if (!line) continue
    const semiIdx = line.indexOf(';')
    const main = semiIdx >= 0 ? line.slice(0, semiIdx) : line
    const eq = main.indexOf('=')
    if (eq < 0) continue
    let key = main.slice(0, eq).trim()
    let val = main.slice(eq + 1).trim()
    // uin 字段去除 'o' 前缀 (QQ 内部用 'o123456' 格式)
    if (key === 'uin' && val.startsWith('o')) val = val.slice(1)
    out[key] = val
  }
  return out
}

/**
 * 获取 pt_login_sig (xlogin endpoint)
 */
async function getLoginSig(domainConf) {
  const u = `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${domainConf.appid}&daid=${domainConf.daid}&hide_close_icon=1&hide_yellow_tip=0&low_login=0&qlogin_auto_login=1&no_verifyimg=1&link_target=blank&app_from=mobile&self_regurl=https://zb.vip.qq.com/v2/dashboard&type=1&css=https://zb.vip.qq.com/v2/Resources/xlogin.css&pt_ver=22.5.0&pt_jsver=22.5.0&s_url=${encodeURIComponent(domainConf.s_url)}&pt_dispose=0&da_width=375&da_height=812&pt_reload=1&pt_savelogin=0`
  const res = await get(u, { headers: COMMON_HEADERS })
  return parseSetCookie(res.headers['set-cookie'] || res.headers['Set-Cookie'])['pt_login_sig']
}

/**
 * 获取 QR PNG + qrsig
 */
export async function fetchQRCode(domain = DEFAULT_DOMAIN, customData) {
  const conf = customData || LOGIN_DOMAINS[domain]
  if (!conf) throw new Error(`未知登录域: ${domain}`)
  const ptLoginSig = await getLoginSig(conf)
  if (!ptLoginSig) throw new Error('获取 pt_login_sig 失败')

  const u = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${conf.appid}&t=${Math.random()}&daid=${conf.daid}&pt_3rd_aid=0&u1=${encodeURIComponent(conf.s_url)}`
  const res = await get(u, {
    headers: { ...COMMON_HEADERS, Cookie: `pt_login_sig=${ptLoginSig}` },
    encoding: null,  // 二进制
  })
  const setCookies = parseSetCookie(res.headers['set-cookie'] || res.headers['Set-Cookie'])
  const qrsig = setCookies['qrsig']
  if (!qrsig) throw new Error('获取 qrsig 失败: ' + JSON.stringify(setCookies))

  // 兼容 Node body 是字符串或 Buffer
  const pngBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body, 'binary')
  const ts = Date.now()
  const qrPath = path.join(QR_DIR, `qr-${domain.replace(/\./g, '_')}-${ts}.png`)
  fs.writeFileSync(qrPath, pngBuffer)
  return { pngBuffer, qrsig, ptLoginSig, path: qrPath, domain, conf }
}

/**
 * 轮询扫码状态
 * @returns {{status: string, uin?: string, redirectUrl?: string, message?: string, raw: string}}
 *
 * ptuiCB 第一个参数 status:
 *   65: 已扫码
 *   66: 未扫码
 *   67: 待确认 (手机弹窗)
 *   68: 二维码已失效
 *   0:  登录成功 (返回 redirect URL)
 *
 * 如果移动端 UA 被服务器拒绝 (HTTP 403),自动尝试 PC UA
 *
 * 关键: 必须传 ptqrtoken (从 qrsig 计算),QQ 服务端用来验证会话合法性
 */
export async function pollLogin(qrsig, conf) {
  const u1 = encodeURIComponent(conf.s_url)
  // 计算 ptqrtoken (跟 bkn/gtk 算法相同)
  const token = ptqrtoken(qrsig)
  const baseUrl = `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${u1}&ptqrtoken=${token}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=${Math.random()}&js_ver=23111510&js_type=1&login_sig=&pt_uistyle=40&aid=${conf.appid}&daid=${conf.daid}&o1vId=&pt_js_version=v1.48.1`

  // 第一次用移动 UA (常见)
  let res = await get(baseUrl, {
    headers: {
      ...COMMON_HEADERS,
      Cookie: `qrsig=${qrsig}`,
      Referer: 'https://xui.ptlogin2.qq.com/',
    },
  })

  // 如果 403/空 body,尝试 PC UA
  if (!res.body && res.status !== 200) {
    res = await get(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: `qrsig=${qrsig}`,
        Referer: 'https://xui.ptlogin2.qq.com/',
      },
    })
  }

  const text = res.body || ''
  // 解析 ptuiCB('status', '?ver', '?uin', '?', 'msg', '?')
  const m = text.match(/ptuiCB\(['"]([^'"]+)['"]/)
  const status = m ? m[1] : '-2'
  let uin = null, redirect = null
  // 如果 raw 为空,可能是网络问题(如 403),给出友好提示
  if (!text && res.status !== 200) {
    return {
      status: '-2',
      message: `网络错误 HTTP ${res.status}`,
      raw: '',
    }
  }
  if (status === '0') {
    // success: extract URL from response
    const u = text.match(/https?:\/\/[^'"\)\\s]+/)
    redirect = u ? u[0] : null
    // uin 在 set-cookie 中
    const cks = parseSetCookie(res.headers['set-cookie'] || res.headers['Set-Cookie'])
    if (cks.uin) uin = cks.uin.replace(/^o/, '')
  }
  return {
    status,
    uin,
    redirectUrl: redirect,
    message: extractMessage(text),
    raw: text,
  }
}

function extractMessage(text) {
  const m = text.match(/ptuiCB\([^)]*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/)
  if (m) return m[2]
  return text.slice(0, 200)
}

/**
 * 完成登录: 跟随重定向 URL,收集所有 cookie
 */
export async function completeLogin(redirectUrl) {
  const res = await get(redirectUrl, {
    headers: COMMON_HEADERS,
    followRedirect: true,
    maxRedirects: 10,
  })
  const all = []
  for (const k of ['set-cookie', 'Set-Cookie']) {
    const v = res.headers[k]
    if (!v) continue
    all.push(...(Array.isArray(v) ? v : [v]))
  }
  const cks = parseSetCookie(all)
  return cks
}

/**
 * 单域登录流程
 * @returns {Promise<{uin: string, domain: string, cookies: object}>}
 */
export async function loginDomain(domain = DEFAULT_DOMAIN, opts = {}) {
  const { onQR, onStatus, onStatusChange, customData, timeout = 60000 } = opts
  const { pngBuffer, qrsig, path } = await fetchQRCode(domain, customData)
  const conf = customData || LOGIN_DOMAINS[domain]
  onQR && onQR({ pngBuffer, path, domain })
  let result = null
  let lastStatus = ''
  const startTime = Date.now()
  while (true) {
    // 超时检查
    if (Date.now() - startTime > timeout) {
      throw new Error(`[${domain}] 登录超时 (${Math.round(timeout / 1000)}s)`)
    }
    const r = await pollLogin(qrsig, conf)
    onStatus && onStatus(r)
    // 只在状态变化时回调 onStatusChange (避免重复发送相同消息)
    if (r.status !== lastStatus) {
      lastStatus = r.status
      onStatusChange && onStatusChange(r)
    }
    if (r.status === '0') {
      result = r
      break
    }
    if (r.status === '68') {
      throw new Error(`[${domain}] 二维码已失效,请重新调用`)
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  const cookies = await completeLogin(result.redirectUrl)
  if (!cookies.uin && result.uin) cookies.uin = result.uin
  // 计算 gtk/bkn 备用
  const skeyVal = cookies.skey || cookies.p_skey
  if (skeyVal) {
    cookies.bkn = String(bkn(skeyVal))
    cookies.g_tk = String(gtk(skeyVal))
  }
  return { uin: cookies.uin, domain, cookies }
}

/**
 * 多域登录 — 一次性获取多个域的 cookie
 *
 * 注意: 每次 QR 登录的 qrsig 是独立的,所以多域必须**串行多次扫码**
 * (扫码只能扫一次,服务端只允许一个 QR 流程)
 *
 * 但是: **同一个 QR 流程能登录多个域!** 因为 ptlogin2 共享 PT_* cookie.
 * 扫码成功后,浏览器跳转到 s_url,只要 s_url 域名不同,会获得不同域 cookie.
 *
 * 实际上更可靠的策略:
 *   - 对每个 domain 都跑一次 QR 流程,这样每个域的 cookie 都是新的 (tk 独立)
 *   - 或者用一个 domain 登录,然后从 cookie 中提取 skey/p_skey (但 p_skey 各域独立)
 */
export async function loginMultiDomain(domains = Object.keys(LOGIN_DOMAINS), opts = {}) {
  const { onDomainStart, onDomainDone, onAllDone } = opts
  const results = {}
  for (const domain of domains) {
    onDomainStart && onDomainStart(domain)
    try {
      const r = await loginDomain(domain, opts)
      // 写入 cookies.json
      cookie.set(r.uin, domain, r.cookies)
      results[domain] = { ok: true, uin: r.uin, cookies: r.cookies }
      onDomainDone && onDomainDone(domain, results[domain])
    } catch (e) {
      results[domain] = { ok: false, error: e.message }
      onDomainDone && onDomainDone(domain, results[domain])
    }
  }
  onAllDone && onAllDone(results)
  return results
}

/**
 * 单次登录 (保留旧 API 兼容)
 */
export async function loginFlow(opts = {}) {
  const { domain = DEFAULT_DOMAIN } = opts
  const r = await loginDomain(domain, opts)
  cookie.set(r.uin, domain, r.cookies)
  return { uin: r.uin, cookie: r.cookies, domain }
}
