/**
 * http.js — HTTPS 工具
 * 支持 GET/POST，自动处理 JSON / form-urlencoded
 */
import https from 'node:https'
import http from 'node:http'
import { URL } from 'node:url'

const TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function _request(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { return reject(new Error('Invalid URL: ' + url)) }
    const lib = u.protocol === 'https:' ? https : http
    const headers = {
      'User-Agent': USER_AGENT,
      ...(opts.headers || {}),
    }
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
      timeout: opts.timeout || TIMEOUT,
    }
    const req = lib.request(reqOpts, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        const ct = res.headers['content-type'] || ''
        const body = /charset=gbk\b/i.test(ct) ? iconvDecode(buf, 'gbk') : buf.toString('utf8')
        let json = null
        if (/\bjson\b/i.test(ct) || body.trim().startsWith('{') || body.trim().startsWith('[')) {
          try { json = JSON.parse(body) } catch {}
        }
        resolve({ status: res.statusCode, headers: res.headers, body, json })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    if (method !== 'GET' && opts.body != null) {
      const data = typeof opts.body === 'string' ? opts.body : (opts.body.__form ? opts.body.data : JSON.stringify(opts.body))
      if (data) {
        req.setHeader('Content-Length', Buffer.byteLength(data))
        req.write(data)
      }
    }
    req.end()
  })
}

/**
 * POST 请求
 * @param {string} url
 * @param {object} opts { headers, body (object|str), timeout, isForm }
 */
export function post(url, opts = {}) {
  return _request('POST', url, opts)
}

export function get(url, opts = {}) {
  return _request('GET', url, opts)
}

/**
 * 表单 POST
 */
export function postForm(url, body, headers = {}) {
  const pairs = []
  for (const [k, v] of Object.entries(body)) {
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }
  return _request('POST', url, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: pairs.join('&'),
  })
}

function iconvDecode(buf, enc) {
  try {
    return new TextDecoder(enc).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}
