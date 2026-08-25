/**
 * env-format.js
 * XAutoDaily 风格的 EnvFormatUtil.format 移植到 Node.js
 *
 * 支持:
 *   ${varName}$                 — 简单变量替换
 *   ${varName[N]}$              — list 索引
 *   urlEncode(...)              — URL 编码
 *   urlDecode(...)              — URL 解码
 *   encBase64(...)              — base64 编码
 *   random(...)                 — 随机数
 *   randString(...)              — 随机字符串
 *   time / microsecond / timeSecond / timeHex / random
 *   md5(...)                    — MD5 摘要（小写）
 */
import crypto from 'node:crypto'

/**
 * 解析并替换 ${...}$
 * 同时兼容 XAutoDaily 中偶尔漏写的 $var$ 形式 (单 $ 包围)
 * @param {string} str
 * @param {object} env
 */
export function format(str, env = {}) {
  if (str == null) return ''
  let s = String(str)
  // 先处理标准格式 ${...}$
  s = s.replace(/\$\{([^}]+)\}\$/g, (_, expr) => evalExpr(expr.trim(), env))
  // 然后处理 $var$ 形式 (XAutoDaily 中 QQ字符任务有这种写法)
  s = s.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$/g, (_, name) => {
    return env[name] != null ? String(env[name]) : '$' + name + '$'
  })
  // 再处理裸 $var 形式 (URL 参数结尾或 & 前面,如 ?bkn=$ps_tk& 或 ?uid=$uid)
  s = s.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)(?=[&\s]|$)/g, (m, name) => {
    return env[name] != null ? String(env[name]) : m
  })
  return s
}

function evalExpr(expr, env) {
  // 1. 直接变量
  if (env[expr] != null) return String(env[expr])
  // 2. 内置常量
  if (expr === 'time') return String(Date.now())
  if (expr === 'microsecond') return String(Date.now() * 1000)
  if (expr === 'timeSecond') return String(Math.floor(Date.now() / 1000))
  if (expr === 'random') return String(Math.random())
  if (expr === 'timeHex') return Date.now().toString(16)
  // 3. 函数调用 xxx(...)
  const fnMatch = expr.match(/^([a-zA-Z]+)\((.*)\)$/s)
  if (fnMatch) {
    const fname = fnMatch[1]
    const inner = fnMatch[2].trim()
    // 先把内部参数也做一次 format
    const innerVal = format(inner, env)
    if (fname === 'urlEncode') return encodeURIComponent(innerVal)
    if (fname === 'urlDecode') return decodeURIComponent(innerVal)
    if (fname === 'encBase64') return Buffer.from(innerVal, 'utf8').toString('base64')
    if (fname === 'decBase64') return Buffer.from(innerVal, 'base64').toString('utf8')
    if (fname === 'md5') return crypto.createHash('md5').update(innerVal).digest('hex')
    if (fname === 'randString') {
      const len = parseInt(innerVal, 10) || 8
      return crypto.randomBytes(len).toString('hex').slice(0, len)
    }
    if (fname === 'random') return String(Math.random())
  }
  // 4. list 索引 varName[idx]
  const idx = expr.match(/^(\w+)\[(\d+)\]$/)
  if (idx) {
    const arr = env[idx[1]]
    if (Array.isArray(arr) && arr[parseInt(idx[2])] != null) return String(arr[parseInt(idx[2])])
  }
  // 5. 算术 a+b, a-b（简单加减）
  const numMatch = expr.match(/^(\d+)([+\-])(\d+)$/)
  if (numMatch) {
    const a = parseInt(numMatch[1]), b = parseInt(numMatch[3])
    return String(numMatch[2] === '+' ? a + b : a - b)
  }
  // 6. 不识别则保留原样
  return ''
}

/**
 * 把 ${list}$ 形式的多值展开成数组
 * @param {string} str
 * @param {object} env
 * @returns {string[]}
 */
export function formatList(str, env = {}) {
  if (str == null) return []
  const matches = [...String(str).matchAll(/\$\{(\w+)\}\$/g)]
  if (matches.length === 0) return [format(str, env)]

  // 找到第一个 list 类型的变量
  let listVarName = null
  let listValue = null
  for (const m of matches) {
    const name = m[1]
    const v = env[name]
    if (Array.isArray(v) && v.length) {
      listVarName = name
      listValue = v
      break
    }
  }

  if (!listVarName) return [format(str, env)]

  return listValue.map(v => {
    const e = { ...env, [listVarName]: v }
    return format(str, e)
  })
}

/**
 * 把 ${u1|u2|u3}$ 字符串解析成 array (例如 message 默认值 "abc|def|ghi")
 */
function parsePipeList(s) {
  if (!s) return []
  return String(s).split('|').map(x => x.trim()).filter(Boolean)
}
