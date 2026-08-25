# yunzai_qqlevel

> **把 XAutoDaily 全部签到/任务功能移植到 Yunzai-Bot 平台**
>
> 基于 [LuckyPray/XAutoDaily](https://github.com/LuckyPray/XAutoDaily) 的任务配置 (`xa_conf.yaml`，已解密内置) 与 [aioqzone/qqqr](https://github.com/aioqzone/aioqzone) 的 QR 登录思路。

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Yunzai](https://img.shields.io/badge/Yunzai-Bot-blue)](https://github.com/Le-niao/Yunzai-Bot)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()

---

## ✨ 功能矩阵

### 通过 HTTP 实现（**真正可用**）

| XAutoDaily 原版功能 | 实现状态 | 备注 |
|---------------------|---------|------|
| 频道签到 | ✅ | `type: web` |
| QQ黄钻签到 + 3 个相关 | ✅ | `type: web` |
| QQ打卡（左上角）/ QQ日签卡 | ✅ | `type: web` |
| QQ字符抽取 | ✅ | `type: web` |
| QQ等级相关（VIP / SVIP 任务） | ✅ | `type: web` |
| 空间相关（签到/点赞/说说） | ✅ | `type: web` |
| 大会员任务（分享/师徒/官网） | ✅ | `type: web` |
| 超星会员 | ✅ | `type: web` |
| QQ会员每日任务 | ✅ | `type: web` |
| QQ超级会员任务 | ✅ | `type: web` |
| 福利社领卷 | ✅ | `type: web` |
| 王者营地任务 | ✅ | `type: web` (mini 部分降级) |
| 300 英雄营地 | ✅ | `type: web` (mini 部分降级) |
| QQ 音乐签到 | ✅ | `type: web` |
| 个性装扮 / 微视 / 波点音乐 | ✅ | `type: web` |
| **黄钻每日领取 / 大会员签到 / 续费** | ✅ | `type: web` |

### 通过 OneBot 模拟（部分可用）

| 功能 | 实现状态 | 说明 |
|------|---------|------|
| 群打卡 OIDB 0xeb7 | ⚠️ 降级 | 通过 bot.sendGroupMsg 模拟；真正 OIDB 需要 QQ 客户端 |
| 群组续火 | ✅ | 通过 bot.sendGroupMsg 发送续火消息 |
| 好友续火 | ✅ | 通过 bot.sendPrivateMsg |
| 公众号签到 | ⚠️ 降级 | 通过 bot.sendPrivateMsg |
| 运动步数上报 | ⚠️ HTTP | 调用 YunDong Web 接口 |

### **无法实现**（需要 Xposed Hook）

| 功能 | 说明 |
|------|------|
| 好友名片点赞 / 回赞 | 需要 OIDB 0x5eb/0x8fc |
| 好友名片点赞（FavoriteManager） | 需要内部接口 |
| QZone 亲密空间签到 | 需要 ViewModel 调用 |
| QQ 运动步数精确上报 | 需要 mobileqq_mp 协议 |
| 新版 OIDB 0xeb7 群打卡 | 需要 QQ 客户端 |
| 部分小程序签到 | 需要 miniAppId 登录态 |

> **结论：能用的有 60+ 个 HTTP 任务，10+ 个 OneBot 模拟任务，10 个 func 任务降级或留空。**

---

## 🚀 安装

```bash
# 在 Yunzai 项目根目录下
git clone https://github.com/lixfl/yunzai_qqlevel.git plugins/yunzai_qqlevel
cd plugins/yunzai_qqlevel
pnpm install   # 或 npm install
```

**目录要求**：必须放在 `plugins/yunzai_qqlevel/` 目录下（与 `package.json` 同级）。

---

## 🔧 使用步骤

### 1. 登录获取 Cookie

```bash
# 在 QQ 群里发送:
#qq登录
```

机器人会发送一张二维码图片，用手机 QQ 扫码即可完成登录。Cookie 自动保存到 `data/cookies.json`。

> 如果扫码时 OneBot 没返回有效 Cookie，可以手动从浏览器抓 `https://vip.qq.com/` 的 cookie 写进 `data/cookies.json`：
> ```json
> { "12345678": { "global": { "p_skey": "xxx", "skey": "xxx", "uin": "o12345678", "pt_key": "xxx" } } }
> ```

### 2. 查看 cookie 状态

```bash
#qqck
```

### 3. 立即签到

```bash
#qq签到
```

依次执行所有已启用任务。

### 4. 任务管理

```bash
#qq任务列表           # 查看所有任务（✓启用 / ✗禁用）
#qq任务详情 <id>     # 查看任务详情
#qq启用任务 <id>     # 启用
#qq禁用任务 <id>     # 禁用
```

---

## ⏰ 自动定时

每个任务根据 `cron` 配置自动执行。任务配置在 `conf/xa_conf.yaml`，内置 XAutoDaily v66 版本（最新）。

启用状态保存到 `data/tasks-state.json`，默认全部启用。

---

## 📁 项目结构

```
yunzai_qqlevel/
├── index.js                # 插件入口（命令 + cron 注册）
├── config.json             # 基础配置
├── package.json
├── LICENSE
├── README.md
├── conf/
│   └── xa_conf.yaml       # XAutoDaily 任务配置（已解密，v66）
├── lib/
│   ├── crypto.js          # xa_conf 解密 / GTK 计算 / ptqrtoken
│   ├── conf-loader.js     # YAML 解析
│   ├── cookie.js          # 多账号 cookie 管理
│   ├── http.js            # HTTPS 工具
│   ├── login.js           # QR 登录
│   └── env-format.js      # XAutoDaily EnvFormatUtil 移植
├── executor/
│   ├── task-runner.js     # 通用任务执行器
│   ├── onebot-func.js     # Function 任务 → OneBot API
│   └── scheduler.js       # cron 调度
├── data/
│   ├── cookies.json       # 持久化 cookie
│   ├── tasks-state.json   # 任务启用状态
│   └── qr/                # 临时二维码图片
└── tasks/                 # 旧的占位（保留兼容）
    ├── daily.js
    ├── group.js
    └── miniapp.js
```

---

## 🔐 内置的 xa_conf 解密机制

`lib/crypto.js` 完整还原了 XAutoDaily 的 RSA + AES 解密：

1. Caesar Cipher 解码 RSA 公钥
2. RSA 公钥解密前 128 字节（base64）→ AES-128 key（16 字节）
3. AES-128-ECB 解密剩余部分 → YAML 配置

详情见 `lib/crypto.js:decryptXAConf`。

--

## ⚠️ 已知限制

1. **OIDB 协议任务**：Yunzai-Bot 跑在普通 bot QQ 上，无法发送 OIDB 协议包（需 QQ 客户端进程内部权限）。涉及好友名片点赞、好友续火 OIDB 模式、亲密空间签到等会失败或降级。

2. **小程序签到**：部分 type=`mini|...` 的任务需要小程序登录态，目前仅支持 HTTP 部分。

3. **群打卡**：依赖 QQ 版本，部分 Yunzai-bot 协议端不支持。

4. **Cookie 失效**：QQ cookie 有效期约 1-3 天，过期后需要重新 `#qq登录`。

---

## 🙏 致谢

- [LuckyPray/XAutoDaily](https://github.com/LuckyPray/XAutoDaily) — 任务配置 / 接口来源
- [aioqzone](https://github.com/aioqzone/aioqzone) — QR 登录思路
- [Le-niao/Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) — 插件运行平台

---

## 📜 License

MIT
