# 发布到 DSH 社区插件市场

> 先纠正一个命名：目前没有一个由 DeepSeek 官方运营、接受第三方插件上架的“官方插件市场”。
> 社区里常说的是 **dsh.so**（独立社区项目，与 DeepSeek 无隶属关系），以及
> `awesome-dsh-plugin` 目录。它们做的是**收录、扫描、展示**，不是官方安全背书。
>
> 本文按 2026-11 的 dsh.so 提交规则写；规则可能变化，以
> <https://www.dsh.so/zh/submit/> 为准。

---

## 1. 我们现在这个东西是什么

`dsh-mobile` 是：

- 一个手机端 IM Web 前端；
- 一个本机网关（口令门、DSH 自动发现、反向代理、`/__im/*` 接口）；
- 依赖本机已经运行的 DSH Desktop。

它**不是**一个 `dsh plugin add` 可以直接安装的 DSH 插件，也没有内置 DSH 运行时。

所以现在最合适的定位是：

```text
DSH 配套应用 / 生态应用
（需要用户先安装 DSH Desktop，再安装 dsh-mobile）
```

不要在描述里写“官方插件”“官方认证”或“一键安装进 DSH”；这会误导审核和用户。

---

## 2. 提交前必须补齐

### 仓库

- [x] 公开源码仓库：<https://github.com/kroxchan/dsh-mobile>
- [x] README 有安装说明
- [x] 独立安装教程：`INSTALL.md`
- [x] SPDX 许可证：`LICENSE`（MIT）
- [x] 包名符合 `^[a-z0-9]+(-[a-z0-9]+)*$`：`dsh-mobile`
- [x] 不含真实口令、cookie、token、会话内容
- [ ] 添加 GitHub topic：`dsh`、`deepseek-harness`、`mobile`、`webapp`、`cloudflare-tunnel`
- [ ] 打一个可下载的 Release（zip 或源码 tag）
- [ ] 准备 1–3 张截图：会话列表、聊天/过程、文件/产物
- [ ] README 增加“非官方 / 需要 DSH / 安全边界”声明

### 安全

- `config.json` 已被 `.gitignore` 忽略；
- `gateway.log`、`state-cache.json`、`*.bak-*` 不提交；
- `launch-tunnel.vbs` 从注册表读取 Cloudflare token，不硬编码；
- 公网入口必须经过口令门，不能把 19000 裸奔到公网；
- 在 README 明确：登录后拥有本机 DSH 同等权限。

### 兼容性

dsh.so 只给“Declared（声明）”，不会自动标“Verified（已验证）”。

建议在 README 写：

```text
测试环境：DSH Desktop 0.2.1-rc.5 / Windows / Node 22
状态：Declared，未经过 dsh.so 独立验证
```

---

## 3. 提交到 dsh.so

1. 打开 <https://www.dsh.so/zh/submit/>；
2. 粘贴仓库地址：

   ```text
   https://github.com/kroxchan/dsh-mobile
   ```

3. 条目类型选 **桌面 / 独立应用（生态应用）**，不要选“dsh 插件”，除非以后真的做了
   `dsh plugin add` 包装；
4. 让检查器拉取、扫描；
5. 扫描通过后点 **提交到 dsh.so**；
6. 审核以 Issue 形式进入后台，维护者合入后才会出现。

注意：

- 检查器会重新拉源码扫描，不使用缓存；
- 有阻断级发现（硬编码密钥、外传、破坏性操作等）会被拦；
- 提交限频，别连续重复提交；
- 被收录 ≠ 安全认证，也 ≠ 官方推荐。

### 如果审核说“不是插件/没有 DSH 运行时”

两条路：

1. 按“生态应用”补充说明：它是 DSH 配套网关，安装前需要 DSH；
2. 真做成 DSH 插件：增加 `package.json` 的 `dsh` 字段、cordis patch 和插件入口，
   让 `dsh plugin add` 能启动网关。这个工作量另算，不要先假装有。

---

## 4. 收录到 awesome-dsh-plugin（可选）

在 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> 提交 PR，新增条目 YAML，
按仓库的 `data/plugins/*.yml` 模板填写。

建议描述：

```text
DSH Mobile — 把本机 DSH 接到手机的 IM 风格 Web 前端与网关；需要先运行 DSH Desktop。
```

不要写“官方”“已验证”“一键安装”。

---

## 5. 发一个试用版

### Release 内容

- 源码 zip；
- `INSTALL.md`；
- 变更说明；
- 截图（去除真实会话、路径、口令）；
- 明确“需要 DSH Desktop + Node 22”。

### 试用说明模板

```markdown
## DSH Mobile 试用版

把电脑上的 DSH 接到手机使用。

### 你需要
- 正在运行的 DSH Desktop
- Node.js 22+
- 手机和电脑同一 Wi-Fi；公网访问需要 HTTPS 入口

### 三步
1. 下载/克隆仓库
2. `node setup.mjs`，记下口令
3. `node server.mjs`，手机打开 `http://电脑IP:19000`

公网访问、开机自启、故障排查见 INSTALL.md。

### 注意
- 非官方项目，不是 DeepSeek 官方插件
- 手机端拥有本机 DSH 权限，只给自己/可信的人用
- 不要把 config.json、口令、cookie 发出来

### 反馈
遇到问题请带：系统、Node 版本、DSH 版本、网关日志（打码口令/cookie）。
```

---

## 6. 兼容性报告

dsh.so 鼓励提交真实兼容性报告：

模板：

```text
插件：dsh-mobile
DSH 版本：0.2.1-rc.5
安装方式：源码 / 手动网关
结果：通过 / 部分通过
备注：手机端会话、审批、文件浏览可用；公网隧道需自行配置
```

发到官方 Discussions：

<https://github.com/deepseek-ai/deepseek-harness/discussions>

这比在 README 里写“兼容所有版本”有用得多。

---

## 7. 现在就可以给别人的最小试用方式

```bash
git clone https://github.com/kroxchan/dsh-mobile.git
cd dsh-mobile
node setup.mjs
node server.mjs
```

然后把 `INSTALL.md` 发给对方。

不要发：

- 你的 `config.json`；
- 你的 Cloudflare token；
- 你的口令；
- 带真实会话的截图。

---

## 8. 一句话结论

**能发，但先按“DSH 配套生态应用”发，不要按“官方插件”发。**  
等真正做了 `dsh plugin add` 包装，再考虑插件分类。
