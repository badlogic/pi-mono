# pi-coding-agent SDK 扩展指南

## 概述

本文档介绍如何在你的 server app 中使用 pi-coding-agent SDK，并扩展自定义信息来跟踪会话的运行状态、统计信息等。

## 架构设计

### 推荐方案：Session 包装器模式

创建一个包装器类，封装 `AgentSession` 并添加你的自定义元数据跟踪功能。

```typescript
// 在你的 server app 中创建
interface SessionMetadata {
  sessionId: string;
  lastConversation: AgentMessage[];
  lastAccessedAt: number;
  requestCount: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  errorCodes: string[];
  runs: SessionRunRecord[];
}

interface SessionRunRecord {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  request: string;
  response?: string;
  startedAt: number;
  completedAt?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  error?: string;
}
```

## 实现方案

### 方案 1：使用扩展机制（推荐）

pi-coding-agent 提供了扩展系统，允许你拦截事件、添加自定义工具、修改行为等。

#### 步骤 1：创建扩展

```typescript
import type {
  ExtensionFactory,
  ExtensionAPI,
  ExtensionContext,
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

interface MyExtensionState {
  sessionId: string;
  requestCount: number;
  tokens: { input: number; output: number; total: number };
  errorCodes: string[];
  runs: SessionRunRecord[];
  currentRun?: SessionRunRecord;
}

export const myExtension: ExtensionFactory = async (pi: ExtensionAPI, context: ExtensionContext) => {
  const state: MyExtensionState = {
    sessionId: context.sessionId || `session_${Date.now()}`,
    requestCount: 0,
    tokens: { input: 0, output: 0, total: 0 },
    errorCodes: [],
    runs: [],
  };

  // 监听所有 Agent 事件
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role === "assistant") {
      // 更新 token 统计
      const usage = event.message.usage;
      if (usage) {
        state.tokens.input += usage.input || 0;
        state.tokens.output += usage.output || 0;
        state.tokens.total += usage.totalTokens || 0;
      }

      // 完成当前 run
      if (state.currentRun) {
        state.currentRun.status = "completed";
        state.currentRun.completedAt = Date.now();
        state.currentRun.response = event.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        state.currentRun.tokens = {
          input: usage?.input || 0,
          output: usage?.output || 0,
          total: usage?.totalTokens || 0,
        };
        state.runs.push(state.currentRun);
        state.currentRun = undefined;
      }
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    state.requestCount++;
    state.lastAccessedAt = Date.now();
  });

  pi.on("error", async (event, ctx) => {
    // 记录错误
    const errorCode = event.error?.code || "UNKNOWN_ERROR";
    if (!state.errorCodes.includes(errorCode)) {
      state.errorCodes.push(errorCode);
    }

    // 标记当前 run 为失败
    if (state.currentRun) {
      state.currentRun.status = "failed";
      state.currentRun.completedAt = Date.now();
      state.currentRun.error = event.error?.message;
      state.runs.push(state.currentRun);
      state.currentRun = undefined;
    }
  });

  // 添加自定义命令来查询统计信息
  pi.registerCommand({
    name: "stats",
    description: "显示当前会话的统计信息",
    handler: async (text, ctx) => {
      return {
        action: "respond",
        response: JSON.stringify(
          {
            sessionId: state.sessionId,
            requestCount: state.requestCount,
            tokens: state.tokens,
            errorCodes: state.errorCodes,
            runs: state.runs.length,
          },
          null,
          2,
        ),
      };
    },
  });

  // 添加 API 供外部访问状态
  return {
    getState: () => state,
    startRun: (request: string) => {
      state.currentRun = {
        runId: `run_${Date.now()}`,
        status: "running",
        request,
        startedAt: Date.now(),
      };
      return state.currentRun.runId;
    },
    getSessionId: () => state.sessionId,
  };
};
```

#### 步骤 2：在创建会话时注册扩展

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { myExtension } from "./my-extension";

async function createMySession() {
  const result = await createAgentSession({
    cwd: process.cwd(),
    // 注册你的扩展
    customExtensions: [myExtension],
  });

  const session = result.session;
  
  // 获取扩展实例来访问状态
  const extensionApi = await session.getExtensionApi<MyExtensionApi>("my-extension");
  
  return { session, extensionApi };
}
```

### 方案 2：使用事件监听器包装器

如果你不想使用扩展系统，可以创建一个包装器类：

```typescript
import { AgentSession, type AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

class SessionWrapper {
  private session: AgentSession;
  private metadata: SessionMetadata;
  private listeners: Map<string, AgentSessionEvent[]> = new Map();

  constructor(session: AgentSession, sessionId: string) {
    this.session = session;
    this.metadata = {
      sessionId,
      lastConversation: [],
      lastAccessedAt: Date.now(),
      requestCount: 0,
      tokens: { input: 0, output: 0, total: 0 },
      errorCodes: [],
      runs: [],
    };

    // 订阅所有事件
    this.session.on("message_end", this.handleMessageEnd.bind(this));
    this.session.on("agent_end", this.handleAgentEnd.bind(this));
    this.session.on("error", this.handleError.bind(this));
  }

  private handleMessageEnd(event: AgentSessionEvent) {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const msg = event.message as AssistantMessage;
      
      // 更新 token 统计
      if (msg.usage) {
        this.metadata.tokens.input += msg.usage.input || 0;
        this.metadata.tokens.output += msg.usage.output || 0;
        this.metadata.tokens.total += msg.usage.totalTokens || 0;
      }

      // 更新最后一条消息
      this.metadata.lastConversation.push(event.message);

      // 完成当前 run
      const currentRun = this.metadata.runs.find((r) => r.status === "running");
      if (currentRun) {
        currentRun.status = "completed";
        currentRun.completedAt = Date.now();
        currentRun.response = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        currentRun.tokens = {
          input: msg.usage?.input || 0,
          output: msg.usage?.output || 0,
          total: msg.usage?.totalTokens || 0,
        };
      }
    }
  }

  private handleAgentEnd(event: AgentSessionEvent) {
    this.metadata.requestCount++;
    this.metadata.lastAccessedAt = Date.now();
  }

  private handleError(event: AgentSessionEvent) {
    if ("error" in event && event.error) {
      const errorCode = event.error.code || "UNKNOWN_ERROR";
      if (!this.metadata.errorCodes.includes(errorCode)) {
        this.metadata.errorCodes.push(errorCode);
      }

      // 标记当前 run 为失败
      const currentRun = this.metadata.runs.find((r) => r.status === "running");
      if (currentRun) {
        currentRun.status = "failed";
        currentRun.completedAt = Date.now();
        currentRun.error = event.error.message;
      }
    }
  }

  async prompt(text: string): Promise<void> {
    // 开始新的 run
    this.metadata.runs.push({
      runId: `run_${Date.now()}`,
      status: "running",
      request: text,
      startedAt: Date.now(),
    });

    await this.session.prompt(text);
  }

  getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  getSession(): AgentSession {
    return this.session;
  }
}
```

## 从内置 Session 读取信息

### 可直接获取的信息

#### 1. 会话 ID 和时间戳

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";

const sessionManager = SessionManager.create(cwd);
const entries = sessionManager.getBranch();
const header = entries.find((e) => e.type === "session");

if (header && header.type === "session") {
  console.log("Session ID:", header.id);
  console.log("Created at:", header.timestamp);
  console.log("Working directory:", header.cwd);
}
```

#### 2. 对话历史（messages）

```typescript
// 获取当前会话的所有消息
const context = sessionManager.buildSessionContext();
const messages = context.messages;

// 或者从 AgentSession 获取
const state = session.agent.state;
const allMessages = state.messages;

// 过滤特定类型的消息
const userMessages = allMessages.filter((m) => m.role === "user");
const assistantMessages = allMessages.filter((m) => m.role === "assistant");
```

#### 3. Token 使用统计

```typescript
// 从 assistant 消息中提取 token 信息
const assistantMessages = state.messages.filter((m) => m.role === "assistant");

let totalInput = 0;
let totalOutput = 0;
let totalTokens = 0;

for (const msg of assistantMessages) {
  if ("usage" in msg && msg.usage) {
    totalInput += msg.usage.input || 0;
    totalOutput += msg.usage.output || 0;
    totalTokens += msg.usage.totalTokens || 0;
  }
}

console.log({
  input: totalInput,
  output: totalOutput,
  total: totalTokens,
});
```

#### 4. 模型信息

```typescript
// 当前使用的模型
const currentModel = session.model;
console.log("Provider:", currentModel?.provider);
console.log("Model ID:", currentModel?.id);

// 从会话条目中获取模型变更历史
const entries = sessionManager.getBranch();
const modelChanges = entries.filter((e) => e.type === "model_change");

for (const change of modelChanges) {
  if (change.type === "model_change") {
    console.log(`Changed to ${change.provider}/${change.modelId} at ${change.timestamp}`);
  }
}
```

#### 5. 错误信息

```typescript
// 查找所有错误消息
const assistantMessages = state.messages.filter((m) => m.role === "assistant");
const errors = assistantMessages
  .filter((m) => m.stopReason === "error")
  .map((m) => ({
    timestamp: m.timestamp,
    errorMessage: m.errorMessage,
    model: `${m.provider}/${m.model}`,
  }));

console.log("Errors:", errors);
```

#### 6. 会话条目（包括压缩、分支等）

```typescript
// 获取所有会话条目
const allEntries = sessionManager.getBranch();

// 获取压缩历史
const compactions = allEntries.filter((e) => e.type === "compaction");
for (const comp of compactions) {
  if (comp.type === "compaction") {
    console.log({
      timestamp: comp.timestamp,
      tokensBefore: comp.tokensBefore,
      summary: comp.summary.substring(0, 100) + "...",
    });
  }
}

// 获取思考级别变更
const thinkingChanges = allEntries.filter((e) => e.type === "thinking_level_change");
```

### 完整示例：SessionMetadataManager

```typescript
import { AgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

export class SessionMetadataManager {
  private session: AgentSession;
  private sessionManager: SessionManager;
  private metadata: SessionMetadata;

  constructor(session: AgentSession, sessionManager: SessionManager, sessionId: string) {
    this.session = session;
    this.sessionManager = sessionManager;
    this.metadata = {
      sessionId,
      lastConversation: [],
      lastAccessedAt: Date.now(),
      requestCount: 0,
      tokens: { input: 0, output: 0, total: 0 },
      errorCodes: [],
      runs: [],
    };

    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.session.on("message_end", (event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        this.updateTokenStats(event.message as AssistantMessage);
        this.updateLastConversation(event.message);
        this.completeCurrentRun("completed", event.message as AssistantMessage);
      }
    });

    this.session.on("agent_end", () => {
      this.metadata.requestCount++;
      this.metadata.lastAccessedAt = Date.now();
    });

    this.session.on("error", (event) => {
      if ("error" in event && event.error) {
        this.recordError(event.error.code, event.error.message);
        this.completeCurrentRun("failed", undefined, event.error.message);
      }
    });
  }

  private updateTokenStats(message: AssistantMessage) {
    if (message.usage) {
      this.metadata.tokens.input += message.usage.input || 0;
      this.metadata.tokens.output += message.usage.output || 0;
      this.metadata.tokens.total += message.usage.totalTokens || 0;
    }
  }

  private updateLastConversation(message: AssistantMessage) {
    this.metadata.lastConversation.push(message);
    // 只保留最近的 N 条消息
    if (this.metadata.lastConversation.length > 50) {
      this.metadata.lastConversation = this.metadata.lastConversation.slice(-50);
    }
  }

  private recordError(code: string, message: string) {
    if (!this.metadata.errorCodes.includes(code)) {
      this.metadata.errorCodes.push(code);
    }
  }

  private completeCurrentRun(
    status: "completed" | "failed" | "cancelled",
    message?: AssistantMessage,
    error?: string,
  ) {
    const currentRun = this.metadata.runs.find((r) => r.status === "running");
    if (!currentRun) return;

    currentRun.status = status;
    currentRun.completedAt = Date.now();

    if (message && message.usage) {
      currentRun.tokens = {
        input: message.usage.input || 0,
        output: message.usage.output || 0,
        total: message.usage.totalTokens || 0,
      };
    }

    if (error) {
      currentRun.error = error;
    }
  }

  startRun(request: string): string {
    const runId = `run_${Date.now()}`;
    this.metadata.runs.push({
      runId,
      status: "running",
      request,
      startedAt: Date.now(),
    });
    return runId;
  }

  getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  // 从内置 session 读取额外信息
  getBuiltInStats() {
    const entries = this.sessionManager.getBranch();
    const state = this.session.agent.state;

    // 会话基本信息
    const header = entries.find((e) => e.type === "session");
    const sessionId = header?.type === "session" ? header.id : undefined;
    const createdAt = header?.type === "session" ? header.timestamp : undefined;

    // 模型信息
    const currentModel = this.session.model;

    // 压缩历史
    const compactions = entries.filter((e) => e.type === "compaction");

    // 错误消息
    const errors = state.messages
      .filter((m) => m.role === "assistant" && m.stopReason === "error")
      .map((m) => ({
        timestamp: m.timestamp,
        message: m.errorMessage,
        model: `${(m as AssistantMessage).provider}/${(m as AssistantMessage).model}`,
      }));

    return {
      sessionId,
      createdAt,
      currentModel: currentModel
        ? {
            provider: currentModel.provider,
            modelId: currentModel.id,
            contextWindow: currentModel.contextWindow,
          }
        : null,
      compactionCount: compactions.length,
      totalMessages: state.messages.length,
      errors,
    };
  }

  async prompt(text: string): Promise<void> {
    this.startRun(text);
    await this.session.prompt(text);
  }
}
```

## 使用示例

### Server App 集成

```typescript
import express from "express";
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { SessionMetadataManager } from "./session-metadata-manager";

const app = express();
const sessions = new Map<string, SessionMetadataManager>();

app.post("/api/sessions", async (req, res) => {
  const { cwd } = req.body;
  
  const result = await createAgentSession({ cwd });
  const sessionId = `session_${Date.now()}`;
  
  const manager = new SessionMetadataManager(result.session, result.session.sessionManager, sessionId);
  sessions.set(sessionId, manager);
  
  res.json({ sessionId });
});

app.post("/api/sessions/:sessionId/prompt", async (req, res) => {
  const { sessionId } = req.params;
  const { prompt } = req.body;
  
  const manager = sessions.get(sessionId);
  if (!manager) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  try {
    await manager.prompt(prompt);
    const metadata = manager.getMetadata();
    res.json({ success: true, metadata });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sessions/:sessionId/stats", (req, res) => {
  const { sessionId } = req.params;
  const manager = sessions.get(sessionId);
  
  if (!manager) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  const metadata = manager.getMetadata();
  const builtIn = manager.getBuiltInStats();
  
  res.json({
    ...metadata,
    ...builtIn,
  });
});
```

## 总结

### 推荐方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **扩展机制** | - 深度集成<br>- 可拦截所有事件<br>- 可添加自定义命令 | - 需要学习扩展 API<br>- 代码稍复杂 | 需要深度定制和拦截 |
| **包装器模式** | - 简单直观<br>- 不依赖扩展系统<br>- 易于测试 | - 无法拦截所有内部事件<br>- 需要手动转发调用 | 简单统计和跟踪 |
| **混合模式** | - 灵活性最高<br>- 可扩展性强 | - 代码量较大 | 复杂业务场景 |

### 可直接从内置 Session 获取的信息

1. ✅ **Session ID** - 从 SessionHeader
2. ✅ **Last Conversation** - `session.agent.state.messages`
3. ✅ **Tokens** - 从 AssistantMessage.usage
4. ✅ **Error Codes** - 从 error 事件和 stopReason="error"的消息
5. ✅ **Model Info** - `session.model`
6. ✅ **Compaction History** - 从 compaction 条目
7. ⚠️ **Request Count** - 需要自己计数（扩展或包装器）
8. ⚠️ **Runs** - 需要自己跟踪（扩展或包装器）

### 最佳实践

1. **使用扩展系统**进行深度集成和事件拦截
2. **使用包装器**简化 API 调用
3. **定期持久化**自定义元数据到磁盘
4. **限制内存使用**（如只保留最近 N 条消息）
5. **添加监控端点**便于调试和观察
