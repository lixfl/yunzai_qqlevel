/**
 * scheduler.js — cron 调度
 *
 * 解析 XAutoDaily cron 表达式 (5-6 段空格分隔) → node-cron
 * 注意：XAutoDaily 用秒级 cron，node-cron 也是秒级 (6 段)
 */
import cron from 'node-cron'
import { getTaskGroups } from '../lib/conf-loader.js'
import { runTask } from './task-runner.js'

const _tasks = []

/**
 * 注册一个 task 的 cron 调度
 * @param {object} task
 * @param {object} ctx
 */
export function scheduleTask(task, ctx) {
  if (!task.cron || task.cron === 'basic') return null
  // 先用 resolveCron 把 ${hour}$ / $hour$ 等模板变量替换成默认值
  const expr = normalizeCron(resolveCron(task, {}))
  if (!cron.validate(expr)) {
    console.warn('[xa] invalid cron:', task.cron, '->', expr)
    return null
  }
  const handle = cron.schedule(expr, async () => {
    console.log(`[xa] cron 触发: ${task.id} (${expr})`)
    const r = await runTask(task, ctx)
    console.log(`[xa] ${task.id} 结果:`, r.ok ? 'OK' : r.msg)
  })
  _tasks.push({ task, handle })
  return handle
}

/**
 * 把 ${minute} ${hour} 之类的变量替换成实际值
 * 默认值根据 task id 散开,避免所有任务集中在 0 点触发
 */
const DEFAULT_TIME_MAP = {
  '群打卡':           { hour: 8,  minute: 0 },
  '群组续火':         { hour: 9,  minute: 30 },
  '好友续火花':       { hour: 12, minute: 0 },
  '频道签到':         { hour: 10, minute: 15 },
  '加好友活跃':       { hour: 7,  minute: 30 },
  '日签卡打卡':       { hour: 11, minute: 45 },
  '连续登陆QQ':       { hour: 13, minute: 20 },
  '福利社领券':       { hour: 14, minute: 0 },
  '空间说说任务':     { hour: 15, minute: 30 },
  '波点音乐听歌':     { hour: 18, minute: 0 },
}

export function resolveCron(task, env = {}) {
  const defaults = DEFAULT_TIME_MAP[task.id] || { hour: 0, minute: 0 }
  const hour = env.hour != null ? env.hour : String(defaults.hour)
  const minute = env.minute != null ? env.minute : String(defaults.minute)
  const random = env.random != null ? env.random : '0'
  return String(task.cron || '')
    // 支持三种变量写法:
    //   ${hour}$  / ${hour}    (标准 + 缺失右 $)
    //   $hour$    / $hour     (XAutoDaily 风格,常漏写右 $)
    // 用 (?=\s|$) 允许变量后跟空格/结尾
    .replace(/\$\{?(\w+)\}?(?=\s|$)/g, (_, name) => {
      if (name === 'hour') return hour
      if (name === 'minute') return minute
      if (name === 'random') return random
      // 其他变量保持原样
      return '${' + name + '}'
    })
}

function normalizeCron(c) {
  // 默认 node-cron 6 段: 秒 分 时 日 月 周
  // XAutoDaily cron 也是 6 段: 秒 分 时 日 月 周
  // 但 XAutoDaily 用 Quartz 风格 "?" 标记 "不指定",需要转换:
  //   "0 0 0 1 * ?" -> "0 0 0 1 * *"   (每月1号)
  //   "0 0 0 ? * 1" -> "0 0 0 * * 1"   (每周一)
  //   "0 0 0 5 * ?" -> "0 0 0 5 * *"   (每月5号)
  //   "0 0 0 24 * ?" -> "0 0 0 24 * *" (每月24号)
  const parts = c.trim().split(/\s+/)
  if (parts.length !== 6) return c.trim()
  const [sec, min, hour, day, mon, dow] = parts
  // 如果 day 是 "?",用 "*" 替换,同时 dow 保持
  // 如果 dow 是 "?",用 "*" 替换,同时 day 保持
  if (day === '?' && dow !== '?') {
    return [sec, min, hour, '*', mon, dow].join(' ')
  }
  if (dow === '?' && day !== '?') {
    return [sec, min, hour, day, mon, '*'].join(' ')
  }
  return c.trim()
}

/**
 * 注册所有 task group 的所有 task
 */
export function scheduleAll(ctx) {
  const groups = getTaskGroups()
  for (const g of groups) {
    for (const t of (g.tasks || [])) {
      if (t.cron && t.cron !== 'basic') scheduleTask(t, ctx)
    }
  }
  return _tasks
}

export function stopAll() {
  for (const t of _tasks) t.handle.stop()
  _tasks.length = 0
}
