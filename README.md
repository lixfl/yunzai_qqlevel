# yunzai_qqlevel

> Yunzai-Bot QQ 等级 / 签到插件 —— 把 [LuckyPray/XAutoDaily](https://github.com/LuckyPray/XAutoDaily) 中的「HTTP 签到」能力搬进 Yunzai‑Bot。

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Yunzai](https://img.shields.io/badge/Yunzai-Bot-blue)](https://github.com/Le-niao/Yunzai-Bot)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()

---

## ✨ 特性

- 🛡 **零 Hook** — 完全使用 QQ HTTP API（无需 Xposed / Root），可在普通 Yunzai‑Bot 部署
- 🔐 **Cookie 登录** — 参考 [aioqzone](https://github.com/aioqzone/aioqzone) 的思路获取 ck
- ⏰ **定时签到** — 基于 `node-cron` 每日自动执行
- 🪪 **多账号** — `config.json` 支持多个 QQ
- 🧩 **可扩展** — `tasks/*.js` 模块化，新增签到只需一个文件

## 🚀 安装

```bash
# 在 Yunzai 项目根目录下
git clone https://github.com/lixfl/yunzai_qqlevel.git plugins/yunzai_qqlevel
```

> 把整个 `yunzai_qqlevel/` 文件夹放到 `plugins/` 下，重启 Yunzai-Bot。

## ⚙️ 配置

编辑 `plugins/yunzai_qqlevel/config.json`：

```json
{
  "cookie": "",
  "userId": "",
  "groupList": [],
  "miniAppList": [],
  "time": "30 7 * * *"
}
```

| 字段 | 说明 |
|------|------|
| `cookie` | QQ 网页 Cookie（推荐用 [aioqzone](https://github.com/aioqzone/aioqzone) 或浏览器抓包获取） |
| `userId` | 自己的 QQ 号 |
| `groupList` | 需要打卡的群号数组 |
| `miniAppList` | 需要签到的小程序 ID 数组 |
| `time` | 每日自动执行时间（cron 表达式） |

## 🤖 命令

| 命令 | 说明 |
|------|------|
| `#qq签到` | 立即触发所有签到任务 |
| `#qq签到帮助` | 显示帮助 |

## 📁 项目结构

```
yunzai_qqlevel/
├── index.js            # 插件入口（命令 + 启动钩子）
├── config.json         # 配置
├── helpers/
│   ├── fs.js           # 配置读写
│   └── http.js         # 简易 HTTPS 工具
├── tasks/
│   ├── daily.js        # 每日签到
│   ├── group.js        # 群打卡
│   └── miniapp.js      # 小程序签到
├── README.md
├── LICENSE
└── package.json
```

## 🔧 获取 Cookie (CK)

参考 [aioqzone](https://github.com/aioqzone/aioqzone)：

```bash
pip install aioqzone
```

通过 QR 登录获取的 `p_skey`/`skey`/`pt4_token` 等字段拼成 cookie 字符串，填入 `config.json`。

## ⚠️ 声明

- 本项目仅供学习交流，请勿用于商业用途或违反 QQ 用户协议的行为。
- QQ 内部接口经常更新，如遇 API 失效请提交 Issue 或自行修改 `tasks/*.js`。

## 🙏 致谢

- [LuckyPray/XAutoDaily](https://github.com/LuckyPray/XAutoDaily) — 复刻来源
- [aioqzone](https://github.com/aioqzone/aioqzone) — Cookie 获取思路
- [Le-niao/Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) — 插件运行平台

---

## 📜 License

MIT
