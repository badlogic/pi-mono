# Pi Coding Agent 架构文档

## 概述

Pi 是一个最小化的终端编码框架，为 AI 驱动的编码代理提供了灵活、可扩展的框架。本文档提供了代码库结构、工作流程、事件和关键组件的全面分析，以及服务器端应用集成的详细指南。

---

## 1. 代码库结构

### 包组织

```
packages/
├── agent/              # 核心代理循环和状态管理
│   ├── src/
│   │   ├── agent.ts           # 主 Agent 类
│   │   ├── agent-loop.ts      # 代理循环实现
│   │   ├── types.ts           # 核心类型和事件
│   │   ├── index.ts
│   │   └── proxy.ts
│   └── test/
├── ai/                 # AI 提供者抽象层
│   ├── src/
│   │   ├── providers/         # LLM 提供者实现
│   │   │   ├── anthropic.ts
│   │   │   ├── openai-*.ts
│   │   │   ├── google-*.ts
│   │   │   └── ...
│   │   ├── utils/             # 工具函数
│   │   ├── api-registry.ts
│   │   ├── stream.ts          # 流抽象
│   │   ├── types.ts           # AI 类型
│   │   └── models.ts          # 模型注册表
│   └── test/
├── coding-agent/       # 主代理实现
│   ├── src/
│   │   ├── cli/               # CLI 参数解析
│   │   ├── core/              # 核心代理会话逻辑
│   │   │   ├── agent-session.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── extensions/    # 扩展系统
│   │   │   ├── tools/         # 内置工具
│   │   │   ├── session-manager.ts
│   │   │   └── ...
│   │   ├── modes/             # 不同的执行模式
│   │   │   ├── interactive/   # TUI 模式
│   │   │   ├── rpc/           # RPC 模式
│   │   │   └── print-mode.ts  # 单次执行模式
│   │   └── config.ts
│   └── examples/              # SDK 示例
└── tui/                # 终端 UI 框架
```

### 关键包

1. **@mariozechner/pi-agent-core** (`packages/agent/`)
   - 核心代理循环和状态管理
   - 事件流和消息处理
   - 工具执行基础设施

2. **@mariozechner/pi-ai** (`packages/ai/`)
   - LLM 提供者抽象层
   - 统一流接口
   - 模型注册表和管理

3. **@mariozechner/pi-coding-agent** (`packages/coding-agent/`)
   - 主代理实现
   - 会话管理
   - 扩展系统
   - 多种执行模式

---

## 2. 事件系统

### 2.1 Agent 核心事件 (`packages/agent/src/types.ts`)

#### Agent 生命周期事件
- `agent_start` - 代理循环初始化
- `agent_end` - 代理循环完成，包含最终消息

#### 轮次生命周期事件（一次 LLM 响应 + 工具调用）
- `turn_start` - 新轮次初始化
- `turn_end` - 轮次完成，包含消息和工具结果

#### 消息生命周期事件
- `message_start` - 消息开始（用户、助手或工具结果）
- `message_update` - 助手消息流式更新（文本/思考/工具调用增量）
- `message_end` - 消息完成

#### 工具执行事件
- `tool_execution_start` - 工具调用执行开始
- `tool_execution_update` - 部分/流式工具结果更新
- `tool_execution_end` - 工具执行完成

### 2.2 Agent 会话事件 (`packages/coding-agent/src/core/agent-session.ts`)

#### 自动压缩事件
- `auto_compaction_start` - 自动压缩触发（阈值或溢出）
- `auto_compaction_end` - 压缩完成，包含结果

#### 自动重试事件
- `auto_retry_start` - 重试尝试开始
- `auto_retry_end` - 重试完成

### 2.3 扩展事件 (`packages/coding-agent/src/core/extensions/types.ts`)

#### 资源发现
- `resources_discover` - 扩展可以提供额外的资源路径

#### 会话事件
- `session_start` - 初始会话加载
- `session_before_switch` - 切换会话前（可取消）
- `session_switch` - 会话切换后
- `session_before_fork` - 分叉会话前（可取消）
- `session_fork` - 会话分叉后
- `session_before_compact` - 压缩前（可取消/可自定义）
- `session_compact` - 压缩后
- `session_shutdown` - 进程退出
- `session_before_tree` - 树导航前（可取消）
- `session_tree` - 树导航后

#### Agent 事件
- `context` - LLM 调用前，可修改消息
- `before_agent_start` - 代理循环开始前
- `agent_start` - 代理循环开始
- `agent_end` - 代理循环结束
- `turn_start` - 轮次开始
- `turn_end` - 轮次结束
- `message_start` - 消息开始
- `message_update` - 消息流式更新
- `message_end` - 消息结束
- `tool_execution_start` - 工具执行开始
- `tool_execution_update` - 工具执行更新
- `tool_execution_end` - 工具执行结束
- `model_select` - 模型变更

#### 用户交互事件
- `user_bash` - 用户通过 `!` 或 `!!` 执行 bash 命令
- `input` - 用户输入接收（在代理处理前）

#### 工具事件
- `tool_call` - 工具执行前（可阻断）
- `tool_result` - 工具执行后（可修改结果）

### 2.4 事件流程图

```
用户输入
    ↓
input 事件（扩展钩子）
    ↓
before_agent_start 事件
    ↓
context 事件（扩展钩子，可修改消息）
    ↓
agent_start
    ↓
turn_start
    ↓
message_start (用户消息)
    ↓
message_end (用户消息)
    ↓
[LLM 调用]
    ↓
message_start (助手消息)
    ↓
message_update (流式文本/思考/工具调用)
    ↓
message_update ...
    ↓
message_end (助手消息)
    ↓
[有工具调用？]
    ├─ 是 → tool_execution_start
    │           ↓
    │       tool_execution_update (部分结果)
    │           ↓
    │       tool_execution_update ...
    │           ↓
    │       tool_execution_end
    │           ↓
    │       message_start (工具结果)
    │           ↓
    │       message_end (工具结果)
    │           ↓
    │       [更多工具调用？]
    │           ↓
    │       turn_end (带工具结果)
    │           ↓
    │       [检查转向消息]
    │           ↓
    │       [如果有更多工具或转向消息，循环回上一步]
    │
    └─ 否 → turn_end (无工具)
            ↓
        [检查后续消息]
            ↓
        [如果有后续消息，循环回上一步]
            ↓
        agent_end (最终消息)
```

---

## 3. 核心工作流程

### 3.1 代理循环 (`packages/agent/src/agent-loop.ts`)

代理循环是系统的核心，实现了连续交互模式：

#### 主循环结构

1. **外层循环** - 处理后续消息
   - 当排队的后续消息在代理停止后到达时继续
   - 允许多个用户消息按顺序处理

2. **内层循环** - 处理工具调用和转向消息
   - 处理助手响应和工具调用
   - 每个工具执行后检查用户中断（转向消息）

#### 关键步骤

```
1. 检查转向消息（用户在等待时输入）
2. 从 LLM 流式传输助手响应
3. 检查响应中的工具调用
4. 执行每个工具调用
5. 工具执行后检查转向消息
6. 如果存在转向消息：跳过剩余工具，注入消息
7. 如果存在后续消息：继续外层循环
8. 否则：代理停止
```

#### 转向消息 vs 后续消息

- **转向消息** (`getSteeringMessages`)：中断当前工具执行，在当前工具完成后传递
- **后续消息** (`getFollowUpMessages`)：等待代理完全完成后，再处理

### 3.2 消息转换

代理使用两步转换过程：

1. **上下文转换** (`transformContext`)
   - 处理 `AgentMessage[]`
   - 上下文窗口管理、修剪、外部上下文注入

2. **LLM 转换** (`convertToLlm`)
   - 转换 `AgentMessage[]` 为 `Message[]`
   - 过滤掉仅 UI 的消息
   - 将附件转换为 LLM 兼容格式

### 3.3 工具执行

工具按顺序执行，具有以下生命周期：

1. **开始** - `tool_execution_start` 事件
2. **更新** - `tool_execution_update` 用于部分/流式结果
3. **结束** - `tool_execution_end` 事件，包含结果
4. **结果消息** - `message_start`/`message_end` 用于工具结果

工具可以在任何时候被转向消息中断。

---

## 4. 执行模式

### 4.1 交互模式 (`packages/coding-agent/src/modes/interactive/`)

**用途**：为交互式开发提供全功能 TUI

**功能**：
- 实时流式输出
- 工具执行可视化
- 会话树导航 (`/tree`)
- 分支和分叉
- 扩展 UI 组件
- 自定义编辑器支持
- 键绑定和快捷键

**关键组件**：
- `InteractiveMode` - 主 TUI 控制器
- 消息、工具、bash 执行的组件系统
- 模型、设置、会话的选择器对话框
- 动态边框和主题支持

### 4.2 打印模式 (`packages/coding-agent/src/modes/print-mode.ts`)

**用途**：为 CI/CD 和脚本提供单次执行

**功能**：
- 文本输出模式：仅最终响应
- JSON 模式：所有事件作为 JSON 行
- 无 TUI，无扩展 UI
- 完成后退出

**用法**：
```bash
pi -p "prompt"                    # 文本输出
pi --mode json "prompt"          # JSON 事件流
pi --mode json -p "prompt"       # JSON 带文本输出
```

### 4.3 RPC 模式 (`packages/coding-agent/src/modes/rpc/`)

**用途**：为进程集成提供无头操作

**协议**：
- 命令作为 JSON 在 stdin 上
- 事件和响应作为 JSON 在 stdout 上
- 扩展 UI 请求/响应

**命令**：
- `prompt` - 发送用户消息
- `abort` - 中止当前操作
- `model` - 切换模型
- `thinking` - 设置思考级别
- `tools` - 启用/禁用工具
- `session` - 会话操作
- `extension_ui_response` - 响应扩展 UI 请求

**使用场景**：
- 嵌入到其他应用中
- 进程隔离
- 非 Node.js 集成

### 4.4 SDK 模式 (`packages/coding-agent/src/core/sdk.ts`)

**用途**：在 TypeScript 应用中以编程方式嵌入

**API**：
```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  model: getModel('anthropic', 'claude-3-5-sonnet'),
  thinkingLevel: 'high',
  tools: [readTool, bashTool, editTool, writeTool],
});

await session.prompt("当前目录中有哪些文件？");
```

**关键功能**：
- 完全控制模型、工具、设置
- 自定义会话管理
- 扩展支持
- 所有事件可通过订阅获取

---

## 5. 扩展系统

### 5.1 扩展架构

扩展是 TypeScript 模块，可以：

- 订阅代理生命周期事件
- 注册 LLM 可调用工具
- 注册命令、键盘快捷键、CLI 标志
- 通过 UI 原语与用户交互
- 修改系统提示
- 转换上下文

### 5.2 扩展 API (`packages/coding-agent/src/core/extensions/types.ts`)

#### 上下文接口

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;        // UI 方法
  hasUI: boolean;                // UI 是否可用
  cwd: string;                   // 当前工作目录
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model | undefined;
  isIdle(): boolean;
  abort(): void;
  hasPendingMessages(): boolean;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}
```

#### UI 上下文接口

```typescript
interface ExtensionUIContext {
  select(title: string, options: string[]): Promise<string>;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, placeholder?: string): Promise<string>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | Component): void;
  setFooter(factory: ComponentFactory): void;
  setHeader(factory: ComponentFactory): void;
  custom(factory: ComponentFactory): Promise<T>;
  setEditorText(text: string): void;
  getEditorText(): string;
  // ... 更多方法
}
```

### 5.3 扩展事件处理器

扩展为特定事件注册处理器：

```typescript
export default function (pi: ExtensionAPI) {
  // 订阅事件
  pi.on("agent_start", async (event, ctx) => {
    console.log("代理已启动");
  });
  
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      console.log("Bash 命令:", event.input.command);
    }
  });
  
  pi.on("input", async (event, ctx) => {
    // 转换用户输入
    return { action: "transform", text: event.text.toUpperCase() };
  });
  
  // 注册工具
  pi.registerTool({
    name: "deploy",
    label: "部署",
    description: "部署当前项目",
    parameters: schema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // 执行部署
      return { content: [{ type: "text", text: "已部署！" }], details: {} };
    }
  });
  
  // 注册命令
  pi.registerCommand("stats", {
    description: "显示统计信息",
    execute: async (args, ctx) => {
      // 命令实现
    }
  });
}
```

### 5.4 工具注册

工具可以使用自定义执行逻辑注册：

```typescript
interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;  // TypeBox schema
  execute(
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult>;
  renderCall?: (args: any, theme: Theme) => Component;
  renderResult?: (result: AgentToolResult, options: ToolRenderResultOptions, theme: Theme) => Component;
}
```

---

## 6. 服务器端应用集成

### 6.1 推荐方案：SDK 模式

对于服务器端应用，使用 SDK 模式进行编程控制：

```typescript
import {
  createAgentSession,
  getModel,
  AuthStorage,
  SessionManager,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

// 使用自定义配置创建会话
const authStorage = AuthStorage.create("/path/to/auth.json");
const modelRegistry = new ModelRegistry(authStorage);
const sessionManager = SessionManager.create("/path/to/sessions");

const { session } = await createAgentSession({
  cwd: "/path/to/project",
  authStorage,
  modelRegistry,
  sessionManager,
  model: getModel("anthropic", "claude-3-5-sonnet"),
  thinkingLevel: "high",
  tools: [readTool, bashTool, editTool, writeTool],
});

// 订阅事件
session.subscribe((event) => {
  // 为你的 UI 或日志处理事件
  if (event.type === "message_update") {
    // 流式传输文本到客户端
    emit("text_delta", event.message);
  }
  if (event.type === "tool_execution_start") {
    // 通知客户端工具执行开始
    emit("tool_start", {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
  }
});

// 发送 prompt
await session.prompt("分析这个代码库", {
  images: [imageContent],
});
```

### 6.2 服务器端应用的关键组件

#### 1. 会话管理

**选项**：
- **基于文件**：`SessionManager.create(cwd)` - 持久化到 JSONL 文件
- **内存中**：`SessionManager.inMemory()` - 短暂会话
- **自定义**：实现 `SessionManager` 接口

```typescript
// 无状态服务器使用内存中会话
const sessionManager = SessionManager.inMemory();

// 持久化会话使用基于文件
const sessionManager = SessionManager.create("/path/to/sessions");

// 自定义会话存储
class CustomSessionManager implements SessionManager {
  // 实现所需方法
}
```

#### 2. 工具控制

**内置工具**：
```typescript
import {
  readTool,      // 读取文件
  writeTool,     // 写入文件
  editTool,      // 编辑文件（基于 diff）
  bashTool,      // 执行 bash 命令
  grepTool,      // grep 文件
  findTool,      // 查找文件
  lsTool,        // 列出目录
} from "@mariozechner/pi-coding-agent";

// 使用特定工具
const tools = [readTool, bashTool, editTool];

// 或使用预设
const tools = codingTools;    // [read, bash, edit, write]
const tools = readOnlyTools;  // [read, grep, find, ls]
const tools = allTools;       // 所有内置工具
```

**自定义工具**：
```typescript
const customTool: ToolDefinition = {
  name: "my_tool",
  label: "我的工具",
  description: "执行某些有用的操作",
  parameters: Type.Object({ param1: Type.String() }),
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    // 你的自定义逻辑
    return {
      content: [{ type: "text", text: "结果" }],
      details: {},
    };
  },
};
```

#### 3. 事件处理

**服务器应用的关键事件**：

```typescript
session.subscribe((event) => {
  switch (event.type) {
    // 消息流式传输
    case "message_update":
      // 流式传输文本到客户端
      break;
    
    // 工具执行
    case "tool_execution_start":
      // 通知工具执行开始
      break;
    
    case "tool_execution_end":
      // 通知工具执行结果
      break;
    
    // 错误处理
    case "agent_end":
      if (event.messages.at(-1)?.stopReason === "error") {
        // 处理错误
      }
      break;
  }
});
```

#### 4. 模型配置

```typescript
import { getModel, ModelRegistry } from "@mariozechner/pi-ai";

// 创建模型注册表
const registry = new ModelRegistry(authStorage);

// 通过提供者和 ID 获取模型
const model = getModel("anthropic", "claude-3-5-sonnet");

// 或使用自定义模型
const customModel: Model<"anthropic"> = {
  id: "claude-3-5-sonnet",
  name: "Claude 3.5 Sonnet",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  contextWindow: 200000,
  maxTokens: 8192,
};

// 注册自定义提供者
registry.registerProvider("my-provider", {
  apiKeyEnv: "MY_API_KEY",
  baseUrlEnv: "MY_BASE_URL",
  modelId: "my-model",
});
```

#### 5. 思考级别控制

```typescript
// 设置思考级别
session.setThinkingLevel("high");  // off, minimal, low, medium, high, xhigh

// 或通过会话选项
const { session } = await createAgentSession({
  thinkingLevel: "high",
});
```

### 6.3 进程集成的 RPC 模式

对于非 Node.js 集成或进程隔离：

```typescript
// 以 RPC 模式启动 pi
const process = spawn("pi", ["--mode", "rpc"], {
  stdio: ["pipe", "pipe", "pipe"],
});

// 发送命令
process.stdin.write(JSON.stringify({
  type: "prompt",
  id: "123",
  text: "分析这个代码库",
}) + "\n");

// 监听事件
process.stdout.on("data", (data) => {
  const event = JSON.parse(data.toString());
  if (event.type === "response" && event.command === "prompt") {
    // 处理响应
  }
});
```

### 6.4 服务器应用的扩展系统

扩展可以添加自定义功能：

```typescript
// 创建扩展
function myExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      // 记录所有 bash 命令
      logger.info("Bash 命令", { command: event.input.command });
    }
  });
  
  pi.on("input", async (event, ctx) => {
    // 添加自定义头或修改输入
    return { action: "continue" };
  });
  
  pi.registerTool({
    name: "custom_tool",
    label: "自定义工具",
    description: "自定义功能",
    parameters: Type.Object({}),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // 你的自定义逻辑
      return { content: [{ type: "text", text: "结果" }], details: {} };
    },
  });
}

// 加载扩展
const { session } = await createAgentSession({
  customTools: [customToolDefinition],
  // 或从文件加载
  resourceLoader: new DefaultResourceLoader({
    cwd,
    extensions: [myExtension],
  }),
});
```

---

## 7. 会话管理

### 7.1 会话类型

**基于文件的会话**：
```typescript
// 持久化到 JSONL 文件
const sessionManager = SessionManager.create("/path/to/sessions");
// 会话文件: /path/to/sessions/.pi/session.jsonl
```

**内存中会话**：
```typescript
// 短暂会话，不持久化
const sessionManager = SessionManager.inMemory();
```

**自定义存储**：
```typescript
class CustomSessionManager implements SessionManager {
  getSession(): SessionContext { /* ... */ }
  appendMessage(message: Message): void { /* ... */ }
  appendCustomMessageEntry(...): void { /* ... */ }
  navigateTree(targetId: string): Promise<{ cancelled: boolean }> { /* ... */ }
  fork(entryId: string): Promise<{ cancelled: boolean; newSessionFile: string }> { /* ... */ }
  getSessionId(): string { /* ... */ }
  getBranch(): SessionEntry[] { /* ... */ }
}
```

### 7.2 会话分支

```typescript
// 分叉会话
const { cancelled, newSessionFile } = await sessionManager.fork(entryId);

// 导航到分支
await sessionManager.navigateTree(targetId);
```

### 7.3 会话压缩

```typescript
// 自动压缩
sessionManager.autoCompact();

// 手动压缩
sessionManager.compact(options);
```

---

## 8. 工具系统

### 8.1 内置工具

```typescript
import {
  readTool,      // 读取文件
  writeTool,     // 写入文件
  editTool,      // 编辑文件（基于 diff）
  bashTool,      // 执行 bash 命令
  grepTool,      // grep 文件
  findTool,      // 查找文件
  lsTool,        // 列出目录
} from "@mariozechner/pi-coding-agent";
```

### 8.2 工具执行流程

```
tool_execution_start
  ↓
[工具执行]
  ↓
tool_execution_update (部分结果)
  ↓
tool_execution_update ...
  ↓
tool_execution_end (最终结果)
  ↓
message_start (工具结果)
  ↓
message_end (工具结果)
```

### 8.3 工具结果类型

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // LLM 的内容
  details: T;                                // UI/显示的详细信息
}
```

---

## 9. AI 提供者抽象层

### 9.1 支持的提供者

**内置提供者**：
- Anthropic (Claude)
- OpenAI (GPT-4, GPT-5)
- Google (Gemini)
- Amazon Bedrock
- Azure OpenAI
- GitHub Copilot
- 更多...

### 9.2 提供者 API

```typescript
// 从任何提供者流式传输
import { streamSimple, getModel } from "@mariozechner/pi-ai";

const model = getModel("anthropic", "claude-3-5-sonnet");
const stream = streamSimple(model, context, {
  apiKey: "sk-...",
  reasoning: "high",
});

for await (const event of stream) {
  switch (event.type) {
    case "text_delta":
      console.log(event.delta);
      break;
    case "toolcall_end":
      console.log(event.toolCall);
      break;
  }
}
```

### 9.3 自定义提供者

```typescript
// 注册自定义提供者
import { registerApiProvider } from "@mariozechner/pi-ai";

registerApiProvider("custom", {
  stream: (model, context, options) => {
    // 你的流式实现
    return assistantMessageEventStream;
  },
  streamSimple: (model, context, options) => {
    // 简单流实现
    return assistantMessageEventStream;
  },
});
```

---

## 10. 服务器端应用的关键考虑因素

### 10.1 状态管理

**选项**：
1. **内存中** - 无状态，短暂
2. **基于文件** - 持久化，共享
3. **自定义存储** - 数据库、Redis 等

### 10.2 并发

- 每个会话有自己的代理实例
- 会话是独立的
- 为并发请求使用单独的会话

### 10.3 错误处理

```typescript
session.subscribe((event) => {
  if (event.type === "agent_end") {
    const lastMessage = event.messages.at(-1);
    if (lastMessage?.stopReason === "error") {
      console.error("代理错误:", lastMessage.errorMessage);
    }
  }
});
```

### 10.4 资源清理

```typescript
// 中止正在进行的操作
session.abort();

// 优雅关闭
session.shutdown();
```

### 10.5 性能优化

1. **会话缓存** - 为相关请求重用会话
2. **工具选择** - 仅启用需要的工具
3. **思考级别** - 对简单任务使用较低级别
4. **上下文压缩** - 自动压缩长会话

---

## 11. 事件参考摘要

### Agent 核心事件

| 事件 | 描述 | 触发时机 |
|------|------|----------|
| `agent_start` | 代理循环开始 | 第一轮之前 |
| `agent_end` | 代理循环结束 | 所有轮次完成后 |
| `turn_start` | 新轮次开始 | 每次 LLM 调用前 |
| `turn_end` | 轮次结束 | 消息 + 工具后 |
| `message_start` | 消息开始 | 每个消息 |
| `message_update` | 消息更新 | 助手流式传输期间 |
| `message_end` | 消息完成 | 消息完全接收后 |
| `tool_execution_start` | 工具开始 | 工具执行前 |
| `tool_execution_update` | 工具更新 | 工具执行期间 |
| `tool_execution_end` | 工具完成 | 工具完成后 |

### 扩展事件

| 事件 | 描述 | 可修改？ |
|------|------|----------|
| `context` | LLM 调用前 | 是（消息） |
| `before_agent_start` | 代理循环前 | 是（系统提示） |
| `input` | 用户输入接收 | 是（转换） |
| `tool_call` | 工具执行前 | 是（阻断） |
| `tool_result` | 工具执行后 | 是（修改结果） |
| `model_select` | 模型变更 | 否 |
| `session_*` | 会话操作 | 部分可取消 |

### 会话事件

| 事件 | 描述 | 可取消？ |
|------|------|----------|
| `session_before_switch` | 会话切换前 | 是 |
| `session_before_fork` | 分叉前 | 是 |
| `session_before_compact` | 压缩前 | 是/可自定义 |
| `session_before_tree` | 树导航前 | 是 |

---

## 12. 架构图

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户/客户端                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   扩展系统                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 事件     │ │ 工具     │ │ 命令     │ │ 快捷键   │       │
│  │ 处理器   │ │ 注册     │ │ 注册     │ │ 注册     │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   Agent 会话                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Agent 循环 (packages/agent)                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ Agent 状态  │  │ 事件总线    │  │ 工具执行    │   │   │
│  │  │ 消息        │  │ 监听器      │  │ 生命周期    │   │   │
│  │  │ 工具        │  │             │  │             │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  会话管理器 (packages/coding-agent)                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ 文件存储    │  │ 分支        │  │ 压缩        │   │   │
│  │  │ 树          │  │ 分叉        │  │ 自动/手动   │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   AI 提供者层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Anthropic│ │ OpenAI   │ │ Google   │ │ 自定义   │       │
│  │ 提供者   │ │ 提供者   │ │ 提供者   │ │ 提供者   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM API                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Claude   │ │ GPT-4    │ │ Gemini   │ │ 其他     │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户输入
    ↓
[扩展: input 事件]
    ↓
[AgentSession: before_agent_start]
    ↓
[AgentSession: context 事件]
    ↓
[Agent: transformContext]
    ↓
[Agent: convertToLlm]
    ↓
[AI: streamSimple]
    ↓
[LLM API]
    ↓
[AI: 流解析]
    ↓
[Agent: 消息流式传输]
    ↓
[AgentSession: 消息事件]
    ↓
[Agent: 有工具调用？]
    ├─ 是 → [Agent: executeToolCalls]
    │           ↓
    │       [扩展: tool_call 事件]
    │           ↓
    │       [工具: execute]
    │           ↓
    │       [Agent: tool_execution 事件]
    │           ↓
    │       [AgentSession: tool_result 事件]
    │           ↓
    │       [Agent: 更多工具？]
    │
    └─ 否 → [Agent: turn_end]
              ↓
          [AgentSession: turn_end 事件]
              ↓
          [Agent: 后续？]
```

---

## 13. 服务器端集成最佳实践

### 13.1 会话管理

- 对于无状态、短暂操作，使用**内存中会话**
- 对于持久化、长期工作流，使用**基于文件的会话**
- 对于分布式系统或数据库支持的应用，使用**自定义存储**

### 13.2 工具选择

- 仅启用必要的工具以减少 token 使用
- 对于只读操作，使用 `readOnlyTools`
- 为领域特定功能注册自定义工具

### 13.3 事件处理

- 订阅 `message_update` 进行流式文本传输
- 订阅 `tool_execution_*` 进行工具监控
- 处理 `agent_end` 进行错误检查

### 13.4 错误恢复

- 为暂时性错误实现重试逻辑
- 使用 `session.abort()` 取消操作
- 记录工具执行进行调试

---

## 14. 完整示例

### 14.1 基础 SDK 使用

```typescript
import {
  createAgentSession,
  getModel,
  AuthStorage,
  SessionManager,
  codingTools,
} from "@mariozechner/pi-coding-agent";

async function basicExample() {
  const authStorage = AuthStorage.create();
  
  const { session } = await createAgentSession({
    authStorage,
    model: getModel("anthropic", "claude-3-5-sonnet"),
    tools: codingTools,
    sessionManager: SessionManager.inMemory(),
  });

  // 订阅事件
  session.subscribe((event) => {
    if (event.type === "message_update") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  // 发送 prompt
  await session.prompt("列出当前目录的文件");
  
  // 等待完成
  await session.waitForIdle();
}
```

### 14.2 并发请求处理

```typescript
class AgentService {
  private sessions: Map<string, AgentSession> = new Map();

  async handleRequest(prompt: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session = await this.createSession();
    this.sessions.set(sessionId, session);

    try {
      let output = "";
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update") {
          output += event.assistantMessageEvent.delta;
        }
      });

      await session.prompt(prompt);
      await session.waitForIdle();
      unsubscribe();

      return output;
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async handleConcurrent(requests: { id: string; prompt: string }[]) {
    const promises = requests.map(req => this.handleRequest(req.prompt));
    return Promise.all(promises);
  }
}
```

### 14.3 自定义工具

```typescript
import { ToolDefinition, Type } from "@mariozechner/pi-coding-agent";

const deployTool: ToolDefinition = {
  name: "deploy",
  label: "部署",
  description: "部署应用程序",
  parameters: Type.Object({
    environment: Type.String({
      description: "部署环境",
      enum: ["development", "staging", "production"],
    }),
    version: Type.String({ description: "版本号" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    onUpdate?.({ type: "text_delta", delta: "开始部署..." });
    
    // 执行部署逻辑
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    onUpdate?.({ type: "text_delta", delta: "部署完成！" });
    
    return {
      content: [{ type: "text", text: `已部署到 ${params.environment} 环境` }],
      details: { environment: params.environment, version: params.version },
    };
  },
};
```

### 14.4 扩展开发

```typescript
import { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function loggingExtension(pi: ExtensionAPI) {
  // 记录所有工具调用
  pi.on("tool_call", async (event, ctx) => {
    console.log(`工具调用: ${event.toolName}`);
    console.log(`参数:`, event.input);
  });

  // 记录所有消息
  pi.on("message_start", async (event, ctx) => {
    console.log(`消息开始: ${event.message.role}`);
  });

  // 记录代理生命周期
  pi.on("agent_start", async (event, ctx) => {
    console.log("代理开始");
  });

  pi.on("agent_end", async (event, ctx) => {
    console.log("代理结束");
  });
}
```

---

## 15. 性能优化

### 15.1 会话优化

- **重用会话** - 为相关请求重用会话
- **压缩上下文** - 定期压缩长会话
- **修剪历史** - 移除旧消息

### 15.2 工具优化

- **最小化工具集** - 仅启用必要的工具
- **缓存结果** - 缓存重复查询
- **异步执行** - 并行执行独立工具

### 15.3 模型优化

- **选择合适模型** - 根据任务选择模型
- **思考级别** - 对简单任务使用较低级别
- **上下文窗口** - 管理上下文大小

---

## 16. 错误处理

### 16.1 常见错误

```typescript
session.subscribe((event) => {
  if (event.type === "agent_end") {
    const lastMessage = event.messages.at(-1);
    
    if (lastMessage?.stopReason === "error") {
      console.error("代理错误:", lastMessage.errorMessage);
      console.error("错误详情:", lastMessage.errorDetails);
    }
  }
});
```

### 16.2 错误恢复

```typescript
async function executeWithRetry(
  session: AgentSession,
  prompt: string,
  maxRetries: number = 3
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await session.prompt(prompt);
      await session.waitForIdle();
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

---

## 17. 安全考虑

### 17.1 工具安全

- **限制 bash 工具** - 限制命令执行
- **文件访问控制** - 限制文件读写
- **环境变量** - 安全存储 API 密钥

### 17.2 输入验证

- **验证用户输入** - 防止注入攻击
- **工具参数验证** - 验证工具参数
- **超时控制** - 防止无限循环

### 17.3 资源限制

- **并发限制** - 限制并发会话数
- **超时限制** - 限制操作时间
- **内存限制** - 限制内存使用

---

## 18. 监控和日志

### 18.1 关键指标

- **响应时间** - 从 prompt 到完成的时间
- **token 使用** - 输入/输出 token 数量
- **成本** - API 调用成本
- **错误率** - 错误发生的频率

### 18.2 日志记录

```typescript
function loggingExtension(pi: ExtensionAPI) {
  pi.on("tool_execution_start", async (event, ctx) => {
    console.time(`tool_${event.toolCallId}`);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    console.timeEnd(`tool_${event.toolCallId}`);
  });

  pi.on("agent_end", async (event, ctx) => {
    const lastMessage = event.messages.at(-1);
    if (lastMessage?.usage) {
      console.log("使用统计:", lastMessage.usage);
    }
  });
}
```

---

## 19. 调试技巧

### 19.1 启用详细日志

```typescript
session.subscribe((event) => {
  console.log("事件:", event.type);
});
```

### 19.2 检查会话状态

```typescript
const branch = sessionManager.getBranch();
console.log("分支:", branch);
```

### 19.3 调试工具执行

```typescript
pi.on("tool_execution_update", async (event, ctx) => {
  console.log("工具更新:", event.update);
});
```

---

## 20. 总结

### 20.1 关键要点

- **SDK 模式** - 服务器端应用的推荐方式
- **事件系统** - 完整的事件流
- **扩展系统** - 强大的自定义能力
- **工具系统** - 灵活的工具注册
- **会话管理** - 多种会话管理选项

### 20.2 最佳实践

- 使用内存中会话进行无状态操作
- 订阅事件进行流式传输和监控
- 限制并发以防止资源耗尽
- 实现错误恢复和重试逻辑
- 记录工具执行进行调试

### 20.3 下一步

- 实现自定义工具
- 开发扩展
- 集成到你的应用
- 性能优化
- 监控和日志

---

## 21. 参考资源

- `packages/coding-agent/examples/sdk/` - SDK 使用示例
- `packages/coding-agent/examples/extensions/` - 扩展示例
- `packages/agent/src/agent.ts` - Agent 核心实现
- `packages/coding-agent/src/core/agent-session.ts` - AgentSession 实现
- `packages/coding-agent/src/core/sdk.ts` - SDK 入口