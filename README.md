# DSH Mobile

把本机运行的 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web GUI 接到手机上使用：一个手机端 IM 界面 + 一个本地网关。

- 手机三页结构：消息 / 通讯录 / 我的
- 聊天框：私聊、群聊、DSH Agent 会话
- 审批卡「允许 / 拒绝」、选择题卡（单选 / 多选 / 自定义答案）
- Bot 运行状态：思考中、正在调用哪个工具、耗时
- 图片上传与查看、Markdown 表格、任务卡、复制消息
- 会话置顶 / 清除、新建会话、历史会话切换、用量与余额

电脑端 DSH 界面完全不受影响。

- 产物入口：文档（md / txt / docx / pdf / xlsx / pptx / csv / json）和图片都支持，按轮次分组，可在手机内直接打开预览

## 架构

```
手机浏览器 / 主屏幕 App
        │  HTTPS（可选：Cloudflare Tunnel 或其它反向代理）
        ▼
dsh-mobile/server.mjs  (127.0.0.1:19000)
        │  · 口令门（cookie）
        │  · 自动发现本机 DSH Web GUI 端口
        │  · 反向代理（含 WebSocket）
        ▼
DSH Web GUI  127.0.0.1:<随机端口>
```

## 快速开始

1. 安装 Node.js 22+，并确保本机 DSH 正在运行；
2. 在本目录执行：

   ```bash
   node setup.mjs
   ```

   会生成 `config.json` 并打印一次性访问口令（口令只以 scrypt 派生值保存）。

3. 启动网关：

   ```bash
   node server.mjs
   ```

   Windows 也可以用 `start.ps1`；停止用 `stop.ps1`。

4. 手机访问 `http://<本机IP>:19000`，输入口令。
   手机 UA 会自动跳到 `/__proto/` 的手机界面；电脑访问同一个地址仍是 DSH 原界面，
   手机想临时看原界面可加 `?desktop=1`。

### 公网访问

自行准备 HTTPS 入口（例如 Cloudflare Tunnel），把域名指向 `http://127.0.0.1:19000` 即可。
`launch-tunnel.vbs` 是一个 Windows 下从 Cloudflared 服务注册项读取 token 的启动示例，
按自己的环境修改或不用。

## 安全说明

- `config.json` 含口令派生值与 cookie 签名密钥，**不要提交、不要外传**（已在 `.gitignore`）。
- 登录页是公开的，但必须输入口令；连续错误会按 IP 限流。
- 登录后手机端拥有与本机浏览器相同的权限，请只在可信网络中开放。
- 换口令：`node setup.mjs 新口令`，然后重启网关。

## 目录

| 路径 | 作用 |
|---|---|
| `server.mjs` | 网关：口令门、DSH 自动发现、反向代理、`/__im/*` 数据接口、审批/选择题事件通道 |
| `setup.mjs` | 生成 `config.json`（随机口令 + scrypt 派生 + 签名密钥） |
| `prototype/` | 手机端 IM 前端（纯静态，无构建步骤） |
| `gateway-guard.js` | 手机端 DSH 原界面的断线守护脚本 |
| `start.ps1` / `stop.ps1` | Windows 启动 / 停止网关 |
| `launch-gateway.vbs` / `launch-tunnel.vbs` | 隐藏窗口启动网关 / Cloudflare Tunnel 的示例 |
| `config.example.json` | 配置字段示例（真实配置由 `setup.mjs` 生成） |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | DSH 数据目录（会话、Bot 状态等） |
| `DSH_REMOTE_DIR` | `~/.dsh-remote` | DSH 远程桥目录（可选） |

端口在 `config.json` 的 `listenPort`（默认 19000）与 `upstreamPort`（DSH 提示端口，默认 61324）中修改。

## 已知边界

- 依赖本机 DSH 正在运行；网关只做代理与数据适配，不替代 DSH。
- 会话日志很大的情况下，首次打开该会话需要解析 1–2 秒，之后走增量缓存。
- 审批 / 选择题依赖与 DSH 的事件通道；通道断开会自动重连。
- 前端导航、模型选择、权限预设等部分入口仍是占位。

## License

仓库未附带开源许可证；如需对外分发，请自行补充（MIT / Apache-2.0 / 内部使用声明等）。
