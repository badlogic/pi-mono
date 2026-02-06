# Agent Loop 实现梳理

> 源码位置：`packages/agent/src/`
> 包名：`@mariozechner/pi-agent-core`

## 目录

- [整体架构](#整体架构)
- [文件结构](#文件结构)
- [核心类型定义 (types.ts)](#核心类型定义-typests)
- [核心循环实现 (agent-loop.ts)](#核心循环实现-agent-loopts)
- [Agent 类封装 (agent.ts)](#agent-类封装-agentts)
- [代理流 (proxy.ts)](#代理流-proxyts)
- [事件流时序](#事件流时序)
- [关键设计决策](#关键设计决策)

---

## 整体架构

Agent Loop 采用 **两层架构** 设计：

```
┌─────────────────────────────────────────────────┐
│                  Agent 类 (高层)                  │
│  状态管理 / 事件订阅 / 消息队列 / 生命周期控制       │
├─────────────────────────────────────────────────┤
│         agentLoop / agentLoopContinue (底层)      │
│  双重循环 / 流式响应 / 工具执行 / 转向/追加消息      │
├─────────────────────────────────────────────────┤
│              streamSimple / streamProxy           │
│           实际的 LLM API 调用 (可替换)              │
└─────────────────────────────────────────────────┘
```

- **底层 API**（`agentLoop` / `agentLoopContinue`）：异步生成器，负责核心循环逻辑
- **高层 API**（`Agent` 类）：封装状态管理、事件订阅、消息队列等

---

## 文件结构

```
packages/agent/src/
├── index.ts          # 统一导出
├── types.ts          # 类型定义（AgentMessage, AgentEvent, AgentTool 等）
├── agent-loop.ts     # 核心循环实现（agentLoop, agentLoopContinue, runLoop）
├── agent.ts          # Agent 类封装（状态管理、消息队列、生命周期）
└── proxy.ts          # 代理流函数（浏览器端通过服务器中转 LLM 调用）
```

---

## 核心类型定义 (types.ts)

### AgentMessage

`AgentMessage` 是整个系统的消息抽象，它是 LLM 标准消息和自定义消息的联合类型：

```typescript
// LLM 标准消息（user / assistant / toolResult）
type Message = UserMessage | AssistantMessage | ToolResultMessage;

// 可通过 declaration merging 扩展自定义消息类型
interface CustomAgentMessages {
  // 默认为空，应用可扩展
}

// 最终的 AgentMessage 类型
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

应用可以通过 TypeScript 的 declaration merging 添加自定义消息类型：

```typescript
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    notification: { role: "notification"; text: string; timestamp: number };
    artifact: ArtifactMessage;
  }
}
```

### AgentLoopConfig

核心循环的配置接口，继承自 `SimpleStreamOptions`：

```typescript
interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;

  // 【必填】将 AgentMessage[] 转换为 LLM 兼容的 Message[]
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  // 【可选】在 convertToLlm 之前对上下文进行变换（裁剪、注入等）
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  // 【可选】动态解析 API Key（支持过期 token 刷新）
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

  // 【可选】获取转向消息（每次工具执行后调用，用于中断）
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  // 【可选】获取追加消息（agent 停止前调用，用于继续对话）
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
}
```

### AgentContext

传入循环的上下文结构：

```typescript
interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}
```

### AgentTool

工具定义，继承自基础 `Tool` 并添加 `execute` 函数：

```typescript
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  name: string;
  label: string;           // UI 展示的人类可读标签
  description: string;
  parameters: TSchema;     // JSON Schema 参数定义
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (result: AgentToolResult<TDetails>) => void  // 流式更新回调
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### AgentEvent

事件系统覆盖了完整的生命周期：

| 事件类型 | 说明 |
|---------|------|
| `agent_start` | Agent 开始运行 |
| `agent_end` | Agent 结束运行，携带 `messages` |
| `turn_start` | 一个 turn 开始（一次 LLM 响应 + 工具调用） |
| `turn_end` | 一个 turn 结束，携带 `message` 和 `toolResults` |
| `message_start` | 消息开始（user / assistant / toolResult） |
| `message_update` | 消息流式更新（仅 assistant） |
| `message_end` | 消息结束 |
| `tool_execution_start` | 工具开始执行 |
| `tool_execution_update` | 工具执行过程中的流式更新 |
| `tool_execution_end` | 工具执行结束 |

---

## 核心循环实现 (agent-loop.ts)

### 入口函数

#### `agentLoop(prompts, context, config, signal?, streamFn?)`

用于 **新建对话轮次**：将 prompt 消息加入上下文，并为每条 prompt 发出 `message_start`/`message_end` 事件。

```
agent-loop.ts:28-55
```

```typescript
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>
```

#### `agentLoopContinue(context, config, signal?, streamFn?)`

用于 **从已有上下文继续**（重试场景）：不添加新消息，不发出 prompt 事件。要求上下文中最后一条消息不是 `assistant` 类型。

```
agent-loop.ts:65-92
```

```typescript
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>
```

两者都返回 `EventStream<AgentEvent, AgentMessage[]>`，并内部调用 `runLoop()` 执行核心逻辑。

### 双重循环架构 (`runLoop`)

```
agent-loop.ts:104-198
```

`runLoop` 是整个 agent-loop 的核心，采用 **外循环 + 内循环** 的双重循环设计：

```
外循环 (while true) ─── 处理 follow-up 消息
│
├─► 内循环 (while hasMoreToolCalls || pendingMessages) ─── 处理 tool calls + steering 消息
│   │
│   ├─► 注入 pending messages（steering / follow-up）
│   ├─► 调用 LLM 获取 assistant 响应 (streamAssistantResponse)
│   ├─► 如果有 tool calls → 执行工具 (executeToolCalls)
│   ├─► 检查 steering 消息 → 有则中断剩余工具，设为 pending
│   └─► 回到内循环顶部
│
├─► 内循环结束（无更多 tool calls 和 steering）
├─► 检查 follow-up 消息 → 有则设为 pending，继续外循环
└─► 无 follow-up → 退出，发出 agent_end
```

关键流程的伪代码：

```typescript
async function runLoop(context, newMessages, config, signal, stream, streamFn) {
  let pendingMessages = await config.getSteeringMessages?.() || [];

  // 外循环：处理 follow-up 消息
  while (true) {
    let hasMoreToolCalls = true;

    // 内循环：处理 tool calls 和 steering 消息
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      // 1. 注入 pending 消息到上下文
      for (const msg of pendingMessages) {
        context.messages.push(msg);
        emit(message_start/message_end);
      }
      pendingMessages = [];

      // 2. 流式获取 LLM 响应
      const message = await streamAssistantResponse(context, config, signal, stream, streamFn);

      // 3. 错误/中止则直接退出
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        emit(turn_end, agent_end);
        return;
      }

      // 4. 检查是否有 tool calls
      const toolCalls = message.content.filter(c => c.type === "toolCall");
      hasMoreToolCalls = toolCalls.length > 0;

      // 5. 执行工具调用
      if (hasMoreToolCalls) {
        const { toolResults, steeringMessages } = await executeToolCalls(...);
        // 将 toolResults 加入上下文
      }

      emit(turn_end);

      // 6. 获取 steering 消息
      pendingMessages = steeringMessages || await config.getSteeringMessages?.() || [];
    }

    // 7. 检查 follow-up 消息
    const followUp = await config.getFollowUpMessages?.() || [];
    if (followUp.length > 0) {
      pendingMessages = followUp;
      continue; // 继续外循环
    }

    break; // 退出
  }

  emit(agent_end);
}
```

### 消息转换流水线

```
AgentMessage[]  (应用层消息，可能包含自定义类型)
     │
     ▼
transformContext()  [可选：裁剪上下文、注入外部信息]
     │
     ▼
AgentMessage[]  (变换后)
     │
     ▼
convertToLlm()  [必选：过滤自定义消息，转为 LLM 格式]
     │
     ▼
Message[]  (LLM 兼容格式：user / assistant / toolResult)
     │
     ▼
streamSimple() 或 streamFn  (实际调用 LLM API)
     │
     ▼
AssistantMessageEvent stream  (流式响应事件)
```

### 流式响应处理 (`streamAssistantResponse`)

```
agent-loop.ts:204-289
```

这个函数负责：

1. 执行 `transformContext()` 变换上下文
2. 调用 `convertToLlm()` 转为 LLM 消息格式
3. 通过 `getApiKey()` 动态解析 API Key
4. 启动流式调用 LLM
5. 处理流事件并维护 partial message：

| 事件类型 | 处理逻辑 |
|---------|---------|
| `start` | 创建 partial message，**直接 push 到 context.messages** |
| `text_delta` / `thinking_delta` / `toolcall_delta` 等 | **原地更新** context 中的 partial message |
| `done` / `error` | 用最终消息**替换** context 中的 partial |

关键设计：partial message 在流式过程中被直接放入 context.messages 并原地更新，这样 UI 可以实时访问最新状态。

### 工具执行 (`executeToolCalls`)

```
agent-loop.ts:294-378
```

执行流程：

```
for each toolCall in assistantMessage.content:
  │
  ├─► emit(tool_execution_start)
  ├─► 查找 tool 定义
  ├─► validateToolArguments() 校验参数
  ├─► tool.execute(toolCallId, args, signal, onUpdate)
  │   └─► onUpdate 回调触发 emit(tool_execution_update)
  ├─► emit(tool_execution_end)
  ├─► 创建 ToolResultMessage
  ├─► emit(message_start/message_end)
  │
  ├─► 检查 steering 消息
  │   └─► 如果有 → 跳过剩余 tool calls（标记为 isError，内容为 "Skipped due to queued user message."）
  │                   → break
  └─► 继续下一个 tool call
```

**错误处理策略**：工具执行中的异常被 catch 并转为 `isError: true` 的 ToolResultMessage 返回给 LLM，**不会终止循环**。LLM 可以根据错误信息决定重试或换一种方式处理。

### 工具跳过 (`skipToolCall`)

```
agent-loop.ts:380-417
```

当 steering 消息到达时，剩余未执行的 tool calls 会被跳过，生成带有 `isError: true` 和 `"Skipped due to queued user message."` 内容的结果。

---

## Agent 类封装 (agent.ts)

### AgentState

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;     // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  isStreaming: boolean;             // 是否正在流式处理
  streamMessage: AgentMessage | null; // 当前流式中的 partial message
  pendingToolCalls: Set<string>;    // 正在执行的 tool call IDs
  error?: string;
}
```

### 消息队列系统

Agent 类维护两个独立的消息队列，有不同的投递语义：

#### Steering 队列（中断型）

```typescript
agent.steer(message)           // 入队
agent.clearSteeringQueue()     // 清空
agent.setSteeringMode(mode)    // "one-at-a-time"（默认）或 "all"
```

- 在 agent 运行 **过程中** 投递
- 每次工具执行后检查
- 会 **跳过剩余 tool calls**
- 适用于用户希望打断当前操作的场景

#### Follow-Up 队列（续接型）

```typescript
agent.followUp(message)        // 入队
agent.clearFollowUpQueue()     // 清空
agent.setFollowUpMode(mode)    // "one-at-a-time"（默认）或 "all"
```

- 在 agent 运行 **结束后** 投递
- 仅当没有更多 tool calls 和 steering 消息时才检查
- 触发新的一轮对话
- 适用于在 agent 完成当前任务后继续追加工作

#### 出队模式

| 模式 | 行为 |
|------|------|
| `"one-at-a-time"` | 每次只取队列头部一条消息（默认） |
| `"all"` | 一次取出队列中所有消息 |

### 核心方法

#### prompt()

```
agent.ts:312-345
```

```typescript
// 文本 prompt
await agent.prompt("Hello");

// 带图片的 prompt
await agent.prompt("这张图片是什么？", [
  { type: "image", data: base64Data, mimeType: "image/jpeg" }
]);

// 直接传 AgentMessage
await agent.prompt({ role: "user", content: "Hello", timestamp: Date.now() });

// 传多条消息
await agent.prompt([msg1, msg2]);
```

如果 agent 正在 streaming，调用 `prompt()` 会抛出错误，应使用 `steer()` 或 `followUp()` 入队。

#### continue()

```
agent.ts:350-376
```

从当前上下文继续，用于重试或处理队列中的消息：
- 如果最后一条消息是 `assistant`，尝试出队 steering/follow-up 消息
- 否则直接调用 `agentLoopContinue`

#### _runLoop() 内部实现

```
agent.ts:383-529
```

Agent 类的 `_runLoop` 是对底层 `agentLoop` / `agentLoopContinue` 的封装：

1. 创建 `AbortController` 和 `Promise`（用于 `waitForIdle()`）
2. 构建 `AgentLoopConfig`，将 steering/follow-up 队列接入回调
3. 调用 `agentLoop` 或 `agentLoopContinue`
4. 消费 `EventStream`，根据事件更新内部状态
5. 将事件广播给所有 listeners
6. 处理 partial message 的边界情况（abort 后的残留消息）
7. 在 `finally` 中清理状态

### 控制与观察

```typescript
agent.subscribe(callback)    // 订阅事件流，返回取消函数
agent.abort()                // 中止当前操作
await agent.waitForIdle()    // 等待当前操作完成
agent.hasQueuedMessages()    // 是否有排队中的消息
agent.reset()                // 完全重置（清空消息、队列、错误状态）
```

### 状态变更

```typescript
agent.setSystemPrompt(prompt)      // 设置 system prompt
agent.setModel(model)              // 切换模型
agent.setThinkingLevel(level)      // 设置思考级别
agent.setTools(tools)              // 设置可用工具
agent.replaceMessages(messages)    // 替换所有消息（复制数组）
agent.appendMessage(message)       // 追加消息
agent.clearMessages()              // 清空消息
```

### 配置项

```typescript
agent.sessionId = "session-123";              // Provider 缓存标识
agent.thinkingBudgets = {                     // 自定义 thinking token 预算
  minimal: 128, low: 512, medium: 1024, high: 2048
};
agent.maxRetryDelayMs = 60000;                // 最大重试等待时间
```

---

## 代理流 (proxy.ts)

`streamProxy` 用于浏览器应用通过服务器中转 LLM 调用：

```
浏览器                    服务器                    LLM Provider
  │                         │                          │
  │  POST /api/stream       │                          │
  │  { model, context }  ──►│                          │
  │                         │   实际 LLM API 调用    ──►│
  │                         │◄── 流式响应               │
  │◄── SSE (精简事件)       │                          │
  │                         │                          │
  │  客户端重建 partial     │                          │
```

**带宽优化**：服务器在发送事件时去除 `partial` 字段（占大量带宽），客户端根据 delta 事件自行重建完整的 partial message。

使用方式：

```typescript
const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: await getAuthToken(),
      proxyUrl: "https://genai.example.com",
    }),
});
```

---

## 事件流时序

### 简单问答（无工具调用）

```
prompt("2+2=?")
├── agent_start
├── turn_start
├── message_start  { userMessage }
├── message_end    { userMessage }
├── message_start  { assistantMessage (partial) }
├── message_update { text_delta: "4" }
├── message_end    { assistantMessage (final) }
├── turn_end       { message: assistantMessage, toolResults: [] }
└── agent_end      { messages: [...] }
```

### 带工具调用

```
prompt("计算 2+2")
├── agent_start
├── turn_start
├── message_start/end  { userMessage }
├── message_start      { assistantMessage with toolCall }
├── message_update     { toolcall_delta... }
├── message_end        { assistantMessage }
├── tool_execution_start  { toolCallId, toolName, args }
├── tool_execution_end    { toolCallId, result, isError: false }
├── message_start/end  { toolResultMessage }
├── turn_end
│
├── turn_start  (新 turn：带 tool result 继续)
├── message_start      { assistantMessage with final answer }
├── message_update     { text_delta... }
├── message_end
├── turn_end           { toolResults: [] }
└── agent_end
```

### Steering 中断

```
prompt("执行多个操作")
├── agent_start
├── turn_start
├── message_start/end  { userMessage }
├── message_start/end  { assistantMessage with toolCall1, toolCall2 }
├── tool_execution_start/end  { tool1 执行成功 }
│
│   ← 用户调用 agent.steer(interruptMessage)
│
├── tool_execution_start  { tool2 }
├── tool_execution_end    { tool2, isError: true, "Skipped due to queued user message." }
├── message_start/end  { toolResult1 }
├── message_start/end  { toolResult2 (skipped) }
├── message_start/end  { steeringMessage }
├── turn_end
│
├── turn_start  (响应中断消息)
├── message_start/end  { assistantMessage }
├── turn_end
└── agent_end
```

---

## 关键设计决策

### 1. 消息抽象与 `convertToLlm`

整个系统在应用层使用 `AgentMessage`（可包含自定义类型），仅在 LLM 调用边界通过 `convertToLlm` 转换为标准 `Message[]`。这使得应用可以在对话历史中维护 UI 专属消息（通知、artifact 等），而不影响 LLM 通信。

### 2. 双队列系统

Steering（中断型）和 Follow-Up（续接型）使用独立队列，具备不同的投递时机和语义：
- Steering：**每个工具执行后**检查，可中断当前轮次
- Follow-Up：**agent 即将停止时**检查，可触发新轮次

### 3. 嵌套循环结构

外循环处理 follow-up，内循环处理 tool calls 和 steering，提供了精细的控制粒度。

### 4. 流式 partial 原地更新

Assistant message 在流式过程中直接放入 `context.messages` 并原地更新引用，UI 可以实时获取最新内容而无需额外的订阅机制。

### 5. 工具错误不终止循环

工具执行的错误被 catch 后封装为 `isError: true` 的 ToolResultMessage 返回给 LLM，而非抛出异常终止循环。LLM 可以据此自行决定重试或调整策略。

### 6. 动态 API Key

`getApiKey()` 回调在每次 LLM 调用前执行，支持 OAuth 等短期 token 在长时间工具执行期间过期后刷新。

### 7. 代理架构的带宽优化

Proxy 模式下服务器去除 `partial` 字段，客户端从 delta 事件自行重建，显著减少传输数据量。
