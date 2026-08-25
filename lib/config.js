/**
 * config.js — 加载用户配置 (config/config.yaml)
 *
 * 支持:
 *   - 自动从 example 复制 (首次启动)
 *   - 热重载 (用户修改后下次读取生效)
 *   - 默认值 fallback (字段缺失自动补全)
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import * as yaml from 'js-yaml'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
// Yunzai 标准路径: config/default_config/config.yaml (默认) + config/config/config.yaml (用户)
// 兼容旧路径: config/config.yaml + config/config.example.yaml
const CONFIG_BASE = path.resolve(__dirname, '../config')
const CONFIG_DIR_NEW = path.join(CONFIG_BASE, 'config')
const CONFIG_FILE_NEW = path.join(CONFIG_DIR_NEW, 'config.yaml')
const DEFAULT_DIR = path.join(CONFIG_BASE, 'default_config')
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'config.yaml')
// 旧路径 (向后兼容)
const CONFIG_DIR_OLD = CONFIG_BASE
const CONFIG_FILE_OLD = path.join(CONFIG_BASE, 'config.yaml')
const EXAMPLE_FILE_OLD = path.join(CONFIG_BASE, 'config.example.yaml')

// 选择实际路径: 优先新路径
const CONFIG_DIR = fs.existsSync(CONFIG_DIR_NEW) ? CONFIG_DIR_NEW : CONFIG_DIR_OLD
const CONFIG_FILE = fs.existsSync(CONFIG_FILE_NEW) ? CONFIG_FILE_NEW : CONFIG_FILE_OLD
const EXAMPLE_FILE = fs.existsSync(DEFAULT_FILE) ? DEFAULT_FILE : EXAMPLE_FILE_OLD

let _cache = null
let _cacheTime = 0

const DEFAULTS = {
  defaultUin: '',
  dailyRunTime: '',
  defaultTime: '',  // 简化格式 "HH:MM"
  taskCronOverrides: {},  // 任务级 cron 覆盖
  oneClickScope: 'all',
  whitelist: [],
  blacklist: [],
  luckyChar: { enabled: true, isSVIP: false },
  defaultMessage: '火',
  customLoginDomains: {},
  taskOverrides: {},
  httpTimeout: 15000,
  retryCount: 1,
  staggerDelay: 2000,
}

/**
 * 加载用户配置 (合并默认值)
 * @returns {object}
 */
export function loadConfig(forceReload = false) {
  // 1. 首次启动: 自动从 example 复制
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(EXAMPLE_FILE)) {
    fs.copyFileSync(EXAMPLE_FILE, CONFIG_FILE)
    console.log('[config] 已创建默认配置:', CONFIG_FILE)
  }

  // 2. 检查文件 mtime,支持热重载
  let mtime = 0
  try { mtime = fs.statSync(CONFIG_FILE).mtimeMs } catch {}
  if (!forceReload && _cache && mtime === _cacheTime) return _cache

  // 3. 解析
  let userCfg = {}
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      userCfg = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}
    } catch (e) {
      console.error('[config] 配置文件解析失败:', e.message)
    }
  }

  // 4. 合并默认值 (深度合并)
  const merged = deepMerge(structuredClone(DEFAULTS), userCfg)
  _cache = merged
  _cacheTime = mtime
  return merged
}

/**
 * 强制刷新配置
 */
export function reloadConfig() {
  _cache = null
  _cacheTime = 0
  return loadConfig(true)
}

/**
 * 检查群是否在白名单/黑名单
 * @returns {boolean} true 表示允许执行
 */
export function isGroupAllowed(groupId) {
  const cfg = loadConfig()
  const id = String(groupId)
  if (cfg.blacklist && cfg.blacklist.map(String).includes(id)) return false
  if (cfg.whitelist && cfg.whitelist.length > 0) {
    return cfg.whitelist.map(String).includes(id)
  }
  return true
}

/**
 * 检查任务是否启用 (结合 taskOverrides + data/tasks-state.json)
 * @param {string} taskId
 * @param {function} isStateEnabled - 从 state.json 读取状态的函数 (e.g. index.js 的 isEnabled)
 */
export function isTaskEnabledByConfig(taskId, isStateEnabled) {
  const cfg = loadConfig()
  if (cfg.taskOverrides && Object.prototype.hasOwnProperty.call(cfg.taskOverrides, taskId)) {
    return cfg.taskOverrides[taskId] === true
  }
  return isStateEnabled ? isStateEnabled(taskId) : true
}

/**
 * 解析任务的 cron 表达式
 * 优先级: taskCronOverrides > xa_conf.yaml 默认
 *
 * 支持格式:
 *   "HH:MM"               → 转换为 "0 MM HH * * *"
 *   "0 0 8 * * *"         → 完整 cron
 *   "disable"             → null (禁用定时)
 *   undefined/null/empty  → undefined (用 xa_conf 默认)
 *
 * @returns {string|null|undefined}
 *   - string: 完整 cron 表达式 (6 段)
 *   - null: 禁用定时 (但仍可通过 #qq签到 手动执行)
 *   - undefined: 用默认
 */
export function resolveTaskCron(taskId) {
  const cfg = loadConfig()
  const override = cfg.taskCronOverrides?.[taskId]
  if (override === undefined || override === null) return undefined
  if (override === '' || override === 'disable') return null
  if (typeof override !== 'string') return undefined
  // "HH:MM" 简化格式
  const m = override.match(/^(\d{1,2}):(\d{1,2})$/)
  if (m) {
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)))
    return `0 ${mm} ${h} * * *`
  }
  // 完整 cron
  return override.trim()
}

/**
 * 解析全局默认时间
 * - dailyRunTime 是完整 cron
 * - defaultTime 是 "HH:MM" 简化格式
 * @returns {string} 完整 cron 表达式,或空字符串
 */
export function resolveDefaultCron() {
  const cfg = loadConfig()
  if (cfg.defaultTime) {
    const m = cfg.defaultTime.match(/^(\d{1,2}):(\d{1,2})$/)
    if (m) {
      return `0 ${m[2]} ${m[1]} * * *`
    }
  }
  return cfg.dailyRunTime || ''
}

function deepMerge(target, source) {
  if (source == null || typeof source !== 'object') return target
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv == null) {
      // skip
    } else if (Array.isArray(sv)) {
      target[key] = sv.slice()
    } else if (typeof sv === 'object' && typeof tv === 'object' && !Array.isArray(tv)) {
      target[key] = deepMerge(tv, sv)
    } else {
      target[key] = sv
    }
  }
  return target
}
