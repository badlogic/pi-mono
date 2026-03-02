# pi-coding-agent Session 持久化机制研究报告

## 概述

pi-coding-agent 实现了一套完整的 session 持久化系统，将对话历史、模型配置、思考级别等状态信息持久化存储到磁盘，支持会话恢复、分支管理和崩溃恢复等功能。

## 核心架构分析

### 1. SessionManager - 持久化核心

[SessionManager](../packages/coding-agent/src/core/session-manager.ts) 是持久化系统的核心组件，主要职责包括：
- 管理会话文件的读写操作
- 维护会话条目的树形结构
- 提供会话导航和分支功能
- 实现增量持久化策略

**设计亮点**：采用树形结构而非简单的线性列表，支持分支对话，用户可以在历史节点上开启新的对话分支而不需要复制整个会话。

### 2. AgentSession - 事件驱动的持久化

[AgentSession](../packages/coding-agent/src/core/agent-session.ts) 封装了 Agent 生命周期管理，通过监听 Agent 事件来触发持久化操作。当接收到新消息时，自动将其保存到 SessionManager 中。

**事件驱动机制**：这种设计解耦了业务逻辑和持久化操作，使得任何 Agent 活动都会自动被记录，无需手动干预。

### 3. SDK 集成 - 无缝恢复体验

`createAgentSession` 函数智能地检测是否存在现有会话，如果有则自动从磁盘加载并恢复 Agent 状态，让用户感觉像是在继续之前的对话。具体实现在 [sdk.ts](../packages/coding-agent/src/core/sdk.ts) 文件中。

## 持久化存储格式分析

### 文件格式：JSONL

会话文件采用 JSONL（每行一个 JSON 对象）格式，这种选择非常巧妙：

**优点**：
- 支持增量追加，无需重写整个文件
- 单行损坏不会影响其他数据
- 人类可读，便于调试和手动编辑

### 会话数据模型详解

#### 会话头（SessionHeader）

每个会话文件的第一行是会话头，包含元数据：

```typescript
interface SessionHeader {
  type: "session";
  version: number;      // 当前为 3
  id: string;           // 会话 UUID（8 字符）
  timestamp: string;    // ISO 时间戳
  cwd: string;          // 工作目录
  parentSession?: string; // 父会话路径（分支时）
}
```

**示例**：
```json
{"type":"session","version":3,"id":"a1b2c3d4","timestamp":"2024-01-15T10:30:00.000Z","cwd":"/home/user/project","parentSession":"/home/user/.pi/agent/sessions/--home-user-project--/2024-01-14T09-00-00-000Z_x9y8z7w6.jsonl"}
```

#### 消息条目（SessionMessageEntry）

```typescript
interface SessionMessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: AgentMessage;  // 完整的消息对象
}
```

**示例 - 用户消息**：
```json
{"type":"message","id":"e1f2g3h4","parentId":"a1b2c3d4","timestamp":"2024-01-15T10:31:00.000Z","message":{"role":"user","content":[{"type":"text","text":"帮我创建一个 React 组件"}],"timestamp":1705315860000}}
```

**示例 - AI 响应**：
```json
{"type":"message","id":"i5j6k7l8","parentId":"e1f2g3h4","timestamp":"2024-01-15T10:31:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"好的，我来帮你创建一个 React 组件..."}],"provider":"anthropic","model":"claude-sonnet-4-5","usage":{"input":100,"output":500,"cacheRead":0,"cacheWrite":0,"totalTokens":600,"cost":{"input":0.0001,"output":0.00075,"cacheRead":0,"cacheWrite":0,"total":0.00085}},"stopReason":"stop","timestamp":1705315865000}}
```

#### 配置变更条目

**思考级别变更**：
```json
{"type":"thinking_level_change","id":"m9n0o1p2","parentId":"i5j6k7l8","timestamp":"2024-01-15T10:32:00.000Z","thinkingLevel":"medium"}
```

**模型变更**：
```json
{"type":"model_change","id":"q3r4s5t6","parentId":"m9n0o1p2","timestamp":"2024-01-15T10:33:00.000Z","provider":"openai","modelId":"gpt-4-turbo"}
```

#### 压缩条目（CompactionEntry）

```typescript
interface CompactionEntry {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: string;
  summary: string;           // LLM 生成的摘要
  firstKeptEntryId: string;  // 保留的第一条消息 ID
  tokensBefore: number;      // 压缩前的 token 数
  details?: {                // 文件操作跟踪
    readFiles: string[];
    modifiedFiles: string[];
  };
  fromHook?: boolean;
}
```

**示例**：
```json
{"type":"compaction","id":"u7v8w9x0","parentId":"q3r4s5t6","timestamp":"2024-01-15T11:00:00.000Z","summary":"## Goal\n创建 React 组件\n\n## Progress\n### Done\n- [x] 创建基础组件结构\n- [x] 添加样式\n\n## Next Steps\n1. 添加单元测试","firstKeptEntryId":"e1f2g3h4","tokensBefore":15000,"details":{"readFiles":["src/App.tsx"],"modifiedFiles":["src/MyComponent.tsx"]}}
```

#### 分支摘要（BranchSummaryEntry）

```typescript
interface BranchSummaryEntry {
  type: "branch_summary";
  id: string;
  parentId: string | null;
  timestamp: string;
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
}
```

#### 自定义条目（CustomEntry）

```typescript
interface CustomEntry {
  type: "custom";
  customType: string;  // 扩展标识符
  data?: unknown;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

#### 标签条目（LabelEntry）

```typescript
interface LabelEntry {
  type: "label";
  id: string;
  parentId: string | null;
  timestamp: string;
  targetId: string;    // 被标记的条目 ID
  label: string;       // 标签文本
}
```

#### 会话信息（SessionInfoEntry）

```typescript
interface SessionInfoEntry {
  type: "session_info";
  id: string;
  parentId: string | null;
  timestamp: string;
  name?: string;  // 用户定义的名称
}
```

## 会话压缩算法详解

### 压缩触发条件

压缩在以下情况下触发：

1. **自动压缩**：当上下文 token 数超过阈值
   ```
   contextTokens > contextWindow - reserveTokens
   ```
   - 默认 `reserveTokens` = 16384（可配置）
   - 保留空间用于 LLM 响应

2. **手动压缩**：用户执行 `/compact [指令]`

### 压缩算法流程

压缩算法的核心实现在 [compaction.ts](../packages/coding-agent/src/core/compaction/compaction.ts) 中，包含以下步骤：

#### 步骤 1：寻找切割点（findCutPoint）

**算法**：从最新消息向后遍历，累积估算的 token 数，直到达到 `keepRecentTokens`（默认 20000）

```typescript
function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  // 1. 找出所有有效的切割点（user/assistant/bash/custom 消息）
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  
  // 2. 从后向前累积 token 数
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];
  
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    
    const messageTokens = estimateTokens(entry.message);
    accumulatedTokens += messageTokens;
    
    // 3. 超过预算时找到切割点
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }
  
  // 4. 检查是否是分割的 turn
  const isSplitTurn = !isUserMessage(cutEntry);
  
  return { firstKeptEntryIndex: cutIndex, turnStartIndex, isSplitTurn };
}
```

**切割点规则**：
- 可以在 user 或 assistant 消息处切割
- 绝不在 tool result 处切割（必须与 tool call 在一起）
- 可以切割 bashExecution、custom messages

#### 步骤 2：提取待压缩消息

根据切割点将消息分为两部分：
- **待压缩部分**：从上一次压缩（或开头）到切割点
- **保留部分**：从切割点到最新

#### 步骤 3：生成摘要（generateSummary）

使用 LLM 生成结构化摘要，采用固定格式：

```
## Goal
[用户目标]

## Constraints & Preferences
[约束和偏好]

## Progress
### Done
- [x] [已完成任务]

### In Progress
- [ ] [进行中任务]

### Blocked
- [阻塞问题]

## Key Decisions
- **[决策]**: [理由]

## Next Steps
1. [下一步骤]

## Critical Context
- [关键上下文]
```

**摘要生成策略**：
- **初次压缩**：使用 `SUMMARIZATION_PROMPT`
- **增量压缩**：使用 `UPDATE_SUMMARIZATION_PROMPT`，合并旧摘要和新消息

#### 步骤 4：处理分割的 Turn

当单个 turn 过大时，会生成两个摘要并合并：
1. **历史摘要**：之前的上下文
2. **Turn 前缀摘要**：分割 turn 的早期部分

#### 步骤 5：保存压缩条目

将 `CompactionEntry` 追加到会话文件，包含：
- 生成的摘要
- `firstKeptEntryId`（保留部分的第一条消息）
- `tokensBefore`（压缩前的 token 数）
- `details`（文件操作跟踪信息）

### Token 估算算法

系统使用精确的 token 计算方法：

```typescript
function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  // 1. 查找最后一个 assistant 消息的 usage 信息
  const usageInfo = getLastAssistantUsageInfo(messages);
  
  if (!usageInfo) {
    // 没有 usage 信息，估算所有消息
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return { tokens: estimated, ... };
  }
  
  // 2. 使用精确的 usage 数据
  const usageTokens = calculateContextTokens(usageInfo.usage);
  
  // 3. 加上后续消息的估算
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }
  
  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
  };
}
```

**关键洞察**：利用 LLM 响应中的 `usage` 字段获取精确 token 数，只对最新几条消息进行估算。

## Session 读取与使用机制

### 何时读取 Session

Session 在以下情况下被读取：

1. **会话恢复**：当使用 `SessionManager.continueRecent()` 或 `SessionManager.open()` 时
2. **Agent 启动**：在 `createAgentSession` 函数中，系统检查是否存在现有会话并加载
3. **上下文构建**：在每次与 LLM 交互前，构建当前对话上下文
4. **分支导航**：当用户在会话历史中切换分支时

### 会话使用策略与优先级

#### 会话选择优先级

系统使用以下策略决定使用哪个会话：

1. **最近会话优先**：`SessionManager.continueRecent()` 自动选择最近修改的会话
   ```typescript
   function findMostRecentSession(sessionDir: string): string | null {
     const files = readdirSync(sessionDir)
       .filter(f => f.endsWith('.jsonl'))
       .map(path => ({ path, mtime: statSync(path).mtime }))
       .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
     
     return files[0]?.path || null;
   }
   ```

2. **显式指定**：用户通过 `--session` 参数指定特定会话文件

3. **会话列表选择**：通过交互式会话选择器选择

#### 会话保留策略

**所有会话都会被保留**，系统不会自动删除旧会话。会话文件存储在：
```
~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<sessionId>.jsonl
```

**会话管理责任**：
- 系统：自动创建和追加，不会删除
- 用户：手动管理（删除、归档）

#### 历史会话使用场景

1. **昨天的会话**：可以通过 `SessionManager.list()` 查看并继续
2. **前天的会话**：同样保留，可以通过会话选择器访问
3. **更久的会话**：永久保留，除非用户手动删除

**无自动过期机制**：系统没有内置的会话过期或删除策略，所有历史会话都会被保留。

### 如何在 LLM 会话中使用

**上下文构建过程**：
[SessionManager](../packages/coding-agent/src/core/session-manager.ts) 通过 `buildSessionContext()` 方法将存储的会话条目转换为 LLM 可以理解的 messages 数组：

1. **路径遍历**：从当前叶节点向上追溯到根节点，构建完整对话路径
2. **设置提取**：沿路径收集模型和思考级别配置
3. **压缩处理**：如果存在压缩条目，插入摘要并保留重要消息
4. **格式转换**：将内部格式转换为 LLM API 接受的格式

**对话内容组成**：
- **系统提示词**：来自 `thinking_level_change` 条目的思考级别配置
- **用户消息**：来自 `message` 条目的用户输入
- **AI 响应**：来自 `message` 条目的助手回复  
- **工具结果**：来自 `message` 条目的工具执行结果
- **摘要信息**：来自 `compaction` 条目的历史摘要

**压缩机制的作用**：当对话过长时，系统会自动压缩早期内容，生成摘要并保留关键消息，确保上下文长度在 LLM 限制范围内，同时保持对话的连续性。

## 设计优势分析

### 1. 可靠性
- 增量写入降低数据丢失风险
- 版本迁移保证向前兼容
- 容错机制处理损坏文件

### 2. 灵活性
- 树形结构支持分支对话
- 自定义条目类型支持扩展
- 配置动态调整适应不同需求

### 3. 性能
- 内存索引提供快速访问
- 异步会话列表加载
- 压缩机制控制上下文长度

### 4. 可扩展性
- 自定义条目支持扩展存储
- 压缩算法可插拔
- 支持扩展注入自定义消息

## 总结

pi-coding-agent 的 session 持久化系统是一个精心设计的架构，不仅实现了基本的数据持久化功能，还通过树形结构、压缩机制和扩展接口提供了高级功能。系统在数据安全、用户体验和性能之间取得了良好平衡，是现代对话代理系统的一个优秀范例。

**关键特性**：
- JSONL 格式支持增量追加
- 树形结构支持分支对话
- LLM 驱动的压缩算法
- 永久保留所有会话（用户手动管理）
- 精确的 token 计算和估算
- 完整的版本迁移机制