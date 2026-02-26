# OpenClaw Agent Trace Replay 能力分析

> 深度研究 OpenClaw 是否支持完整的 Agent Trace Replay，包括思考链保存、确定性重放和 Eval 支持

---

## 一、当前架构概览

### 1.1 会话数据流

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Agent 数据流                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   用户输入                                                                            │
│      │                                                                               │
│      ▼                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                        Agent Loop (@mariozechner/pi-agent-core)              │   │
│   │                                                                              │   │
│   │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │   │
│   │   │   思考过程   │───▶│  工具调用    │───▶│  结果处理    │                  │   │
│   │   │  (thinking)  │    │ (tool_call)  │    │(tool_result) │                  │   │
│   │   └──────────────┘    └──────────────┘    └──────────────┘                  │   │
│   │          │                   │                   │                          │   │
│   │          ▼                   ▼                   ▼                          │   │
│   │   ┌─────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                    SessionManager (pi-coding-agent)                  │   │   │
│   │   │                                                                      │   │   │
│   │   │   保存格式: JSON Lines (.jsonl)                                      │   │   │
│   │   │   - 消息头 (session header)                                          │   │   │
│   │   │   - 消息记录 (type: "message")                                       │   │   │
│   │   │   - 使用记录 (type: "usage")                                         │   │   │
│   │   └─────────────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                                 │
│                                    ▼                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                        诊断事件系统 (Diagnostic Events)                      │   │
│   │                                                                              │   │
│   │   - webhook.received/processed/error                                        │   │
│   │   - message.queued/processed                                                │   │
│   │   - session.state                                                           │   │
│   │   - run.attempt                                                             │   │
│   │   - tool.loop                                                               │   │
│   │                                                                              │   │
│   │   存储: 内存中 (diagnosticSessionStates)                                    │   │
│   │   TTL: 30分钟                                                               │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心组件

| 组件 | 包/模块 | 职责 |
|------|---------|------|
| Agent Loop | `@mariozechner/pi-agent-core` | 执行 Agent 推理循环 |
| Session Manager | `@mariozechner/pi-coding-agent` | 持久化会话历史 |
| Diagnostic System | `src/logging/diagnostic.ts` | 运行时事件追踪 |
| Tool Orchestration | `src/agents/pi-tools.ts` | 工具调用管理 |

---

## 二、思考链保存能力分析

### 2.1 当前保存内容

```typescript
// Session 文件格式 (JSON Lines)
// 位置: ~/.openclaw/sessions/{agentId}/{sessionId}.jsonl

// 1. 会话头
{
  "type": "session",
  "version": "v1",
  "id": "sess_xxx",
  "timestamp": "2024-01-15T10:30:00Z",
  "cwd": "/workspace"
}

// 2. 消息记录
{
  "type": "message",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "我需要分析这个问题..." },
      { "type": "text", "text": "让我帮您查看代码" },
      { "type": "toolCall", "id": "call_1", "name": "read", "arguments": {...} }
    ],
    "stopReason": "tool_use",
    "timestamp": 1705312200000
  }
}

// 3. 工具结果
{
  "type": "message",
  "message": {
    "role": "toolResult",
    "toolCallId": "call_1",
    "toolName": "read",
    "content": [...],
    "isError": false,
    "timestamp": 1705312201000
  }
}

// 4. 使用统计
{
  "type": "usage",
  "usage": {
    "input": 1500,
    "output": 800,
    "totalTokens": 2300,
    "cost": { "total": 0.003 }
  }
}
```

### 2.2 思考链保存完整度评估

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      思考链保存完整度矩阵                                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   数据类型                    │ 是否保存 │ 完整度 │ 说明                            │
│   ────────────────────────────┼──────────┼────────┼─────────────────────────────────│
│   用户输入 (user)             │    ✅    │  100%  │ 完整保存                        │
│   助手回复 (assistant)        │    ✅    │  100%  │ 包含 thinking + text + toolCall │
│   工具调用参数                │    ✅    │  100%  │ 完整 JSON 参数                  │
│   工具执行结果                │    ✅    │  95%   │ 默认保存，但可能被截断          │
│   系统提示 (system)           │    ❌    │   0%   │ 不保存，每次重新生成            │
│   模型元数据                  │    ✅    │  80%   │ provider/model/usage            │
│   运行时配置                  │    ❌    │   0%   │ temperature 等参数不保存        │
│   环境状态                    │    ❌    │   0%   │ 工作区文件状态不保存            │
│   工具执行副作用              │    ❌    │   0%   │ 文件修改等不记录                │
│   网络请求/响应               │    ❌    │   0%   │ 不保存原始 HTTP 流量            │
│   错误堆栈                    │    ⚠️    │  50%   │ 部分错误信息可能丢失            │
│   时间戳                      │    ✅    │  100%  │ 精确到毫秒                      │
│                                                                                      │
│   整体完整度: ~65%                                                                   │
│   - 对话历史: 完整                                                                   │
│   - 思考过程: 完整 (依赖模型返回 thinking 块)                                        │
│   - 执行上下文: 缺失                                                                 │
│   - 环境状态: 缺失                                                                   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 关键代码分析

```typescript
// src/agents/pi-embedded-runner/run/attempt.ts
// Session 管理和消息保存

export async function runEmbeddedAttempt(
  params: EmbeddedRunAttemptParams
): Promise<EmbeddedRunAttemptResult> {
  // ... 准备工作 ...
  
  const sessionManager = SessionManager.open(sessionFile);
  
  // Agent 执行
  const agentSession = createAgentSession({
    sessionManager,
    settingsManager,
    // ... 其他配置
  });
  
  // 消息自动保存到 sessionFile (JSONL 格式)
  // 由 pi-coding-agent 内部处理
}

// src/logging/diagnostic-session-state.ts
// 诊断状态追踪

export type SessionState = {
  sessionId?: string;
  sessionKey?: string;
  lastActivity: number;
  state: "idle" | "processing" | "waiting";
  queueDepth: number;
  toolCallHistory?: ToolCallRecord[];  // 工具调用历史
  toolLoopWarningBuckets?: Map<string, number>;
  commandPollCounts?: Map<string, { count: number; lastPollAt: number }>;
};

export type ToolCallRecord = {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
};
```

---

## 三、Deterministic Replay 可行性分析

### 3.1 确定性重放的挑战

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      确定性重放挑战分析                                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   非确定性因素:                                                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. LLM 输出随机性                                                             │   │
│   │    ├── temperature > 0 时采样随机                                             │   │
│   │    ├── 即使 temperature=0，不同版本模型输出可能不同                           │   │
│   │    └── 模型更新导致行为变化                                                   │   │
│   │                                                                             │   │
│   │ 2. 时间依赖                                                                   │   │
│   │    ├── 当前时间影响 (如 Date.now())                                          │   │
│   │    ├── 超时逻辑                                                               │   │
│   │    └── 缓存过期                                                               │   │
│   │                                                                             │   │
│   │ 3. 外部状态                                                                   │   │
│   │    ├── 文件系统状态变化                                                       │   │
│   │    ├── 网络请求结果                                                           │   │
│   │    └── 环境变量变化                                                           │   │
│   │                                                                             │   │
│   │ 4. 并发和竞态条件                                                             │   │
│   │    ├── 多会话并发                                                             │   │
│   │    ├── 工具执行顺序                                                           │   │
│   │    └── 锁机制                                                                 │   │
│   │                                                                             │   │
│   │ 5. 未记录的状态                                                               │   │
│   │    ├── 系统提示变化                                                           │   │
│   │    ├── 技能 (skills) 更新                                                     │   │
│   │    └── 配置文件变更                                                           │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 当前 Replay 能力评估

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Replay 能力矩阵                                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Replay 场景                              │ 可行性 │ 限制                           │
│   ─────────────────────────────────────────┼────────┼────────────────────────────────│
│   相同输入，相同模型，相同配置              │   ⚠️   │ 可能成功，但非 100% 确定       │
│   离线分析历史对话                          │   ✅   │ 完全可行                       │
│   基于历史的回归测试                        │   ⚠️   │ 需要 mock LLM 和工具           │
│   跨模型 Replay                             │   ❌   │ 不可行，输出差异太大           │
│   跨版本 Replay                             │   ❌   │ OpenClaw 更新可能改变行为      │
│   并发场景 Replay                           │   ❌   │ 竞态条件无法复现               │
│   长时间运行 Replay                         │   ⚠️   │ 累积误差可能导致分叉           │
│                                                                                      │
│   当前状态: 不支持完整的 deterministic replay                                        │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 实现 Deterministic Replay 所需改造

```typescript
// 理论上的 Replay 系统架构

interface ReplayEnvironment {
  // 1. 固定随机种子
  seed: string;
  
  // 2. 固定时间
  frozenTime: number;
  timeIncrement: number;  // 每次调用增加的量
  
  // 3. 固定模型版本
  modelVersion: string;
  modelProvider: string;
  
  // 4. 固定配置
  configSnapshot: OpenClawConfig;
  
  // 5. 固定文件系统状态
  workspaceSnapshot: WorkspaceSnapshot;
  
  // 6. 固定网络响应
  networkMocks: Map<string, MockedResponse>;
  
  // 7. 固定工具行为
  toolMocks: Map<string, MockedToolResult>;
}

interface ReplaySession {
  // 重放模式
  mode: 'record' | 'replay';
  
  // 记录的数据
  trace: AgentTrace;
  
  // 执行
  async execute(): Promise<ReplayResult>;
  
  // 对比
  compare(expected: AgentTrace): ReplayDiff;
}

// 需要修改的关键点:
// 1. 在 pi-agent-core 中支持 seed 参数
// 2. 记录所有外部调用 (文件、网络、时间)
// 3. 实现 Mock 层拦截外部调用
// 4. 保存和恢复完整环境状态
```

---

## 四、Eval 支持能力分析

### 4.1 当前测试架构

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      OpenClaw 测试架构                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   测试类型:                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                             │   │
│   │  1. 单元测试 (*.test.ts)                                                    │   │
│   │     ├── 工具函数测试                                                        │   │
│   │     ├── 配置解析测试                                                        │   │
│   │     └── 消息处理测试                                                        │   │
│   │                                                                             │   │
│   │  2. E2E 测试 (*.e2e.test.ts)                                                │   │
│   │     ├── Gateway API 测试                                                    │   │
│   │     ├── Webhook 处理测试                                                    │   │
│   │     └── 端到端工作流测试                                                    │   │
│   │                                                                             │   │
│   │  3. 集成测试                                                                 │   │
│   │     ├── Provider 兼容性测试                                                 │   │
│   │     ├── 工具链测试                                                          │   │
│   │     └── 会话管理测试                                                        │   │
│   │                                                                             │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
│   测试工具:                                                                          │
│   - Vitest (测试框架)                                                               │
│   - 自定义 Mock (LLM、工具、网络)                                                   │
│   - 临时文件系统隔离                                                                │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Eval 能力评估

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Eval 支持能力矩阵                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Eval 场景                                │ 支持度 │ 实现方式                       │
│   ─────────────────────────────────────────┼────────┼────────────────────────────────│
│   工具调用正确性评估                        │   ✅   │ 检查 toolCall 参数             │
│   回复质量评估                              │   ⚠️   │ 需要人工或 LLM-as-judge        │
│   思考过程评估                              │   ⚠️   │ 依赖模型返回 thinking 块       │
│   Token 使用评估                            │   ✅   │ usage 记录完整                 │
│   成本评估                                  │   ✅   │ cost 记录完整                  │
│   延迟评估                                  │   ⚠️   │ timestamp 记录，但受环境影     │
│   任务完成率评估                            │   ⚠️   │ 需要定义完成标准               │
│   多轮对话一致性评估                        │   ⚠️   │ 需要复杂评估逻辑               │
│   安全性评估                                │   ❌   │ 无内置安全评估                 │
│   幻觉检测                                  │   ❌   │ 无内置幻觉检测                 │
│                                                                                      │
│   当前状态: 基础数据完整，但缺乏系统化 Eval 框架                                     │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 当前测试示例

```typescript
// src/gateway/server.agent.gateway-server-agent-b.e2e.test.ts
// E2E 测试示例

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Agent E2E', () => {
  it('should process message and return response', async () => {
    // 1. 设置测试环境
    const server = await startTestServer();
    
    // 2. 发送请求
    const response = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        message: 'Hello',
        sessionId: 'test-session'
      })
    });
    
    // 3. 验证响应
    const result = await response.json();
    expect(result.text).toBeDefined();
    expect(result.messageId).toBeDefined();
    
    // 4. 验证会话历史
    const session = loadSession('test-session');
    expect(session.messages).toHaveLength(2); // user + assistant
  });
});

// src/agents/session-transcript-repair.e2e.test.ts
// 会话修复测试

describe('Session Transcript Repair', () => {
  it('should repair missing tool results', () => {
    const brokenMessages = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'read' }] },
      // 缺少对应的 toolResult
    ];
    
    const repaired = repairToolUseResultPairing(brokenMessages);
    
    expect(repaired.added).toHaveLength(1);
    expect(repaired.added[0].role).toBe('toolResult');
    expect(repaired.added[0].toolCallId).toBe('call_1');
  });
});
```

---

## 五、Eval 框架对接可行性

### 5.1 主流 Eval 框架对比

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Eval 框架对比                                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   框架              │ 特点                          │ 对接可行性                    │
│   ──────────────────┼───────────────────────────────┼───────────────────────────────│
│   LangSmith         │ LangChain 官方，追踪完整链    │ ⚠️ 需要适配 pi-mono           │
│   PromptFlow        │ 微软，可视化评估              │ ⚠️ 需要导出数据格式           │
│   Weights & Biases  │ 实验追踪，支持 LLM            │ ✅ 可通过 API 对接            │
│   MLflow            │ 通用 ML 实验管理              │ ✅ 可记录 trace               │
│   Braintrust        │ 专为 LLM Eval 设计            │ ⚠️ 需要数据转换               │
│   OpenAI Evals      │ OpenAI 官方评估框架           │ ⚠️ 需要适配数据格式           │
│   EleutherAI LM Eval│ 学术评估框架                  │ ❌ 不适用于 Agent 场景        │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 推荐的 Eval 架构

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                   推荐的 Eval 集成架构                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                        OpenClaw Agent 执行                                   │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                                 │
│                                    ▼                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                      Trace Collector (新增)                                  │   │
│   │                                                                              │   │
│   │   收集:                                                                       │   │
│   │   - 完整消息历史 (从 SessionManager)                                         │   │
│   │   - 诊断事件 (从 diagnostic events)                                          │   │
│   │   - Token 使用 (从 usage records)                                            │   │
│   │   - 工具调用链 (从 tool call history)                                        │   │
│   │   - 系统提示 (运行时捕获)                                                     │   │
│   │   - 配置快照 (运行时捕获)                                                     │   │
│   │                                                                              │   │
│   │   输出: OpenTrace / AgentTrace 标准格式                                      │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                                 │
│                                    ▼                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                        Eval 框架适配层                                       │   │
│   │                                                                              │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │   │
│   │   │ LangSmith    │  │ Braintrust   │  │ MLflow       │                      │   │
│   │   │ Adapter      │  │ Adapter      │  │ Adapter      │                      │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘                      │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                                 │
│                                    ▼                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                        评估执行                                              │   │
│   │                                                                              │   │
│   │   - 离线评估 (基于历史 trace)                                                │   │
│   │   - 在线评估 (实时拦截和评估)                                                │   │
│   │   - 回归测试 (对比新旧版本)                                                  │   │
│   │                                                                              │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 实现建议

```typescript
// 建议的 Trace Collector 实现

interface AgentTrace {
  traceId: string;
  sessionId: string;
  timestamp: number;
  
  // 执行环境
  environment: {
    openclawVersion: string;
    piMonoVersion: string;
    modelProvider: string;
    modelId: string;
    config: Record<string, unknown>;
  };
  
  // 完整消息历史
  messages: AgentMessage[];
  
  // 思考链 (如果模型支持)
  thinkingChain?: ThinkingStep[];
  
  // 工具调用链
  toolCalls: ToolCallTrace[];
  
  // Token 和成本
  usage: UsageStats;
  
  // 诊断事件
  events: DiagnosticEvent[];
  
  // 结果
  outcome: 'success' | 'error' | 'timeout';
  finalResponse?: string;
}

interface TraceCollector {
  // 开始收集
  start(sessionId: string): void;
  
  // 记录消息
  recordMessage(message: AgentMessage): void;
  
  // 记录工具调用
  recordToolCall(toolCall: ToolCallTrace): void;
  
  // 记录事件
  recordEvent(event: DiagnosticEvent): void;
  
  // 结束收集
  finish(outcome: TraceOutcome): AgentTrace;
  
  // 导出
  export(format: 'json' | 'opentrace' | 'braintrust'): string;
}

// 使用示例
const collector = createTraceCollector();

collector.start('session-123');

// 在 Agent 执行过程中自动收集
agent.onMessage = (msg) => collector.recordMessage(msg);
agent.onToolCall = (call) => collector.recordToolCall(call);

// 执行完成后
const trace = collector.finish('success');

// 导出到 Eval 框架
await uploadToLangSmith(trace);
await uploadToBraintrust(trace);
```

---

## 六、结论与建议

### 6.1 核心结论

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          核心结论                                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   1. 是否能保存完整思考链？                                                          │
│      ─────────────────────                                                           │
│      ⚠️ 部分支持                                                                     │
│      ✅ 保存: 消息历史、工具调用链、Token 使用、诊断事件                             │
│      ❌ 缺失: 系统提示、运行时配置、环境状态、网络请求                               │
│      完整度: ~65%                                                                    │
│                                                                                      │
│   2. 是否能 deterministic replay？                                                   │
│      ─────────────────────────────                                                   │
│      ❌ 当前不支持                                                                   │
│      主要障碍:                                                                       │
│      - LLM 输出随机性                                                                │
│      - 时间依赖                                                                      │
│      - 外部状态变化                                                                  │
│      - 未记录的配置和环境                                                            │
│                                                                                      │
│   3. 是否能用于 eval？                                                               │
│      ─────────────────────                                                           │
│      ⚠️ 基础支持                                                                     │
│      ✅ 可用: 离线分析、工具调用验证、Token/成本统计                                 │
│      ❌ 缺失: 系统化评估框架、自动化评分、回归测试                                   │
│                                                                                      │
│   4. 是否可以对接 eval 框架？                                                        │
│      ─────────────────────────                                                       │
│      ✅ 可行                                                                         │
│      推荐: MLflow (通用)、Braintrust (LLM 专用)                                      │
│      需要: Trace Collector 中间层                                                    │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 改进路线图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      改进路线图                                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Phase 1: 增强 Trace 收集 (短期)                                                    │
│   ────────────────────────────────                                                   │
│   ├── 1.1 保存系统提示快照                                                           │
│   ├── 1.2 保存运行时配置 (temperature, maxTokens 等)                                 │
│   ├── 1.3 保存技能 (skills) 版本信息                                                 │
│   ├── 1.4 增强工具结果记录 (避免截断)                                                │
│   └── 1.5 记录网络请求摘要 (可选)                                                    │
│                                                                                      │
│   Phase 2: Trace Collector (中期)                                                    │
│   ────────────────────────────────                                                   │
│   ├── 2.1 实现统一的 Trace 收集器                                                    │
│   ├── 2.2 标准化 Trace 格式 (兼容 OpenTrace)                                         │
│   ├── 2.3 实现导出到主流 Eval 框架                                                   │
│   └── 2.4 添加 Trace 可视化界面                                                      │
│                                                                                      │
│   Phase 3: Deterministic Replay (长期)                                               │
│   ────────────────────────────────────                                               │
│   ├── 3.1 在 pi-agent-core 中支持 seed 参数                                          │
│   ├── 3.2 实现 Mock 层 (时间、文件、网络)                                            │
│   ├── 3.3 环境快照和恢复                                                             │
│   └── 3.4 回归测试框架                                                               │
│                                                                                      │
│   Phase 4: Eval 框架 (长期)                                                          │
│   ────────────────────────────                                                       │
│   ├── 4.1 内置评估指标 (工具正确性、任务完成率)                                      │
│   ├── 4.2 LLM-as-judge 集成                                                          │
│   ├── 4.3 幻觉检测                                                                   │
│   └── 4.4 A/B 测试支持                                                               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 优先级建议

| 优先级 | 任务 | 影响 | 工作量 |
|--------|------|------|--------|
| P0 | 实现 Trace Collector | 高 | 中 |
| P0 | 保存系统提示和配置 | 高 | 低 |
| P1 | MLflow/Braintrust 对接 | 中 | 中 |
| P1 | 增强工具结果记录 | 中 | 低 |
| P2 | Deterministic Replay | 高 | 高 |
| P2 | 回归测试框架 | 中 | 高 |
| P3 | LLM-as-judge | 低 | 中 |

---

## 参考文档

- [diagnostic.ts](file:///d:/temp/openclaw/src/logging/diagnostic.ts)
- [diagnostic-session-state.ts](file:///d:/temp/openclaw/src/logging/diagnostic-session-state.ts)
- [session-files.ts](file:///d:/temp/openclaw/src/memory/session-files.ts)
- [session-transcript-repair.ts](file:///d:/temp/openclaw/src/agents/session-transcript-repair.ts)
- [transcript.ts](file:///d:/temp/openclaw/src/config/sessions/transcript.ts)
- [attempt.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run/attempt.ts)
