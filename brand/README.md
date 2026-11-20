# DSH Bot 品牌标识

## 概念

**D = Dialogue / Desktop**
用一块奶油色的 D 作为主体，既是 DSH 的首字母，也像一块对话气泡。  
中间是珊瑚色终端光标 `>`，代表 Agent 在等待输入、执行和回应。  
右上角的薄荷色轨迹与圆点表示异步任务在后台继续运行。

整体不依赖渐变炫技，用深墨蓝 + 奶油白 + 珊瑚 + 薄荷四色，保持克制、可识别。

## 颜色

| 名称 | 色值 | 用途 |
|---|---|---|
| Ink | `#101A2B` | 深色底、浅色版主体 |
| Ink Light | `#1B2B44` | 深色渐变高光 |
| Cream | `#F6EFE3` | 深色版 D、浅色版底 |
| Coral | `#F06B4F` | 终端光标、强调 |
| Mint | `#7BE0C1` | 运行轨迹、状态点 |

## 文件

| 文件 | 用途 |
|---|---|
| `dsh-bot-icon.svg` | 深色主图标，矢量源文件 |
| `dsh-bot-icon-1024.png` | 主图标 1024 |
| `dsh-bot-icon-512.png` / `192` / `180` / `64` / `32` | App / PWA / favicon |
| `dsh-bot-icon-light.svg` | 浅色底版本矢量 |
| `dsh-bot-icon-light-*.png` | 浅色底尺寸 |
| `dsh-bot-wordmark.svg` | 深色底横向组合 |
| `dsh-bot-wordmark.png` | 横向组合 PNG |
| `dsh-bot-wordmark-light.svg` / `.png` | 浅色底横向组合 |

## 使用

- 图标最小建议 32px；小于 48px 时不要加文字；
- 横向组合四周留出至少一个 D 宽度的空白；
- 不要拉伸、不要改色、不要把 D 和光标拆开单独使用；
- 深色背景用 `dsh-bot-icon.svg` / `dsh-bot-wordmark.svg`；
- 浅色背景用 `-light` 版本；
- 这是 DSH Bot 的独立标识，不使用 DeepSeek 官方商标。
