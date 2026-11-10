# 复制管线 (dsh-rich-copy)

本文是 [README.zh.md](../README.zh.md) 的分册, 讲一次复制从宿主 DOM 到剪贴板的完整路径. 浏览器侧的总体行为见 [工作原理](./how-it-works.zh.md). [English](./copy-pipeline.md). 架构决策见 [docs/adr/](./adr/).

## 富文本复制

`clipboard` 模块把 CopySource 与 CopyTrigger 收敛成 1 个 interface, 产出 `{html, text}` 两份载荷:

1. 选区复制 (`Ctrl+C`) 与按钮复制走同一入口. 按钮路径先构造载荷, 再由写入侧在同步点击栈内只选中一个屏外 1 字符隐藏 span, 调用 `document.execCommand("copy")`, 由 `copyCapture` 把载荷写入 `clipboardData`. 这既保住用户手势激活态, 又绕开大选区的原生布局开销.
2. `serializer` 让 CodeBlock 与 DiffCard 共用外壳实现: 把 `var(...)` / `light-dark(...)` 解析为字面 `rgb(...)`, 清洗字体栈, 找最近实色祖先背景, 行底半透明色叠成不透明实色, 补齐 `- ` / `+ ` / `  ` 行首前缀, 拆掉 `<pre><code>` 壳避免粘贴目标重置字体. 宿主未定义的变量(web 版宿主没有 `--shiki-foreground`)退到外壳自身的实色前景/背景, 与浏览器对非法声明按继承渲染的结果一致, 导出的 HTML 不携带活的 `var()`, 粘贴目标不会把标点退成黑字.
3. 折叠的 diff 卡在复制时自动展开; 若 React 18 尚未异步提交, `hostAdapter` 从 fiber 同步取全量行, 保证复制内容完整.
4. 宿主按钮紧随的 `writeText` 会在 250ms 窗口内被静默, 避免覆盖已写入的富文本, 同时保留宿主"复制成功"的图标反馈. 抑制窗口的生命周期只归写入模块: 调用方只能开窗, 关窗只发生在模块自己的 timer 或 dispose. 曾有调用方提前关窗, 让宿主的纯文本覆盖了刚写好的富文本 — 同一次点击里还有第二个写入者, 模块必须替所有写入者把窗口留到最后.
5. 抑制机制对多实例安全. 宿主的 `client-hmr` 每 500ms 轮询插件文件, 热重载新模块时**不 dispose 旧实例**, 泄漏的旧实例会与新实例共存, 并在同一次点击里各开一次抑制窗. 因此模块把唯一的真原生 `writeText` 存进 `navigator.clipboard` 上的共享槽, 给吞掉函数打可识别标记, 已处于抑制态时不再叠层, 恢复永远走共享槽; 新实例 mount 时自愈历史卡死态(旧版吞掉函数按源码识别, 真原生从 `Clipboard.prototype` 取回). 没有这层防护时, 后一个实例会把前一个实例的吞掉函数误存成"原件", 其 timer 把吞掉函数永久写回 — 宿主的消息复制(自己的 `writeText` 路径)全体静默失效.

## 防御守护

`fenceGuard` 是独立 adapter: 当会话里存在 `"panel": true` 的 GenUI 围栏时, 宿主会每帧把空的 `.genui-dom-fence` 判为被清空并反复重建, 引发持续的整页重排. 该 adapter 在空容器实例上覆盖 `childElementCount` getter(真实子节点为 0 时返回 1), 不插入任何 DOM 节点, 直接切断循环. 可独立开关, `dispose` 时撤销全部 getter.

宿主的内部结构知识(React fiber 私有键, 按钮属性, DOM 类名)只存在于 `hostAdapter` 的 implementation 里, 主模块不直接依赖.
