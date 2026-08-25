/**
 * components/Config.js
 * 标准 Yunzai 配置管理 (参考 yeqiu6080/yunzai-plugin-skill 5.3)
 *
 * 路径规范 (Yunzai 标准):
 *   ${process.cwd()}/plugins/${pluginName}/config/config/${name}.yaml       # 用户配置
 *   ${process.cwd()}/plugins/${pluginName}/config/default_config/${name}.yaml # 默认配置
 *
 * 注意: 插件运行环境要求从 Yunzai 项目根目录启动,所以使用 process.cwd()
 * 我们的 plugins/yunzai_qqlevel/ 路径是硬编码的
 */
import * as YAML from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'

const _path = process.cwd()
const plugin = 'yunzai_qqlevel'

// 智能检测 Yunzai 项目根目录:
//   1. 标准安装: cwd 是 Yunzai 项目根, plugin 在 cwd/plugins/yunzai_qqlevel
//   2. 开发测试: cwd 是 plugin 自身目录,config/config.yaml 在 cwd/config/
const DEFAULT_BASE = (() => {
  // 如果 cwd/plugins/yunzai_qqlevel 存在,这是 Yunzai 根目录
  if (fs.existsSync(`${_path}/plugins/${plugin}`)) {
    return `${_path}/plugins/${plugin}`
  }
  // 否则 cwd 自身就是 plugin 目录
  return _path
})()

const CONFIG_DIR = `${DEFAULT_BASE}/config/config`
const DEFAULT_DIR = `${DEFAULT_BASE}/config/default_config`

export default class Config {
  /**
   * 获取配置 - 自动从 default_config 复制缺失的用户配置
   * @param {string} name 配置名 (不带 .yaml 后缀)
   * @returns {object}
   */
  static getConfig(name = 'config') {
    const userFile = path.join(CONFIG_DIR, `${name}.yaml`)
    if (!fs.existsSync(userFile)) {
      Config.copyDefault(name)
    }
    if (!fs.existsSync(userFile)) return {}
    try {
      return YAML.load(fs.readFileSync(userFile, 'utf8')) || {}
    } catch (e) {
      console.error(`[Config] 解析失败 ${userFile}:`, e.message)
      return {}
    }
  }

  /**
   * 保存配置 (深合并到现有)
   * @param {string} name
   * @param {object} data 要合并的数据
   */
  static setConfig(name = 'config', data) {
    const userFile = path.join(CONFIG_DIR, `${name}.yaml`)
    const existing = Config.getConfig(name)
    const merged = Config._deepMerge(existing, data)
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(userFile, YAML.stringify(merged, { lineWidth: -1 }))
  }

  /**
   * 从 default_config 复制到 config (首次启动)
   */
  static copyDefault(name = 'config') {
    const defaultFile = path.join(DEFAULT_DIR, `${name}.yaml`)
    const userFile = path.join(CONFIG_DIR, `${name}.yaml`)
    if (fs.existsSync(defaultFile)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.copyFileSync(defaultFile, userFile)
      console.log(`[Config] 已复制默认配置: ${userFile}`)
    }
  }

  /**
   * 深度合并 (target 被 source 覆盖)
   */
  static _deepMerge(target, source) {
    if (source == null || typeof source !== 'object') return target
    if (Array.isArray(source)) return source.slice()
    const out = { ...(target || {}) }
    for (const k of Object.keys(source)) {
      const sv = source[k]
      const tv = out[k]
      if (sv != null && typeof sv === 'object' && !Array.isArray(sv) && typeof tv === 'object' && !Array.isArray(tv)) {
        out[k] = Config._deepMerge(tv, sv)
      } else if (sv !== undefined) {
        out[k] = sv
      }
    }
    return out
  }
}
