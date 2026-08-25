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
const CONFIG_DIR = path.resolve(__dirname, '../config')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml')
const EXAMPLE_FILE = path.join(CONFIG_DIR, 'config.example.yaml')

let _cache = null
let _cacheTime = 0

const DEFAULTS = {
  defaultUin: '',
  dailyRunTime: '',
  oneClickScope: 'all',
  whitelist: [],
  blacklist: [],
  luckyChar: { enabled: true, isSVIP: false },
  defaultMessage: '火',
  customLoginDomains: {},
  taskOverrides: {},
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
 * 获取某个字段
 */
export function get(keyPath, fallback) {
  const cfg = loadConfig()
  const keys = keyPath.split('.')
  let cur = cfg
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return fallback
    cur = cur[k]
  }
  return cur === undefined ? fallback : cur
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
