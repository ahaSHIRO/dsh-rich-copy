# 工作原理 (dsh-rich-copy)

本文是 [README.zh.md](../README.zh.md) 的分册, 描述插件在浏览器侧的实际行为. 复制侧单独成册: [复制管线](./copy-pipeline.zh.md). [English](./how-it-works.md). 架构决策见 [docs/adr/](./adr/).

## 注入与生命周期

`dsh-client-modules` 扫描 profile 里声明了 `dsh.client` 的包, 把 `lib/client.js` 送进页面. 脚本只注册一个 `factory`, 真正的工作在 `apply(ctx)` 里由 `runtime.mount` 展开: 挂 `MutationObserver` 与 `copy` / `click` 两个捕获监听, 起 300ms 防抖扫描与 8 次 2 秒间隔的补扫. `ctx.on("dispose")` 绑定到 `runtime.unmount`, 它是所有副作用的唯一回收点: 断观察器, 清定时器, 恢复 `navigator.clipboard.writeText`, 撤销 DOM getter 劫持, 清空跨事件状态与缓存.

## 高亮

- **ArkTS / ETS 代码块**: 内置 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) 的 TextMate 语法, 运行时从 CDN 懒加载 [Shiki](https://shiki.style), 用 `codeToHtml` 重写 `code.innerHTML`, 再补一遍装饰器着色. CDN 不可达时该增强静默跳过, 不影响宿主内置高亮.
- **diff 卡**: `highlighter` 模块有 2 个 adapter. 内置正则分词器先同步上色(零网络), Shiki 就绪后在后台覆盖成更准的 token. 语言推断只有一个 owner, 卡片头部标签优先, 否则按首行路径后缀. 未知后缀或超过 400 行的块保持纯文本.

主题输出恒为 `var(--shiki-*)`. 若 Shiki 缺少 `createCssVariablesTheme`, 加载直接失败并走内置分词器, 不再退回字面色主题, 避免颜色表示出现第二种形式.

## 复制管线

复制侧单独成册: [复制管线](./copy-pipeline.zh.md) — 载荷构造, 变量解析与实色兜底, 250ms 宿主写入抑制窗口, 以及针对 GenUI 围栏重排的防御守护.

## 调试与验证

控制台 `window.dshRichCopy` 暴露行为指令:

- `copyOnce("code")` / `copyOnce("diff")`: 复述生产的按钮路径(识别, 构造, 开窗, 写入)并返回 `{wrote, payload}`.
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
│   ├── copy-pipeline.md      # 复制管线分册(英文)
│   ├── copy-pipeline.zh.md   # 复制管线分册(中文)
│   └── adr/                  # 架构决策
├── tests/
│   ├── harness.html      # 无头 Edge 页面夹具
│   └── run.cjs           # 断言入口
└── lib/
    ├── index.js          # 宿主侧空 apply
    └── client.js         # 全部浏览器侧逻辑
```
