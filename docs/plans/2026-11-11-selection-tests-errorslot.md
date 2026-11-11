# Selection Tests and Error Slot Implementation Plan

> **For agentic workers:** Implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选区 CopyTrigger 获得测试覆盖(此前零覆盖), lastDiffError 按 stage 分流, 消灭字符串匹配断言。

**Architecture:** harness 加 selectCopy 助手(程序化 Selection + 直接 dispatch copy 事件走 copyCapture 选区分支); T17(部分选区取选区文本)+T18(完整覆盖 body 取全量 diff 文本); 文件层 errorReport(stage, message) 结构化错误槽, 五个写入点改调, T11 改按 stage 断言。

**Tech Stack:** 零依赖单文件 DSH 客户端插件, 无头 Edge 测试夹具。

**Spec:** 2026-11-10 架构评审候选 6 剩余 grilling 共识(Q5 T17/T18 照此 / Q6a {stage,message} + errorReport)。

## Global Constraints

- 零依赖单文件(ADR-0001); 注释中文 ASCII 标点
- T1-T16 语义不变(T11 断言改 stage 属共识); T17/T18 为 pin(现行为应为绿)
- T17/T18 不开抑制窗(选区路径无窗口), 与后续 T13/T16 无时序干扰

## Review Focus

1. T17 部分选区: text 为原始选区文本(无 diff 前缀), html 的行仍补 "+ " 前缀(diff adapter)
2. T18 完整覆盖: text 为全量 diff 文本(带前缀, 行数 >= 5)
3. selectionCoversBody 边界(selectNodeContents(body) 判定 whole)
4. errorReport 三 stage(load/upgrade/construct)与 resetTransient 清槽语义
5. T11 stage 断言在无错误(null)与有错误(非 construct)两种态都通过

---

### Task 1: T17/T18 + errorReport

- [x] Step 1: harness 加 selectCopy 助手; T5 之后插 T17/T18; T11 改 stage 断言
- [x] Step 2: client.js: errorReport 定义 + 五个写入点(load x2 / upgrade x2 / construct x1)
- [x] Step 3: `node tests/run.cjs` 预期 32/32(T1-T18 共 32 项断言)
- [x] Step 4: `node --check` + 文档核查(how-it-works/README 若提及 lastError 文案则同步)

### Task 2: 终审与提交

- [x] Step 1: 派全新 reviewer 对照共识终审
- [x] Step 2: 修复注记, 提交(已预授权)
