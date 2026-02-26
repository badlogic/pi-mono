# OpenClaw Agent Loop 状态机分析

> 深度研究 OpenClaw 的 Agent Loop 是否可以抽象为状态机，以及改造为显式图模型的可行性

---

## 一、当前 Loop 架构分析

### 1.1 核心执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Agent Loop 架构                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐                                                          │
│   │  用户输入     │                                                          │
│   └──────┬───────┘                                                          │
│          ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                        runEmbeddedPiAgent()                         │  │
│   │  ┌─────────────────────────────────────────────────────────────┐   │  │
│   │  │                    while (true) { ... }                      │   │  │
│   │  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │   │  │
│   │  │  │ runAttempt  │───▶│  LLM Call   │───▶│ Process     │      │   │  │
│   │  │  │   Setup     │    │  Streaming  │    │ Response    │      │   │  │
│   │  │  └─────────────┘    └─────────────┘    └──────┬──────┘      │   │  │
│   │  │                                               │              │   │  │
│   │  │                         ┌─────────────────────┘              │   │  │
│   │  │                         ▼                                    │   │  │
│   │  │  ┌────────────────────────────────────────────────────────┐  │   │  │
│   │  │  │              决策分支 (基于 stopReason)                 │  │   │  │
│   │  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │  │   │  │
│   │  │  │  │completed │  │tool_calls│  │  error   │  │overflow │ │  │   │  │
│   │  │  │  │  → break │  │  → retry │  │  → retry │  │→ compact│ │  │   │  │
│   │  │  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │  │   │  │
│   │  │  └────────────────────────────────────────────────────────┘  │   │  │
│   │  └──────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 代码位置

| 文件 | 职责 |
|------|------|
| [run.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run.ts) | 外层循环 (`while (true)`)，认证轮换、溢出恢复 |
| [run/attempt.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run/attempt.ts) | 单次尝试执行，Session 管理、工具执行 |
| [pi-embedded-subscribe.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-subscribe.ts) | 流式响应处理、状态追踪 |
| [runs.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/runs.ts) | 活跃 Run 注册、队列管理 |

---

## 二、当前是隐式流程还是显式状态流转？

### 2.1 结论：**隐式流程为主，局部显式状态**

```
隐式流程特征：
├── 使用 while(true) 循环而非状态机
├── 通过 continue/break/return 控制流程
├── 状态分散在多个变量中
└── 决策逻辑嵌入在代码流程中

局部显式状态：
├── stopReason: "completed" | "tool_calls" | "error" | ...
├── isStreaming: boolean
├── isCompacting: boolean
├── compactionInFlight: boolean
└── aborted/timedOut: boolean
```

### 2.2 隐式流程代码示例

```typescript
// run.ts:469 - 外层循环
while (true) {
  attemptedThinking.add(thinkLevel);
  
  const attempt = await runEmbeddedAttempt({ ... });
  const { aborted, promptError, lastAssistant } = attempt;
  
  // 1. 上下文溢出处理
  if (contextOverflowError) {
    if (overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
      overflowCompactionAttempts++;
      continue;  // ← 隐式跳转到下一次循环
    }
    return { ... };  // ← 隐式退出
  }
  
  // 2. Prompt 错误处理
  if (promptError && !aborted) {
    // 认证失败轮换
    if (await advanceAuthProfile()) {
      continue;  // ← 隐式重试
    }
    throw promptError;  // ← 隐式异常退出
  }
  
  // 3. Thinking 降级
  const fallbackThinking = pickFallbackThinkingLevel({ ... });
  if (fallbackThinking && !aborted) {
    thinkLevel = fallbackThinking;
    continue;  // ← 隐式重试
  }
  
  // 4. 认证/计费失败处理
  if (shouldRotate) {
    if (await advanceAuthProfile()) {
      continue;  // ← 隐式重试
    }
  }
  
  // 5. 正常完成
  if (lastAssistant?.stopReason === "completed" || 
      lastAssistant?.stopReason === "end_turn") {
    break;  // ← 隐式退出循环
  }
  
  // 6. 工具调用 - 继续循环等待结果
  // (隐式继续，因为工具结果已写入 session)
}
```

### 2.3 状态分散问题

```typescript
// 状态分散在多个对象中

// 1. Run 级别状态
let overflowCompactionAttempts = 0;
let toolResultTruncationAttempted = false;
let autoCompactionCount = 0;
let thinkLevel: ThinkLevel;
const attemptedThinking = new Set<ThinkLevel>();

// 2. Attempt 级别状态
let aborted = false;
let timedOut = false;
let timedOutDuringCompaction = false;

// 3. Session 级别状态
activeSession.isStreaming;
activeSession.isCompacting;

// 4. Subscription 级别状态
state.compactionInFlight;
state.pendingCompactionRetry;
state.assistantTexts;
state.toolMetas;

// 5. 全局注册状态
ACTIVE_EMBEDDED_RUNS: Map<string, EmbeddedPiQueueHandle>;
```

---

## 三、是否可以形式化为 FSM？

### 3.1 理论可行性：**可以**

Agent Loop 本质上是一个有限状态机：
- **有限状态**：可以枚举所有可能的执行阶段
- **输入触发**：用户消息、工具结果、错误、超时等
- **状态转移**：基于当前状态和输入决定下一个状态

### 3.2 提取的 FSM 模型

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     OpenClaw Agent Loop FSM 模型                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   States (状态):                                                            │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│   │  IDLE    │  │PREPARING │  │STREAMING │  │TOOL_EXEC │  │COMPACTING│     │
│   │ (空闲)   │  │ (准备)   │  │ (流式)   │  │(工具执行)│  │ (压缩)   │     │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│        │             │             │             │             │           │
│   ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐     │
│   │  ERROR   │  │  RETRY   │  │COMPLETED │  │ AWAITING │  │  PAUSED  │     │
│   │ (错误)   │  │ (重试)   │  │ (完成)   │  │(等待输入)│  │ (暂停)   │     │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                             │
│   Events (事件):                                                            │
│   - USER_INPUT: 用户输入                                                    │
│   - LLM_START: LLM 开始响应                                                 │
│   - TEXT_DELTA: 收到流式文本                                                │
│   - TOOL_CALL: 模型请求工具调用                                             │
│   - TOOL_RESULT: 工具执行完成                                               │
│   - STOP_COMPLETED: 正常完成                                                │
│   - STOP_ERROR: 错误停止                                                    │
│   - CONTEXT_OVERFLOW: 上下文溢出                                            │
│   - TIMEOUT: 超时                                                           │
│   - ABORT: 中断                                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 状态转移表

| 当前状态 | 事件 | 下一状态 | 动作 |
|----------|------|----------|------|
| IDLE | USER_INPUT | PREPARING | 构建 prompt，准备 session |
| PREPARING | LLM_START | STREAMING | 开始流式接收响应 |
| STREAMING | TEXT_DELTA | STREAMING | 追加文本到 buffer |
| STREAMING | TOOL_CALL | TOOL_EXEC | 执行工具，等待结果 |
| TOOL_EXEC | TOOL_RESULT | PREPARING | 将结果写入 session，重试 |
| STREAMING | STOP_COMPLETED | COMPLETED | 构建 payloads，返回结果 |
| STREAMING | STOP_ERROR | ERROR | 分类错误，决定是否重试 |
| STREAMING | CONTEXT_OVERFLOW | COMPACTING | 执行压缩算法 |
| COMPACTING | COMPACT_SUCCESS | PREPARING | 压缩完成，重试 |
| COMPACTING | COMPACT_FAIL | ERROR | 压缩失败，返回错误 |
| ERROR | RETRYABLE | RETRY | 增加重试计数，继续 |
| ERROR | FATAL | COMPLETED | 返回错误 payloads |
| ANY | TIMEOUT | ERROR | 标记超时，清理资源 |
| ANY | ABORT | COMPLETED | 清理资源，返回已生成内容 |

### 3.4 FSM 代码实现示例

```typescript
// 理论上的 FSM 实现

type AgentState = 
  | 'idle' 
  | 'preparing' 
  | 'streaming' 
  | 'tool_exec' 
  | 'compacting' 
  | 'error' 
  | 'completed';

type AgentEvent = 
  | { type: 'USER_INPUT'; prompt: string }
  | { type: 'LLM_START' }
  | { type: 'TEXT_DELTA'; text: string }
  | { type: 'TOOL_CALL'; calls: ToolCall[] }
  | { type: 'TOOL_RESULT'; results: ToolResult[] }
  | { type: 'STOP_COMPLETED' }
  | { type: 'STOP_ERROR'; error: Error }
  | { type: 'CONTEXT_OVERFLOW' }
  | { type: 'TIMEOUT' }
  | { type: 'ABORT' };

interface FSMContext {
  state: AgentState;
  attemptCount: number;
  compactionCount: number;
  messages: AgentMessage[];
  payloads: Payload[];
  error?: Error;
}

const transitions: Record<AgentState, Partial<Record<AgentEvent['type'], {
  nextState: AgentState;
  action: (ctx: FSMContext, event: AgentEvent) => Promise<FSMContext> | FSMContext;
}>>> = {
  idle: {
    USER_INPUT: { 
      nextState: 'preparing', 
      action: prepareSession 
    }
  },
  preparing: {
    LLM_START: { 
      nextState: 'streaming', 
      action: startStreaming 
    }
  },
  streaming: {
    TEXT_DELTA: { 
      nextState: 'streaming', 
      action: appendText 
    },
    TOOL_CALL: { 
      nextState: 'tool_exec', 
      action: executeTools 
    },
    STOP_COMPLETED: { 
      nextState: 'completed', 
      action: finalizeResponse 
    },
    STOP_ERROR: { 
      nextState: 'error', 
      action: handleError 
    },
    CONTEXT_OVERFLOW: { 
      nextState: 'compacting', 
      action: compactContext 
    },
    TIMEOUT: { 
      nextState: 'error', 
      action: handleTimeout 
    },
    ABORT: { 
      nextState: 'completed', 
      action: handleAbort 
    }
  },
  tool_exec: {
    TOOL_RESULT: { 
      nextState: 'preparing', 
      action: prepareRetry 
    }
  },
  compacting: {
    COMPACT_SUCCESS: { 
      nextState: 'preparing', 
      action: prepareRetry 
    },
    COMPACT_FAIL: { 
      nextState: 'error', 
      action: handleCompactionError 
    }
  },
  error: {
    RETRYABLE: { 
      nextState: 'preparing', 
      action: prepareRetry 
    },
    FATAL: { 
      nextState: 'completed', 
      action: returnError 
    }
  },
  completed: {}  // 终态
};
```

---

## 四、是否支持中断恢复？

### 4.1 当前中断机制

```
当前支持的中断：
├── 1. AbortSignal 中断
│   ├── 用户主动取消
│   ├── 超时中断
│   └── 系统关闭信号
│
├── 2. 压缩等待中断
│   └── 压缩过程中可以中断
│
└── 3. 工具执行中断
    └── 通过 abortSignal 传递给工具
```

### 4.2 当前恢复能力

```
恢复能力评估：
├── ✅ Session 持久化
│   └── 所有消息写入 <sessionId>.jsonl
│
├── ✅ 工具结果持久化
│   └── 工具执行结果写入 session
│
├── ⚠️ 部分状态丢失
│   ├── 流式 buffer 中的未提交文本
│   ├── 当前尝试的计数器状态
│   └── 认证轮换状态
│
└── ❌ 无法精确恢复执行点
    └── 只能回到"上一次完成的消息"
```

### 4.3 代码分析

```typescript
// runs.ts - 活跃 Run 管理
const ACTIVE_EMBEDDED_RUNS = new Map<string, EmbeddedPiQueueHandle>();

interface EmbeddedPiQueueHandle {
  queueMessage: (text: string) => Promise<void>;
  isStreaming: () => boolean;
  isCompacting: () => boolean;
  abort: () => void;
}

// 中断时：
// 1. 调用 abort() 设置 AbortController
// 2. 清理 ACTIVE_EMBEDDED_RUNS
// 3. 但已生成的消息已持久化到 session

// attempt.ts:1092 - 超时快照选择
const snapshotSelection = selectCompactionTimeoutSnapshot({
  timedOutDuringCompaction,
  preCompactionSnapshot,      // 压缩前的快照
  preCompactionSessionId,
  currentSnapshot: activeSession.messages.slice(),
  currentSessionId: activeSession.sessionId,
});
```

### 4.4 中断恢复的限制

```
限制分析：
┌────────────────────────────────────────────────────────────────┐
│ 问题                    │ 当前行为                              │
├────────────────────────────────────────────────────────────────┤
│ 流式响应中断            │ 已接收文本丢失（未写入 session）      │
│ 工具执行中断            │ 工具可能已完成但结果未写入            │
│ 压缩过程中断            │ 压缩可能部分完成，状态不一致          │
│ 认证轮换中断            │ 轮换状态丢失，可能重复尝试失败密钥    │
│ 重试计数器              │ 计数器重置，可能超过限制重试          │
└────────────────────────────────────────────────────────────────┘
```

---

## 五、是否可以 Externalize State？

### 5.1 当前状态分布

```
状态分布：
├── 1. 持久化状态 (JSONL)
│   ├── Session 消息历史
│   ├── Compaction 摘要
│   └── 工具调用记录
│
├── 2. 内存状态 (Process)
│   ├── ACTIVE_EMBEDDED_RUNS
│   ├── 流式 buffer
│   ├── 重试计数器
│   └── 认证状态
│
└── 3. 文件状态 (Lock)
    └── Session Write Lock
```

### 5.2 Externalization 可行性

```typescript
// 理论上可以外部化的状态

interface ExternalizedAgentState {
  // 1. Session 状态 (已持久化)
  sessionId: string;
  sessionFile: string;
  messages: AgentMessage[];
  
  // 2. Run 状态 (可持久化)
  runId: string;
  attemptCount: number;
  compactionCount: number;
  overflowCompactionAttempts: number;
  thinkLevel: ThinkLevel;
  attemptedThinking: ThinkLevel[];
  
  // 3. 认证状态 (可持久化)
  currentProfileId?: string;
  profileIndex: number;
  
  // 4. 流式状态 (难持久化)
  streamBuffer?: string;
  blockBuffer?: string;
  partialBlockState?: BlockState;
  
  // 5. 工具状态 (可持久化)
  pendingToolCalls?: PendingToolCall[];
  toolMetas: ToolMetaEntry[];
  
  // 6. 元数据
  startedAt: number;
  lastActivityAt: number;
  state: AgentState;  // FSM 状态
}
```

### 5.3 挑战与限制

```
挑战：
├── 1. 流式状态难以捕获
│   └── 部分接收的 token 未形成完整消息
│
├── 2. 工具执行原子性
│   └── 外部工具执行无法暂停/恢复
│
├── 3. 网络连接状态
│   └── LLM 流式连接无法序列化
│
└── 4. 性能开销
    └── 频繁持久化影响性能
```

---

## 六、LangGraph 风格改造可行性

### 6.1 LangGraph 核心概念

```
LangGraph 特点：
├── 1. 显式图结构
│   └── 节点和边明确定义
│
├── 2. 状态管理
│   └── 集中式状态对象
│
├── 3. 检查点 (Checkpoint)
│   └── 自动持久化状态
│
└── 4. 人机交互 (Human-in-the-loop)
    └── 支持中断和恢复
```

### 6.2 改造方案设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OpenClaw → LangGraph 改造方案                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   图结构:                                                                   │
│                                                                             │
│                    ┌─────────────┐                                          │
│         ┌─────────▶│   prepare   │────────┐                                 │
│         │          │  (准备节点)  │        │                                 │
│         │          └─────────────┘        ▼                                 │
│         │                        ┌─────────────────┐                         │
│         │                        │   call_model    │                         │
│         │                        │  (调用 LLM)     │                         │
│         │                        └────────┬────────┘                         │
│         │                                 │                                  │
│         │                                 ▼                                  │
│         │                        ┌─────────────────┐                         │
│         │                        │ process_stream  │                         │
│         │                        │ (处理流式响应)   │                         │
│         │                        └────────┬────────┘                         │
│         │                                 │                                  │
│         │                    ┌────────────┼────────────┐                     │
│         │                    ▼            ▼            ▼                     │
│         │           ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│         │           │  tools   │  │ overflow │  │  end     │                │
│         │           │ (工具)   │  │ (压缩)   │  │ (结束)   │                │
│         │           └────┬─────┘  └────┬─────┘  └──────────┘                │
│         │                │             │                                    │
│         └────────────────┴─────────────┘                                    │
│                          (条件边，基于状态决定下一节点)                        │
│                                                                             │
│   状态定义:                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ interface AgentState {                                              │  │
│   │   messages: AgentMessage[];      // 消息历史                        │  │
│   │   payloads: Payload[];           // 输出载荷                        │  │
│   │   toolCalls: ToolCall[];         // 待执行工具                      │  │
│   │   attemptCount: number;          // 尝试计数                        │  │
│   │   compactionCount: number;       // 压缩计数                        │  │
│   │   error?: Error;                 // 错误信息                        │  │
│   │   streamBuffer: string;          // 流式 buffer                     │  │
│   │ }                                                                   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 改造代码示例

```typescript
// 使用 LangGraph 风格的实现

import { StateGraph, END } from '@langchain/langgraph';

// 1. 定义状态
interface AgentState {
  messages: AgentMessage[];
  payloads: Payload[];
  toolCalls?: ToolCall[];
  attemptCount: number;
  compactionCount: number;
  error?: Error;
  shouldRetry?: boolean;
  isComplete?: boolean;
}

// 2. 定义节点
const prepareNode = async (state: AgentState): Promise<AgentState> => {
  // 准备 prompt，加载 session
  return { ...state, attemptCount: state.attemptCount + 1 };
};

const callModelNode = async (state: AgentState): Promise<AgentState> => {
  // 调用 LLM，返回流式响应处理器
  const response = await callLLM(state.messages);
  return { ...state, response };
};

const processStreamNode = async (state: AgentState): Promise<AgentState> => {
  // 处理流式响应，提取文本和工具调用
  const { text, toolCalls, stopReason } = await processStream(state.response);
  
  if (stopReason === 'tool_calls') {
    return { ...state, toolCalls, shouldRetry: true };
  }
  
  if (stopReason === 'completed') {
    return { ...state, payloads: buildPayloads(text), isComplete: true };
  }
  
  return state;
};

const executeToolsNode = async (state: AgentState): Promise<AgentState> => {
  // 执行工具调用
  const results = await executeTools(state.toolCalls);
  const newMessages = [...state.messages, ...results];
  return { ...state, messages: newMessages, shouldRetry: true };
};

const compactNode = async (state: AgentState): Promise<AgentState> => {
  // 执行压缩
  const summary = await compactSession(state.messages);
  return { 
    ...state, 
    messages: [summary, ...getRecentMessages(state.messages)],
    compactionCount: state.compactionCount + 1,
    shouldRetry: true 
  };
};

const errorNode = async (state: AgentState): Promise<AgentState> => {
  // 处理错误
  return { ...state, isComplete: true };
};

// 3. 构建图
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: { value: (x, y) => x.concat(y) },
    payloads: { value: (x, y) => y ?? x },
  }
});

workflow
  .addNode('prepare', prepareNode)
  .addNode('call_model', callModelNode)
  .addNode('process_stream', processStreamNode)
  .addNode('execute_tools', executeToolsNode)
  .addNode('compact', compactNode)
  .addNode('error', errorNode);

// 4. 定义边
workflow
  .addEdge('__start__', 'prepare')
  .addEdge('prepare', 'call_model')
  .addEdge('call_model', 'process_stream')
  .addConditionalEdges('process_stream', (state) => {
    if (state.error) return 'error';
    if (state.isComplete) return END;
    if (state.toolCalls) return 'execute_tools';
    return 'prepare';  // 继续下一轮
  })
  .addConditionalEdges('execute_tools', (state) => {
    if (state.shouldRetry) return 'prepare';
    return END;
  })
  .addConditionalEdges('compact', (state) => {
    if (state.shouldRetry) return 'prepare';
    return 'error';
  });

// 5. 添加检查点（支持中断恢复）
const checkpointer = new SqliteSaver({
  dbPath: './checkpoints.db'
});

const app = workflow.compile({ checkpointer });

// 6. 执行
const result = await app.invoke(
  { messages: [], payloads: [], attemptCount: 0, compactionCount: 0 },
  { configurable: { thread_id: 'session-123' } }
);
```

### 6.4 改造优势与挑战

```
优势：
├── ✅ 显式状态流转
│   └── 代码可读性和可维护性提升
│
├── ✅ 内置检查点
│   └── 自动支持中断恢复
│
├── ✅ 可视化调试
│   └── 可以可视化执行路径
│
└── ✅ 人机交互支持
    └── 更容易实现人工审核和干预

挑战：
├── ❌ 改造成本高
│   └── 需要重写核心执行逻辑
│
├── ❌ 性能开销
│   └── 检查点持久化带来额外开销
│
├── ❌ 与现有架构冲突
│   └── Pi SDK 的集成方式需要调整
│
└── ❌ 流式处理复杂化
    └── LangGraph 对流式支持有限
```

---

## 七、总结与建议

### 7.1 当前状态评估

| 维度 | 当前状态 | 评估 |
|------|----------|------|
| **流程类型** | 隐式流程为主 | ⚠️ 需要改进 |
| **FSM 形式化** | 理论可行，未实现 | ⚠️ 可以改进 |
| **中断恢复** | 部分支持 | ⚠️ 有局限性 |
| **State Externalization** | 部分支持 | ⚠️ 流式状态难捕获 |
| **LangGraph 改造** | 可行但成本高 | ⚠️ 需要权衡 |

### 7.2 渐进式改进建议

```
建议路线图：

Phase 1: 显式状态定义 (低成本)
├── 1. 定义统一的 AgentState 接口
├── 2. 将分散的状态集中到单一对象
├── 3. 添加状态验证和日志
└── 预期收益：提高可观测性

Phase 2: 轻量级 FSM (中等成本)
├── 1. 提取核心状态转移逻辑
├── 2. 使用状态机库（如 xstate）
├── 3. 保留现有执行模型
└── 预期收益：提高可维护性

Phase 3: 增强恢复能力 (中等成本)
├── 1. 定期持久化运行状态
├── 2. 实现 graceful degradation
├── 3. 添加恢复机制
└── 预期收益：提高可靠性

Phase 4: LangGraph 评估 (高成本)
├── 1. 原型验证
├── 2. 性能基准测试
├── 3. 逐步迁移或保持现状
└── 预期收益：长期架构升级
```

### 7.3 关键结论

1. **当前 Loop 是隐式流程**：使用 `while(true)` 和 `continue/break` 控制，状态分散

2. **可以形式化为 FSM**：理论可行，有明确的状态和转移条件

3. **中断恢复能力有限**：Session 可恢复，但流式状态和运行状态会丢失

4. **State Externalization 部分可行**：大部分状态可持久化，流式状态难捕获

5. **LangGraph 改造可行但成本高**：适合长期架构升级，不适合短期迭代

6. **建议采用渐进式改进**：从显式状态定义开始，逐步增强恢复能力

---

## 参考文档

- [run.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run.ts) - 主执行循环
- [run/attempt.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run/attempt.ts) - 单次尝试执行
- [pi-embedded-subscribe.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-subscribe.ts) - 流式处理
- [runs.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/runs.ts) - Run 管理
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
