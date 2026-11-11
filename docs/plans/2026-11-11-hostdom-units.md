# Host Structure Units Implementation Plan

> **For agentic workers:** Implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 宿主结构知识收进三个单元: codeDom(CodeBlock 结构)/diffDom(DiffCard 结构, 含双代类名行类型)/hostAdapter(fiber 键 + 按钮属性), 消费方不见裸选择器。

**Architecture:** 两个新 IIFE 替换共享读取器区的 firstDivChild/findDiffBody/diffRowsOf/rowKind(入 diffDom); escapeHtml/bgTint/solidBg(计算样式读取, 非结构知识)留文件层; 十处调用点改走单元; hostAdapter 增 expandClosed。

**Tech Stack:** 零依赖单文件 DSH 客户端插件, 无头 Edge 测试夹具。

**Spec:** 2026-11-10 架构评审候选 5 grilling 共识(Q1a 三单元 / Q2a 行类型入 diffDom / Q3a 一次收齐 / Q4 纯搬家 30 项 pin)。

## Global Constraints

- 零依赖单文件(ADR-0001); 注释中文 ASCII 标点; T1-T16(30 项)全存活, 无新红测
- fenceGuard 的 .genui-dom-fence 不动(ADR-0003, 自有单元)
- bgTint/solidBg/escapeHtml 留文件层(Q2a 共识)

## Review Focus

1. isCodeOrDiffRelated 语义保持(closest 与 querySelector 两段检查, node.nodeType 区分)
2. rowKind 双代类名兼容逐字搬移(哈希前缀 + 裸类名 + "⋯" gap + isFirst path)
3. diffDebug 的 heading 输出保持(head 缺失为 null, 非空串)
4. button 分派的容器判定语义(data-diff 优先于 md-code-block)
5. onClickCapture 路由: 排除 diff 卡 banner 按钮的规则经 diffDom.owns

---

### Task 1: codeDom + diffDom 单元

**Interfaces:**
- codeDom: containerOf/isContainer/bannerButton/langText/preCode/codeTarget/blocks/firstBlock/contains
- diffDom: containerOf/owns/isContainer/diffButton/expandButton/heading/headingText/blocks/firstBlock/contains/body/rows/rowKind/rowClass
- hostAdapter: +expandClosed

- [x] Step 1: 替换共享读取器区为两个单元 IIFE(rowKind 逐字, findDiffBody 改名 body, firstDivChild 内化)
- [x] Step 2: hostAdapter 增 expandClosed; isCodeOrDiffRelated 改走 containerOf/contains
- [x] Step 3: coloring 消费方(findBlocks/detectDiffLang/scanDiffs/upgradeDiffWithShiki); source 消费方(codeContainerOf/button/codeOf/diffOf/fromSelection/rowClass); serializer 消费方(codeTarget); 路由(onClickCapture/copyOnce); 调试面(diffDebug)
- [x] Step 4: `node --check` + 残留扫描(裸选择器只剩单元内/fenceGuard/自产属性) + `node tests/run.cjs` 30/30

### Task 2: 终审与提交

- [x] Step 1: 派全新 reviewer 对照共识终审(逐字性重点: rowKind/findDiffBody/rowClass)
- [x] Step 2: 修复注记, 提交(已预授权)
