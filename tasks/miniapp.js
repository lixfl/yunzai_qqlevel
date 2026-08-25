import { post } from '../helpers/http.js'
import { formatCookie } from '../helpers/fs.js'

/**
 * QQ 小程序签到
 * @param {object} cfg
 * @param {string} miniAppId
 */
export async function signInMiniapp(cfg, miniAppId) {
  const cookie = formatCookie(cfg.cookie)
  if (!cookie) throw new Error('Cookie 为空')
  // 占位 URL：实际请根据小程序接口替换
  const url = 'https://miniapp.qq.com/api/checkin'
  const body = { miniAppId, uin: cfg.userId, ts: Date.now() }
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
