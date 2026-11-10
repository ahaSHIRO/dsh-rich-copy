# 工作原理 (dsh-rich-copy)

本文是 [README.zh.md](../README.zh.md) 的分册, 描述插件在浏览器侧的实际行为. [English](./how-it-works.md). 架构决策见 [docs/adr/](./adr/).

## 注入与生命周期

`dsh-client-modules` 扫描 profile 里声明了 `dsh.client` 的包, 把 `lib/client.js` 送进页面. 脚本只注册一个 `factory`, 真正的工作在 `apply(ctx)` 里由 `runtime.mount` 展开: 挂 `MutationObserver` 与 `copy` / `click` 两个捕获监听, 起 300ms 防抖扫描与 8 次 2 秒间隔的补扫. `ctx.on("dispose")` 绑定到 `runtime.unmount`, 它是所有副作用的唯一回收点: 断观察器, 清定时器, 恢复 `navigator.clipboard.writeText`, 撤销 DOM getter 劫持, 清空跨事件状态与缓存.

## 高亮

- **ArkTS / ETS 代码块**: 内置 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) 的 TextMate 语法, 运行时从 CDN 懒加载 [Shiki](https://shiki.style), 用 `codeToHtml` 重写 `code.innerHTML`, 再补一遍装饰器着色. CDN 不可达时该增强静默跳过, 不影响宿主内置高亮.
- **diff 卡**: `highlighter` 模块有 2 个 adapter. 内置正则分词器先同步上色(零网络), Shiki 就绪后在后台覆盖成更准的 token. 语言推断只有一个 owner, 卡片头部标签优先, 否则按首行路径后缀. 未知后缀或超过 400 行的块保持纯文本.

主题输出恒为 `var(--shiki-*)`. 若 Shiki 缺少 `createCssVariablesTheme`, 加载直接失败并走内置分词器, 不再退回字面色主题, 避免颜色表示出现第二种形式.

## 富文本复制

`clipboard` 模块把 CopySource 与 CopyTrigger 收敛成 1 个 interface, 产出 `{html, text}` 两份载荷:

1. 选区复制 (`Ctrl+C`) 与按钮复制走同一入口. 按钮路径先构造载荷, 再由写入侧在同步点击栈内只选中一个屏外 1 字符隐藏 span, 调用 `document.execCommand("copy")`, 由 `copyCapture` 把载荷写入 `clipboardData`. 这既保住用户手势激活态, 又绕开大选区的原生布局开销.
2. `serializer` 让 CodeBlock 与 DiffCard 共用外壳实现: 把 `var(...)` / `light-dark(...)` 解析为字面 `rgb(...)`, 清洗字体栈, 找最近实色祖先背景, 行底半透明色叠成不透明实色, 补齐 `- ` / `+ ` / `  ` 行首前缀, 拆掉 `<pre><code>` 壳避免粘贴目标重置字体.
3. 折叠的 diff 卡在复制时自动展开; 若 React 18 尚未异步提交, `hostAdapter` 从 fiber 同步取全量行, 保证复制内容完整.
4. 宿主按钮紧随的 `writeText` 会在 250ms 窗口内被静默, 避免覆盖已写入的富文本, 同时保留宿主"复制成功"的图标反馈.

## 防御守护

`fenceGuard` 是独立 adapter: 当会话里存在 `"panel": true` 的 GenUI 围栏时, 宿主会每帧把空的 `.genui-dom-fence` 判为被清空并反复重建, 引发持续的整页重排. 该 adapter 在空容器实例上覆盖 `childElementCount` getter(真实子节点为 0 时返回 1), 不插入任何 DOM 节点, 直接切断循环. 可独立开关, `dispose` 时撤销全部 getter.

宿主的内部结构知识(React fiber 私有键, 按钮属性, DOM 类名)只存在于 `hostAdapter` 的 implementation 里, 主模块不直接依赖.

## 调试与验证

控制台 `window.dshRichCopy` 暴露行为指令:

- `copyOnce("code")` / `copyOnce("diff")`: 触发一次 CopyTrigger 并返回 ClipboardPayload.
- `rescan()` / `rescanDiff()`: 强制重扫. `restart()`: 复位一次性降级标志.
- `setDiffHighlight(on)` / `setFenceGuard(on)`: 开关.
- `diffDebug()`: 返回状态与前 3 张 diff 卡的摘要.

`node tests/run.cjs` 用本机无头 Edge 加载 `tests/harness.html`, 在页面外断言复制载荷, 主题切换, 折叠展开, 防御守护与 dispose 回收, 零 npm 依赖.

## 项目结构

```
dsh-rich-copy/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 插入插件行
├── index.js              # Loader 垫片, 转发到 lib/index.js
├── GLOSSARY.md           # 领域术语
├── README.md             # 英文总览
├── README.zh.md          # 中文总览
├── docs/
│   ├── how-it-works.md       # 本文英文版
│   ├── how-it-works.zh.md    # 本文
│   └── adr/                  # 架构决策
├── tests/
│   ├── harness.html      # 无头 Edge 页面夹具
│   └── run.cjs           # 断言入口
└── lib/
    ├── index.js          # 宿主侧空 apply
    └── client.js         # 全部浏览器侧逻辑
```
