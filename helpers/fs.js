import fs from 'node:fs'
import path from 'node:path'

const cfgPath = path.resolve(process.cwd(), 'plugins/yunzai_qqlevel/config.json')

export function readConfig() {
  if (!fs.existsSync(cfgPath)) {
    return { cookie: '', userId: '', groupList: [], miniAppList: [], time: '30 7 * * *' }
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  } catch (e) {
    return { cookie: '', userId: '', groupList: [], miniAppList: [], time: '30 7 * * *' }
  }
}

export function writeConfig(data) {
  fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * 把 cookie 字典或字符串格式化成 "k=v; k2=v2" 形式
 * @param {string|object} cookie
 * @returns {string}
 */
export function formatCookie(cookie) {
  if (!cookie) return ''
  if (typeof cookie === 'string') return cookie
  if (typeof cookie === 'object') {
    return Object.entries(cookie).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('; ')
  }
  return ''
}
