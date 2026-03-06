# pi-coding-agent vs LangGraph State 管理机制研究

## 执行摘要

本文档深入分析 LangGraph 的 State 管理机制，并研究如何在 pi-coding-agent 中实现类似的功能。pi-coding-agent 本身**不直接支持** LangGraph 风格的显式 State 管理，但通过其扩展机制和自定义消息类型，可以实现类似的功能。

## 1. LangGraph State 管理机制

### 1.1 核心概念

LangGraph 的 State 是整个工作流的"记忆本"，具有以下特点：

1. **共享状态**：所有节点共享同一个状态对象
2. **类型安全**：使用 TypedDict 定义状态结构
3. **节点间传递**：每个节点接收状态并返回更新后的状态
4. **图结构**：通过节点和边定义工作流

### 1.2 基本示例

```python
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    text: str
    count: int

def node_a(state: State) -> dict:
    # 接收状态，返回更新
    return {"text": state["text"] + "a", "count": state["count"] + 1}

def node_b(state: State) -> dict:
    return {"text": state["text"] + "b", "count": state["count"] + 1}

# 构建图
graph = StateGraph(State)
graph.add_node("node_a", node_a)
graph.add_node("node_b", node_b)
graph.add_edge(START, "node_a")
graph.add_edge("node_a", "node_b")

# 执行
result = graph.compile().invoke({"text": "", "count": 0})
# {'text': 'ab', 'count': 2}
```

### 1.3 State 管理特性

| 特性 | 描述 |
|------|------|
| **显式 State 定义** | 使用 TypedDict 定义状态结构 |
| **节点间传递** | 每个节点接收 state 并返回 dict |
| **自动合并** | LangGraph 自动合并节点返回的 dict |
| **条件分支** | 基于状态值决定下一个节点 |
| **持久化** | 支持 checkpoint 持久化状态 |

### 1.4 高级特性

```python
# 条件分支
def route_node(state: State) -> str:
    if state["count"] > 5:
        return "node_c"
    return "node_b"

graph.add_conditional_edges("node_a", route_node)

# 人工介入
def human_in_the_loop(state: State) -> State:
    user_input = input("Continue? ")
    return {**state, "confirmed": user_input == "yes"}
```

## 2. pi-coding-agent State 管理机制

### 2.1 核心数据结构

pi-coding-agent 的 State 管理基于以下核心结构：

```typescript
// AgentState - 核心状态
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];  // 所有消息（包括用户、助手、工具结果）
  isStreaming: boolean;
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  error?: string;
}

// AgentMessage - 消息类型
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// Message - LLM 消息
interface Message {
  role: "user" | "assistant" | "toolResult";
  content: (TextContent | ImageContent | ToolCall | ToolResult)[];
  usage?: TokenUsage;
  stopReason?: StopReason;
  timestamp: number;
}
```

### 2.2 State 管理特点

| 特性 | pi-coding-agent | LangGraph |
|------|----------------|-----------|
| **状态存储** | `AgentState.messages` 数组 | 显式 State 对象 |
| **类型定义** | 运行时推断 | 编译时 TypedDict |
| **节点传递** | 消息追加到数组 | 函数返回 dict |
| **状态更新** | 消息追加/替换 | 函数返回更新 |
| **条件分支** | 手动控制 | 内置条件边 |

### 2.3 消息传递机制

pi-coding-agent 通过消息传递状态：

```typescript
// 1. 用户消息（输入状态）
{
  role: "user",
  content: [{ type: "text", text: "分析这个项目" }]
}

// 2. 助手消息（处理状态）
{
  role: "assistant",
  content: [{ type: "toolCall", ... }]
}

// 3. 工具结果（输出状态）
{
  role: "toolResult",
  content: [{ type: "text", text: "分析结果" }]
}
```

## 3. 差异分析

### 3.1 架构差异

**LangGraph**：
```
State → Node → Updated State → Node → Final State
     ↓           ↓              ↓
  定义类型    处理状态    返回更新
```

**pi-coding-agent**：
```
Messages → Agent → New Messages → Agent → Final Messages
          ↓                    ↓
      处理消息            追加消息
```

### 3.2 State 管理对比

| 维度 | LangGraph | pi-coding-agent |
|------|-----------|-----------------|
| **状态定义** | 编译时 TypedDict | 运行时消息数组 |
| **状态更新** | 函数返回 dict | 消息追加 |
| **类型安全** | 编译时检查 | 运行时检查 |
| **节点概念** | 显式节点 | 隐式 turn |
| **条件分支** | 内置支持 | 手动控制 |
| **持久化** | 内置 checkpoint | 手动序列化 |

### 3.3 适用场景

**LangGraph 适合**：
- 多节点工作流（编排多个 Agent）
- 复杂条件分支
- 需要显式状态管理
- 人工介入流程

**pi-coding-agent 适合**：
- 单 Agent 交互
- 对话式任务
- 工具调用链
- 简单状态管理

## 4. 在 pi-coding-agent 中实现 LangGraph 风格 State

### 4.1 方案 1：自定义消息类型（推荐）

**原理**：扩展 `CustomAgentMessages` 接口，添加自定义状态消息

```typescript
// 1. 定义状态消息类型
declare module "@mariozechner/agent" {
  interface CustomAgentMessages {
    stateUpdate: StateUpdateMessage;
    workflowContext: WorkflowContextMessage;
  }
}

interface StateUpdateMessage {
  type: "state_update";
  role: "system";
  content: [{ type: "text"; text: string }];
  state: Record<string, any>;  // 状态数据
  timestamp: number;
}

interface WorkflowContextMessage {
  type: "workflow_context";
  role: "system";
  content: [{ type: "text"; text: "Workflow context" }];
  context: {
    currentNode: string;
    nextNodes: string[];
    variables: Record<string, any>;
  };
  timestamp: number;
}

// 2. 使用自定义消息
const { session } = await createAgentSession();

// 添加状态更新
await session.prompt("Start workflow");

// 注入状态
session.agent.appendMessage({
  type: "state_update",
  role: "system",
  content: [{ type: "text", text: "State update" }],
  state: { step: 1, data: "initial" },
  timestamp: Date.now(),
});

// Agent 会看到这个状态并作出响应
```

**优点**：
- 类型安全（通过 TypeScript）
- 与 pi-coding-agent 深度集成
- 自动持久化到 session

**缺点**：
- 需要手动管理状态
- 没有自动合并机制

### 4.2 方案 2：扩展 Agent 类

**原理**：继承 `Agent` 类，添加 State 管理层

```typescript
import { Agent, type AgentState } from "@mariozechner/agent";

interface WorkflowState {
  variables: Record<string, any>;
  currentNode: string;
  history: Array<{ node: string; output: any }>;
}

class WorkflowAgent extends Agent {
  private _workflowState: WorkflowState;

  constructor(opts: any) {
    super(opts);
    this._workflowState = {
      variables: {},
      currentNode: "",
      history: [],
    };
  }

  // 获取当前状态
  getState(): WorkflowState {
    return { ...this._workflowState };
  }

  // 更新状态
  updateState(updates: Partial<WorkflowState>): void {
    this._workflowState = {
      ...this._workflowState,
      ...updates,
    };
  }

  // 添加状态消息
  addStateMessage(key: string, value: any): void {
    this.appendMessage({
      role: "system",
      content: [{ type: "text", text: JSON.stringify({ [key]: value }) }],
      timestamp: Date.now(),
    });
  }

  // 从消息中提取状态
  extractStateFromMessages(): WorkflowState {
    const state: WorkflowState = {
      variables: {},
      currentNode: this._workflowState.currentNode,
      history: this._workflowState.history,
    };

    for (const msg of this.state.messages) {
      if (msg.role === "assistant") {
        for (const content of msg.content) {
          if (content.type === "text") {
            try {
              const data = JSON.parse(content.text);
              if (data.type === "state_update") {
                state.variables = { ...state.variables, ...data.variables };
              }
            } catch {
              // 忽略非 JSON 内容
            }
          }
        }
      }
    }

    return state;
  }
}

// 使用
const workflowAgent = new WorkflowAgent({
  initialState: {
    systemPrompt: "You are a workflow agent",
    model: getModel("openai", "gpt-5.1"),
    thinkingLevel: "high",
    tools: [],
    messages: [],
  },
});

workflowAgent.updateState({
  currentNode: "node_a",
  variables: { input: "data" },
});

// Agent 会看到状态并作出响应
await workflowAgent.prompt("Execute node_a");
```

**优点**：
- 封装状态管理逻辑
- 提供便捷的 API
- 可重用

**缺点**：
- 需要继承类
- 状态和消息分离

### 4.3 方案 3：使用 Context Transform

**原理**：利用 `transformContext` 钩子注入状态

```typescript
interface WorkflowState {
  variables: Record<string, any>;
  currentNode: string;
}

class StateManagedAgent {
  private agent: Agent;
  private state: WorkflowState;

  constructor(state: WorkflowState) {
    this.state = state;
    
    this.agent = new Agent({
      initialState: {
        systemPrompt: "You are a workflow agent",
        model: getModel("openai", "gpt-5.1"),
        thinkingLevel: "high",
        tools: [],
        messages: [],
      },
      // 关键：转换上下文，注入状态
      transformContext: async (messages, signal) => {
        // 添加状态消息
        const stateMessage = {
          role: "system" as const,
          content: [{ 
            type: "text", 
            text: `Current state: ${JSON.stringify(this.state)}\nCurrent node: ${this.state.currentNode}` 
          }],
          timestamp: Date.now(),
        };
        
        return [...messages, stateMessage];
      },
    });
  }

  async executeNode(nodeName: string, input: any): Promise<any> {
    this.state.currentNode = nodeName;
    
    const prompt = `Execute node ${nodeName} with input: ${JSON.stringify(input)}`;
    await this.agent.prompt(prompt);
    
    // 提取结果
    const lastMessage = this.agent.state.messages[this.agent.state.messages.length - 1];
    return this.parseResult(lastMessage);
  }

  private parseResult(message: any): any {
    // 解析结果
    return message.content[0].text;
  }
}

// 使用
const workflow = new StateManagedAgent({
  variables: {},
  currentNode: "",
});

const result1 = await workflow.executeNode("node_a", { input: "data" });
const result2 = await workflow.executeNode("node_b", { input: result1 });
```

**优点**：
- 无需修改 Agent
- 灵活的上下文转换
- 状态和消息分离

**缺点**：
- 状态不持久化到消息
- 需要手动管理

### 4.4 方案 4：自定义工具传递状态

**原理**：使用工具调用传递状态

```typescript
// 定义状态工具
const stateTools = [
  {
    name: "read_state",
    description: "Read current workflow state",
    parameters: Type.Object({
      key: Type.Optional(Type.String({ description: "State key to read" })),
    }),
    execute: async (_id, params) => {
      return {
        content: [{ type: "text", text: JSON.stringify(state[params.key] ?? state) }],
        details: undefined,
      };
    },
  },
  {
    name: "update_state",
    description: "Update workflow state",
    parameters: Type.Object({
      key: Type.String({ description: "State key" }),
      value: Type.String({ description: "State value (JSON)" }),
    }),
    execute: async (_id, params) => {
      const value = JSON.parse(params.value);
      state[params.key] = value;
      return {
        content: [{ type: "text", text: `State updated: ${params.key}` }],
        details: undefined,
      };
    },
  },
];

// 使用
const { session } = await createAgentSession({
  tools: [...codingTools, ...stateTools],
});

// Agent 可以读取和更新状态
await session.prompt("Read current state and update the counter");
```

**优点**：
- Agent 主动管理状态
- 类型安全
- 易于调试

**缺点**：
- 需要额外工具
- 状态管理分散

## 5. 完整实现示例

### 5.1 方案 1 完整实现（推荐）

```typescript
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// 1. 扩展自定义消息类型
declare module "@mariozechner/pi-coding-agent" {
  interface CustomAgentMessages {
    workflowState: WorkflowStateMessage;
    workflowNode: WorkflowNodeMessage;
  }
}

interface WorkflowStateMessage {
  type: "workflow_state";
  role: "system";
  content: [{ type: "text"; text: "Workflow state" }];
  state: {
    variables: Record<string, any>;
    currentNode: string;
    nextNodes: string[];
    history: Array<{ node: string; output: any }>;
  };
  timestamp: number;
}

interface WorkflowNodeMessage {
  type: "workflow_node";
  role: "system";
  content: [{ type: "text"; text: "Workflow node" }];
  node: {
    name: string;
    description: string;
    inputSchema?: any;
    outputSchema?: any;
  };
  timestamp: number;
}

// 2. Workflow Manager
class WorkflowManager {
  private session: any;
  private state: WorkflowStateMessage["state"] = {
    variables: {},
    currentNode: "",
    nextNodes: [],
    history: [],
  };

  constructor() {
    this.init();
  }

  private async init() {
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      authStorage: AuthStorage.create(),
      modelRegistry: new ModelRegistry(AuthStorage.create()),
      model: getModel("openai", "gpt-5.1"),
      thinkingLevel: "high",
    });
    this.session = session;
  }

  // 添加状态消息
  private addStateMessage(): void {
    this.session.agent.appendMessage({
      type: "workflow_state",
      role: "system",
      content: [{ type: "text", text: "Current workflow state" }],
      state: { ...this.state },
      timestamp: Date.now(),
    });
  }

  // 添加节点消息
  private addNodeMessage(nodeName: string, description: string): void {
    this.state.currentNode = nodeName;
    this.session.agent.appendMessage({
      type: "workflow_node",
      role: "system",
      content: [{ type: "text", text: `Executing node: ${nodeName}` }],
      node: {
        name: nodeName,
        description,
      },
      timestamp: Date.now(),
    });
  }

  // 执行节点
  async executeNode(nodeName: string, description: string, input?: any): Promise<any> {
    // 添加状态和节点消息
    this.addStateMessage();
    this.addNodeMessage(nodeName, description);

    // 构建提示
    let prompt = `Execute node: ${nodeName}\nDescription: ${description}`;
    
    if (input) {
      prompt += `\nInput: ${JSON.stringify(input)}`;
    }

    // 执行
    await this.session.prompt(prompt);

    // 提取结果
    const lastMessage = this.session.agent.state.messages[
      this.session.agent.state.messages.length - 1
    ];

    if (lastMessage.role === "assistant") {
      const textContent = lastMessage.content.find(c => c.type === "text");
      if (textContent) {
        try {
          const result = JSON.parse(textContent.text);
          this.updateHistory(nodeName, result);
          return result;
        } catch {
          return textContent.text;
        }
      }
    }

    return null;
  }

  // 更新历史
  private updateHistory(nodeName: string, output: any): void {
    this.state.history.push({ node: nodeName, output });
  }

  // 获取当前状态
  getState(): WorkflowStateMessage["state"] {
    return { ...this.state };
  }

  // 更新变量
  updateVariable(key: string, value: any): void {
    this.state.variables[key] = value;
  }

  // 设置下一个节点
  setNextNodes(nodes: string[]): void {
    this.state.nextNodes = nodes;
  }
}

// 3. 使用示例
async function runWorkflow() {
  const workflow = new WorkflowManager();

  // 节点 A
  const resultA = await workflow.executeNode(
    "node_a",
    "Analyze repository structure",
    { repo: "https://github.com/example/repo" }
  );

  // 更新状态
  workflow.updateVariable("analysis", resultA);

  // 节点 B
  const resultB = await workflow.executeNode(
    "node_b",
    "Generate security report",
    { analysis: resultA }
  );

  // 更新状态
  workflow.updateVariable("securityReport", resultB);

  // 节点 C
  const resultC = await workflow.executeNode(
    "node_c",
    "Create summary",
    { analysis: resultA, security: resultB }
  );

  console.log("Workflow completed:", resultC);
}

runWorkflow().catch(console.error);
```

### 5.2 条件分支实现

```typescript
class ConditionalWorkflowManager extends WorkflowManager {
  // 条件分支
  async executeConditional(
    condition: (state: any) => boolean,
    trueNode: string,
    falseNode: string
  ): Promise<any> {
    const state = this.getState();
    
    if (condition(state)) {
      return this.executeNode(trueNode, `Condition true: ${trueNode}`);
    } else {
      return this.executeNode(falseNode, `Condition false: ${falseNode}`);
    }
  }

  // 多分支
  async executeSwitch(
    selector: (state: any) => string,
    branches: Record<string, { description: string }>
  ): Promise<any> {
    const nextState = selector(this.getState());
    const branch = branches[nextState];
    
    if (branch) {
      return this.executeNode(nextState, branch.description);
    }
    
    throw new Error(`Unknown branch: ${nextState}`);
  }
}

// 使用
async function runConditionalWorkflow() {
  const workflow = new ConditionalWorkflowManager();

  // 节点 A
  const resultA = await workflow.executeNode("node_a", "Analyze");

  // 条件分支
  await workflow.executeConditional(
    (state) => state.variables.analysis?.securityIssues > 0,
    "security_review",  // true
    "code_review"       // false
  );

  // 多分支
  await workflow.executeSwitch(
    (state) => {
      if (state.variables.hasTests) return "run_tests";
      if (state.variables.hasLint) return "run_lint";
      return "deploy";
    },
    {
      run_tests: { description: "Run test suite" },
      run_lint: { description: "Run linting" },
      deploy: { description: "Deploy application" },
    }
  );
}
```

### 5.3 人工介入实现

```typescript
class HumanInLoopWorkflowManager extends WorkflowManager {
  // 人工介入点
  async humanIntervention(
    question: string,
    options?: string[]
  ): Promise<string> {
    // 添加人工介入消息
    this.session.agent.appendMessage({
      type: "workflow_state",
      role: "system",
      content: [{ type: "text", text: "Human intervention required" }],
      state: {
        ...this.state,
        humanQuestion: question,
        humanOptions: options,
      },
      timestamp: Date.now(),
    });

    // 等待用户输入（在实际应用中，这里会调用 UI）
    const userResponse = await this.promptUser(question, options);
    
    // 记录响应
    this.updateVariable("humanResponse", userResponse);
    
    return userResponse;
  }

  private async promptUser(question: string, options?: string[]): Promise<string> {
    // 在实际应用中，这里会调用 UI
    // 例如：return await ui.ask(question, options);
    return "user response"; // 示例
  }
}

// 使用
async function runHumanWorkflow() {
  const workflow = new HumanInLoopWorkflowManager();

  await workflow.executeNode("node_a", "Analyze");

  // 人工介入
  const response = await workflow.humanIntervention(
    "Do you want to proceed with the analysis?",
    ["Yes", "No", "Review Details"]
  );

  if (response === "Yes") {
    await workflow.executeNode("node_b", "Continue analysis");
  } else if (response === "Review Details") {
    await workflow.executeNode("node_c", "Show details");
  }
}
```

## 6. 方案对比

### 6.1 功能对比

| 功能 | 方案 1 | 方案 2 | 方案 3 | 方案 4 |
|------|--------|--------|--------|--------|
| 类型安全 | ✅ | ✅ | ⚠️ | ✅ |
| 自动持久化 | ✅ | ✅ | ❌ | ✅ |
| 易于使用 | ⚠️ | ✅ | ✅ | ⚠️ |
| 灵活性 | ⚠️ | ✅ | ✅ | ✅ |
| 性能 | ✅ | ✅ | ✅ | ⚠️ |

### 6.2 推荐方案

**方案 1（自定义消息类型）** 是最推荐的方案，原因：

1. **类型安全**：通过 TypeScript 编译时检查
2. **自动持久化**：消息自动保存到 session
3. **深度集成**：与 pi-coding-agent 深度集成
4. **可调试**：所有状态都在消息中可见
5. **可重用**：自定义消息类型可重用

## 7. 最佳实践

### 7.1 状态设计

```typescript
// 1. 明确状态结构
interface WorkflowState {
  variables: Record<string, any>;      // 变量存储
  currentNode: string;                  // 当前节点
  nextNodes: string[];                  // 下一步节点
  history: Array<{                      // 历史记录
    node: string;
    input: any;
    output: any;
    timestamp: number;
  }>;
  metadata: {                           // 元数据
    workflowId: string;
    startTime: number;
    endTime?: number;
    status: "running" | "completed" | "failed";
  };
}

// 2. 状态版本控制
interface StateMessage {
  type: "state_update";
  version: string;                      // 状态版本
  state: WorkflowState;
  timestamp: number;
}

// 3. 状态快照
function createSnapshot(state: WorkflowState): StateMessage {
  return {
    type: "state_update",
    version: "1.0",
    state: {
      ...state,
      metadata: {
        ...state.metadata,
        endTime: Date.now(),
        status: "completed",
      },
    },
    timestamp: Date.now(),
  };
}
```

### 7.2 错误处理

```typescript
async function executeNodeWithRetry(
  workflow: WorkflowManager,
  nodeName: string,
  description: string,
  maxRetries: number = 3
): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await workflow.executeNode(nodeName, description);
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      // 重试前更新状态
      workflow.updateVariable("retryCount", i + 1);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error("Max retries exceeded");
}
```

### 7.3 性能优化

```typescript
// 1. 批量状态更新
class OptimizedWorkflowManager extends WorkflowManager {
  private pendingUpdates: Array<{ key: string; value: any }> = [];

  updateVariable(key: string, value: any): void {
    this.pendingUpdates.push({ key, value });
  }

  async executeNode(nodeName: string, description: string): Promise<any> {
    // 批量添加状态消息
    for (const update of this.pendingUpdates) {
      this.addStateMessage(update.key, update.value);
    }
    this.pendingUpdates = [];

    return super.executeNode(nodeName, description);
  }
}

// 2. 状态压缩
function compressState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    history: state.history.slice(-100),  // 只保留最后 100 条
  };
}
```

## 8. 总结

### 8.1 pi-coding-agent vs LangGraph

| 维度 | pi-coding-agent | LangGraph |
|------|----------------|-----------|
| **核心理念** | 对话式 Agent | 图式工作流 |
| **状态管理** | 消息数组 | 显式 State |
| **节点概念** | 隐式 turn | 显式节点 |
| **条件分支** | 手动控制 | 内置支持 |
| **适用场景** | 单 Agent 交互 | 多 Agent 编排 |

### 8.2 实现建议

**如果需要 LangGraph 风格 State**：

1. **首选方案 1**：自定义消息类型
   - 类型安全
   - 自动持久化
   - 深度集成

2. **复杂场景**：组合方案
   - 自定义消息 + 扩展 Agent
   - 实现条件分支
   - 支持人工介入

3. **简单场景**：方案 3
   - Context Transform
   - 轻量级实现

### 8.3 未来展望

pi-coding-agent 可能的改进方向：

1. **内置 State 管理**：类似 LangGraph 的 State 类型
2. **条件边**：内置条件分支支持
3. **Subgraph**：子图支持
4. **Checkpoint**：内置持久化

### 8.4 参考资源

- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [pi-coding-agent SDK 文档](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- [Agent Types](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/types.ts)
