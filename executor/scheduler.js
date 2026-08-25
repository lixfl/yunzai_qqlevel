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
  // 转换 cron 表达式为 node-cron 可识别的形式
  const expr = normalizeCron(task.cron)
  if (!cron.validate(expr)) {
    console.warn('[xa] invalid cron:', task.cron)
    return null
  }
  const handle = cron.schedule(expr, async () => {
    console.log(`[xa] cron 触发: ${task.id}`)
    const r = await runTask(task, ctx)
    console.log(`[xa] ${task.id} 结果:`, r.ok ? 'OK' : r.msg)
  })
  _tasks.push({ task, handle })
  return handle
}

/**
 * 把 ${minute} ${hour} 之类的变量替换成实际值
 */
export function resolveCron(task, env = {}) {
  const hour = env.hour != null ? env.hour : '0'
  const minute = env.minute != null ? env.minute : '0'
  return String(task.cron || '')
    .replace(/\$\{hour\}\$/g, hour)
    .replace(/\$\{minute\}\$/g, minute)
    .replace(/\$\{random\}\$/g, '0')
}

function normalizeCron(c) {
  // 默认 node-cron 6 段: 秒 分 时 日 月 周
  // XAutoDaily cron 也是 6 段: 秒 分 时 日 月 周
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
