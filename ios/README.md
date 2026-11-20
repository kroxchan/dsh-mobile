# iOS Web Clip 配置说明

`DSH-Mobile-WebClip.mobileconfig` 是一个 iOS 配置描述文件，用 `com.apple.webClip.managed` 在主屏幕放一个全屏网页入口。

## 它是什么

- 本质上是一个 **Web Clip / 网页快捷方式**；
- 不是 App Store 应用；
- 不包含原生 API、APNs 推送或原生文件选择；
- 适合个人/团队快速安装，不适合冒充正式 App 上架。

## 安装

1. 把 `.mobileconfig` 放到 HTTPS 可访问的位置；
2. iPhone Safari 打开这个文件；
3. 设置 → 通用 → VPN 与设备管理 → 已下载的描述文件；
4. 安装；
5. 回到主屏幕，会出现 `DSH Mobile` 图标。

也可以放进 Files 后点击安装。

## 注意

- 未签名的描述文件会显示“未签名”警告；正式分发应使用 Apple Developer 证书签名，或走 MDM；
- 这个入口打开的是：

```text
https://bot.chatkrox.top/__proto/
```

- 如果你换了网关域名，修改 XML 里的 `URL`；
- Web Push 的可靠性不如 Safari 的“添加到主屏幕”PWA，重要通知建议仍用 PWA；
- 真正的 iOS App 需要 Xcode + TestFlight/App Store，不能靠这个配置文件完成。

## 修改 URL

编辑 `DSH-Mobile-WebClip.mobileconfig`：

```xml
<key>URL</key>
<string>https://你的域名/__proto/</string>
```

改完后重新安装描述文件。
