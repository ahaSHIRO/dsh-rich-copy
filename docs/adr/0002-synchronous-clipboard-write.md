# 剪贴板写入必须留在同步手势栈内

复制按钮不调用 `navigator.clipboard.write([ClipboardItem])`, 而是在点击栈内构造自包含 `{html, text}` 载荷, 只选中一个屏外 1 字符隐藏 span, 同步调用 `document.execCommand("copy")`, 由捕获阶段的 `copy` 监听把载荷写入 `clipboardData`.

原因: 在 Electron 的 `dsh-app://` 协议下 `ClipboardItem` 写入实测被拒绝(`NotAllowedError`), 等进入 `.then()` 时已丢失用户手势激活态, 回退的 `execCommand("copy")` 也返回 false, 剪贴板最终只剩宿主 `writeText` 写入的黑白纯文本. 直接选中几百行代码块再复制又会让浏览器对几千个节点做原生选区布局, 实测卡顿数秒.

代价是依赖 `document.execCommand` 这个已废弃但在此环境仍可靠的 API, 以及一个跨事件的 `pending` 内部状态. 收益是同步手势成功率 100%, 写入耗时 < 1ms, 且写入侧只有一个生产 adapter, 按"两个 adapter 才构成真实 seam"不抽成可注入替身. 宿主紧随的 `writeText` 在 250ms 窗口内被静默, 避免覆盖已写入的 HTML, 同时保留宿主的复制成功反馈; 该窗口只由写入模块自己的 timer 或 dispose 关闭 — 曾允许调用方提前关窗, 结果宿主在同一点击事件里的第二个写入覆盖了刚写好的富文本, 此后调用方只保留开窗权, 关窗权全部收归模块; CopySource 构造收拢进 source module 后, 按钮路径的开窗也随 `copyButton(container)` 收进写入模块 — 调用方只递容器, 识别失败(无内容)不开窗不写入, 宿主纯文本复制照常.

窗口的"原件"必须存进跨实例的共享槽. 宿主的 `client-hmr` 每 500ms 轮询插件文件, 热重载新模块时不 dispose 旧实例, 泄漏实例与新实例会在同一次点击里各开一次窗口; 每实例闭包各存一份"原件"时, 后一个实例把前一个实例的吞掉函数误存成原件, 其 timer 把吞掉函数永久写回, 宿主的消息级复制(自己的 `writeText` 路径)全体静默失效. 共享槽(`navigator.clipboard` 上的属性) + 吞掉函数打标记 + 已抑制不叠层 + 新实例 mount 时自愈, 四件套缺一不可; 真原生的兜底取自 `Clipboard.prototype`(卡死态且槽位缺失时).
