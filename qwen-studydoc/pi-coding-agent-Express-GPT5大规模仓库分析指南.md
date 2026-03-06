# pi-coding-agent SDK 集成 Express.js 进行大规模 GitHub 仓库分析指南

## 执行摘要

本文档为使用 pi-coding-agent SDK 在 Express.js 服务器中分析 1000+ GitHub 仓库提供全面的技术指南。重点使用 OpenAI GPT-5.1 模型，确保分析过程连续性和结果准确性。

## 1. 架构设计

### 1.1 核心组件

```
Express.js Server
├── API Routes (REST/gRPC)
├── Job Queue (任务队列)
├── Worker Pool (工作池)
│   ├── Agent Session Manager
│   ├── Model Registry
│   └── Error Handler
└── Storage Layer
    ├── Session Storage (JSONL)
    ├── Results Database (PostgreSQL/MongoDB)
    └── Cache (Redis)
```

### 1.2 推荐架构模式

**模式 1：单例 Agent + 并发控制**
- 适合：分析任务相对简单，工具调用较少
- 优点：资源占用少，启动快
- 缺点：并发能力受限

**模式 2：Agent Pool + 负载均衡**
- 适合：复杂分析任务，需要隔离环境
- 优点：隔离性强，并发能力高
- 缺点：资源占用高，管理复杂

**模式 3：无状态 Worker + 持久化 Session**
- 适合：大规模分布式分析
- 优点：可水平扩展，容错性强
- 缺点：架构复杂，需要外部存储

## 2. SDK 初始化配置

### 2.1 基础初始化

```typescript
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

// GPT-5.1 模型配置
const gpt5Model = getModel("openai", "gpt-5.1");

// 创建 Agent Session
const { session } = await createAgentSession({
  model: gpt5Model,
  thinkingLevel: "high", // GPT-5.1 支持高思考级别
  sessionManager: SessionManager.inMemory(), // Express 环境使用内存管理
  authStorage: AuthStorage.create(), // API key 存储
  modelRegistry: new ModelRegistry(AuthStorage.create()),
});
```

### 2.2 关键配置参数

```typescript
interface AgentConfig {
  // 模型配置
  model: Model; // GPT-5.1
  thinkingLevel: "high" | "xhigh"; // GPT-5.1 支持
  systemPrompt: string; // 自定义系统提示
  
  // 重试配置（关键）
  retry: {
    enabled: true;
    maxRetries: 1; // 生产环境建议 1，快速失败
    baseDelayMs: 2000;
    maxDelayMs: 30000;
  };
  
  // 工具配置（关键）
  tools: {
    write: { timeout: 30000 }; // 30秒超时
    edit: { timeout: 30000 }; // 30秒超时
    read: { timeout: 15000 }; // 15秒超时
    bash: { timeout: 60000 }; // 60秒超时
  };
  
  // 上下文配置
  context: {
    maxTokens: 128000; // GPT-5.1 上下文窗口
    compactionThreshold: 0.8; // 80% 时自动压缩
  };
}
```

## 3. GPT-5.1 模型特定配置

### 3.1 模型能力

**GPT-5.1 特性**：
- 上下文窗口：128K tokens
- 思考能力：支持 minimal/low/medium/high/xhigh
- 工具调用：原生支持
- 多模态：支持图像输入
- 速度：比 GPT-4o 快 2-3 倍
- 成本：比 GPT-4o 低 50%

### 3.2 推荐配置

```typescript
// GPT-5.1 优化配置
const gpt5Config = {
  model: getModel("openai", "gpt-5.1"),
  thinkingLevel: "high", // 平衡准确性和成本
  
  // 思考预算（GPT-5.1 特有）
  reasoningEffort: "medium", // minimal | low | medium | high
  reasoningSummary: "detailed", // 简洁或详细总结
  
  // 工具调用优化
  toolChoice: "auto", // 自动选择工具
  parallelToolCalls: true, // 允许并行工具调用
};
```

### 3.3 成本优化策略

```typescript
// 1. 使用思考级别控制成本
const costOptimizedConfig = {
  // 简单分析：minimal/low
  simpleAnalysis: { thinkingLevel: "minimal" },
  // 中等分析：medium
  mediumAnalysis: { thinkingLevel: "medium" },
  // 复杂分析：high/xhigh
  complexAnalysis: { thinkingLevel: "high" },
};

// 2. 上下文压缩
const compactConfig = {
  context: {
    maxTokens: 100000, // 预留 28K 用于响应
    compactionThreshold: 0.75, // 75% 时压缩
  },
};

// 3. 批量处理
const batchConfig = {
  // 将多个小任务合并为一个大任务
  batchAnalysis: true,
  maxBatchSize: 5, // 最多 5 个文件/仓库
};
```

## 4. Express.js 集成模式

### 4.1 基础 Express 服务器

```typescript
import express, { Request, Response } from "express";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const app = express();
app.use(express.json({ limit: "50mb" })); // 增加 JSON 限制

// Agent Session 池
const agentSessions = new Map<string, AgentSession>();

// 初始化 Agent
async function initAgent(sessionId: string): Promise<AgentSession> {
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    model: getModel("openai", "gpt-5.1"),
    thinkingLevel: "high",
  });
  
  agentSessions.set(sessionId, session);
  return session;
}

// 获取或创建 Agent Session
function getAgentSession(sessionId: string): AgentSession {
  let session = agentSessions.get(sessionId);
  if (!session) {
    session = await initAgent(sessionId);
  }
  return session;
}

// 分析端点
app.post("/api/analyze", async (req: Request, res: Response) => {
  const { repositoryUrl, analysisType, sessionId } = req.body;
  
  try {
    const session = getAgentSession(sessionId);
    
    // 构建分析提示
    const prompt = buildAnalysisPrompt(repositoryUrl, analysisType);
    
    // 执行分析
    await session.prompt(prompt);
    
    // 获取结果
    const result = extractAnalysisResult(session);
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
```

### 4.2 任务队列模式

```typescript
import Bull from "bull";
import { createAgentSession } from "@mariozechner/pi-coding-agent";

// 创建任务队列
const analysisQueue = new Bull("analysis", {
  redis: { host: "localhost", port: 6379 },
});

// 任务处理器
analysisQueue.process(async (job) => {
  const { repositoryUrl, analysisType, jobId } = job.data;
  
  // 初始化 Agent
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    model: getModel("openai", "gpt-5.1"),
    thinkingLevel: "high",
  });
  
  try {
    // 执行分析
    await session.prompt(buildAnalysisPrompt(repositoryUrl, analysisType));
    
    // 提取结果
    const result = extractAnalysisResult(session);
    
    // 保存结果
    await saveResult(jobId, result);
    
    return { success: true, result };
  } catch (error) {
    // 重试逻辑
    if (job.attemptsMade < 3) {
      throw error; // 自动重试
    }
    return { success: false, error: error.message };
  }
});

// API 端点
app.post("/api/analyze", async (req: Request, res: Response) => {
  const { repositoryUrl, analysisType } = req.body;
  
  const job = await analysisQueue.add({
    repositoryUrl,
    analysisType,
    timestamp: Date.now(),
  });
  
  res.json({ jobId: job.id, status: "queued" });
});

app.get("/api/job/:jobId", async (req: Request, res: Response) => {
  const job = await analysisQueue.getJob(req.params.jobId);
  const state = await job.getState();
  
  res.json({ jobId: job.id, state, progress: job.progress });
});
```

### 4.3 并发控制

```typescript
import { Semaphore } from "typescript-semaphore";

// 信号量控制并发数
const semaphore = new Semaphore(5); // 最多 5 个并发分析

async function analyzeWithConcurrencyControl(
  sessionId: string,
  prompt: string
): Promise<any> {
  await semaphore.acquire(); // 获取信号量
  
  try {
    const session = getAgentSession(sessionId);
    await session.prompt(prompt);
    return extractAnalysisResult(session);
  } finally {
    semaphore.release(); // 释放信号量
  }
}

// 或使用 p-limit
import pLimit from "p-limit";

const limit = pLimit(5); // 最多 5 个并发

const analyzeWithLimit = limit(async () => {
  // 分析逻辑
});
```

## 5. 大规模仓库分析策略

### 5.1 分批处理

```typescript
interface RepositoryBatch {
  batchId: string;
  repositories: string[];
  analysisType: string;
  status: "pending" | "processing" | "completed" | "failed";
  results: AnalysisResult[];
}

class BatchAnalyzer {
  private batches = new Map<string, RepositoryBatch>();
  private semaphore = new Semaphore(10); // 并发数
  
  async analyzeBatch(batchId: string, repositories: string[], analysisType: string) {
    const batch: RepositoryBatch = {
      batchId,
      repositories,
      analysisType,
      status: "pending",
      results: [],
    };
    
    this.batches.set(batchId, batch);
    
    // 分批处理
    const batchSize = 50; // 每批 50 个仓库
    for (let i = 0; i < repositories.length; i += batchSize) {
      const chunk = repositories.slice(i, i + batchSize);
      await this.processChunk(batchId, chunk, analysisType);
    }
    
    batch.status = "completed";
    return batch;
  }
  
  private async processChunk(
    batchId: string,
    repositories: string[],
    analysisType: string
  ) {
    const promises = repositories.map(repo => 
      this.semaphore.acquire().then(async () => {
        try {
          const result = await this.analyzeRepository(repo, analysisType);
          return { repository: repo, result, success: true };
        } catch (error) {
          return { repository: repo, error: error.message, success: false };
        } finally {
          this.semaphore.release();
        }
      })
    );
    
    const results = await Promise.all(promises);
    this.updateBatchResults(batchId, results);
  }
}
```

### 5.2 断点续传

```typescript
interface AnalysisCheckpoint {
  batchId: string;
  processed: string[];
  failed: string[];
  pending: string[];
  timestamp: number;
}

class ResumableAnalyzer {
  private checkpoints = new Map<string, AnalysisCheckpoint>();
  
  async analyzeWithCheckpoint(
    batchId: string,
    repositories: string[],
    analysisType: string
  ) {
    // 检查是否有断点
    const checkpoint = this.checkpoints.get(batchId);
    let toProcess = repositories;
    
    if (checkpoint) {
      // 从断点继续
      toProcess = checkpoint.pending;
      console.log(`Resuming from ${checkpoint.processed.length} processed repos`);
    }
    
    // 处理剩余仓库
    for (const repo of toProcess) {
      try {
        await this.analyzeRepository(repo, analysisType);
        
        // 更新断点
        this.updateCheckpoint(batchId, repo, "processed");
      } catch (error) {
        this.updateCheckpoint(batchId, repo, "failed");
      }
    }
  }
  
  private updateCheckpoint(
    batchId: string,
    repo: string,
    status: "processed" | "failed" | "pending"
  ) {
    const checkpoint = this.checkpoints.get(batchId) || {
      batchId,
      processed: [],
      failed: [],
      pending: [],
      timestamp: Date.now(),
    };
    
    if (status === "processed") {
      checkpoint.processed.push(repo);
    } else if (status === "failed") {
      checkpoint.failed.push(repo);
    } else {
      checkpoint.pending.push(repo);
    }
    
    checkpoint.timestamp = Date.now();
    this.checkpoints.set(batchId, checkpoint);
  }
}
```

### 5.3 结果持久化

```typescript
import { Pool } from "pg";

class ResultStorage {
  private pool: Pool;
  
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.initTable();
  }
  
  private async initTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS analysis_results (
        id SERIAL PRIMARY KEY,
        batch_id VARCHAR(255) NOT NULL,
        repository_url VARCHAR(1000) NOT NULL,
        analysis_type VARCHAR(100) NOT NULL,
        result JSONB NOT NULL,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_batch_id ON analysis_results(batch_id)
    `);
  }
  
  async saveResult(
    batchId: string,
    repository: string,
    analysisType: string,
    result: any,
    status: "success" | "failed" = "success",
    errorMessage?: string
  ) {
    await this.pool.query(
      `
      INSERT INTO analysis_results 
        (batch_id, repository_url, analysis_type, result, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (batch_id, repository_url) 
      DO UPDATE SET 
        result = EXCLUDED.result,
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        updated_at = CURRENT_TIMESTAMP
      `,
      [batchId, repository, analysisType, JSON.stringify(result), status, errorMessage]
    );
  }
  
  async getBatchResults(batchId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM analysis_results WHERE batch_id = $1`,
      [batchId]
    );
    return rows;
  }
}
```

## 6. 错误处理和重试策略

### 6.1 错误分类

```typescript
enum ErrorType {
  // 可重试错误
  RATE_LIMIT = "rate_limit",
  OVERLOADED = "overloaded",
  SERVER_ERROR = "server_error",
  NETWORK_ERROR = "network_error",
  
  // 不可重试错误
  INVALID_REQUEST = "invalid_request",
  AUTH_ERROR = "auth_error",
  CONTEXT_OVERFLOW = "context_overflow",
  TOOL_ERROR = "tool_error",
}

function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();
  
  if (message.includes("rate limit") || message.includes("429")) {
    return ErrorType.RATE_LIMIT;
  }
  
  if (message.includes("overloaded") || message.includes("503")) {
    return ErrorType.OVERLOADED;
  }
  
  if (message.includes("500") || message.includes("502")) {
    return ErrorType.SERVER_ERROR;
  }
  
  if (message.includes("network") || message.includes("ECONNRESET")) {
    return ErrorType.NETWORK_ERROR;
  }
  
  if (message.includes("invalid") || message.includes("400")) {
    return ErrorType.INVALID_REQUEST;
  }
  
  if (message.includes("auth") || message.includes("401") || message.includes("403")) {
    return ErrorType.AUTH_ERROR;
  }
  
  if (message.includes("context") || message.includes("overflow")) {
    return ErrorType.CONTEXT_OVERFLOW;
  }
  
  return ErrorType.TOOL_ERROR;
}
```

### 6.2 智能重试

```typescript
class SmartRetry {
  private retryCounters = new Map<string, number>();
  private backoffTimes = new Map<string, number>();
  
  async executeWithRetry<T>(
    key: string,
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    const attempts = this.retryCounters.get(key) || 0;
    
    try {
      const result = await fn();
      
      // 成功后重置计数器
      this.retryCounters.delete(key);
      this.backoffTimes.delete(key);
      
      return result;
    } catch (error) {
      const errorType = classifyError(error);
      
      // 不可重试错误，立即失败
      if (this.isNonRetryable(errorType)) {
        this.retryCounters.delete(key);
        throw error;
      }
      
      // 检查重试次数
      if (attempts >= maxRetries) {
        this.retryCounters.delete(key);
        throw new Error(`Max retries exceeded: ${error.message}`);
      }
      
      // 计算退避时间
      const backoff = this.backoffTimes.get(key) || baseDelay;
      await this.sleep(backoff);
      
      // 更新计数器和退避时间
      this.retryCounters.set(key, attempts + 1);
      this.backoffTimes.set(key, Math.min(backoff * 2, 30000)); // 最大 30s
      
      // 重试
      return this.executeWithRetry(key, fn, maxRetries, baseDelay);
    }
  }
  
  private isNonRetryable(errorType: ErrorType): boolean {
    return [
      ErrorType.INVALID_REQUEST,
      ErrorType.AUTH_ERROR,
      ErrorType.CONTEXT_OVERFLOW,
    ].includes(errorType);
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 6.3 超时控制

```typescript
class TimeoutHandler {
  async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    errorMessage: string = "Operation timed out"
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const result = await fn();
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(errorMessage);
      }
      
      throw error;
    }
  }
}

// 使用示例
const timeoutHandler = new TimeoutHandler();

await timeoutHandler.executeWithTimeout(
  async () => {
    await session.prompt(prompt);
  },
  120000, // 2 分钟超时
  "Analysis timed out after 2 minutes"
);
```

## 7. 性能优化

### 7.1 并发优化

```typescript
import pLimit from "p-limit";

class ConcurrentAnalyzer {
  private limit = pLimit(10); // 最多 10 个并发
  
  async analyzeRepositories(
    repositories: string[],
    analysisType: string
  ): Promise<AnalysisResult[]> {
    const promises = repositories.map(repo => 
      this.limit(async () => {
        const result = await this.analyzeRepository(repo, analysisType);
        return { repository: repo, result };
      })
    );
    
    return Promise.all(promises);
  }
}
```

### 7.2 上下文优化

```typescript
class ContextOptimizer {
  async optimizeContext(
    session: AgentSession,
    maxTokens: number = 100000
  ): Promise<void> {
    const currentTokens = this.estimateContextTokens(session);
    
    if (currentTokens > maxTokens * 0.8) {
      // 触发自动压缩
      await session.compact({
        instructions: "Summarize older messages, keep recent context",
      });
    }
  }
  
  private estimateContextTokens(session: AgentSession): number {
    // 简化估算
    const messages = session.messages;
    let tokens = 0;
    
    for (const msg of messages) {
      // 每个消息大约 4 个 tokens per character
      tokens += JSON.stringify(msg).length * 4;
    }
    
    return tokens;
  }
}
```

### 7.3 缓存策略

```typescript
import Redis from "ioredis";

class AnalysisCache {
  private redis: Redis;
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }
  
  async getCachedResult(repository: string, analysisType: string): Promise<any | null> {
    const key = `analysis:${repository}:${analysisType}`;
    const cached = await this.redis.get(key);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  }
  
  async setCachedResult(
    repository: string,
    analysisType: string,
    result: any,
    ttl: number = 3600 // 1 小时
  ) {
    const key = `analysis:${repository}:${analysisType}`;
    await this.redis.set(key, JSON.stringify(result), "EX", ttl);
  }
  
  async invalidateCache(repository: string, analysisType?: string) {
    if (analysisType) {
      const key = `analysis:${repository}:${analysisType}`;
      await this.redis.del(key);
    } else {
      // 清除所有缓存
      const cursor = await this.redis.scan(0, "MATCH", `analysis:${repository}:*`, "COUNT", 100);
      await this.redis.del(...cursor.keys);
    }
  }
}
```

## 8. 监控和日志

### 8.1 关键指标

```typescript
interface AnalysisMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retryCount: number;
  avgResponseTime: number;
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  errorBreakdown: Record<string, number>;
}

class MetricsCollector {
  private metrics: AnalysisMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retryCount: 0,
    avgResponseTime: 0,
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    errorBreakdown: {},
  };
  
  recordRequest(start: number, message: AssistantMessage) {
    const duration = Date.now() - start;
    
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.metrics.avgResponseTime = 
      (this.metrics.avgResponseTime * (this.metrics.totalRequests - 1) + duration) 
      / this.metrics.totalRequests;
    
    // 累加 token 使用
    if (message.usage) {
      this.metrics.tokenUsage.input += message.usage.input;
      this.metrics.tokenUsage.output += message.usage.output;
      this.metrics.tokenUsage.cacheRead += message.usage.cacheRead || 0;
      this.metrics.tokenUsage.cacheWrite += message.usage.cacheWrite || 0;
      this.metrics.cost += message.usage.cost.total || 0;
    }
  }
  
  recordError(errorType: string) {
    this.metrics.failedRequests++;
    this.metrics.errorBreakdown[errorType] = 
      (this.metrics.errorBreakdown[errorType] || 0) + 1;
  }
  
  getMetrics() {
    return { ...this.metrics };
  }
}
```

### 8.2 日志策略

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// 详细日志（开发环境）
if (process.env.NODE_ENV === "development") {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// 结构化日志
logger.info("Analysis started", {
  repository: repoUrl,
  analysisType: "security",
  sessionId: sessionId,
  timestamp: new Date().toISOString(),
});
```

## 9. 完整示例

### 9.1 Express 服务器

```typescript
import express, { Request, Response } from "express";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import Bull from "bull";
import { Pool } from "pg";
import pLimit from "p-limit";

const app = express();
app.use(express.json({ limit: "50mb" }));

// 初始化组件
const gpt5Model = getModel("openai", "gpt-5.1");
const analysisQueue = new Bull("analysis", { redis: { host: "localhost" } });
const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
const semaphore = pLimit(10); // 并发控制

// 任务处理器
analysisQueue.process(async (job) => {
  const { repositoryUrl, analysisType, jobId } = job.data;
  
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    model: gpt5Model,
    thinkingLevel: "high",
  });
  
  try {
    const prompt = buildAnalysisPrompt(repositoryUrl, analysisType);
    await session.prompt(prompt);
    
    const result = extractAnalysisResult(session);
    await saveResultToDB(dbPool, jobId, result);
    
    return { success: true, result };
  } catch (error) {
    if (job.attemptsMade < 3) {
      throw error;
    }
    return { success: false, error: error.message };
  }
});

// API 端点
app.post("/api/analyze/batch", async (req: Request, res: Response) => {
  const { repositories, analysisType } = req.body;
  
  const job = await analysisQueue.add({
    repositories,
    analysisType,
    timestamp: Date.now(),
  });
  
  res.json({ jobId: job.id, status: "queued", total: repositories.length });
});

app.get("/api/job/:jobId", async (req: Request, res: Response) => {
  const job = await analysisQueue.getJob(req.params.jobId);
  res.json({ jobId: job.id, state: await job.getState(), progress: job.progress });
});

app.get("/api/metrics", async (req: Request, res: Response) => {
  res.json(getMetrics()); // 从 MetricsCollector 获取
});

app.listen(3000, () => {
  console.log("Analysis server running on port 3000");
});
```

### 9.2 分析工作流

```typescript
async function analyzeRepository(
  session: AgentSession,
  repositoryUrl: string,
  analysisType: string
): Promise<AnalysisResult> {
  // 1. 克隆仓库
  const cloneResult = await executeBash(session, `git clone ${repositoryUrl} /tmp/repo`);
  
  if (!cloneResult.success) {
    throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
  }
  
  // 2. 分析代码
  const analysisPrompt = `
  Analyze the repository at /tmp/repo for ${analysisType} issues.
  
  Focus on:
  1. Code quality
  2. Security vulnerabilities
  3. Performance issues
  4. Best practices
  
  Provide a detailed report with:
  - Summary of findings
  - Severity ratings
  - Code examples
  - Recommendations
  `;
  
  await session.prompt(analysisPrompt);
  
  // 3. 提取结果
  const result = extractAnalysisResult(session);
  
  // 4. 清理
  await executeBash(session, "rm -rf /tmp/repo");
  
  return result;
}

function buildAnalysisPrompt(repositoryUrl: string, analysisType: string): string {
  return `
  Analyze the GitHub repository ${repositoryUrl} for ${analysisType} issues.
  
  Please:
  1. Clone the repository
  2. Analyze the codebase
  3. Generate a detailed report
  
  Report format:
  ## Summary
  [Brief summary]
  
  ## Findings
  [Detailed findings with severity]
  
  ## Recommendations
  [Actionable recommendations]
  `;
}
```

## 10. 最佳实践

### 10.1 生产环境配置

```typescript
const productionConfig = {
  // 模型配置
  model: getModel("openai", "gpt-5.1"),
  thinkingLevel: "medium", // 平衡准确性和成本
  
  // 重试配置
  retry: {
    enabled: true,
    maxRetries: 1, // 快速失败
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  },
  
  // 工具超时
  tools: {
    write: { timeout: 30000 },
    edit: { timeout: 30000 },
    read: { timeout: 15000 },
    bash: { timeout: 60000 },
  },
  
  // 并发控制
  concurrency: {
    maxSessions: 10,
    maxRetriesPerRequest: 3,
  },
  
  // 监控
  monitoring: {
    metricsCollection: true,
    errorLogging: true,
    performanceTracking: true,
  },
};
```

### 10.2 成本控制

```typescript
const costControl = {
  // 1. 使用思考级别控制
  thinkingLevel: {
    simple: "minimal",
    medium: "medium",
    complex: "high",
  },
  
  // 2. 上下文压缩
  compaction: {
    enabled: true,
    threshold: 0.75,
  },
  
  // 3. 批量处理
  batching: {
    enabled: true,
    maxSize: 5,
  },
  
  // 4. 缓存
  caching: {
    enabled: true,
    ttl: 3600, // 1 小时
  },
  
  // 5. 速率限制
  rateLimiting: {
    enabled: true,
    requestsPerMinute: 60,
  },
};
```

## 11. 常见问题

### 11.1 上下文窗口溢出

**问题**：GPT-5.1 上下文窗口 128K，分析大仓库时可能溢出

**解决方案**：
1. 启用自动压缩
2. 手动压缩旧消息
3. 分批处理文件
4. 使用摘要替代完整内容

```typescript
// 自动压缩配置
const session = await createAgentSession({
  settings: {
    context: {
      compactionThreshold: 0.75, // 75% 时压缩
    },
  },
});

// 手动压缩
await session.compact({
  instructions: "Summarize messages before turn 10",
});
```

### 11.2 API 速率限制

**问题**：GPT-5.1 有速率限制

**解决方案**：
1. 实现指数退避重试
2. 使用队列控制并发
3. 监控速率限制状态

```typescript
// 速率限制器
class RateLimiter {
  private requests: number[] = [];
  private limit = 60; // 每分钟 60 次
  
  async wait(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < 60000);
    
    if (this.requests.length >= this.limit) {
      const oldest = this.requests[0];
      const waitTime = 60000 - (now - oldest);
      await sleep(waitTime + 1000);
    }
    
    this.requests.push(now);
  }
}
```

### 11.3 内存泄漏

**问题**：长时间运行的 Express 服务器可能出现内存泄漏

**解决方案**：
1. 定期清理旧 Session
2. 使用内存监控
3. 实现健康检查

```typescript
// 清理旧 Session
setInterval(() => {
  const now = Date.now();
  const maxAge = 3600000; // 1 小时
  
  for (const [id, session] of agentSessions) {
    if (now - session.createdAt > maxAge) {
      session.dispose();
      agentSessions.delete(id);
    }
  }
}, 60000); // 每分钟检查
```

## 12. 性能基准

### 12.1 GPT-5.1 性能

| 操作 | 平均耗时 | 成本估算 |
|------|----------|----------|
| 简单分析 (minimal) | 5-10s | $0.002/请求 |
| 中等分析 (medium) | 10-20s | $0.005/请求 |
| 复杂分析 (high) | 20-40s | $0.01/请求 |
| 批量分析 (5个) | 30-60s | $0.025/批 |

### 12.2 优化后性能

| 配置 | 吞吐量 | 成本降低 |
|------|--------|----------|
| 基础配置 | 10 req/min | - |
| 并发优化 | 50 req/min | 20% |
| 缓存 | 100 req/min | 50% |
| 批量处理 | 200 req/min | 70% |

## 结论

使用 pi-coding-agent SDK 在 Express.js 中分析 1000+ GitHub 仓库的关键要点：

1. **架构选择**：根据需求选择单例、池或无状态模式
2. **GPT-5.1 配置**：使用 high 思考级别，启用自动压缩
3. **错误处理**：实现智能重试和分类处理
4. **性能优化**：并发控制、上下文优化、缓存策略
5. **监控日志**：收集关键指标，记录详细日志
6. **成本控制**：使用思考级别、批量处理、缓存

遵循这些最佳实践，可以构建高性能、高可靠性的仓库分析系统。
