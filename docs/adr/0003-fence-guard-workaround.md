# 劫持 childElementCount 止血 GenUI 空围栏

`fenceGuard` adapter 在空的 `.genui-dom-fence` 实例上覆盖 `childElementCount` getter: 真实子节点为 0 时返回 1, 不插入任何 DOM 节点.

原因是宿主把 `"panel": true` 的 GenUI 围栏挂载成空容器(渲染 `null`), 却每帧把 `childElementCount === 0` 误判为"容器被宿主清空", 于是不断卸载, 删除, 重建, 插回. 实测 4 秒内 59 个长任务, 合计 3915ms, 其中样式布局 3139ms, `div._markdown_` 上 757 次 DOM 变更; 复制按钮在这期间必然卡数秒. 该问题与复制, Shiki, CDN 都无关, 是第三方渲染循环.

代价是改写了宿主 DOM 实例的原生 getter, 属于临时 workaround. 因此它被做成可独立开关(`setFenceGuard`)的 adapter, 并在 `dispose` 时逐一 `delete` 撤销. 宿主修复该误判后应整体删除这个 adapter 与本文档, 不需要改动主模块. 替代方案(改宿主插件文件, 或给空容器塞占位子节点)被否决: 前者违反"不动其他插件"的约束, 后者会干扰 React fiber 协调.

**Status**: accepted, 待宿主修复后 deprecated.
