# dsh-rich-copy

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 的客户端插件,做三件事:

1. **ArkTS / ETS 语法高亮** —— 为 web GUI 中标记为 `arkts` / `ets` 的代码块提供语法着色。内置 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) 的 TextMate 语法(MIT),运行时从 esm.sh 加载 [Shiki](https://shiki.style) —— 无构建步骤,无 npm 依赖。
2. **一键富文本复制** —— 对所有语言的代码块生效(不限 `ets` / `arkts`):代码块的「复制」按钮和 `Ctrl+C` 选区都会向剪贴板写入自包含的 `text/html`,粘贴到 Snipaste 等工具时保留颜色、字体和背景。
3. **diff 卡语法高亮** —— 宿主的 diff 卡片(工具调用与 GenUI 的 diff 节点共用同一个 `DiffBlock`)会按文件后缀推断语言着色,不再是单调的红绿纯文本;复制时一并带出行底色。

[English](./README.md)

## 功能

- **高亮** —— `struct`、`@interface`、`import lazy` 及所有 TypeScript 关键字着色;装饰器(`@Entry`、`@State`、`@Provide` 等)以 DevEco 风格亮黄色(`light-dark(#9a6700, #ffd75f)`)渲染。主题感知:跟随 DSH 明暗主题切换。
- **富文本复制(全语言)** —— 不限于 `ets` / `arkts`:任意 `.md-code-block`(javascript、python、sql 等)复制时都会把每个 `var(--shiki-*)` / `light-dark(...)` 引用解析为字面 `rgb(...)`,导出 HTML 离开 DSH 后仍能正确渲染。注释和字符串不会被误染色。
- **diff 卡高亮** —— 按 `path` 后缀推断语言(kotlin/typescript/python/…),对连续代码行整段着色后按行回填;未知后缀或超过 400 行的块保持纯文本,可用 `setDiffHighlight(false)` 关闭。
- **零依赖** —— 无需 `npm install`;Shiki 首次使用时从 CDN 获取。
- **优雅降级** —— CDN 不可达时插件静默跳过,不影响 DSH 内置高亮。

## 安装

前提:已配置 DSH web profile(位于 `~/.dsh/profiles/web`)。

### 方式一 —— `link:` 安装(推荐)

```bash
dsh plugin --profile web add link:https://github.com/ahaSHIRO/dsh-rich-copy
```

之后重启 `dsh web`。

### 方式二 —— 克隆到 node_modules

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
git clone https://github.com/ahaSHIRO/dsh-rich-copy.git \
  ~/.dsh/profiles/web/node_modules/dsh-rich-copy
```

然后把它加入 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`(上面的 `dsh plugin` 命令会自动完成)。

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

- 点击代码块的「复制」按钮 → 粘贴到 Snipaste → 保留彩色。
- 选中代码并按 `Ctrl+C` → 效果相同。
- 复制能力对所有语言的代码块生效;高亮增强只针对 `ets` / `arkts`。
- diff 卡(工具调用或 GenUI 的)按路径后缀着色,点右上角「复制」后粘贴带行底色。

## 工作原理

| 步骤 | 发生什么 |
|---|---|
| 1 | `dsh-client-modules` 扫描 profile 中的 `dsh.client` 包,把 `lib/client.js` 送入页面。 |
| 2 | 插件监听 DOM,找到横幅文字为 `ets` 或 `arkts` 的 `.md-code-block` 容器做高亮增强(复制拦截见第 4 步,不区分语言)。 |
| 3 | 从 esm.sh 懒加载 Shiki + ArkTS 语法,用高亮后的 token 重写该代码块的 `innerHTML`。 |
| 4 | 捕获阶段的 `copy` 监听器拦截每次复制:把克隆的选区挂载到真实 DOM,用 `getComputedStyle` 将 `var(...)` / `light-dark(...)` 解析为字面 `rgb(...)`,然后向剪贴板写入自包含的 `text/html` + `text/plain`。 |
| 5 | diff 卡(`[data-diff]`)按路径后缀加载语言,把连续代码行整段交给 Shiki 着色后按行回填;行底色与红绿语义仍归宿主,复制时把底色解析成内联样式。 |

调试入口:控制台执行 `window.dshRichCopy.rescan()` / `window.dshRichCopy.rescanDiff()` 强制重新扫描;`window.dshRichCopy.setDiffHighlight(false)` 可关闭 diff 着色。

## 项目结构

```
dsh-rich-copy/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 插入插件行
├── index.js              # Loader 垫片(转发到 lib/index.js)
└── lib/
    ├── index.js          # 宿主侧:空操作(纯客户端插件)
    └── client.js         # 全部客户端逻辑(~16 KB,无依赖)
```

## 许可证

MIT。内置 ArkTS TextMate 语法来自 [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS)(MIT)。
