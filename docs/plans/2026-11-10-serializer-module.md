# Serializer Module Implementation Plan

> **For agentic workers:** Implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 序列化的全部构造(两个 adapter 差异, 共用外壳, var/light-dark 解析, 颜色混合, 字体栈清洗)归入 serializer 一个 IIFE, 删掉传话筒。

**Architecture:** serializer IIFE(物理保持 source 之后 clipboard 之前)收编 wrapDiffHtml(改名 diff)/blendCanvas+blendOver/isClearColor/cssVar 群(cssVarCache/cssVarScope/readCssVar/resolveColorValue/resolveLightDark/resolveVarStyles)/cleanCodeFontStack+FALLBACK_CODE_FONT; 导出 code/diff/reset; shell 退为内部; resetTransient 三项枚举改调 serializer.reset()。

**Tech Stack:** 零依赖单文件 DSH 客户端插件, 无头 Edge 测试夹具。

**Spec:** 2026-11-10 架构评审候选 4 grilling 共识(收编清单 / 三导出 / 双头重置收一头 / 无新红测)。

## Global Constraints

- `lib/client.js` 保持零依赖单文件无构建(ADR-0001); 注释中文 ASCII 标点
- T1-T16(30 项)全部存活; T5(cssVarCache 明暗切换失效)为 pin
- GRAMMAR/SHIKI_URLS/TARGET_LANGS 留顶层(上一候选共识, 不变)

## Review Focus

1. resolveVarStyles 入口的单次复制内重置语义(T5)搬后不变
2. wrapCodeHtml 删除后 clipboard.payload 直调 serializer.code
3. resetTransient 的 cssVarCache/cssVarScope/blendCanvas 改 serializer.reset()
4. diff adapter 的 serializer.shell 调用改内部直调
5. 搬家后无残留: cssVar 群/cleanCodeFontStack 原位置清空

---

### Task 1: serializer 收编

- [x] Step 1: blendOver→wrapDiffHtml 区整体替换为扩张后的 serializer IIFE(diff +2 缩进, shell 内调, cssVar 群与字体清洗搬入 +2)
- [x] Step 2: 删除 clipboard 之后的 cssVar 群 + cleanCodeFontStack + wrapCodeHtml 原区域
- [x] Step 3: clipboard.payload 改调 serializer.diff / serializer.code; resetTransient 三项改 serializer.reset()
- [x] Step 4: `node --check` + `node tests/run.cjs` 预期 30/30

### Task 2: 终审与提交

- [x] Step 1: 派全新 reviewer 对照共识终审
- [x] Step 2: 修复注记, 提交(已预授权)
