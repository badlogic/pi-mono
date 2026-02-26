# 在 Node.js Server 中运行 Coding Agent

本文档介绍如何在 Node.js server（运行于 Ubuntu Docker）中使用 pi-mono SDK 程序化运行 coding agent，读取指定目录下的代码文件进行分析。

## 一、基本架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Server                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Express/Fastify                       ││
│  │  ┌─────────────┐    ┌─────────────────────────────────┐ ││
│  │  │ HTTP API    │───▶│        AgentService             │ ││
│  │  │ /analyze    │    │  - createAgentSession()         │ ││
│  │  │ /chat       │    │  - session.prompt()             │ ││
│  │  └─────────────┘    │  - subscribe() for streaming    │ ││
│  │                     └─────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
│                           │                                  │
│                           ▼                                  │
│                    ┌──────────┐                              │
│                    │   repo/  │  (代码目录)                   │
│                    └──────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

## 二、安装依赖

### package.json

```json
{
  "name": "coding-agent-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-ai": "latest",
    "express": "^4.18.2"
  }
}
```

### Dockerfile

```dockerfile
FROM node:20-slim

# 安装必要的工具（用于 fd 和 ripgrep）
RUN apt-get update && apt-get install -y \
    fd-find \
    ripgrep \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 创建 repo 目录挂载点
RUN mkdir -p /app/repo

EXPOSE 3000

CMD ["npm", "start"]
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  coding-agent:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./repo:/app/repo:ro  # 只读挂载代码目录
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      # 或其他 provider 的 API key
```

## 三、核心代码实现

### 3.1 AgentService - 核心服务类

```typescript
// src/agent-service.ts
import { getModel } from "@mariozechner/pi-ai";
import {
    AuthStorage,
    createAgentSession,
    createBashTool,
    createReadTool,
    createGrepTool,
    createFindTool,
    createLsTool,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    createExtensionRuntime,
    type ResourceLoader,
    type AgentSession,
    type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

export interface AgentConfig {
    repoPath: string;
    apiKey?: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface AnalysisResult {
    success: boolean;
    response: string;
    toolCalls: Array<{
        name: string;
        args: any;
        result: string;
        isError: boolean;
    }>;
    tokens?: {
        input: number;
        output: number;
        total: number;
    };
}

export class AgentService {
    private session: AgentSession | null = null;
    private config: AgentConfig;

    constructor(config: AgentConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        const {
            repoPath,
            apiKey,
            provider = "anthropic",
            modelId = "claude-sonnet-4-20250514",
            thinkingLevel = "medium",
        } = this.config;

        // 1. 配置认证存储
        const authStorage = AuthStorage.create();
        if (apiKey) {
            authStorage.setRuntimeApiKey(provider, apiKey);
        }

        // 2. 配置模型注册表
        const modelRegistry = new ModelRegistry(authStorage);
        const model = getModel(provider, modelId);
        if (!model) {
            throw new Error(`Model not found: ${provider}/${modelId}`);
        }

        // 3. 配置设置（内存中，不持久化）
        const settingsManager = SettingsManager.inMemory({
            compaction: { enabled: true },
            retry: { enabled: true, maxRetries: 2 },
        });

        // 4. 创建工具（使用工厂函数，指定 repoPath 作为 cwd）
        const tools = [
            createReadTool(repoPath),
            createBashTool(repoPath),
            createGrepTool(repoPath),
            createFindTool(repoPath),
            createLsTool(repoPath),
        ];

        // 5. 自定义资源加载器（最小化配置）
        const resourceLoader: ResourceLoader = {
            getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
            getSkills: () => ({ skills: [], diagnostics: [] }),
            getPrompts: () => ({ prompts: [], diagnostics: [] }),
            getThemes: () => ({ themes: [], diagnostics: [] }),
            getAgentsFiles: () => ({ agentsFiles: [] }),
            getSystemPrompt: () => this.buildSystemPrompt(),
            getAppendSystemPrompt: () => [],
            getPathMetadata: () => new Map(),
            extendResources: () => {},
            reload: async () => {},
        };

        // 6. 创建 session
        const { session } = await createAgentSession({
            cwd: repoPath,
            model,
            thinkingLevel,
            authStorage,
            modelRegistry,
            resourceLoader,
            tools,
            sessionManager: SessionManager.inMemory(),
            settingsManager,
        });

        this.session = session;
    }

    private buildSystemPrompt(): string {
        return `You are a code analysis assistant. Your task is to analyze code in the repository.

Working directory: ${this.config.repoPath}

Available tools:
- read: Read file contents
- grep: Search file contents for patterns
- find: Find files by glob pattern
- ls: List directory contents
- bash: Execute shell commands

Guidelines:
- Start by exploring the directory structure
- Use grep to find relevant code patterns
- Read specific files to understand implementation details
- Be concise in your analysis
- Focus on the user's specific questions`;
    }

    async analyze(prompt: string, onEvent?: (event: AgentSessionEvent) => void): Promise<AnalysisResult> {
        if (!this.session) {
            await this.initialize();
        }

        const toolCalls: AnalysisResult["toolCalls"] = [];
        let response = "";
        let tokens = { input: 0, output: 0, total: 0 };

        // 订阅事件
        const unsubscribe = this.session!.subscribe((event) => {
            // 流式输出文本
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                response += event.assistantMessageEvent.delta;
                if (onEvent) {
                    onEvent(event);
                }
            }

            // 记录工具调用
            if (event.type === "tool_execution_end") {
                toolCalls.push({
                    name: event.toolName,
                    args: event.args,
                    result: event.result?.content?.[0]?.type === "text" 
                        ? event.result.content[0].text 
                        : JSON.stringify(event.result?.content),
                    isError: event.isError,
                });
            }

            // 获取 token 使用量
            if (event.type === "message_end" && event.message.role === "assistant") {
                const usage = (event.message as any).usage;
                if (usage) {
                    tokens = {
                        input: usage.input || 0,
                        output: usage.output || 0,
                        total: usage.totalTokens || usage.input + usage.output || 0,
                    };
                }
            }
        });

        try {
            await this.session!.prompt(prompt);
        } finally {
            unsubscribe();
        }

        return {
            success: true,
            response,
            toolCalls,
            tokens,
        };
    }

    async chat(prompt: string): Promise<string> {
        if (!this.session) {
            await this.initialize();
        }

        let response = "";

        const unsubscribe = this.session!.subscribe((event) => {
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                response += event.assistantMessageEvent.delta;
            }
        });

        try {
            await this.session!.prompt(prompt);
        } finally {
            unsubscribe();
        }

        return response;
    }

    async dispose(): Promise<void> {
        if (this.session) {
            this.session.dispose();
            this.session = null;
        }
    }
}
```

### 3.2 Express Server

```typescript
// src/server.ts
import express, { Request, Response } from "express";
import { AgentService } from "./agent-service.js";

const app = express();
app.use(express.json());

// 配置
const REPO_PATH = process.env.REPO_PATH || "/app/repo";
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

// 全局 agent 实例（或使用连接池）
let agentService: AgentService | null = null;

async function getAgentService(): Promise<AgentService> {
    if (!agentService) {
        agentService = new AgentService({
            repoPath: REPO_PATH,
            apiKey: API_KEY,
            provider: process.env.PROVIDER || "anthropic",
            modelId: process.env.MODEL_ID || "claude-sonnet-4-20250514",
            thinkingLevel: (process.env.THINKING_LEVEL as any) || "medium",
        });
        await agentService.initialize();
    }
    return agentService;
}

// API: 分析代码库
app.post("/analyze", async (req: Request, res: Response) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            res.status(400).json({ error: "prompt is required" });
            return;
        }

        const agent = await getAgentService();
        const result = await agent.analyze(prompt);
        
        res.json(result);
    } catch (error) {
        console.error("Analysis error:", error);
        res.status(500).json({ 
            error: error instanceof Error ? error.message : "Unknown error" 
        });
    }
});

// API: 流式分析（SSE）
app.post("/analyze/stream", async (req: Request, res: Response) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            res.status(400).json({ error: "prompt is required" });
            return;
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const agent = await getAgentService();
        
        const result = await agent.analyze(prompt, (event) => {
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                res.write(`data: ${JSON.stringify({ type: "delta", text: event.assistantMessageEvent.delta })}\n\n`);
            }
        });

        res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
        res.end();
    } catch (error) {
        console.error("Stream error:", error);
        res.write(`data: ${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Unknown error" })}\n\n`);
        res.end();
    }
});

// API: 简单对话
app.post("/chat", async (req: Request, res: Response) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            res.status(400).json({ error: "prompt is required" });
            return;
        }

        const agent = await getAgentService();
        const response = await agent.chat(prompt);
        
        res.json({ response });
    } catch (error) {
        console.error("Chat error:", error);
        res.status(500).json({ 
            error: error instanceof Error ? error.message : "Unknown error" 
        });
    }
});

// API: 健康检查
app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", repoPath: REPO_PATH });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Coding Agent Server running on port ${PORT}`);
    console.log(`Repo path: ${REPO_PATH}`);
});
```

## 四、使用示例

### 4.1 启动服务

```bash
# 构建并启动
docker-compose up -d

# 或直接运行（需要安装依赖）
npm install
npm run build
npm start
```

### 4.2 API 调用示例

**分析代码库结构：**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"prompt": "分析这个代码库的目录结构，找出主要模块和入口文件"}'
```

**搜索特定代码：**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"prompt": "找出所有使用 async/await 的函数，并分析错误处理方式"}'
```

**分析特定功能：**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"prompt": "分析 src/auth 目录下的认证逻辑，找出潜在的安全问题"}'
```

**流式响应：**
```bash
curl -X POST http://localhost:3000/analyze/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "列出所有 TypeScript 文件并分析依赖关系"}'
```

## 五、高级配置

### 5.1 自定义系统提示

```typescript
// 在 AgentService 中自定义系统提示
private buildSystemPrompt(): string {
    return `You are a code analysis assistant specialized in ${this.config.specialty || "general code review"}.

Working directory: ${this.config.repoPath}

Project context:
${this.config.projectContext || "No additional context provided."}

Analysis focus:
${this.config.focusAreas?.map(f => `- ${f}`).join("\n") || "- General code quality"}

Available tools:
- read: Read file contents (supports offset/limit for large files)
- grep: Search file contents (supports regex, context lines)
- find: Find files by glob pattern
- ls: List directory contents
- bash: Execute shell commands (use sparingly)

Analysis workflow:
1. Start with ls or find to understand structure
2. Use grep to locate relevant code patterns
3. Read specific files for detailed analysis
4. Synthesize findings and provide actionable insights`;
}
```

### 5.2 添加项目上下文文件

```typescript
// 加载 AGENTS.md 或自定义上下文
const resourceLoader: ResourceLoader = {
    // ... 其他方法
    getAgentsFiles: () => ({
        agentsFiles: [
            { 
                path: "/virtual/AGENTS.md", 
                content: `
# Project Guidelines

## Architecture
- Monorepo with packages in /packages directory
- Shared types in @mariozechner/pi-ai
- Agent core in @mariozechner/pi-agent-core

## Code Style
- Use TypeScript strict mode
- Prefer functional programming patterns
- Document public APIs with JSDoc
`
            }
        ]
    }),
};
```

### 5.3 多会话管理

```typescript
// src/session-pool.ts
import { AgentService, AgentConfig } from "./agent-service.js";

export class AgentSessionPool {
    private sessions: Map<string, AgentService> = new Map();
    private config: Omit<AgentConfig, "repoPath">;

    constructor(config: Omit<AgentConfig, "repoPath">) {
        this.config = config;
    }

    async getSession(sessionId: string, repoPath: string): Promise<AgentService> {
        const key = `${sessionId}:${repoPath}`;
        
        if (!this.sessions.has(key)) {
            const service = new AgentService({
                ...this.config,
                repoPath,
            });
            await service.initialize();
            this.sessions.set(key, service);
        }
        
        return this.sessions.get(key)!;
    }

    async closeSession(sessionId: string, repoPath: string): Promise<void> {
        const key = `${sessionId}:${repoPath}`;
        const session = this.sessions.get(key);
        if (session) {
            await session.dispose();
            this.sessions.delete(key);
        }
    }

    async closeAll(): Promise<void> {
        for (const session of this.sessions.values()) {
            await session.dispose();
        }
        this.sessions.clear();
    }
}
```

### 5.4 内置 Prompt 模板

```typescript
// src/prompts.ts
export const BUILT_IN_PROMPTS = {
    analyzeStructure: `分析代码库的目录结构：
1. 列出顶层目录和主要模块
2. 找出入口文件（main, index, app 等）
3. 识别配置文件（package.json, tsconfig.json 等）
4. 总结项目架构`,

    findSecurityIssues: `安全审计：
1. 搜索敏感信息（API key, password, secret）
2. 检查输入验证和 sanitization
3. 分析认证和授权逻辑
4. 检查依赖项的已知漏洞
5. 报告发现的安全问题`,

    codeReview: `代码审查：
1. 检查代码风格一致性
2. 识别代码重复
3. 分析错误处理模式
4. 检查类型安全
5. 提出改进建议`,

    generateDocs: `生成文档：
1. 分析主要模块和类的功能
2. 提取公共 API 和类型定义
3. 生成 API 文档结构
4. 创建使用示例`,
};

// 使用内置 prompt
app.post("/analyze/:template", async (req, res) => {
    const { template } = req.params;
    const { customPrompt } = req.body;
    
    const basePrompt = BUILT_IN_PROMPTS[template];
    if (!basePrompt) {
        res.status(404).json({ error: "Template not found" });
        return;
    }
    
    const prompt = customPrompt ? `${basePrompt}\n\nAdditional: ${customPrompt}` : basePrompt;
    const agent = await getAgentService();
    const result = await agent.analyze(prompt);
    res.json(result);
});
```

## 六、注意事项

### 6.1 API Key 管理

```typescript
// 推荐使用环境变量
const API_KEY = process.env.ANTHROPIC_API_KEY;

// 或从安全存储加载
import { readFileSync } from "fs";
const apiKey = readFileSync("/run/secrets/anthropic-key", "utf-8").trim();
```

### 6.2 资源限制

```typescript
// 限制并发会话数
import pLimit from "p-limit";

const limit = pLimit(3); // 最多 3 个并发分析

app.post("/analyze", async (req, res) => {
    const result = await limit(() => agent.analyze(prompt));
    res.json(result);
});
```

### 6.3 错误处理

```typescript
// 完善的错误处理
try {
    const result = await agent.analyze(prompt);
    res.json(result);
} catch (error) {
    if (error.message?.includes("rate limit")) {
        res.status(429).json({ error: "Rate limit exceeded, please retry later" });
    } else if (error.message?.includes("context")) {
        res.status(413).json({ error: "Context too large, please narrow your query" });
    } else {
        res.status(500).json({ error: error.message });
    }
}
```

### 6.4 日志记录

```typescript
// 添加请求日志
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 记录分析结果
const result = await agent.analyze(prompt);
console.log(`Analysis completed: ${result.toolCalls.length} tool calls, ${result.tokens?.total} tokens`);
```

## 七、完整项目结构

```
coding-agent-server/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts           # Express 服务入口
│   ├── agent-service.ts    # Agent 核心服务
│   ├── session-pool.ts     # 会话池管理
│   ├── prompts.ts          # 内置 prompt 模板
│   └── types.ts            # 类型定义
├── repo/                   # 代码目录（挂载）
└── .env                    # 环境变量
```

## 八、总结

通过 pi-mono SDK，可以轻松在 Node.js server 中集成 coding agent：

1. **使用 `createAgentSession()`** 创建 agent 会话
2. **使用工具工厂函数** (`createReadTool`, `createGrepTool` 等) 指定工作目录
3. **通过 `session.prompt()`** 发送分析请求
4. **通过 `subscribe()`** 接收流式响应和事件
5. **使用 `SessionManager.inMemory()`** 避免持久化（适合 server 场景）

这种架构适用于：
- 代码审查服务
- 自动化文档生成
- 安全审计工具
- 代码质量分析平台
