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

## 第二版：D 与 `>` 融合

`dsh-bot-icon-fused.svg` 是第二版主标识：  
D 的负空间直接切出一枚 `>`，不再把光标单独放在 D 里面。远看是 D，近看是终端提示符，两个符号共用同一条轮廓。

这一版只用前端已有的色彩：

```text
纸白 #f7f6f3
墨黑 #1f1e1d
陶土 #c15f3c / #d97a55
```

- 浅色底：纸白底 + 陶土 D；
- 深色底：墨黑底 + 陶土 D；
- 不再引入薄荷色和额外光效。

## 第三版：D 的右侧轮廓就是 `>`

`dsh-bot-icon-chevron.svg` 不再把 `>` 单独放进 D，也不挖一个 `>` 的洞。

它把 D 的**右侧碗形轮廓本身**做成折线尖点：

- 左侧是 D 的竖笔；
- 上、下边向右收成一个尖点；
- 这个尖点就是 `>`，不是额外叠加的符号；
- 远看是一个 D，近看能看出终端的折线方向。

颜色继续只用前端色系：

```text
纸白 #f7f6f3
墨黑 #1f1e1d
陶土 #c15f3c / #d97a55
```

这是目前三版里最“融合”的一版，不再有独立光标或镂空箭头。

## 第四版：去掉竖笔

`dsh-bot-icon-open-chevron.svg` 把左侧的 `丨` 完全去掉，只留下开口的碗形折线：

- 不再有 D 的竖笔；
- 上、下两条弧线在右侧收成尖点；
- 开口本身让 `>` 非常明确；
- 左侧留白让整体仍然像 D 的碗形/缺口。

这是“先看出 `>`，再看出 D”的版本。

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
| `dsh-bot-icon-fused.svg` | 第二版 D + `>` 融合图标，浅色底 |
| `dsh-bot-icon-fused-*.png` | 第二版浅色底尺寸 |
| `dsh-bot-icon-fused-dark.svg` | 第二版深色底 |
| `dsh-bot-icon-fused-dark-*.png` | 第二版深色底尺寸 |
| `dsh-bot-wordmark-fused.svg` / `.png` | 第二版浅色横向组合 |
| `dsh-bot-wordmark-fused-dark.svg` / `.png` | 第二版深色横向组合 |
| `dsh-bot-icon-chevron.svg` | 第三版 D 的右侧轮廓就是 `>`，浅色底 |
| `dsh-bot-icon-chevron-*.png` | 第三版浅色底尺寸 |
| `dsh-bot-icon-chevron-dark.svg` | 第三版深色底 |
| `dsh-bot-icon-chevron-dark-*.png` | 第三版深色底尺寸 |
| `dsh-bot-wordmark-chevron.svg` / `.png` | 第三版浅色横向组合 |
| `dsh-bot-wordmark-chevron-dark.svg` / `.png` | 第三版深色横向组合 |
| `dsh-bot-icon-open-chevron.svg` | 第四版去掉竖笔的开口 D/`>`，浅色底 |
| `dsh-bot-icon-open-chevron-*.png` | 第四版浅色底尺寸 |
| `dsh-bot-icon-open-chevron-dark.svg` | 第四版深色底 |
| `dsh-bot-icon-open-chevron-dark-*.png` | 第四版深色底尺寸 |
| `dsh-bot-wordmark-open-chevron.svg` / `.png` | 第四版浅色横向组合 |
| `dsh-bot-wordmark-open-chevron-dark.svg` / `.png` | 第四版深色横向组合 |
| `dsh-bot-icon-curved-d.svg` | 无竖笔但左侧闭合的备选稿 |

## 使用

- 图标最小建议 32px；小于 48px 时不要加文字；
- 横向组合四周留出至少一个 D 宽度的空白；
- 不要拉伸、不要改色、不要把 D 和光标拆开单独使用；
- 深色背景用 `dsh-bot-icon.svg` / `dsh-bot-wordmark.svg`；
- 浅色背景用 `-light` 版本；
- 这是 DSH Bot 的独立标识，不使用 DeepSeek 官方商标。
