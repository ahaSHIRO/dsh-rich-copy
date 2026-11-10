# dsh-rich-copy

一个 DSH 客户端插件所处的领域: 宿主会话里展示的代码与改动, 以及把它们带出宿主的那次复制. 本表只固定概念, 不描述实现, 不记录决策.

## Language

**CodeBlock**:
宿主会话里一段带语言标签的源代码.
_Avoid_: pre, code 元素, 代码块容器

**DiffCard**:
宿主会话里一张展示单个或多个文件改动的卡片, 由若干 DiffRow 组成.
_Avoid_: diff block, 差异块, 工具调用

**DiffRow**:
DiffCard 里的一行, 其语义为新增, 删除, 上下文, 路径或折叠间隔之一.
_Avoid_: line, 差异行, 文本节点

**CopySource**:
一次复制所针对的宿主内容, 或为 CodeBlock, 或为 DiffCard.
_Avoid_: selection, target, DOM node

**CopyTrigger**:
一次复制的发起方式, 或为选区复制, 或为复制按钮. 同一次复制只有一个 CopyTrigger.
_Avoid_: event, click, 监听器

**ClipboardPayload**:
一次复制对外交付的内容, 由同一份 CopySource 生成的富文本表示与纯文本表示共同构成.
_Avoid_: HTML, ClipboardItem, 剪贴板数据

## Relationships

**CopyTrigger -> CopySource -> ClipboardPayload**: 一次复制由一个 CopyTrigger 选定一个 CopySource, 产出一个 ClipboardPayload. 同一个 CopySource 在不同 CopyTrigger 下产出等价的 ClipboardPayload. CopySource 是 CodeBlock 或 DiffCard, DiffCard 由若干 DiffRow 组成.
