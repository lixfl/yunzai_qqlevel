# yunzai_qqlevel

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Yunzai](https://img.shields.io/badge/Yunzai-Bot-blue)](https://github.com/Le-niao/Yunzai-Bot)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()

---

## ✨ 功能

### 任务规模

- **13 个任务组**，**51 个任务**
- **45 个 web 任务**（HTTP） + **6 个 func 任务**（OneBot）
- **多域 QR 登录**（qzone/qun/vip/mail/weiyun/accounts）
- **群白名单/黑名单** + **群打卡/续火/抽字符**
- **cron 自动调度** + **配置热重载**

### 命令速览（14 个）

```bash
# 一键
#qq一键 / #qq一键签到 / #qq一键 all / #qq全部

# 登录
#qq登录 [domain] / #qq登录 all / #qq登录 列表 / #qq刷新ck

# Cookie / 任务
#qqck
#qq签到 / #qq任务列表 / #qq任务详情 <id>
#qq启用任务 <id> / #qq禁用任务 <id>

# 配置
#qq配置 / #qq重载配置

# 帮助
#qq签到帮助
```

### 实现状态

| 类别 | 数量 | 实现 |
|------|------|------|
| HTTP 任务 | 45 | ✅ 真正可用 |
| OneBot 模拟任务 | 6 | ✅ 真正可用（用 icqq Yunzai API） |

### 无法实现（需要 Xposed Hook）

| 功能 | 说明 |
|------|------|
| QZone 亲密空间签到 | 需要 ViewModel 调用 |
| ~~小程序任务~~ | ~~已删除：需要小程序登录态，外部 bot 无法获取~~ |

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

**默认时间已错开**（避免 0 点服务器拥塞）：

```
07:30 加好友活跃    15:30 空间说说任务
08:00 群打卡        18:00 波点音乐听歌
09:30 群组续火      20:00 QQ晚安卡 / 步数
10:15 频道签到      21:00 大会员个性点赞
11:45 日签卡打卡    00:00 19 个每日任务
12:00 好友续火花    每月 1/5/24 号 月度任务
13:20 连续登陆QQ    每周一 周度任务
14:00 福利社领券
```

用户可通过 `config/config.yaml` 覆盖每个任务的执行时间（见下文）。

---

## ⚙️ 自定义配置

用户配置位于 `config/config.yaml`（首次启动自动从 `config.example.yaml` 复制）。

### 时间配置

```yaml
# 简化格式 "HH:MM" — 每天固定时间
taskCronOverrides:
  群打卡: "08:00"
  群组续火: "09:30"
  
# 完整 cron (6 段)
  QQ晚安卡: "0 0 20 * * *"
  
# 禁用定时（但仍可通过 #qq签到 手动执行）
  波点音乐听歌: disable
```

### 群白名单/黑名单

```yaml
whitelist:
  - 123456789    # 只对这些群续火/打卡

blacklist:
  - 987654321    # 这些群永不执行
```

### 任务启用覆盖

```yaml
taskOverrides:
  群打卡: true        # 强制启用（覆盖 #qq禁用任务）
  波点音乐听歌: false # 强制禁用（覆盖 #qq启用任务）
```

### 抽字符

```yaml
luckyChar:
  enabled: true
  isSVIP: true        # bot 是 SVIP 时,每群可抽 3 次
```

修改后用 `#qq重载配置` 立即生效，无需重启 Yunzai。

---

## 📁 项目结构

```
yunzai_qqlevel/
├── index.js                # 插件入口（命令 + cron 注册）
├── package.json
├── LICENSE
├── README.md
├── conf/
│   └── xa_conf.yaml       # XAutoDaily 任务配置（已解密，v66）
├── config/
│   ├── config.example.yaml # 配置示例（git 跟踪）
│   └── config.yaml        # 用户配置（git 忽略,首次启动自动创建）
├── lib/
│   ├── crypto.js          # xa_conf 解密 / GTK 计算 / ptqrtoken
│   ├── conf-loader.js     # YAML 解析
│   ├── cookie.js          # 多账号 cookie 管理
│   ├── http.js            # HTTPS 工具
│   ├── login.js           # QR 登录
│   ├── env-format.js      # XAutoDaily EnvFormatUtil 移植
│   └── config.js          # 用户配置加载 + 热重载
├── executor/
│   ├── task-runner.js     # 通用任务执行器
│   ├── onebot-func.js     # Function 任务 → OneBot API
│   └── scheduler.js       # cron 调度
└── data/
    ├── cookies.json       # 持久化 cookie
    ├── tasks-state.json   # 任务启用状态
    └── qr/                # 临时二维码图片
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
