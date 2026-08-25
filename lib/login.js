/**
 * login.js — QR 扫码登录获取 Cookie
 *
 * 借鉴 aioqzone/qqqr 实现，端口为 Node.js:
 *   1. 访问 xlogin 获取 pt_login_sig cookie
 *   2. 访问 ptqrshow 获取 QR PNG 和 qrsig
 *   3. 循环 ptqrlogin 轮询扫码状态
 *   4. 跟随重定向 URL 获取 uin/skey/p_skey 等 cookie
 */
import { get, post } from './http.js'
import { ptqrtoken } from './crypto.js'
import * as cookie from './cookie.js'
import { CookieJar } from 'tough-cookie'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const QR_DIR = path.resolve(__dirname, '../data/qr')
if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true })

const COMMON = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

/**
 * 获取登录用的 pt_login_sig
 */
async function getLoginSig() {
  const url = 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?' + new URLSearchParams({
    appid: '715030901',
    daid: '549',
    hide_close_icon: '1',
    hide_yellow_tip: '0',
    low_login: '0',
    qlogin_auto_login: '1',
    no_verifyimg: '1',
    link_target: 'blank',
    app_from: 'mobile',
    self_regurl: 'https://zb.vip.qq.com/v2/dashboard',
    type: '1',
    css: 'https://zb.vip.qq.com/v2/Resources/xlogin.css',
    pt_ver: '22.5.0',
    pt_jsver: '22.5.0',
    s_url: 'https://zb.vip.qq.com/v2/dashboard',
    pt_dispose: '0',
    da_width: '375',
    da_height: '812',
    pt_reload: '1',
    pt_savelogin: '0',
  })
  const res = await get(url, { headers: COMMON })
  const setCookies = parseSetCookie(res.headers['set-cookie'] || [])
  return setCookies['pt_login_sig']
}

function parseSetCookie(arr) {
  const out = {}
  for (const line of (Array.isArray(arr) ? arr : [arr])) {
    if (!line) continue
    const semiIdx = line.indexOf(';')
    const main = semiIdx >= 0 ? line.slice(0, semiIdx) : line
    const eq = main.indexOf('=')
    if (eq < 0) continue
    out[main.slice(0, eq)] = main.slice(eq + 1)
  }
  return out
}

/**
 * 获取二维码 PNG 和 qrsig
 * @returns {Promise<{pngBuffer: Buffer, qrsig: string, path: string}>}
 */
export async function fetchQRCode() {
  const ptLoginSig = await getLoginSig()
  if (!ptLoginSig) throw new Error('获取 pt_login_sig 失败')
  const url = `https://xui.ptlogin2.qq.com/ssl/ptqrshow?${new URLSearchParams({
    appid: '715030901',
    e: '2',
    l: 'M',
    s: '3',
    d: '72',
    v: '4',
    t: String(Math.random()),
    daid: '549',
    pt_3rd_aid: '0',
  })}`
  const res = await get(url, { headers: { ...COMMON, Cookie: `pt_login_sig=${ptLoginSig}` } })
  const setCookies = parseSetCookie(res.headers['set-cookie'] || [])
  const qrsig = setCookies['qrsig']
  if (!qrsig) throw new Error('获取 qrsig 失败')
  const ts = Date.now()
  const qrPath = path.join(QR_DIR, `qr-${ts}.png`)
  fs.writeFileSync(qrPath, res.body, 'binary')
  return { pngBuffer: Buffer.from(res.body, 'binary'), qrsig, ptLoginSig, path: qrPath }
}

/**
 * 轮询扫码状态
 * @param {string} ptLoginSig
 * @param {string} qrsig
 * @returns {Promise<{status: string, redirectUrl?: string, message?: string, uin?: string}>}
 */
export async function pollLogin(ptLoginSig, qrsig) {
  const url = `https://xui.ptlogin2.qq.com/ssl/ptqrlogin?${new URLSearchParams({
    u1: 'https://zb.vip.qq.com/v2/dashboard',
    ptredirect: '0',
    h: '1',
    t: '1',
    g: '1',
    from_ui: '1',
    ptlang: '2052',
    action: `0-0-${Date.now()}`,
    js_ver: '22042517',
    js_type: '1',
    ptqrtoken: String(ptqrtoken(qrsig)),
    pt_uistyle: '40',
    daid: '549',
    pt_3rd_aid: '0',
  })}`
  const res = await get(url, {
    headers: { ...COMMON, Cookie: `pt_login_sig=${ptLoginSig}; qrsig=${qrsig}` },
  })
  // 响应: ptuiCB('66','0','','0','error_msg', '')
  const m = res.body.match(/ptuiCB\(['"]([^'"]+)['"][\s\S]*\)/)
  const status = m ? m[1] : '0'
  // extract uin from response
  let uin = null
  let redirect = null
  if (status === '0') {
    const u = res.body.match(/['"](\d{5,})['"]/)
    uin = u ? u[1] : null
    redirect = extractUrl(res.body)
  }
  return { status, uin, redirectUrl: redirect, raw: res.body }
}

function extractUrl(s) {
  const m = s.match(/https?:\/\/[^'"\)\s]+/)
  return m ? m[0] : null
}

/**
 * 完成登录：跟随重定向 URL 获取 cookie
 */
export async function completeLogin(redirectUrl) {
  const res = await get(redirectUrl, {
    headers: COMMON,
    maxRedirects: 10,
    followRedirect: true,
  })
  // 提取所有 set-cookie
  const all = []
  for (const k of ['set-cookie', 'Set-Cookie']) {
    if (res.headers[k]) {
      const arr = Array.isArray(res.headers[k]) ? res.headers[k] : [res.headers[k]]
      all.push(...arr)
    }
  }
  return parseSetCookie(all)
}

/**
 * 高层接口：登录成功后，把 cookie 写入 data/cookies.json
 * 使用流程：
 *   1. await fetchQRCode() → 把 PNG 发给用户
 *   2. await pollLogin() 轮询直到 status === '0'
 *   3. await completeLogin() → 得到 cookie
 *   4. cookie.set(uin, 'global', cookieObj)
 */
export async function loginFlow({ onQR, onStatus, onComplete }) {
  const { pngBuffer, qrsig, ptLoginSig, path } = await fetchQRCode()
  onQR && onQR({ pngBuffer, path })
  let uin = null
  let redirectUrl = null
  while (true) {
    const r = await pollLogin(ptLoginSig, qrsig)
    // 65: 已扫码 66: 未扫码 67: 已扫码待确认 68: 二维码失效 0: 成功
    onStatus && onStatus(r)
    if (r.status === '0') {
      uin = r.uin
      redirectUrl = r.redirectUrl
      break
    }
    if (r.status === '68') {
      throw new Error('二维码已失效，请重新调用 loginFlow')
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  const cookieObj = await completeLogin(redirectUrl)
  cookieObj.uin = uin
  cookie.set(uin, 'global', cookieObj)
  onComplete && onComplete({ uin, cookie: cookieObj })
  return { uin, cookie: cookieObj }
}
