/**
 * crypto.js
 * - 解密 XAutoDaily xa_conf (RSA + AES-128-ECB)
 * - 计算 QQ GTK / BKN
 * - Caesar cipher 解码
 */
import crypto from 'node:crypto'

// XAutoDaily 硬编码的加密 RSA 公钥 (Caesar 编码后)
const UC_DEC = ['N','V','P','J','Q','B','M','R','S','G','A','Z','I','X','E','O','H','Y','L','F','W','T','U','K','C','D']
const LC_DEC = ['i','h','w','v','s','j','t','g','k','x','m','d','q','y','e','b','l','f','p','a','n','r','z','u','o','c']

const ENC_PUB_KEY = [
  'GMJrGK0JYImJIMp3ZEOFKEWKK4JAKZYFaEXFhEYNiQdP15L4zogm4u',
  'ERI4oTNdFOzts1LaU2i3EwbKMbxGYlNuarl9nKNqbVeA9h8f+BJSjO',
  'kDrEIEX8Y/OjU6kuHixx6gEmR3wyoVEQX83IlUXeKNLMKlc1o88jY3',
  '3GnojHG6oq7bnBwFMjQCvODaggH1ZiArlh1T+tuBobux9u0cMZKEKF'
].join('')

function caesarDecrypt(s) {
  return s.split('').map(c => {
    if (c >= 'A' && c <= 'Z') return UC_DEC[c.charCodeAt(0) - 65]
    if (c >= 'a' && c <= 'z') return LC_DEC[c.charCodeAt(0) - 97]
    return c
  }).join('')
}

function getPublicKey() {
  const pem = caesarDecrypt(ENC_PUB_KEY)
  return `-----BEGIN PUBLIC KEY-----\n${pem}\n-----END PUBLIC KEY-----`
}

/**
 * 解密 xa_conf 文本，得到明文 YAML
 * @param {string} confBase64 XAutoDaily xa_conf 文件原始内容（base64）
 * @returns {string} 明文 YAML
 */
export function decryptXAConf(confBase64) {
  const encAesKeyB64 = confBase64.substr(0, 171) + '='
  const encConfB64 = confBase64.substr(171)
  const encAesKey = Buffer.from(encAesKeyB64, 'base64')
  const encConf = Buffer.from(encConfB64, 'base64')

  const aesKey = crypto.publicDecrypt(
    { key: getPublicKey(), padding: crypto.constants.RSA_PKCS1_PADDING },
    encAesKey
  )

  if (aesKey.length !== 16) {
    throw new Error(`RSA 解密得到非 16 字节 key，实际 ${aesKey.length}`)
  }

  const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, null)
  decipher.setAutoPadding(true)
  const plain = Buffer.concat([decipher.update(encConf), decipher.final()])
  return plain.toString('utf8')
}

/**
 * QQ GTK (g_tk) 计算
 * 算法: hash = 5381; for c in skey: hash = (hash + (hash << 5)) + c.charCodeAt(0); return hash & 0x7fffffff
 * @param {string} skey QQ cookie 中的 skey / p_skey 字段
 * @returns {number}
 */
export function gtk(skey) {
  if (!skey) return 0
  let hash = 5381
  for (let i = 0; i < skey.length; i++) {
    hash += (hash << 5) + skey.charCodeAt(i)
    hash &= 0xffffffff
  }
  return hash & 0x7fffffff
}

/**
 * QQ BKN 计算（与 GTK 等价，只是别名）
 */
export function bkn(skey) {
  return gtk(skey)
}

/**
 * 从 cookie 字典/字符串里提取 skey 或 p_skey
 * @param {string|object} cookie
 * @returns {string}
 */
export function getSkey(cookie) {
  const obj = typeof cookie === 'string' ? parseCookie(cookie) : (cookie || {})
  return obj.p_skey || obj.skey || ''
}

function parseCookie(str) {
  const out = {}
  for (const part of str.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/**
 * QQ client-side ptqrtoken (用于 ptqrlogin 轮询)
 * 算法: hash33(qrsig)
 */
export function ptqrtoken(qrsig) {
  let hash = 0
  for (let i = 0; i < qrsig.length; i++) {
    hash += (hash << 5) + qrsig.charCodeAt(i)
    hash &= 0xffffffff
  }
  return hash & 0x7fffffff
}
