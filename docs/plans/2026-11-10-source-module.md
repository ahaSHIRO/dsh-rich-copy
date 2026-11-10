# CopySource 构造收拢 Implementation Plan

> **For agentic workers:** Implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三种 CopyTrigger(按钮/选区/调试)的 CopySource 构造收进一个独立 source module, 按钮路径在触发点只剩一行 `clipboard.copyButton(container)`。

**Architecture:** 新增 source IIFE(物理位于 hostAdapter 与 serializer 之间), 收编识别+构造; clipboard 的 copyButton 升级为一行入口(识别可 null 不开窗, 识别后构造永不失败, 内部开窗+写入+回退); onClickCapture 退化为按钮路由; copyOnce 复述生产路径。

**Tech Stack:** 零依赖单文件 DSH 客户端插件(ES5 兼容 IIFE), 无头 Edge 测试夹具。

**Spec:** 本计划实现 2026-11-10 架构评审 grilling 共识(候选 1), 共识清单见会话记录; 关键契约与共识一致。

## Global Constraints

- `lib/client.js` 保持零 npm 依赖单文件, 无构建步骤(ADR-0001)
- 写入侧机制不动: 屏外 1 字符 span + execCommand + 捕获阶段 copy 监听(ADR-0002)
- 注释用中文, 标点用 ASCII
- T1-T14 全部存活且语义不变; 提交信息英文 `type(Lx): lowercase summary`
- 开窗顺序的既定事实: 宿主 writeText 在我们 handler 返回后才发生; source.button 识别+构造一体, 开窗在构造后, 窗口仍完整覆盖紧随的宿主写入(与共识字面"识别-开窗-构造-写入"的偏差: 构造并入识别, 已在共识确认时说明)

## Review Focus

1. 折叠 diff 的调试复制必须与真实点击一致(自动展开+全量行) — T15 钉住
2. 无内容容器的复制按钮点击: 不开窗, 宿主纯文本照常落剪贴板 — T16 钉住
3. 脏 fiber 数据构造抛错: 降级梯不丢剪贴板 — T8/T10/T11 存活
4. 宿主紧随 writeText 被吞 — T4/T13 存活
5. 选区路径零回归: fromSelection 搬家不改行为 — copyCapture 现有断言面(无直接用例, 候选 6 领地)

---

### Task 1: T15/T16 红绿基线(测试先行)

**Files:**
- Modify: `tests/harness.html`(T11 之后插入 T15/T16 块; fixtures 加空块)

**Interfaces:**
- Consumes: `window.dshRichCopy.copyOnce(kind)`(现返回 payload 对象, 无 wrote 字段 - 红基线)
- Produces: T15 断言 `copyOnce("diff")` 返回 `{wrote:true, payload:{html 含 middle 行}}` 且折叠卡已展开; T16 断言空块按钮点击后剪贴板为宿主纯文本

- [x] Step 1: fixtures 加无 pre 的 md-code-block(id=emptyBlock, 复制按钮 id=emptyCopy, host listener 写 "HOST EMPTY TEXT")
- [x] Step 2: T11 之后插 T15: 删除 diffBlock 的 __reactFiber$probe, 重置折叠态(aria-expanded=false, 移除 middle 行), 调 copyOnce("diff"), 断言 wrote/middle/aria-expanded
- [x] Step 3: T15 之后插 T16: click("emptyCopy"), 断言 clipboardState.text === "HOST EMPTY TEXT"(宿主纯文本未被吞)
- [x] Step 4: `node tests/run.cjs` 预期 T15 FAIL(现 copyOnce 无 wrote 字段且不展开), 其余含 T16 全 PASS

### Task 2: source module 与一行入口

**Files:**
- Modify: `lib/client.js`(多处, 详见各步)

**Interfaces:**
- Produces: `source.button(container)` 返回 CopySource|null; `source.fromSelection()` 返回 CopySource|null; `clipboard.copyButton(container)` 返回 `{wrote, payload}`; clipboard 导出面缩至 copyButton/copyCapture/heal/dispose

- [x] Step 1: 在 hostAdapter 之后(现 buildFullDiffFragmentFromFiber 处)建 source IIFE: 搬入 codeContainerOf(L1372), selectionCoversBody(L1005), sourceFromSelection 改名 fromSelection(L1197), buildFullDiffFragmentFromFiber(L821), diffCopyText(L849); 新增 button/container 分派 + codeOf + diffOf(原 onClickCapture 的 42 行降级梯原样搬入); 导出 {button, fromSelection}; interface 注释写明识别可 null + 构造永不失败契约
- [x] Step 2: clipboard: 删除搬走的两个函数; copyCapture 改调 source.fromSelection(); copyButton 改为一行入口体(null 不开窗返回 {wrote:false,payload:null}; 否则开窗 - payload - writeSync - 纯文本回退 - fallbackSelect+restore; 返回 {wrote, payload}); suppressHostWrite/payload 退出导出; 重写 L1 interface 注释
- [x] Step 3: runtime.copyOnce 改为 `clipboard.copyButton(el)`; onClickCapture 缩为按钮路由 + 容器查找 + 一行调用; 展开分支的 rAF 补染原样保留
- [x] Step 4: `node tests/run.cjs` 预期 30/30 全 PASS

### Task 3: ADR 与文档

**Files:**
- Modify: `docs/adr/0002-synchronous-clipboard-write.md`, `docs/copy-pipeline.md`, `docs/copy-pipeline.zh.md`

- [x] Step 1: ADR-0002 增补一句: 按钮路径开窗随按钮复制入口收进写入模块, 调用方只递容器; 识别失败不开窗
- [x] Step 2: copy-pipeline 两章更新为新编排(source 构造 - 一行入口 - copyOnce 复述生产)

### Task 4: 终审

- [x] Step 1: `node tests/run.cjs` 30/30
- [x] Step 2: 派全新 reviewer 子代理审整条改动(对照共识与 ADR)
- [x] Step 3: 汇报, 提交前请示
