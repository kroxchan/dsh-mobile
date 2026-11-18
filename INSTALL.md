# DSH Mobile 安装教程

把电脑上正在运行的 DeepSeek Harness（DSH）接到手机浏览器 / 主屏幕 App。

> 这是第三方配套工具，不是 DeepSeek 官方产品。  
> 它会以你本机 DSH 的权限运行，请只在自己的电脑和可信网络中使用。

---

## 1. 准备

- 一台运行 DSH Desktop 的电脑；
- Node.js **22 或更高版本**；
- 手机和电脑在同一个 Wi-Fi（局域网试用）；
- 如果要公网访问，再准备一个 HTTPS 入口（推荐 Cloudflare Tunnel）。

检查 Node：

```bash
node -v
```

---

## 2. 下载

### 方式 A：Git

```bash
git clone https://github.com/kroxchan/dsh-mobile.git
cd dsh-mobile
```

### 方式 B：下载 ZIP

打开 GitHub 仓库，点 **Code → Download ZIP**，解压后进入目录。

---

## 3. 安装依赖

`ash
npm install
`

Web Push 需要 web-push 依赖，第一次运行前必须安装。

---

## 4. 生成访问口令

```bash
node setup.mjs
```

会生成 `config.json`，并在终端打印一次性访问口令。

也可以自己指定口令：

```bash
node setup.mjs "你的口令"
```

注意：

- `config.json` 含口令派生值和 cookie 签名密钥；
- **不要提交、不要发给别人、不要截图发群**；
- 忘记口令就重新执行 `node setup.mjs 新口令`，然后重启网关。

---

## 5. 启动网关

```bash
node server.mjs
```

Windows 也可以：

```powershell
.\start.ps1
```

正常会监听：

```text
http://127.0.0.1:19000
```

保持这个窗口运行，或按下面“开机自启”配置后台运行。

---

## 6. 手机访问（局域网）

1. 查电脑局域网 IP：

Windows：

```powershell
ipconfig
```

macOS / Linux：

```bash
ifconfig
# 或
ip addr
```

2. 手机浏览器打开：

```text
http://电脑局域网IP:19000
```

3. 输入第 3 步生成的口令。

4. 手机 UA 会自动进入 `/__proto/` 手机界面；想临时看桌面版可加：

```text
http://电脑局域网IP:19000/?desktop=1
```

### 连不上

- 确认手机和电脑在同一 Wi-Fi；
- Windows 防火墙放行 19000：

```powershell
New-NetFirewallRule -DisplayName "DSH Mobile 19000" -Direction Inbound -Protocol TCP -LocalPort 19000 -Action Allow
```

- 确认 `node server.mjs` 还在运行；
- 不要把 `127.0.0.1` 填到手机；手机要用电脑的局域网 IP。

---

## 7. 公网访问 / HTTPS（可选）

手机主屏幕 App、系统通知、部分浏览器能力需要 HTTPS。推荐 Cloudflare Tunnel。

### 快速试用

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

它会给你一个临时 `https://xxx.trycloudflare.com` 地址。

### 固定域名

在 Cloudflare Zero Trust 创建一个 Tunnel，Public Hostname 指向：

```text
http://127.0.0.1:19000
```

然后把域名填到手机。

安全要求：

- **不要**直接把 19000 端口映射到公网；
- 公网入口必须经过口令门；
- 只给自己或可信的人使用；
- 不要把带口令的链接发到公开群。

---

## 8. 开机自启

### Windows

用“任务计划程序”创建登录时任务：

- 程序：`node.exe`
- 参数：`server.mjs`
- 起始于：`dsh-mobile` 目录
- 勾选“不管用户是否登录都运行”或“登录时运行”

也可以把 `launch-gateway.vbs` 放进启动目录；它用于隐藏窗口启动。

### macOS

用 `launchd` 建一个用户级 plist，`ProgramArguments` 指向 `node` 和 `server.mjs`，工作目录设为项目目录。

### Linux

用 `systemd --user`：

```ini
[Unit]
Description=DSH Mobile Gateway
After=network.target

[Service]
WorkingDirectory=/path/to/dsh-mobile
ExecStart=/usr/bin/node /path/to/dsh-mobile/server.mjs
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now dsh-mobile
```

---

## 9. 更新

1. 停掉网关；
2. 拉取新版本或覆盖文件；
3. **保留自己的 `config.json`**；
4. 重新启动：

```bash
node server.mjs
```

手机端版本号在 URL 的 `?v=` 参数里；更新后建议杀掉 App 重开或硬刷新。

---

## 10. 卸载

1. 停掉网关 / 删除自启任务；
2. 删除 `dsh-mobile` 目录；
3. 如果用了 Cloudflare Tunnel，删除对应 tunnel 和 DNS 记录。

---

## 11. 常见问题

### 502 / 提示 DSH 异常

网关找不到 DSH 上游。

- 确认 DSH Desktop 正在运行；
- 看网关日志是否有 `上游 = 127.0.0.1:<端口>`；
- DSH 重启后端口可能变化，重启一次网关；
- 确认 `config.json` 没被误删。

### 首屏很久 / 一直停在加载页

- 首次打开需要下载 CSS/JS；
- 确认网络能访问网关；
- 更新到最新版本（CSS 已改为非阻塞加载）；
- 还慢就看网关日志里 `/__proto/` 请求是否到达。

### 登录后立刻掉线

- 检查系统时间是否正确；
- 重新执行 `node setup.mjs 新口令`，重启网关；
- 清掉浏览器 cookie 再登录。

### 手机能打开但 DSH 原界面空白

- 手机端默认走 `/__proto/`；
- 临时访问 `/?desktop=1` 看桌面版；
- 检查网关日志中的 WebSocket / 反向代理错误。

### 公网打不开

- 先确认局域网 `http://电脑IP:19000` 正常；
- 再检查 Cloudflare Tunnel 是否在线；
- 确认 Public Hostname 指向 `http://127.0.0.1:19000`；
- 不要把 `https://` 指到 19000 的裸 HTTP 端口而不做 TLS 终止。

---

## 12. 安全边界

- 手机端登录后拥有与本机 DSH 浏览器相同的权限；
- 不要开放给不受信任的人；
- 不要把 `config.json`、cookie、Cloudflare token 提交到 Git；
- 公网使用必须加 HTTPS 和强口令；
- 发现安全问题请在仓库开 issue，不要公开贴出口令或会话内容。
