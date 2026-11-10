# dsh-rich-copy

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 的客户端插件,做三件事:

1. **ArkTS / ETS 语法高亮** : 为 web GUI 中标记为 `arkts` / `ets` 的代码块提供语法着色. 内置 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) 的 TextMate 语法(MIT),运行时从 CDN 加载 [Shiki](https://shiki.style),无构建步骤,无 npm 依赖.
2. **一键富文本复制** : 对所有语言的代码块生效(不限 `ets` / `arkts`):代码块的复制按钮和 `Ctrl+C` 选区都会向剪贴板写入自包含的 `text/html`,粘贴到 Snipaste 等工具时保留颜色,字体和背景.
3. **diff 卡语法高亮** : 宿主的 diff 卡片按文件后缀推断语言着色,复制时一并带出行底色与 `+` / `-` 前缀.

[English](./README.md) · [工作原理](./docs/how-it-works.zh.md) · [架构决策](./docs/adr/)

## 功能

- **高亮** : `struct`,`@interface`,`import lazy` 及所有 TypeScript 关键字着色;装饰器以 DevEco 风格亮黄渲染,跟随 DSH 明暗主题切换.
- **富文本复制(全语言)** : 把 `var(--shiki-*)` / `light-dark(...)` 解析为字面 `rgb(...)`(宿主未定义的变量退到代码块自身的实色),清洗字体栈,行底叠成不透明实色;导出 HTML 离开 DSH 后仍能正确渲染.
- **diff 卡高亮** : 内置正则分词器立即上色,Shiki 就绪后后台升级;未知后缀或超过 400 行的块保持纯文本,可用 `setDiffHighlight(false)` 关闭.
- **零依赖** : 无需 `npm install`;Shiki 首次使用时从 CDN 获取.
- **优雅降级** : CDN 不可达时内置分词器继续工作,ArkTS 增强静默跳过.
- **折叠感知** : 折叠的 diff 卡点复制时自动展开并复制完整行.

## 安装

前提:已配置 DSH web profile(位于 `~/.dsh/profiles/web`).

```bash
dsh plugin --profile web add link:https://github.com/ahaSHIRO/dsh-rich-copy
```

之后重启 `dsh web`. 也可克隆到 `~/.dsh/profiles/web/node_modules/dsh-rich-copy` 并加入该 profile 的 `dsh.profile.bundles`.

## 使用

重启后,任何标注 `arkts` 或 `ets` 的围栏代码块都会自动高亮:

    ```arkts
    @Entry
    @Component
    struct HomePage {
      @State message: string = 'Hello';
      build() { /* ... */ }
    }
    ```

- 点击代码块的复制按钮或选中代码按 `Ctrl+C` → 粘贴到 Snipaste → 保留彩色.
- 复制能力对所有语言生效;高亮增强只针对 `ets` / `arkts`.
- diff 卡按路径后缀着色,点右上角复制后粘贴带行底色与 `+` / `-` 前缀.
- 控制台 `window.dshRichCopy.copyOnce("code")` 可触发一次复制并返回载荷;其余指令见 [工作原理](./docs/how-it-works.zh.md).

## 验证

```bash
node tests/run.cjs
```

用本机无头 Edge 在页面外断言复制载荷,主题切换,折叠展开,防御守护与 dispose 回收,零 npm 依赖.

## 文档

- [工作原理(中文)](./docs/how-it-works.zh.md) / [How it works (English)](./docs/how-it-works.md)
- [复制管线(中文)](./docs/copy-pipeline.zh.md) / [Copy pipeline (English)](./docs/copy-pipeline.md)
- [GLOSSARY.md](./GLOSSARY.md) : 领域术语
- [docs/adr/](./docs/adr/) : 架构决策

## 许可证

MIT. 内置 ArkTS TextMate 语法来自 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS)(MIT).
