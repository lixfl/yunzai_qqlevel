/**
 * yunzai_qqlevel/index.js
 * 兼容入口 - 转发到 apps/index.js
 *
 * 老版本 Yunzai 仍可能通过 require('./index.js') 调用,这里提供兼容
 * 推荐使用 apps/index.js 里的 QqLevelPlugin 类
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { cleanupQRCache } from './lib/login.js'
import { scheduleAll, stopAll } from './executor/scheduler.js'
import * as cookie from './lib/cookie.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')

// 重新导出主插件类
export { QqLevelPlugin } from './apps/index.js'

// 兼容入口: export default (plugin 实例, 调用 e )
export { default } from './apps/index.js'

// 启动钩子: 在 Yunzai 启动时调用
export async function onFirstLaunch() {
  console.log('[yunzai_qqlevel] 启动,初始化数据目录...')
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  // 清理 24 小时前的 QR 临时文件
  try {
    const removed = cleanupQRCache()
    if (removed > 0) console.log(`[yunzai_qqlevel] 清理 ${removed} 个过期 QR 文件`)
  } catch (e) {
    console.warn('[yunzai_qqlevel] QR 清理失败:', e.message)
  }

  const ctx = { uin: Object.keys(cookie.readAll())[0] || '', bot: global.Bot, logger: console }
  try {
    scheduleAll(ctx)
    console.log('[yunzai_qqlevel] cron 任务已注册')
  } catch (e) {
    console.error('[yunzai_qqlevel] cron 注册失败:', e.message)
  }
}
