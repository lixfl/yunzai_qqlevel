import { post } from '../helpers/http.js'
import { formatCookie } from '../helpers/fs.js'

/**
 * 群打卡（OIDB 0xeb7 协议需要从 QQ 客户端发包，外部 bot 一般通过 QQ HTTP API 模拟）
 * @param {object} cfg
 * @param {string} groupUin
 */
export async function signInGroup(cfg, groupUin) {
  const cookie = formatCookie(cfg.cookie)
  if (!cookie) throw new Error('Cookie 为空')
  // 占位 URL：实际请根据群打卡接口替换
  const url = 'https://group.vip.qq.com/signin'
  const body = { groupUin, uin: cfg.userId, ts: Date.now() }
  const headers = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) QQ/9.9.5',
  }
  const res = await post(url, { headers, body })
  if (res.status !== 200) throw new Error('HTTP ' + res.status)
  try {
    return JSON.parse(res.body)
  } catch {
    return { raw: res.body }
  }
}
