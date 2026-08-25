/**
 * conf-loader.js
 * 加载并解析 xa_conf.yaml
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import * as yaml from 'js-yaml'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

let _cache = null

/**
 * 加载默认配置 conf/xa_conf.yaml
 */
function loadConf() {
  if (_cache) return _cache
  const confPath = path.resolve(__dirname, '../conf/xa_conf.yaml')
  if (!fs.existsSync(confPath)) {
    throw new Error(`未找到配置文件 ${confPath}`)
  }
  const text = fs.readFileSync(confPath, 'utf8')
  _cache = yaml.load(text)
  if (!_cache || typeof _cache !== 'object') {
    throw new Error('YAML 解析失败')
  }
  return _cache
}

/**
 * 获取所有任务组 (taskGroups)
 */
export function getTaskGroups() {
  return loadConf().taskGroups || []
}

/**
 * 统计信息
 */
export function getStats() {
  const groups = getTaskGroups()
  const stats = {
    version: loadConf().version,
    totalGroups: groups.length,
    totalTasks: 0,
    byType: { web: 0, func: 0, mini: 0 },
  }
  for (const g of groups) {
    for (const t of (g.tasks || [])) {
      stats.totalTasks++
      const type = g.type || 'web'
      if (type.startsWith('mini|')) stats.byType.mini++
      else if (stats.byType[type] != null) stats.byType[type]++
    }
  }
  return stats
}
