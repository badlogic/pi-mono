# Pi Coding Agent - Subagent 并行执行与 Server-Side App 集成指南

## 目录

1. [Subagent 并行执行能力分析](#1-subagent-并行执行能力分析)
2. [AgentService vs Spawn 方案对比](#2-agentservice-vs-spawn-方案对比)
3. [Server-Side App 关键组件](#3-server-side-app-关键组件)
4. [并行执行实现方案](#4-并行执行实现方案)
5. [最佳实践与示例](#5-最佳实践与示例)

---

## 1. Subagent 并行执行能力分析

### 1.1 当前 Subagent 实现方式

查看 `packages/coding-agent/examples/extensions/subagent/index.ts` 的实现：

**核心机制**：
```typescript
// 使用 spawn 启动独立的 pi 进程
const proc = spawn("pi", args, { 
  cwd: cwd ?? defaultCwd, 
  stdio: ["ignore", "pipe", "pipe"] 
});
```

**三种执行模式**：

1. **Single 模式** - 单个 agent 执行单个任务
2. **Parallel 模式** - 多个 agent 并行执行
3. **Chain 模式** - 串行执行，前一个的输出作为后一个的输入

### 1.2 Parallel 模式的并行实现

```typescript
// 并行执行的核心代码
const results = await mapWithConcurrencyLimit(
  params.tasks, 
  MAX_CONCURRENCY,  // 默认 4
  async (t, index) => {
    const result = await runSingleAgent(...);
    return result;
  }
);
```

**关键参数**：
- `MAX_PARALLEL_TASKS = 8` - 最多 8 个并行任务
- `MAX_CONCURRENCY = 4` - 最多 4 个并发执行
- `mapWithConcurrencyLimit` - 并发限制工具函数

### 1.3 并行执行能力评估

**✅ 支持并行执行**：
- 通过 `spawn("pi")` 启动独立进程
- 每个子 agent 有独立的 context window
- 内部使用 `mapWithConcurrencyLimit` 控制并发数

**⚠️ 限制**：
- 每个子 agent 是独立进程（spawn）
- 并发数限制为 4
- 最多 8 个并行任务
- 无法在同一个 Agent 实例内并行

### 1.4 并行执行流程图

```
Main Agent (pi process 1)
    ↓
subagent tool (parallel mode)
    ↓
┌─────────────────────────────────────────────────────┐
│ mapWithConcurrencyLimit (max 4 concurrent)         │
│                                                     │
│ Task 1: spawn("pi") → Agent A → Result 1          │
│ Task 2: spawn("pi") → Agent B → Result 2          │
│ Task 3: spawn("pi") → Agent C → Result 3          │
│ Task 4: spawn("pi") → Agent D → Result 4          │
│ Task 5-8: queued, wait for slots                  │
└─────────────────────────────────────────────────────┘
    ↓
Collect all results
    ↓
Return to main agent
```

---

## 2. AgentService vs Spawn 方案对比

### 2.1 Spawn 方案（当前实现）

**优点**：
- ✅ 完全隔离的 context window
- ✅ 独立的模型选择和配置
- ✅ 独立的工具集
- ✅ 独立的生命周期管理
- ✅ 崩溃隔离（一个子 agent 崩溃不影响 others）

**缺点**：
- ❌ 进程开销大（每个子 agent 启动新进程）
- ❌ 启动延迟高
- ❌ 资源消耗大（内存、CPU）
- ❌ 无法共享状态
- ❌ 进程间通信开销

### 2.2 AgentService 方案（推荐）

**架构**：
```
Server App
    ↓
AgentService (in-memory)
    ├─ Session 1: Agent Instance 1
    ├─ Session 2: Agent Instance 2
    ├─ Session 3: Agent Instance 3
    └─ Session N: Agent Instance N
```

**优点**：
- ✅ 无进程开销（内存中运行）
- ✅ 启动延迟极低（微秒级）
- ✅ 资源消耗小（共享进程）
- ✅ 可共享状态（如果需要）
- ✅ 更好的控制和监控
- ✅ 支持真正的并行（V8 线程池）

**缺点**：
- ⚠️ 共享 context window（如果使用同一个 session）
- ⚠️ 需要手动管理隔离
- ⚠️ 一个 agent 崩溃可能影响 others（需错误隔离）

### 2.3 方案对比表

| 特性 | Spawn 方案 | AgentService 方案 |
|------|-----------|------------------|
| 启动延迟 | 高（100-500ms） | 低（<1ms） |
| 内存开销 | 高（每个进程 ~50MB） | 低（共享进程） |
| CPU 开销 | 高（进程创建） | 低（线程复用） |
| Context 隔离 | 完全隔离 | 需手动管理 |
| 并发控制 | 自动（spawn） | 手动（Promise.all） |
| 错误隔离 | 自动 | 需 try-catch |
| 状态共享 | 不支持 | 可支持 |
| 监控难度 | 高（多进程） | 低（单进程） |
| 扩展性 | 低（进程限制） | 高（内存限制） |

---

## 3. Server-Side App 关键组件

### 3.1 核心组件架构

```
Server App
    ↓
┌─────────────────────────────────────────────────────┐
│  AgentService (Your Implementation)                │
│  ├─ SessionPool: SessionManager[]                  │
│  ├─ AgentPool: Agent[]                             │
│  ├─ ToolRegistry: ToolDefinition[]                 │
│  └─ ModelRegistry: ModelRegistry                   │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  @mariozechner/pi-coding-agent SDK                 │
│  ├─ createAgentSession()                           │
│  ├─ Agent class                                    │
│  ├─ AgentSession class                             │
│  └─ Event System                                   │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  @mariozechner/pi-ai                               │
│  ├─ streamSimple()                                 │
│  ├─ Model Registry                                 │
│  └─ Provider Abstraction                           │
└─────────────────────────────────────────────────────┘
```

### 3.2 关键组件详解

#### 3.2.1 AgentSession

**作用**：会话管理器，封装 Agent 实例

**关键方法**：
```typescript
class AgentSession {
  // 发送 prompt
  prompt(message: string, options?: PromptOptions): Promise<void>
  
  // 事件订阅
  subscribe(listener: AgentSessionEventListener): void
  
  // 工具管理
  setActiveTools(toolNames: string[]): void
  getActiveTools(): string[]
  
  // 模型管理
  setModel(model: Model<any>): void
  setThinkingLevel(level: ThinkingLevel): void
  
  // 中断
  abort(): void
  
  // 等待空闲
  waitForIdle(): Promise<void>
}
```

#### 3.2.2 Agent

**作用**：核心 agent 实例，执行 agent loop

**关键方法**：
```typescript
class Agent {
  // 订阅事件
  subscribe(fn: (e: AgentEvent) => void): () => void
  
  // 发送 prompt
  prompt(input: string | AgentMessage, images?: ImageContent[]): Promise<void>
  
  // 队列消息
  steer(message: AgentMessage): void      // 立即中断
  followUp(message: AgentMessage): void   // 等待完成
  
  // 状态管理
  abort(): void
  reset(): void
  replaceMessages(messages: AgentMessage[]): void
  
  // 等待空闲
  waitForIdle(): Promise<void>
}
```

#### 3.2.3 SessionManager

**作用**：会话持久化和管理

**关键方法**：
```typescript
class SessionManager {
  // 创建会话
  static create(cwd: string): SessionManager
  static inMemory(): SessionManager
  
  // 会话操作
  getSession(): SessionContext
  appendMessage(message: Message): void
  appendCustomMessageEntry(...)
  
  // 分支操作
  navigateTree(targetId: string): Promise<{ cancelled: boolean }>
  fork(entryId: string): Promise<{ cancelled: boolean; newSessionFile: string }>
  
  // 会话信息
  getSessionId(): string
  getBranch(): SessionEntry[]
}
```

### 3.3 事件系统

**关键事件**：

```typescript
// Agent Lifecycle
"agent_start"      // Agent 开始
"agent_end"        // Agent 完成

// Turn Lifecycle
"turn_start"       // 新轮次开始
"turn_end"         // 轮次完成

// Message Lifecycle
"message_start"    // 消息开始
"message_update"   // 消息更新（流式）
"message_end"      // 消息结束

// Tool Lifecycle
"tool_execution_start"    // 工具执行开始
"tool_execution_update"   // 工具执行更新
"tool_execution_end"      // 工具执行结束
```

**事件流示例**：
```
agent_start
  ↓
turn_start
  ↓
message_start (user)
  ↓
message_end (user)
  ↓
[LLM Call]
  ↓
message_start (assistant)
  ↓
message_update (text_delta: "Hello")
  ↓
message_update (text_delta: " world")
  ↓
message_end (assistant)
  ↓
turn_end
  ↓
agent_end
```

### 3.4 工具系统

**内置工具**：
```typescript
import {
  readTool,      // 读文件
  writeTool,     // 写文件
  editTool,      // 编辑文件
  bashTool,      // 执行 bash
  grepTool,      // grep
  findTool,      // 查找文件
  lsTool,        // 列目录
} from "@mariozechner/pi-coding-agent";
```

**工具定义**：
```typescript
interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;  // TypeBox schema
  execute(
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback,
    ctx: ExtensionContext
  ): Promise<AgentToolResult>;
}
```

---

## 4. 并行执行实现方案

### 4.1 方案一：多 Agent 实例并行（推荐）

```typescript
class AgentService {
  private sessions: Map<string, AgentSession> = new Map();
  private agents: Map<string, Agent> = new Map();

  async executeParallel(tasks: Task[]): Promise<Result[]> {
    // 为每个任务创建独立的 agent 实例
    const promises = tasks.map(async (task) => {
      const sessionId = crypto.randomUUID();
      
      // 创建独立 session
      const session = await this.createSession({
        model: task.model,
        tools: task.tools,
        thinkingLevel: task.thinkingLevel,
      });
      
      this.sessions.set(sessionId, session);
      
      try {
        // 发送 prompt
        await session.prompt(task.prompt);
        
        // 等待完成
        await session.waitForIdle();
        
        // 获取结果
        const result = this.extractResult(session);
        
        return { sessionId, success: true, result };
      } catch (error) {
        return { sessionId, success: false, error };
      } finally {
        // 清理
        this.sessions.delete(sessionId);
      }
    });
    
    // 并行执行
    return Promise.all(promises);
  }
}
```

### 4.2 方案二：共享 Session 并行（需谨慎）

```typescript
// 注意：同一个 session 的 messages 是共享的
// 需要手动管理 message parentId 构建树结构

async executeParallelSharedSession(tasks: Task[]): Promise<Result[]> {
  const results: Result[] = [];
  
  for (const task of tasks) {
    // 创建独立的 message branch
    const branchId = crypto.randomUUID();
    
    // 发送 prompt（作为独立分支）
    await this.session.prompt(task.prompt);
    
    // 等待完成
    await this.session.waitForIdle();
    
    // 获取结果
    const result = this.extractResult(this.session);
    results.push(result);
  }
  
  return results;
}
```

### 4.3 方案三：并发限制并行（生产级）

```typescript
class ConcurrentAgentService {
  private sessionPool: Map<string, AgentSession> = new Map();
  private activeCount = 0;
  private maxConcurrent = 10;  // 最大并发数

  async executeWithConcurrencyLimit(
    tasks: Task[], 
    concurrency: number = this.maxConcurrent
  ): Promise<Result[]> {
    const results: Result[] = [];
    
    // 并发限制队列
    const queue = [...tasks];
    const active: Promise<void>[] = [];
    
    while (queue.length > 0 || active.length > 0) {
      // 启动新任务
      while (active.length < concurrency && queue.length > 0) {
        const task = queue.shift()!;
        const promise = this.executeTask(task).then((result) => {
          results.push(result);
          this.activeCount--;
        });
        active.push(promise);
        this.activeCount++;
      }
      
      // 等待至少一个任务完成
      if (active.length > 0) {
        await Promise.race(active);
        // 移除已完成的任务
        active.splice(
          active.findIndex((p) => p.fulfilled),
          1
        );
      }
    }
    
    return results;
  }

  private async executeTask(task: Task): Promise<Result> {
    const sessionId = crypto.randomUUID();
    const session = await this.createSession({
      model: task.model,
      tools: task.tools,
    });
    
    this.sessionPool.set(sessionId, session);
    
    try {
      await session.prompt(task.prompt);
      await session.waitForIdle();
      
      return {
        sessionId,
        success: true,
        result: this.extractResult(session),
      };
    } catch (error) {
      return { sessionId, success: false, error };
    } finally {
      this.sessionPool.delete(sessionId);
    }
  }
}
```

### 4.4 完整实现示例

```typescript
import {
  createAgentSession,
  getModel,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  codingTools,
} from "@mariozechner/pi-coding-agent";

export interface Task {
  id: string;
  prompt: string;
  model?: string;
  tools?: string[];
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

export interface Result {
  taskId: string;
  success: boolean;
  output?: string;
  error?: string;
  usage?: {
    input: number;
    output: number;
    total: number;
    cost: number;
  };
}

export class AgentService {
  private sessions: Map<string, AgentSession> = new Map();
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;

  constructor() {
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  async createSession(options?: {
    model?: string;
    tools?: string[];
    thinkingLevel?: string;
  }): Promise<AgentSession> {
    const model = options?.model 
      ? this.modelRegistry.find("anthropic", options.model) ?? getModel("anthropic", "claude-sonnet-4-20250514")
      : getModel("anthropic", "claude-sonnet-4-20250514");

    const tools = options?.tools
      ? options.tools.map((name) => codingTools.find((t) => t.name === name)).filter(Boolean)
      : codingTools;

    const { session } = await createAgentSession({
      model,
      tools,
      thinkingLevel: (options?.thinkingLevel as any) ?? "medium",
      sessionManager: SessionManager.inMemory(),  // in-memory for stateless
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    return session;
  }

  async execute(task: Task): Promise<Result> {
    const sessionId = crypto.randomUUID();
    const session = await this.createSession({
      model: task.model,
      tools: task.tools,
      thinkingLevel: task.thinkingLevel,
    });

    this.sessions.set(sessionId, session);

    try {
      // 订阅事件以捕获输出
      let output = "";
      let usage: Result["usage"] = undefined;

      const unsubscribe = session.subscribe((event) => {
        // 捕获文本输出
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          output += event.assistantMessageEvent.delta;
        }

        // 捕获使用统计
        if (event.type === "agent_end") {
          const lastMessage = event.messages.at(-1);
          if (lastMessage?.role === "assistant" && lastMessage.usage) {
            usage = {
              input: lastMessage.usage.input,
              output: lastMessage.usage.output,
              total: lastMessage.usage.totalTokens,
              cost: lastMessage.usage.cost.total,
            };
          }
        }
      });

      // 发送 prompt
      await session.prompt(task.prompt);

      // 等待完成
      await session.waitForIdle();

      // 清理订阅
      unsubscribe();

      return {
        taskId: task.id,
        success: true,
        output,
        usage,
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async executeParallel(tasks: Task[], maxConcurrent: number = 10): Promise<Result[]> {
    const results: Result[] = [];
    const queue = [...tasks];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      // 启动新任务
      while (active.length < maxConcurrent && queue.length > 0) {
        const task = queue.shift()!;
        const promise = this.execute(task).then((result) => {
          results.push(result);
        });
        active.push(promise);
      }

      // 等待至少一个任务完成
      if (active.length > 0) {
        await Promise.race(active);
        // 移除已完成的任务
        for (let i = 0; i < active.length; i++) {
          if (active[i].fulfilled) {
            active.splice(i, 1);
            break;
          }
        }
      }
    }

    return results;
  }

  async executeWithStreaming(
    task: Task,
    onText: (text: string) => void,
    onUsage?: (usage: Result["usage"]) => void
  ): Promise<Result> {
    const sessionId = crypto.randomUUID();
    const session = await this.createSession();

    this.sessions.set(sessionId, session);

    try {
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          onText(event.assistantMessageEvent.delta);
        }

        if (event.type === "agent_end") {
          const lastMessage = event.messages.at(-1);
          if (lastMessage?.role === "assistant" && lastMessage.usage) {
            onUsage?.({
              input: lastMessage.usage.input,
              output: lastMessage.usage.output,
              total: lastMessage.usage.totalTokens,
              cost: lastMessage.usage.cost.total,
            });
          }
        }
      });

      await session.prompt(task.prompt);
      await session.waitForIdle();

      unsubscribe();

      return { taskId: task.id, success: true };
    } catch (error) {
      return { taskId: task.id, success: false, error: String(error) };
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async abort(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.abort();
    return true;
  }

  async cleanup(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.abort();
    }
    this.sessions.clear();
  }
}
```

### 4.5 并行执行测试

```typescript
async function testParallelExecution() {
  const service = new AgentService();

  const tasks: Task[] = [
    { id: "1", prompt: "List all .ts files in current directory" },
    { id: "2", prompt: "Count lines of code in src/" },
    { id: "3", prompt: "Find all TODO comments" },
    { id: "4", prompt: "Analyze package.json dependencies" },
    { id: "5", prompt: "Check TypeScript configuration" },
    { id: "6", prompt: "Review git history for recent changes" },
    { id: "7", prompt: "Find all exported functions" },
    { id: "8", prompt: "Check for unused imports" },
  ];

  console.time("Parallel execution");
  const results = await service.executeParallel(tasks, 4);  // 4 concurrent
  console.timeEnd("Parallel execution");

  for (const result of results) {
    if (result.success) {
      console.log(`Task ${result.taskId}: Success (${result.output?.length ?? 0} chars)`);
    } else {
      console.log(`Task ${result.taskId}: Failed - ${result.error}`);
    }
  }
}
```

---

## 5. 最佳实践与示例

### 5.1 生产级 AgentService 实现

```typescript
import {
  createAgentSession,
  getModel,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  codingTools,
  readOnlyTools,
  allBuiltInTools,
} from "@mariozechner/pi-coding-agent";

export interface AgentConfig {
  model: string;
  tools: string[];
  thinkingLevel: string;
  systemPrompt?: string;
}

export interface AgentPoolOptions {
  maxSessions?: number;
  maxConcurrent?: number;
  defaultConfig?: AgentConfig;
}

export class AgentPool {
  private sessions: Map<string, AgentSession> = new Map();
  private configs: Map<string, AgentConfig> = new Map();
  private activeCount = 0;
  private maxSessions: number;
  private maxConcurrent: number;
  private defaultConfig: AgentConfig;

  constructor(options: AgentPoolOptions = {}) {
    this.maxSessions = options.maxSessions ?? 100;
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.defaultConfig = options.defaultConfig ?? {
      model: "claude-sonnet-4-20250514",
      tools: ["read", "bash", "edit", "write"],
      thinkingLevel: "medium",
    };
  }

  async createAgent(config: AgentConfig = this.defaultConfig): Promise<{ sessionId: string; session: AgentSession }> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Session limit reached: ${this.maxSessions}`);
    }

    const model = getModel("anthropic", config.model) ?? getModel("anthropic", "claude-sonnet-4-20250514");
    
    const tools = config.tools
      .map((name) => {
        if (name === "read") return readTool;
        if (name === "write") return writeTool;
        if (name === "edit") return editTool;
        if (name === "bash") return bashTool;
        if (name === "grep") return grepTool;
        if (name === "find") return findTool;
        if (name === "ls") return lsTool;
        return null;
      })
      .filter(Boolean);

    const { session } = await createAgentSession({
      model,
      tools,
      thinkingLevel: config.thinkingLevel as any,
      sessionManager: SessionManager.inMemory(),
    });

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, session);
    this.configs.set(sessionId, config);

    return { sessionId, session };
  }

  async execute(sessionId: string, prompt: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    let output = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        output += event.assistantMessageEvent.delta;
      }
    });

    try {
      await session.prompt(prompt);
      await session.waitForIdle();
    } finally {
      unsubscribe();
    }

    return output;
  }

  async executeParallel(
    tasks: { sessionId: string; prompt: string }[],
    maxConcurrent?: number
  ): Promise<{ sessionId: string; output: string; error?: string }[]> {
    const results: { sessionId: string; output: string; error?: string }[] = [];
    const queue = [...tasks];
    const active: Promise<void>[] = [];

    const concurrency = maxConcurrent ?? this.maxConcurrent;

    while (queue.length > 0 || active.length > 0) {
      while (active.length < concurrency && queue.length > 0) {
        const task = queue.shift()!;
        const promise = this.execute(task.sessionId, task.prompt)
          .then((output) => {
            results.push({ sessionId: task.sessionId, output });
          })
          .catch((error) => {
            results.push({ sessionId: task.sessionId, output: "", error: String(error) });
          });
        active.push(promise);
      }

      if (active.length > 0) {
        await Promise.race(active);
        for (let i = 0; i < active.length; i++) {
          if (active[i].fulfilled) {
            active.splice(i, 1);
            break;
          }
        }
      }
    }

    return results;
  }

  async abort(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.abort();
    return true;
  }

  async cleanup(sessionId?: string): Promise<void> {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.abort();
        this.sessions.delete(sessionId);
        this.configs.delete(sessionId);
      }
    } else {
      for (const session of this.sessions.values()) {
        session.abort();
      }
      this.sessions.clear();
      this.configs.clear();
    }
  }

  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeCount: this.activeCount,
      maxSessions: this.maxSessions,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// 使用示例
async function main() {
  const pool = new AgentPool({
    maxSessions: 50,
    maxConcurrent: 8,
    defaultConfig: {
      model: "claude-sonnet-4-20250514",
      tools: ["read", "bash", "edit", "write"],
      thinkingLevel: "medium",
    },
  });

  // 创建多个 agent
  const agent1 = await pool.createAgent();
  const agent2 = await pool.createAgent();
  const agent3 = await pool.createAgent();

  // 并行执行
  const results = await pool.executeParallel([
    { sessionId: agent1.sessionId, prompt: "Task 1" },
    { sessionId: agent2.sessionId, prompt: "Task 2" },
    { sessionId: agent3.sessionId, prompt: "Task 3" },
  ]);

  console.log(results);

  // 清理
  await pool.cleanup();
}
```

### 5.2 Subagent 并行执行对比

```typescript
// 方案 1: 使用 AgentService（推荐）
async function executeWithAgentService(tasks: Task[]) {
  const service = new AgentService();
  return service.executeParallel(tasks, 10);
}

// 方案 2: 使用 spawn（当前 subagent 实现）
async function executeWithSpawn(tasks: Task[]) {
  const results = [];
  for (const task of tasks) {
    const result = await new Promise((resolve) => {
      const proc = spawn("pi", [
        "--mode", "json",
        "-p",
        "--no-session",
        `Task: ${task.prompt}`,
      ]);

      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ output, code });
      });
    });
    results.push(result);
  }
  return results;
}

// 性能对比
async function benchmark() {
  const tasks = Array(10).fill({ prompt: "List files" });

  console.time("AgentService");
  await executeWithAgentService(tasks);
  console.timeEnd("AgentService");

  console.time("Spawn");
  await executeWithSpawn(tasks);
  console.timeEnd("Spawn");
}
```

### 5.3 错误处理与隔离

```typescript
class RobustAgentService {
  private sessions: Map<string, AgentSession> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  async executeWithTimeout(
    task: Task,
    timeout: number = 30000
  ): Promise<Result> {
    const sessionId = crypto.randomUUID();
    const session = await this.createSession();

    this.sessions.set(sessionId, session);

    // 设置超时
    const timeoutId = setTimeout(() => {
      session.abort();
    }, timeout);

    this.timeouts.set(sessionId, timeoutId);

    try {
      await session.prompt(task.prompt);
      await session.waitForIdle();

      return {
        taskId: task.id,
        success: true,
        output: this.extractOutput(session),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("aborted")) {
        return { taskId: task.id, success: false, error: "Timeout" };
      }
      return { taskId: task.id, success: false, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
      this.timeouts.delete(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  async executeWithRetry(
    task: Task,
    maxRetries: number = 3
  ): Promise<Result> {
    let lastError: string | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.execute(task);
      } catch (error) {
        lastError = String(error);
        // 指数退避
        await new Promise((resolve) => 
          setTimeout(resolve, Math.pow(2, i) * 1000)
        );
      }
    }

    return { taskId: task.id, success: false, error: lastError };
  }
}
```

### 5.4 资源监控与限流

```typescript
class MonitoredAgentService {
  private sessions: Map<string, AgentSession> = new Map();
  private stats: Map<string, { startTime: number; endTime?: number }> = new Map();
  private activeCount = 0;
  private maxConcurrent = 10;

  async execute(task: Task): Promise<Result> {
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error("Concurrency limit reached");
    }

    const sessionId = crypto.randomUUID();
    const session = await this.createSession();

    this.sessions.set(sessionId, session);
    this.stats.set(sessionId, { startTime: Date.now() });
    this.activeCount++;

    try {
      await session.prompt(task.prompt);
      await session.waitForIdle();

      const endTime = Date.now();
      const duration = endTime - this.stats.get(sessionId)!.startTime;

      return {
        taskId: task.id,
        success: true,
        output: this.extractOutput(session),
        stats: {
          duration,
          activeCount: this.activeCount,
        },
      };
    } finally {
      this.sessions.delete(sessionId);
      this.stats.delete(sessionId);
      this.activeCount--;
    }
  }

  getStats() {
    return {
      activeCount: this.activeCount,
      totalSessions: this.sessions.size,
      maxConcurrent: this.maxConcurrent,
    };
  }
}
```

---

## 6. 总结

### 6.1 关键结论

1. **Subagent 并行执行能力**：
   - ✅ 支持并行执行（通过 spawn）
   - ✅ 并发数限制为 4
   - ✅ 最多 8 个并行任务
   - ❌ 进程开销大

2. **AgentService 方案优势**：
   - ✅ 无进程开销
   - ✅ 启动延迟低
   - ✅ 资源消耗小
   - ✅ 更好的控制
   - ✅ 支持真正的并行

3. **Server-Side App 关键组件**：
   - `AgentSession` - 会话管理
   - `Agent` - 核心执行
   - `SessionManager` - 会话持久化
   - `Event System` - 事件订阅
   - `Tool System` - 工具注册

### 6.2 推荐方案

**对于 Server-Side App**：
- 使用 `AgentService` 模式（内存中运行）
- 实现并发限制和错误隔离
- 订阅事件以捕获输出和统计
- 使用 `SessionManager.inMemory()` 实现无状态

**对于 Subagent 场景**：
- 如果需要完全隔离：使用 spawn（当前实现）
- 如果需要高性能：使用 AgentService
- 如果需要共享状态：使用 AgentService

### 6.3 性能对比

| 操作 | Spawn | AgentService |
|------|-------|--------------|
| 启动延迟 | 100-500ms | <1ms |
| 内存开销 | ~50MB/进程 | ~5MB/实例 |
| 并发控制 | 自动 | 手动 |
| 错误隔离 | 自动 | 需 try-catch |
| 扩展性 | 低 | 高 |

### 6.4 下一步

1. 实现 `AgentService` 类
2. 添加并发限制和错误处理
3. 订阅事件以捕获输出
4. 测试并行执行性能
5. 集成到你的 server app

---

## 7. 参考资源

- `packages/coding-agent/examples/sdk/` - SDK 使用示例
- `packages/coding-agent/examples/extensions/subagent/` - Subagent 实现
- `packages/agent/src/agent.ts` - Agent 核心实现
- `packages/coding-agent/src/core/agent-session.ts` - AgentSession 实现
- `packages/coding-agent/src/core/sdk.ts` - SDK 入口
