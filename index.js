import { readConfig, writeConfig } from './helpers/fs.js'
import { signInDaily } from './tasks/daily.js'
import { signInGroup } from './tasks/group.js'
import { signInMiniapp } from './tasks/miniapp.js'

const logger = global.logger || console
let _running = false

/**
 * Yunzai 插件命令入口
 * 接收每条消息，匹配 #qq签到 等指令
 */
export default async function (e) {
  if (!e || !e.msg) return
  const msg = e.msg.trim()

  if (msg === '#qq签到' || msg === '#qqlevel签到') {
    if (_running) return e.reply('签到任务正在执行中，请稍候...')
    _running = true
    e.reply('开始执行签到任务...')
    const cfg = readConfig()
    if (!cfg.cookie) {
      _running = false
      return e.reply('请先在 plugins/yunzai_qqlevel/config.json 填入 cookie 后再使用')
    }
    try {
      const r1 = await signInDaily(cfg)
      await e.reply('每日签到: ' + JSON.stringify(r1))
    } catch (err) {
      await e.reply('每日签到失败: ' + err.message)
    }
    try {
      for (const gid of (cfg.groupList || [])) {
        const r = await signInGroup(cfg, gid)
        await e.reply(`群 ${gid} 打卡: ` + JSON.stringify(r))
      }
    } catch (err) {
      await e.reply('群打卡失败: ' + err.message)
    }
    try {
      for (const mid of (cfg.miniAppList || [])) {
        const r = await signInMiniapp(cfg, mid)
        await e.reply(`小程序 ${mid} 签到: ` + JSON.stringify(r))
      }
    } catch (err) {
      await e.reply('小程序签到失败: ' + err.message)
    }
    _running = false
    return
  }

  if (msg === '#qq签到帮助' || msg === '#qqlevel帮助') {
    return e.reply([
      '#qq签到         手动执行所有签到任务',
      '#qq签到帮助    显示本帮助',
      '#qq刷新ck      通过 aioqzone 重新登录获取 cookie'
    ].join('\n'))
  }
}

/**
 * 兼容旧版 Yunzai 的 onFirstLaunch 钩子
 */
export async function onFirstLaunch() {
  const cfg = readConfig()
  if (!cfg || Object.keys(cfg).length === 0) {
    writeConfig({ cookie: '', userId: '', groupList: [], miniAppList: [], time: '30 7 * * *' })
    logger.mark && logger.mark('[yunzai_qqlevel] 已生成默认 config.json')
  }
}
