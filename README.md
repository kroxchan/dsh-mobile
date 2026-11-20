# DSH Bot

<p align="center"><img src="brand/dsh-bot-icon-d-refined-192.png" width="104" alt="DSH Bot"></p>

**DSH Bot 是运行在本机 DSH 之上的多 Bot 协作客户端。**

手机端 `DSH Mobile` 只是它的一部分。同一个 Bot 组织还接入了 **DSH Agent** 和 **QQ Bot**，共用工作区、任务板、审批流和长期记忆。

- 手机三页：消息 / 通讯录 / 我的
- 多 Bot 私聊、群聊、DSH Agent 会话
- Bot 组织：Chief、内容、研究、项目等角色，不是单一聊天窗口
- 审批卡、单选/多选/自定义答案卡
- Bot 运行时状态：处理过程、工具调用、耗时
- 图片上传与查看、Markdown 表格、任务卡、复制消息
- 会话置顶 / 清除、新建会话、历史会话、用量与余额
- 任务完成 / 需要审批时的应用内提醒；支持 Web Push 系统通知
- 共享知识库：DSH Agent、QQ Bot、手机端共用 `knowledge/memory.json`
- PWA 图标、manifest、iOS Web Clip 配置

电脑端 DSH 界面不受影响。

> **非官方项目**：DSH Bot 是第三方 DSH 配套产品，不是 DeepSeek 官方产品。
>
> 登录后手机端拥有与本机 DSH 浏览器相同的权限。只在自己或可信的人中间使用。
>
> 安装细节见 [INSTALL.md](INSTALL.md)，社区说明见 [COMMUNITY.md](COMMUNITY.md)。

---

## 它是什么，不是什么

| 是 | 不是 |
|---|---|
| 多 Bot 协作客户端：Bot 身份、群聊、任务板、审批、记忆 | 不是单纯的 DeepSeek Harness 手机壳 |
| 手机端 + DSH Agent + QQ Bot 共用一套工作区 | 不是只有一个聊天输入框 |
| 运行在本机 DSH 之上的 Bot 产品层 | 不是 DeepSeek 官方产品 |
| 依赖 DSH 作为执行后端 | 不是独立云端 Bot 服务 |
| 可以把同一个 Bot 组织接到手机和 QQ | 不是把 DSH Web GUI 等比缩小 |

**DeepSeek Harness 是运行时和执行后端；DSH Bot 是在它之上做 Bot 组织、协作和移动端体验的产品层。** 没有 DSH，DSH Bot 不能独立运行；但只有 DSH，也没有这套多 Bot 协作界面、任务流和共享记忆。

---

## 1. 前置条件

| 条件 | 要求 |
|---|---|
| DSH Desktop | 已安装并正在运行，作为 Bot 的执行后端；电脑上能打开 DSH Web GUI |
| Node.js | **22 或更高** |
| npm | 随 Node.js 安装 |
| 电脑 | Windows 10/11 为主要支持环境；macOS/Linux 可直接运行 `node server.mjs` |
| 手机 | 与电脑同一 Wi-Fi（局域网访问） |
| 公网访问 | 一个 HTTPS 入口，推荐 Cloudflare Tunnel，并支持 WebSocket |
| PWA 通知 | HTTPS；iOS 需要 16.4+，且必须“添加到主屏幕” |
| iOS 描述文件 | Safari；未签名 profile 会显示警告 |

检查环境：

```bash
node -v
npm -v
```

DSH 的 Web GUI 必须在本机回环地址可访问。网关会自动探测 DSH 端口；探测失败时用 `config.json` 的 `upstreamPort` 作为提示端口。

---

## 2. 架构

```text
手机浏览器 / 主屏幕 PWA（DSH Mobile）
        │  HTTPS（可选：Cloudflare Tunnel 或其它反向代理）
        ▼
DSH Bot 移动网关  dsh-mobile/server.mjs  (127.0.0.1:19000)
        │  · 口令门（gate cookie）
        │  · Bot 会话 / 群聊 / 任务板 / 审批 / /__im/* 数据接口
        │  · 自动发现 DSH，并反向代理 HTTP / WebSocket
        │
        ├────────────── 共享工作区 / 任务板 / knowledge/memory.json
        │                              ▲
        │                              │
        │                        QQ Bot / QQ bridge
        │
        ▼
DSH Web GUI  127.0.0.1:<随机端口>
        │
        └── DSH Agent（执行运行时）
```

DSH Bot 不替代 DSH。DSH 关闭后，手机端只能看到连接失败或缓存状态；QQ Bot 也不能继续依赖 DSH 执行任务。

---

## 3. 快速开始

### 3.1 下载并安装

```bash
git clone <repository-url> dsh-mobile
cd dsh-mobile
npm install
```

没有 Git 时，下载 ZIP 解压后进入目录，再执行 `npm install`。

### 3.2 生成配置

```bash
node setup.mjs
```

它会：

- 生成 `config.json`；
- 生成随机手机访问口令；
- 只把口令的 scrypt 派生值和 cookie 签名密钥写入磁盘；
- 在终端打印一次明文口令。

自定义口令：

```bash
node setup.mjs "YOUR_PASSPHRASE"
```

注意：

- 重新执行 `setup.mjs` 会覆盖现有 `config.json`；
- 自定义口令可能留在 shell 历史里，敏感环境请用随机口令；
- `config.json` 不要提交、截图或外传。

### 3.3 启动网关

```bash
node server.mjs
```

Windows 也可以：

```powershell
.\start.ps1
```

停止：

```powershell
.\stop.ps1
```

默认监听：

```text
http://127.0.0.1:19000
```

### 3.4 手机访问

局域网内打开：

```text
http://<电脑局域网IP>:19000
```

输入 `setup.mjs` 打印的口令。

手机 UA 会自动进入 `/__proto/` 手机界面；电脑访问同一地址仍是 DSH 桌面界面。手机想临时看桌面版：

```text
http://<电脑局域网IP>:19000/?desktop=1
```

---

## 4. 配置说明

### 4.1 `config.json`

由 `setup.mjs` 生成，示例结构：

```json
{
  "listenPort": 19000,
  "upstreamPort": 61324,
  "passSalt": "<generated-hex>",
  "passHash": "<generated-hex>",
  "gateSecret": "<generated-base64url>",
  "createdAt": "YYYY-MM-DDTHH:mm:ss.sssZ"
}
```

| 字段 | 说明 |
|---|---|
| `listenPort` | 网关监听端口，默认 `19000`。被占用时改成其它端口 |
| `upstreamPort` | DSH 端口提示值。网关仍会探测；DSH 固定端口时填真实值 |
| `passSalt` | 口令 scrypt 盐，**不要手改** |
| `passHash` | 口令 scrypt 派生值，**不要手改** |
| `gateSecret` | 登录 cookie 签名密钥，**不要外传** |
| `createdAt` | 配置生成时间，仅用于记录 |

`config.example.json` 只有占位值，不能直接用于启动。

### 4.2 换口令

```bash
node setup.mjs "NEW_PASSPHRASE"
```

然后重启网关：

```powershell
.\start.ps1 -Restart
```

或直接结束旧的 `node server.mjs` 再启动。

### 4.3 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | DSH 数据目录；会话、Bot 状态、工作区都在这里 |
| `DSH_REMOTE_DIR` | `~/.dsh-remote` | DSH 远程桥目录，读取 bridge cookie（可选） |
| `DSH_WORKSPACE` | `$DSH_HOME/bot/workspace` | 共享工作区；知识库、任务板等 |
| `DSH_MEMORY_FILE` | `$DSH_WORKSPACE/knowledge/memory.json` | 共享记忆文件路径 |

端口以 `config.json` 为准，不走环境变量。

### 4.4 公网 HTTPS

公网访问需要 HTTPS；Cloudflare Tunnel 示例：

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

固定域名时，在 Tunnel 的 Public Hostname 中指向：

```text
http://127.0.0.1:19000
```

要求：

- 反向代理必须支持 WebSocket；
- 不要把 DSH 的原始端口直接暴露到公网；
- Tunnel token、Cloudflare API token 只放在本机服务配置或环境变量里，**不要写进仓库**；
- `launch-tunnel.vbs` 只是读取本机 token 的示例，按自己的环境修改。

---

## 5. PWA 与图标

### 5.1 Web App Manifest

配置文件：

```text
prototype/manifest.webmanifest
```

包含：

- `name`: `DSH Mobile`
- `short_name`: `DSH`
- `display`: `standalone`
- `orientation`: `portrait`
- `theme_color` / `background_color`: `#f7f6f3`
- 192 / 512 普通图标
- 192 / 512 maskable 图标

图标文件：

```text
prototype/icon.svg
prototype/icon-32.png
prototype/icon-180.png
prototype/icon-192.png
prototype/icon-512.png
prototype/icon-1024.png
prototype/icon-maskable-192.png
prototype/icon-maskable-512.png
```

### 5.2 添加到主屏幕

**iPhone / iPad**

1. Safari 打开网关地址；
2. 分享 → 添加到主屏幕；
3. 从主屏幕启动。

iOS 16.4+ 才支持 Web Push；必须从主屏幕 PWA 启动并授予通知权限。网关或 DSH 关闭时无法推送。

**Android**

Chrome 打开后选择“安装应用”或“添加到主屏幕”。图标不更新时，删除旧图标后重新安装。

### 5.3 iOS Web Clip 描述文件

文件：

```text
ios/DSH-Mobile-WebClip.mobileconfig
```

它会在主屏幕生成一个全屏网页入口，并已嵌入 DSH 图标。

安装：

1. 用 Safari 下载 `.mobileconfig`；
2. 设置 → 通用 → VPN 与设备管理 → 已下载的描述文件；
3. 安装；
4. 回主屏幕。

说明：

- 这是 **Web Clip**，不是 App Store 原生 App；
- 未签名的 profile 会显示“未签名”警告；正式分发应使用 Apple Developer 证书签名或 MDM；
- 换域名后修改 XML 里的 `URL` 再重新安装；
- 通知可靠性不如 Safari 的 PWA，重要通知优先用 PWA。

---

## 6. 共享知识库

数据文件默认：

```text
$DSH_HOME/bot/workspace/knowledge/memory.json
```

DSH Agent、QQ Bot、手机端共用这一份 JSON。

接口：

```text
GET    /__im/memory?q=<keyword>&limit=50
POST   /__im/memory
DELETE /__im/memory?id=<id>
```

CLI：

```bash
node memory-cli.mjs search "关键词"
node memory-cli.mjs add "标题" "长期有效的事实" "tag1,tag2"
node memory-cli.mjs stats
```

手机端：我的 → 共享知识库，可搜索、新增、删除。

QQ Bot：通过 `memory_search` / `memory_add` 工具接入；QQ bridge 的导入路径按部署环境配置。

规则：

- 只记录长期偏好、决定、稳定事实；
- 不记录密码、验证码、token、cookie、隐私数据；
- 记忆文件不要提交到公开仓库；`knowledge/memory.json` 属于运行数据。

---

## 7. 安全

- `config.json` 含口令派生值和 cookie 签名密钥，已在 `.gitignore` 中忽略；
- 不要把 `config.json`、`.credentials.yaml`、`secrets.json`、gate cookie、Tunnel token 写进 README、截图或提交；
- 登录页公开，但必须输入口令；连续错误会按 IP 限流；
- 手机端登录后拥有本机 DSH 浏览器权限，不要在不可信网络公开；
- 公网使用时只开 HTTPS，不直接暴露 `19000`；
- 不再使用时关闭 Tunnel 和网关；
- 换口令或怀疑泄露时，重新执行 `setup.mjs` 并重启网关。

---

## 8. 常见问题

| 现象 | 处理 |
|---|---|
| `EADDRINUSE` | 改 `config.json` 的 `listenPort`，同步修改 Tunnel / 防火墙 |
| 502 / 上游连接失败 | 确认 DSH 正在运行；检查/修改 `upstreamPort`；重启网关 |
| 手机打不开 | 确认同一 Wi-Fi、电脑防火墙放行端口、使用局域网 IP 而不是 `127.0.0.1` |
| 登录一直回到口令页 | 重新执行 `setup.mjs`；清除站点 cookie；确认没有旧进程占用端口 |
| PWA 图标还是旧的 | 删除主屏幕图标，清除站点数据，重新打开 `?v=20261118z13` 后重装 |
| 没有系统通知 | 必须 HTTPS + 已安装 PWA + 通知权限；iOS 16.4+；网关和 DSH 保持运行 |
| 我的页“今日完成”是 0 | 数据来自 `org/task-board.md` 的 completed 记录和 `updated` 日期；当天没有完成记录时就是 0。旁边会显示累计完成数 |
| iOS Web Clip 图标不对 | 重新安装 `.mobileconfig`；旧 profile 先移除 |
| 网关启动后马上退出 | 看 `stderr.log`；先确认 Node 22+ 和 `npm install` 完成 |
| 打开很慢 / 长时间白屏 | 先用局域网 IP 判断是不是公网隧道慢；检查 Cloudflare Tunnel；强制刷新或重装 PWA；当前版本已启用文本压缩和版本化缓存 |

日志：

```text
gateway.log
stdout.log
stderr.log
```

这些文件都是运行数据，不要提交。

---

## 9. 目录

| 路径 | 作用 |
|---|---|
| `server.mjs` | 网关：口令门、DSH 发现、反向代理、`/__im/*` API |
| `setup.mjs` | 生成 `config.json` |
| `prototype/` | 手机端静态前端 |
| `prototype/manifest.webmanifest` | PWA 配置 |
| `prototype/icon-*.png` / `icon.svg` | Web App 图标 |
| `ios/DSH-Mobile-WebClip.mobileconfig` | iOS Web Clip 配置 |
| `memory-store.mjs` / `memory-cli.mjs` | 共享记忆存储与 CLI |
| `gateway-guard.js` | DSH 原界面断线守护 |
| `start.ps1` / `stop.ps1` | Windows 启停 |
| `launch-gateway.vbs` / `launch-tunnel.vbs` | 隐藏窗口启动示例 |
| `brand/` | DSH Bot 标识、品牌板、导出图标 |
| `config.example.json` | 配置字段占位示例 |

---

## 10. 已知边界

- 依赖本机 DSH 正在运行，不是独立云端服务；
- 首次打开很大的会话日志需要解析时间，之后走增量缓存；
- 审批 / 选择题依赖 DSH 事件通道，断线会自动重连；
- 共享记忆目前是关键词检索，不是向量库/RAG；
- Web Push 受系统、浏览器、PWA 安装状态和网关在线状态影响；
- iOS `.mobileconfig` 是 Web Clip，不是原生 App。

---

## License

MIT，见 [LICENSE](LICENSE)。
