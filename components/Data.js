/**
 * components/Data.js
 * 数据工具 - 提供任务状态/cookie 持久化等常用操作
 */
import fs from 'node:fs'
import path from 'node:path'

const _path = process.cwd()
const plugin = 'yunzai_qqlevel'
const DATA_DIR = `${_path}/plugins/${plugin}/data`

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export default class Data {
  /**
   * 读取 JSON 数据 (自动初始化文件)
   * @param {string} name 文件名 (不带 .json)
   * @returns {object}
   */
  static loadJson(name) {
    ensure()
    const file = path.join(DATA_DIR, `${name}.json`)
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '{}', 'utf8')
      return {}
    }
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
  }

  /**
   * 写入 JSON 数据
   */
  static saveJson(name, data) {
    ensure()
    const file = path.join(DATA_DIR, `${name}.json`)
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  }

  /**
   * 获取任务启用状态
   */
  static getTaskEnabled(taskId) {
    return Data.loadJson('tasks-state')[taskId] !== false
  }

  /**
   * 设置任务启用状态
   */
  static setTaskEnabled(taskId, enabled) {
    const s = Data.loadJson('tasks-state')
    s[taskId] = enabled
    Data.saveJson('tasks-state', s)
  }
}
