import https from 'node:https'
import { URL } from 'node:url'
import http from 'node:http'

/**
 * 简易 HTTPS/HTTP POST 工具
 * @param {string} url
 * @param {object} opts { headers, body, timeout }
 * @returns {Promise<{status:number, headers:object, body:string}>}
 */
export function post(url, opts = {}) {
  const { headers = {}, body = null, timeout = 30000 } = opts
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers },
      timeout,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, body: buf })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timeout')) })
    if (body != null) {
      const data = typeof body === 'string' ? body : JSON.stringify(body)
      req.setHeader('Content-Length', Buffer.byteLength(data))
      req.write(data)
    }
    req.end()
  })
}

/**
 * 简易 HTTPS/HTTP GET 工具
 */
export function get(url, opts = {}) {
  const { headers = {}, timeout = 30000 } = opts
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers,
      timeout,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, body: buf })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timeout')) })
    req.end()
  })
}
