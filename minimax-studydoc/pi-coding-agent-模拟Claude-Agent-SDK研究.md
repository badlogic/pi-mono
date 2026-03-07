# pi-coding-agent 模拟 Claude Agent SDK 研究

## 1. Claude Agent SDK 核心架构

### 1.1 设计原则

Claude Agent SDK 的核心设计原则是**让 Claude 拥有一台电脑**，使其能够像人类程序员一样工作。

### 1.2 核心循环

Claude Agent SDK 的智能体遵循以下循环：

```
收集上下文 → 执行操作 → 验证结果 → 重复迭代
```

### 1.3 核心组件

| 组件 | 描述 |
|------|------|
| **工具 (Tools)** | 执行操作的核心，如读写文件、运行命令 |
| **子智能体 (Subagents)** | 并行化处理、上下文隔离 |
| **压缩 (Compaction)** | 自动总结旧消息，防止上下文溢出 |
| **MCP** | 与外部服务的标准化集成 |

### 1.4 工具设计模式

```typescript
// Claude Agent SDK 工具定义
{
  name: "read",
  description: "Read file contents",
  input_schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to file" }
    },
    required: ["file_path"]
  }
}
```

### 1.5 子智能体模式

```typescript
// Claude Agent SDK 子智能体
const subagent = await Agent.create({
  model: "claude-opus-4-5",
  tools: [...],
  system_prompt: "你是邮件搜索专家..."
});

// 并行调用
const results = await Promise.all([
  subagent.run("搜索上个月的邮件"),
  subagent.run("搜索上周的邮件")
]);
```

### 1.6 上下文管理

Claude Agent SDK 通过以下方式管理上下文：

1. **Agentic Search**：使用 grep、find 等工具搜索文件
2. **语义搜索**：使用向量数据库进行语义搜索
3. **Compaction**：自动压缩旧消息

## 2. pi-coding-agent SDK 架构

### 2.1 核心组件

```typescript
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";

// 创建会话
const { session } = await createAgentSession({
  model: getModel("openai", "gpt-5.1"),
  thinkingLevel: "medium",
  tools: ["read", "bash", "edit", "write"]
});

// 发送提示
const result = await session.prompt("分析这个代码库");
```

### 2.2 工具系统

```typescript
// pi-coding-agent 工具定义
{
  name: "read",
  description: "Read file contents",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string" }
    },
    required: ["file_path"]
  }
}
```

### 2.3 扩展系统

```typescript
// 注册自定义工具
pi.registerTool({
  name: "my-tool",
  description: "My custom tool",
  parameters: Type.Object({...}),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return { content: [{ type: "text", text: "result" }] };
  }
});
```

### 2.4 会话管理

```typescript
// 继续会话
const { session } = await createAgentSession({
  continueSession: true
});

// 保存会话
await session.save();

// 恢复会话
const { session } = await createAgentSession({
  sessionId: "session-id"
});
```

## 3. 两者差异对比

### 3.1 架构差异

| 特性 | Claude Agent SDK | pi-coding-agent |
|------|------------------|-----------------|
| **核心理念** | 赋予 AI 电脑能力 | 代码助手 + 通用智能体 |
| **执行模式** | 子进程 + MCP | SDK 直接调用 |
| **工具定义** | JSON Schema | TypeScript + Typebox |
| **子智能体** | 原生支持 | 扩展支持 |
| **上下文压缩** | 自动压缩 | 手动压缩 |
| **MCP 支持** | 原生支持 | 无原生支持 |

### 3.2 API 差异

```typescript
// Claude Agent SDK
const agent = await Agent.create({
  model: "claude-opus-4-5",
  tools: [...],
  system_prompt: "..."
});
const result = await agent.run("任务");

// pi-coding-agent
const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-opus-4-5")
});
const result = await session.prompt("任务");
```

### 3.3 工具差异

```typescript
// Claude Agent SDK
{
  name: "read",
  input_schema: { ... }
}

// pi-coding-agent
{
  name: "read",
  parameters: Type.Object({ ... })
}
```

### 3.4 子智能体差异

```typescript
// Claude Agent SDK - 原生支持
const subagent = await Agent.create({ ... });
const result = await subagent.run("任务");

// pi-coding-agent - 通过扩展
pi.registerTool({
  name: "subagent",
  async execute(...) {
    // 实现子智能体逻辑
  }
});
```

## 4. 模拟方案

### 4.1 方案一：直接映射（推荐）

**原理**：直接使用 pi-coding-agent SDK 模拟 Claude Agent SDK 的核心功能。

**实现**：

```typescript
// claude-agent-adapter.ts
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: any;
}

interface ClaudeAgentOptions {
  model: string;
  tools: ClaudeTool[];
  system_prompt?: string;
}

class ClaudeAgentAdapter {
  private session: any;
  private tools: ClaudeTool[];

  static async create(options: ClaudeAgentOptions): Promise<ClaudeAgentAdapter> {
    const { session } = await createAgentSession({
      model: getModel("anthropic", options.model),
      customTools: options.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: Type.Object(t.input_schema.properties),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return { content: [{ type: "text", text: "" }] };
        }
      }))
    });

    return new ClaudeAgentAdapter(session, options.tools);
  }

  async run(prompt: string): Promise<string> {
    const result = await this.session.prompt(prompt);
    return result.message;
  }
}

// 使用示例
const agent = await ClaudeAgentAdapter.create({
  model: "claude-opus-4-5-20251111",
  tools: [
    {
      name: "read",
      description: "Read file contents",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string" }
        },
        required: ["file_path"]
      }
    }
  ],
  system_prompt: "你是一个专业的开发者..."
});

const result = await agent.run("分析这个代码库");
```

**优点**：
- 实现简单
- 与 pi-coding-agent 深度集成
- 支持所有内置工具

**缺点**：
- 不完全兼容 Claude Agent SDK API
- 需要手动映射工具定义

### 4.2 方案二：完整模拟层

**原理**：创建一个完整的模拟层，完整实现 Claude Agent SDK 的 API。

**实现**：

```typescript
// claude-agent-sdk-compat.ts
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: any;
}

interface AgentOptions {
  model: string;
  tools?: ToolDefinition[];
  system_prompt?: string;
}

interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

class ClaudeAgent {
  private session: any;
  private tools: ToolDefinition[];
  private systemPrompt: string;

  static async create(options: AgentOptions): Promise<ClaudeAgent> {
    const { session } = await createAgentSession({
      model: getModel("anthropic", options.model),
      customTools: options.tools?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: Type.Object(t.input_schema.properties),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return { content: [{ type: "text", text: "" }] };
        }
      })) ?? []
    }));

    const agent = new ClaudeAgent(session, options.tools ?? [], options.system_prompt ?? "");
    
    if (options.system_prompt) {
      session.agent.setSystemPrompt(options.system_prompt);
    }

    return agent;
  }

  constructor(session: any, tools: ToolDefinition[], systemPrompt: string) {
    this.session = session;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
  }

  async run(prompt: string): Promise<string> {
    const result = await this.session.prompt(prompt);
    return result.message;
  }

  async runWithMessages(messages: Message[]): Promise<string> {
    for (const msg of messages) {
      if (msg.role === "user") {
        this.session.agent.appendMessage({
          role: "user",
          content: [{ type: "text", text: msg.content }]
        });
      }
    }
    
    const result = await this.session.prompt("");
    return result.message;
  }
}

// 子智能体
class ClaudeSubAgent extends ClaudeAgent {
  private parentSession: any;

  static async create(options: AgentOptions): Promise<ClaudeSubAgent> {
    const { session } = await createAgentSession({
      model: getModel("anthropic", options.model),
      customTools: options.tools?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: Type.Object(t.input_schema.properties),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          return { content: [{ type: "text", text: "" }] };
        }
      })) ?? [],
      sessionManager: SessionManager.inMemory()
    });

    const agent = new ClaudeSubAgent(session, options.tools ?? [], options.system_prompt ?? "", session);
    return agent;
  }

  constructor(session: any, tools: ToolDefinition[], systemPrompt: string, parentSession: any) {
    super(session, tools, systemPrompt);
    this.parentSession = parentSession;
  }
}

export { ClaudeAgent, ClaudeSubAgent, ToolDefinition, AgentOptions, Message };
```

**优点**：
- API 完全兼容 Claude Agent SDK
- 支持子智能体
- 可以复用现有代码

**缺点**：
- 实现复杂
- 需要维护大量适配代码

### 4.3 方案三：MCP 模拟

**原理**：使用 pi-coding-agent 的扩展系统模拟 MCP（Model Context Protocol）。

**实现**：

```typescript
// mcp-adapter.ts
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface MCPOptions {
  name: string;
  version: string;
  tools?: MCPTool[];
  resources?: MCPResource[];
}

class MCPAdapter {
  private tools: MCPTool[];
  private resources: MCPResource[];

  constructor(options: MCPOptions) {
    this.tools = options.tools ?? [];
    this.resources = options.resources ?? [];
  }

  async listTools(): Promise<MCPTool[]> {
    return this.tools;
  }

  async listResources(): Promise<MCPResource[]> {
    return this.resources;
  }

  toPiCodingAgentTools() {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: Type.Object(t.inputSchema.properties),
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        // MCP 工具实现
        return { content: [{ type: "text", text: "" }] };
      }
    }));
  }
}

// 使用示例
const mcpServer = new MCPAdapter({
  name: "email-server",
  version: "1.0.0",
  tools: [
    {
      name: "fetchInbox",
      description: "Fetch emails from inbox",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" }
        }
      }
    },
    {
      name: "searchEmails",
      description: "Search emails",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        }
      }
    }
  ]
});

const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-opus-4-5"),
  customTools: mcpServer.toPiCodingAgentTools()
});
```

**优点**：
- 模拟 MCP 协议
- 可以复用现有 MCP 工具
- 标准化接口

**缺点**：
- 不支持完整 MCP 协议
- 需要手动实现 MCP 语义

### 4.4 方案四：工作流模拟

**原理**：使用 pi-coding-agent 的 SKILL 和 Sub-Agent 模拟 Claude Agent SDK 的工作流。

**实现**：

```typescript
// workflow-adapter.ts
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";

interface WorkflowStep {
  name: string;
  agent: string;
  task: string;
}

interface WorkflowOptions {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

class WorkflowAgent {
  private session: any;
  private workflow: WorkflowOptions;

  static async create(options: WorkflowOptions): Promise<WorkflowAgent> {
    const { session } = await createAgentSession({
      model: getModel("anthropic", "claude-opus-4-5"),
      systemPrompt: `
# 工作流：${options.name}

${options.description}

## 工作流步骤

${options.steps.map((step, i) => `${i + 1}. ${step.name}: ${step.task}`).join("\n")}

## 执行规则

1. 按照步骤顺序执行
2. 每个步骤完成后才能进入下一个
3. 使用 {previous} 传递上下文
4. 记录每个步骤的结果
`
    });

    return new WorkflowAgent(session, options);
  }

  constructor(session: any, workflow: WorkflowOptions) {
    this.session = session;
    this.workflow = workflow;
  }

  async run(input: string): Promise<string> {
    const result = await this.session.prompt(input);
    return result.message;
  }

  async runWithSteps(input: string): Promise<WorkflowStepResult[]> {
    const results: WorkflowStepResult[] = [];
    
    for (const step of this.workflow.steps) {
      const prompt = results.length > 0 
        ? `${step.task}\n\nPrevious step result:\n${results[results.length - 1].output}`
        : step.task;
      
      const result = await this.session.prompt(prompt);
      results.push({
        step: step.name,
        output: result.message
      });
    }
    
    return results;
  }
}

interface WorkflowStepResult {
  step: string;
  output: string;
}

// 使用示例
const workflow = await WorkflowAgent.create({
  name: "代码分析工作流",
  description: "分析代码库并生成报告",
  steps: [
    { name: "分析", agent: "scout", task: "分析代码库结构" },
    { name: "设计", agent: "planner", task: "设计方案" },
    { name: "实现", agent: "worker", task: "实现功能" },
    { name: "审查", agent: "reviewer", task: "审查代码" }
  ]
});

const result = await workflow.run("分析 src 目录下的代码");
```

**优点**：
- 工作流可视化
- 可配置步骤
- 支持并行执行

**缺点**：
- 不完全模拟 Claude Agent SDK
- 需要预定义工作流

## 5. 方案对比

### 5.1 功能对比

| 特性 | 方案一 | 方案二 | 方案三 | 方案四 |
|------|--------|--------|--------|--------|
| **实现难度** | 低 | 高 | 中 | 中 |
| **API 兼容** | 部分 | 完全 | 部分 | 无 |
| **子智能体** | 无 | 有 | 无 | 有 |
| **MCP 支持** | 无 | 无 | 有 | 无 |
| **工作流** | 无 | 无 | 无 | 有 |
| **维护成本** | 低 | 高 | 中 | 中 |

### 5.2 适用场景

| 场景 | 推荐方案 |
|------|----------|
| 快速原型 | 方案一 |
| 生产环境 | 方案二 |
| MCP 集成 | 方案三 |
| 复杂工作流 | 方案四 |

### 5.3 推荐方案

**对于大多数场景，推荐方案一（直接映射）**，因为：

1. 实现简单，维护成本低
2. 与 pi-coding-agent 深度集成
3. 支持所有内置工具
4. 可以逐步扩展功能

**如果需要完整兼容 Claude Agent SDK，推荐方案二（完整模拟层）**。

## 6. 实现细节

### 6.1 工具映射

```typescript
// Claude Agent SDK 工具定义
const claudeTool = {
  name: "read",
  description: "Read file contents",
  input_schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to file" },
      offset: { type: "number", description: "Line offset" },
      limit: { type: "number", description: "Number of lines" }
    },
    required: ["file_path"]
  }
};

// pi-coding-agent 工具定义
const piTool = {
  name: "read",
  description: "Read file contents",
  parameters: Type.Object({
    file_path: Type.String(),
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number())
  })
};
```

### 6.2 子智能体实现

```typescript
// 使用 pi-coding-agent 扩展实现子智能体
function createSubAgentExtension() {
  return {
    name: "subagent",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { agent, task } = params;
      
      // 创建新的会话（隔离上下文）
      const { session } = await createAgentSession({
        model: ctx.settings.getModel(),
        sessionManager: SessionManager.inMemory()
      });
      
      // 执行任务
      const result = await session.prompt(task);
      
      return {
        content: [{ type: "text", text: result.message }]
      };
    }
  };
}
```

### 6.3 上下文压缩实现

```typescript
// 手动实现上下文压缩
async function compactContext(session: any, maxTokens: number = 100000) {
  const messages = session.agent.getMessages();
  let totalTokens = 0;
  
  for (const msg of messages) {
    totalTokens += estimateTokens(msg);
    if (totalTokens > maxTokens) {
      // 压缩旧消息
      const summary = await summarizeMessages(messages.slice(0, messages.indexOf(msg)));
      session.agent.replaceMessages([
        { role: "system", content: [{ type: "text", text: `Summary: ${summary}` }] },
        ...messages.slice(messages.indexOf(msg))
      ]);
      break;
    }
  }
}

function estimateTokens(message: any): number {
  // 简单的 token 估算
  return JSON.stringify(message).length / 4;
}

async function summarizeMessages(messages: any[]): Promise<string> {
  const { session } = await createAgentSession({
    model: getModel("anthropic", "claude-haiku-4-5")
  });
  
  const result = await session.prompt(
    `Summarize the following conversation concisely:\n\n${JSON.stringify(messages)}`
  );
  
  return result.message;
}
```

## 7. 最佳实践

### 7.1 工具设计

```typescript
// 好的工具定义示例
{
  name: "search_codebase",
  description: "Search for code patterns in the codebase",
  parameters: Type.Object({
    pattern: Type.String({ description: "Search pattern (regex supported)" }),
    path: Type.Optional(Type.String({ description: "Directory to search in" })),
    extensions: Type.Optional(Type.Array(Type.String(), { description: "File extensions to search" }))
  })
}
```

### 7.2 子智能体使用

```typescript
// 使用子智能体进行并行处理
const searchTasks = [
  "搜索认证相关代码",
  "搜索数据库相关代码",
  "搜索 API 相关代码"
];

const results = await Promise.all(
  searchTasks.map(task => subagent.run(task))
);
```

### 7.3 上下文管理

```typescript
// 定期压缩上下文
setInterval(async () => {
  await compactContext(session);
}, 10 * 60 * 1000); // 每 10 分钟
```

## 8. 参考资料

- [Claude Agent SDK 文档](https://docs.anthropic.com/en/docs/agent-sdk/overview)
- [pi-coding-agent 文档](https://github.com/badlogic/pi-mono)
- [MCP 协议](https://modelcontextprotocol.io/)
- [ Anthropic 官方博客](https://www.anthropic.com/blog)