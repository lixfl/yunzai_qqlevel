import { post } from '../helpers/http.js'
import { formatCookie } from '../helpers/fs.js'

/**
 * QQ 每日签到 / 会员签到
 * 注意：QQ 内部接口经常调整，本文件示例结构，真实部署请根据抓包自行调整 URL/参数。
 * @param {object} cfg
 * @returns {Promise<object>} 返回接口响应 JSON
 */
export async function signInDaily(cfg) {
  const cookie = formatCookie(cfg.cookie)
  if (!cookie) throw new Error('Cookie 为空，请先在 config.json 中填写')
  // 这里使用一个占位 URL，实际请根据抓包替换
  const url = 'https://api.vip.qq.com/qqlevel/signin'
  const body = {
    uin: cfg.userId,
    ts: Date.now(),
  }
  const headers = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) QQ/9.9.5 Chrome/120.0',
  }
  const res = await post(url, { headers, body })
  if (res.status !== 200) throw new Error('HTTP ' + res.status)
  try {
    return JSON.parse(res.body)
  } catch {
    return { raw: res.body }
  }
}
