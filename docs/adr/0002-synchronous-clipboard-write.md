# 剪贴板写入必须留在同步手势栈内

复制按钮不调用 `navigator.clipboard.write([ClipboardItem])`, 而是在点击栈内构造自包含 `{html, text}` 载荷, 只选中一个屏外 1 字符隐藏 span, 同步调用 `document.execCommand("copy")`, 由捕获阶段的 `copy` 监听把载荷写入 `clipboardData`.

原因: 在 Electron 的 `dsh-app://` 协议下 `ClipboardItem` 写入实测被拒绝(`NotAllowedError`), 等进入 `.then()` 时已丢失用户手势激活态, 回退的 `execCommand("copy")` 也返回 false, 剪贴板最终只剩宿主 `writeText` 写入的黑白纯文本. 直接选中几百行代码块再复制又会让浏览器对几千个节点做原生选区布局, 实测卡顿数秒.

代价是依赖 `document.execCommand` 这个已废弃但在此环境仍可靠的 API, 以及一个跨事件的 `pending` 内部状态. 收益是同步手势成功率 100%, 写入耗时 < 1ms, 且写入侧只有一个生产 adapter, 按"两个 adapter 才构成真实 seam"不抽成可注入替身. 宿主紧随的 `writeText` 在 250ms 窗口内被静默, 避免覆盖已写入的 HTML, 同时保留宿主的复制成功反馈.
