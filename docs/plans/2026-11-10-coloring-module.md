# Coloring Module Implementation Plan

> **For agentic workers:** Implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整条后台着色管线(code 块侧 + diff 侧)收进一个 `coloring` module, 统一上色入口修掉 fiber 分支缺异步升级的行为分叉。

**Architecture:** 新 IIFE `coloring`(物理位于 highlighter 之后 source 之前), 收编 code 块扫描(getHighlighter/done/patchDecorators/findBlocks/scan)与 diff 扫描(scanDiffs/upgradeDiffWithShiki/colorizeOneDiffBlockSync/三态); 统一入口 colorizeRows 内化"内置立即 - 语言检测 - pack 就绪 - Shiki 覆盖 - 未加载异步补染"; highlighter 导出面缩至 colorize。

**Tech Stack:** 零依赖单文件 DSH 客户端插件(ES5 兼容 IIFE), 无头 Edge 测试夹具。

**Spec:** 2026-11-10 架构评审候选 2 grilling 两轮共识(本文件即共识落地)。

## Global Constraints

- `lib/client.js` 保持零依赖单文件无构建(ADR-0001)
- T1-T16 全部存活且语义不变; 无新增红测(异步升级依赖 CDN, 无头不可红)
- 注释用中文, 标点用 ASCII; 提交已预授权, 英文 `type(Lx): lowercase summary`
- lastDiffError 留文件层(source.diffOf 仍写它); GRAMMAR/SHIKI_URLS/TARGET_LANGS 留文件顶层

## Review Focus

1. fiber 片段行的异步升级 — colorizeFragmentRows 覆盖未加载语言的 ensureDiffLang 补染(行为分叉修复, 无头不可红, 由代码审读保证)
2. builtin 导出退场后三处直调点等价改写(colorize(rows, null, null) 内部先跑 builtin)
3. 扫描锁与一次性锁(scanning/diffScanning/shikiUpgradeStarted/shikiUpgraded)全部收进单元作用域
4. resetTransient 删五项枚举改调 coloring.reset()
5. 调试指令面 rescan/rescanDiff/setDiffHighlight/diffDebug 行为不变

---

### Task 1: coloring IIFE

**Files:**
- Modify: `lib/client.js`(多处)

**Interfaces:**
- Produces: `coloring.scan() / coloring.scanDiffs() / coloring.colorize(block) / coloring.colorizeFragmentRows(block, rows) / coloring.reset()`; `highlighter.colorize(rows, lang, pack)`(唯一导出)

- [x] Step 1: 建 coloring IIFE(物理: highlighter 之后, 现 scanDiffs 区域): 搬入 highlighterPack/getHighlighter, done, DECO_RE/DECO_NAMES/patchDecorators, findBlocks/scanning/scan, LANG_BY_EXT/KNOWN_LANGS/langFromHeading/langForPath/detectDiffLang, diffScanning/builtinMode(diffEnabled 留文件层), shikiUpgradeStarted/shikiUpgraded/resolvedPack/upgradeDiffWithShiki, scanDiffs, withTimeout, colorizeOneDiffBlockSync 改造为 colorize/colorizeFragmentRows(统一 colorizeRows 核心: cap + builtin + detectDiffLang + pack 就绪 + 异步补染), reset
- [x] Step 2: highlighter 导出面缩至 colorize; 三处 builtin 直调点等价改写(scanDiffs 内 → colorize(rows, null, null) 或经统一入口; source 的 fiber 构造 → coloring.colorizeFragmentRows)
- [x] Step 3: 调用方更新: runtime.schedule/tick, window.dshRichCopy.rescan/rescanDiff, onClickCapture 展开分支 rAF, source.diffOf 构造前上色; resetTransient 删五项枚举改调 coloring.reset()
- [x] Step 4: `node --check` + `node tests/run.cjs` 预期 16/16

### Task 2: 文档同步与终审

**Files:**
- Modify: 视 how-it-works 两章与 README 是否有过时表述而定

- [x] Step 1: 检查并更新过时文档表述(上色时序, builtin, 调试指令)
- [x] Step 2: 派全新 reviewer 子代理对照共识终审
- [x] Step 3: 修复注记, 提交(已预授权)
