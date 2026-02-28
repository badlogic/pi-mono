# Long-Running Task Skill 设计方案研究报告

## 一、需求分析

### 1.1 任务特征

| 特征 | 说明 |
|------|------|
| **任务类型** | 代码审查/分析 |
| **执行模式** | 完全自主（无需人工干预） |
| **关键能力** | Plan & Execute + Subagent 协作 + 状态持久化 + 进度追踪 |
| **运行时长** | 可能消耗大量 tokens，需要数分钟到数小时 |

### 1.2 核心挑战

1. **上下文窗口限制** - 大型代码库无法一次性加载
2. **任务中断恢复** - 需要保存中间状态
3. **进度可视化** - 长时间运行需要反馈
4. **错误处理** - 单步失败不应导致整体失败
5. **Token 效率** - 避免重复分析已处理的内容

---

## 二、参考实现分析

### 2.1 pi-coding-agent 现有机制

#### Plan Mode 扩展 (`examples/extensions/plan-mode/`)

**核心功能：**
- Read-only 探索模式
- 计划提取与步骤追踪
- `[DONE:n]` 标记机制
- 进度 widget 显示

**代码参考：**
```typescript
// plan-mode/index.ts:15-20
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];

// 状态持久化
function persistState(): void {
    pi.appendEntry("plan-mode", {
        enabled: planModeEnabled,
        todos: todoItems,
        executing: executionMode,
    });
}
```

**局限性：**
- 需要交互式 UI
- 单进程执行，无 subagent 协作

#### Subagent 扩展 (`examples/extensions/subagent/`)

**核心功能：**
- 三种执行模式：Single / Parallel / Chain
- 独立进程隔离上下文
- JSON 模式结构化输出
- 并发控制（MAX_CONCURRENCY = 4）

**代码参考：**
```typescript
// subagent/index.ts:195-210
async function mapWithConcurrencyLimit<TIn, TOut>(
    items: TIn[],
    concurrency: number,
    fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]>

// subagent/index.ts:400-415
pi.registerTool({
    name: "subagent",
    parameters: SubagentParams,  // single/parallel/chain 模式
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
        const discovery = discoverAgents(ctx.cwd, agentScope);
        // ...
    }
});
```

**优势：**
- 进程隔离避免上下文污染
- 支持并行加速
- 实时流式更新

#### Session 持久化 (`core/session-manager.ts`)

**核心功能：**
- 会话版本管理（CURRENT_SESSION_VERSION = 3）
- 自定义 Entry 存储扩展状态
- 分支和压缩支持

**代码参考：**
```typescript
// session-manager.ts:76-85
export interface CustomEntry<T = unknown> extends SessionEntryBase {
    type: "custom";
    customType: string;
    data?: T;
}

// 使用方式
pi.appendEntry("my-skill", { phase: "analyzing", progress: 50 });
```

### 2.2 其他 Coding Agent 参考

#### Claude Code (Anthropic)

**特点：**
- `/plan` 命令生成执行计划
- 自动工具调用循环
- 会话状态自动保存

**可借鉴：**
- 计划-执行分离的架构
- 隐式状态管理

#### Aider (Paul Gauthier)

**特点：**
- 基于 Git 的 checkpoint 机制
- 代码地图 (repo map) 压缩上下文
- 多文件编辑协调

**可借鉴：**
- Git checkpoint 用于错误恢复
- Repo map 减少 token 消耗

#### OpenClaw

**特点：**
- 完整的内存系统
- 会话归档和检索
- 跨会话记忆

**可借鉴：**
- 会话总结机制
- 长期记忆存储

---

## 三、设计方案

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    LongRunningTaskSkill                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Task Planner│  │  Executor   │  │   State Manager         │  │
│  │             │  │             │  │                         │  │
│  │ - 分解任务  │  │ - 调度执行  │  │ - 保存/恢复状态         │  │
│  │ - 生成计划  │  │ - 错误处理  │  │ - 进度追踪              │  │
│  │ - 估算成本  │  │ - 结果汇总  │  │ - 检查点管理            │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
│         │                │                                       │
│         └────────────────┼───────────────────────────────────────┘
│                          │
│  ┌───────────────────────┴───────────────────────────────────┐  │
│  │                    Subagent Pool                          │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │  │
│  │  │ Analyzer│ │ Reviewer│ │  Doc    │ │    ...          │ │  │
│  │  │ 分析代码 │ │审查问题 │ │生成文档 │ │                 │ │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件设计

#### 3.2.1 Task Planner（任务规划器）

**职责：**
1. 分析任务需求
2. 分解为可执行步骤
3. 估算 token 成本
4. 生成执行计划

**输入：**
```typescript
interface TaskRequest {
    type: "code-review" | "refactor" | "analyze";
    target: string;           // 文件/目录/模式
    scope: "file" | "module" | "project";
    constraints?: {
        maxTokens?: number;
        maxTime?: number;
        tools?: string[];
    };
}
```

**输出：**
```typescript
interface ExecutionPlan {
    steps: PlanStep[];
    estimatedTokens: number;
    estimatedTime: number;
    checkpoints: string[];    // 可恢复的检查点
}

interface PlanStep {
    id: string;
    type: "analyze" | "review" | "document" | "summarize";
    agent: string;            // 使用的 subagent
    target: string;           // 目标文件/目录
    dependencies: string[];   // 依赖的步骤
    estimatedTokens: number;
}
```

#### 3.2.2 Executor（执行器）

**职责：**
1. 调度 subagent 执行
2. 管理并发（避免 rate limit）
3. 处理错误和重试
4. 收集结果

**并发控制：**
```typescript
const MAX_CONCURRENT_AGENTS = 3;  // 避免 rate limit
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;
```

**错误处理策略：**
| 错误类型 | 处理策略 |
|---------|---------|
| Rate limit | 指数退避重试 |
| Context overflow | 分割任务 |
| Subagent 失败 | 标记为失败，继续其他步骤 |
| 超时 | 取消任务，保存状态 |

#### 3.2.3 State Manager（状态管理器）

**职责：**
1. 保存执行状态到 session
2. 支持中断恢复
3. 管理检查点
4. 追踪进度

**状态结构：**
```typescript
interface TaskState {
    version: number;
    taskId: string;
    status: "planning" | "executing" | "paused" | "completed" | "failed";
    plan: ExecutionPlan;
    completedSteps: string[];
    failedSteps: Array<{ stepId: string; error: string }>;
    results: Map<string, StepResult>;
    checkpoints: Checkpoint[];
    metadata: {
        startTime: number;
        totalTokens: number;
        estimatedRemaining: number;
    };
}

interface Checkpoint {
    id: string;
    timestamp: number;
    completedSteps: string[];
    state: TaskState;
}
```

**持久化机制：**
```typescript
// 使用 session 的 custom entry
function saveState(state: TaskState) {
    pi.appendEntry("long-task", {
        type: "state",
        version: 1,
        data: state,
    });
}

// 恢复时读取
function loadState(session: Session): TaskState | null {
    const entries = session.getEntries("long-task")
        .filter(e => e.type === "state");
    return entries.length > 0 ? entries[entries.length - 1].data : null;
}
```

### 3.3 Subagent 设计

#### 3.3.1 专用 Agent 定义

**代码分析 Agent (`agents/analyzer.md`)：**
```markdown
---
name: code-analyzer
description: Analyze code structure, dependencies, and patterns
tools: read, grep, find, ls
model: claude-sonnet-4-5
---

You are a code analysis specialist. Your task is to:
1. Read and understand the target code
2. Identify code structure and patterns
3. Find dependencies and relationships
4. Detect potential issues

Output format:
```json
{
    "summary": "Brief description of the code",
    "structure": { "files": [], "modules": [] },
    "dependencies": [],
    "issues": [],
    "metrics": { "lines": 0, "complexity": 0 }
}
```
```

**代码审查 Agent (`agents/reviewer.md`)：**
```markdown
---
name: code-reviewer
description: Review code for bugs, security, and best practices
tools: read, grep
model: claude-sonnet-4-5
---

You are a code review specialist. Review the provided code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Best practice violations

Output format:
```json
{
    "issues": [
        {
            "severity": "high|medium|low",
            "type": "bug|security|performance|style",
            "location": "file:line",
            "description": "...",
            "suggestion": "..."
        }
    ],
    "score": 85
}
```
```

**文档生成 Agent (`agents/documenter.md`)：**
```markdown
---
name: documenter
description: Generate documentation from code analysis
tools: read
model: claude-sonnet-4-5
---

Generate comprehensive documentation based on code analysis results.

Output format:
```markdown
# Module Documentation

## Overview
...

## API Reference
...

## Examples
...
```
```

#### 3.3.2 Agent 调用模式

**并行分析（适用于独立模块）：**
```typescript
const results = await runSubagents({
    mode: "parallel",
    tasks: modules.map(m => ({
        agent: "code-analyzer",
        task: `Analyze module: ${m.path}`,
    })),
});
```

**链式处理（适用于依赖分析）：**
```typescript
const result = await runSubagents({
    mode: "chain",
    steps: [
        { agent: "code-analyzer", task: "Analyze structure" },
        { agent: "code-reviewer", task: "Review issues in: {previous}" },
        { agent: "documenter", task: "Generate docs from: {previous}" },
    ],
});
```

### 3.4 进度追踪设计

#### 3.4.1 进度计算

```typescript
function calculateProgress(state: TaskState): Progress {
    const total = state.plan.steps.length;
    const completed = state.completedSteps.length;
    const failed = state.failedSteps.length;
    
    return {
        percentage: Math.round((completed / total) * 100),
        completed,
        failed,
        remaining: total - completed - failed,
        estimatedTimeRemaining: calculateETA(state),
    };
}
```

#### 3.4.2 实时更新

```typescript
// 每完成一个步骤更新
function onStepComplete(stepId: string, result: StepResult) {
    state.completedSteps.push(stepId);
    state.results.set(stepId, result);
    
    // 更新 UI
    updateProgressWidget(calculateProgress(state));
    
    // 保存检查点
    if (shouldCheckpoint(state)) {
        createCheckpoint(state);
    }
    
    // 持久化状态
    saveState(state);
}
```

### 3.5 Token 优化策略

#### 3.5.1 代码地图 (Repo Map)

**目的：** 在不加载完整代码的情况下了解项目结构

**实现：**
```typescript
interface RepoMap {
    files: Array<{
        path: string;
        type: "source" | "test" | "config" | "doc";
        size: number;
        exports: string[];
        imports: string[];
    }>;
    modules: Array<{
        name: string;
        files: string[];
        dependencies: string[];
    }>;
}

// 生成轻量级地图
async function generateRepoMap(cwd: string): Promise<RepoMap> {
    // 使用 bash 命令快速扫描
    const files = await bash({
        command: `find ${cwd} -type f -name "*.ts" -o -name "*.js" | head -100`,
    });
    // 解析 import/export
    // ...
}
```

#### 3.5.2 智能分块

**策略：**
1. 按模块边界分割
2. 相关文件分组
3. 优先分析核心文件

```typescript
function chunkFiles(files: string[], maxChunkSize: number): string[][] {
    const chunks: string[][] = [];
    let currentChunk: string[] = [];
    let currentSize = 0;
    
    for (const file of sortByPriority(files)) {
        const size = estimateFileSize(file);
        if (currentSize + size > maxChunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentSize = 0;
        }
        currentChunk.push(file);
        currentSize += size;
    }
    
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}
```

---

## 四、实现建议

### 4.1 文件结构

```
skill-long-task/
├── README.md                 # 使用文档
├── SKILL.md                  # Skill 定义和元数据
├── package.json              # 依赖声明
├── src/
│   ├── index.ts              # 入口，注册工具和命令
│   ├── planner.ts            # 任务规划器
│   ├── executor.ts           # 执行器
│   ├── state-manager.ts      # 状态管理
│   ├── progress.ts           # 进度追踪
│   └── utils/
│       ├── repo-map.ts       # 代码地图生成
│       ├── chunking.ts       # 智能分块
│       └── token-estimator.ts # Token 估算
├── agents/
│   ├── analyzer.md           # 代码分析 agent
│   ├── reviewer.md           # 代码审查 agent
│   ├── documenter.md         # 文档生成 agent
│   └── summarizer.md         # 总结 agent
└── prompts/
    ├── plan-generation.md    # 计划生成提示
    └── result-synthesis.md   # 结果汇总提示
```

### 4.2 关键代码片段

#### 注册 Skill

```typescript
// src/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { TaskPlanner } from "./planner.js";
import { Executor } from "./executor.js";
import { StateManager } from "./state-manager.js";

export default function (pi: ExtensionAPI) {
    const stateManager = new StateManager(pi);
    const planner = new TaskPlanner(pi);
    const executor = new Executor(pi, stateManager);
    
    // 注册长任务工具
    pi.registerTool({
        name: "long_task",
        label: "Long Task",
        description: "Execute long-running code analysis tasks",
        parameters: TaskParamsSchema,
        
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            // 检查是否有恢复的状态
            const savedState = await stateManager.load(ctx.session);
            
            if (savedState && savedState.status === "paused") {
                // 恢复任务
                return executor.resume(savedState, signal, onUpdate);
            }
            
            // 生成计划
            const plan = await planner.createPlan(params, ctx);
            
            // 执行
            return executor.execute(plan, signal, onUpdate);
        },
    });
    
    // 注册命令
    pi.registerCommand("task-status", {
        description: "Show long task status",
        async run(ctx) {
            const state = await stateManager.load(ctx.session);
            if (state) {
                ctx.ui.notify(`Progress: ${state.completedSteps.length}/${state.plan.steps.length}`);
            }
        },
    });
}
```

#### 状态管理实现

```typescript
// src/state-manager.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Session } from "@mariozechner/pi-agent-core";

const STATE_VERSION = 1;
const STATE_TYPE = "long-task-state";

export class StateManager {
    constructor(private pi: ExtensionAPI) {}
    
    async save(state: TaskState): Promise<void> {
        this.pi.appendEntry(STATE_TYPE, {
            version: STATE_VERSION,
            timestamp: Date.now(),
            data: state,
        });
    }
    
    async load(session: Session): Promise<TaskState | null> {
        const entries = session.getEntries(STATE_TYPE);
        if (entries.length === 0) return null;
        
        // 获取最新的状态
        const latest = entries
            .filter(e => e.version === STATE_VERSION)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        return latest?.data ?? null;
    }
    
    async createCheckpoint(state: TaskState): Promise<void> {
        const checkpoint: Checkpoint = {
            id: generateId(),
            timestamp: Date.now(),
            completedSteps: [...state.completedSteps],
            state: structuredClone(state),
        };
        
        state.checkpoints.push(checkpoint);
        await this.save(state);
    }
}
```

#### 执行器实现

```typescript
// src/executor.ts
import { mapWithConcurrencyLimit } from "./utils/concurrency.js";

const MAX_CONCURRENT = 3;
const CHECKPOINT_INTERVAL = 5; // 每5步创建检查点

export class Executor {
    constructor(
        private pi: ExtensionAPI,
        private stateManager: StateManager,
    ) {}
    
    async execute(
        plan: ExecutionPlan,
        signal: AbortSignal,
        onUpdate: OnUpdateCallback,
    ): Promise<ToolResult> {
        const state: TaskState = {
            version: 1,
            taskId: generateId(),
            status: "executing",
            plan,
            completedSteps: [],
            failedSteps: [],
            results: new Map(),
            checkpoints: [],
            metadata: {
                startTime: Date.now(),
                totalTokens: 0,
                estimatedRemaining: plan.estimatedTime,
            },
        };
        
        // 拓扑排序步骤（处理依赖）
        const sortedSteps = topologicalSort(plan.steps);
        
        // 分批执行
        for (let i = 0; i < sortedSteps.length; i += MAX_CONCURRENT) {
            if (signal.aborted) {
                state.status = "paused";
                await this.stateManager.save(state);
                throw new Error("Task aborted");
            }
            
            const batch = sortedSteps.slice(i, i + MAX_CONCURRENT);
            
            // 并行执行批次
            await mapWithConcurrencyLimit(
                batch,
                MAX_CONCURRENT,
                async (step) => this.executeStep(step, state, onUpdate),
            );
            
            // 检查点
            if (i % CHECKPOINT_INTERVAL === 0) {
                await this.stateManager.createCheckpoint(state);
            }
        }
        
        state.status = "completed";
        await this.stateManager.save(state);
        
        return this.synthesizeResults(state);
    }
    
    private async executeStep(
        step: PlanStep,
        state: TaskState,
        onUpdate: OnUpdateCallback,
    ): Promise<void> {
        try {
            // 调用 subagent
            const result = await this.runSubagent(step);
            
            state.completedSteps.push(step.id);
            state.results.set(step.id, result);
            state.metadata.totalTokens += result.tokensUsed;
            
            // 通知更新
            onUpdate({
                content: [{ type: "text", text: `Completed: ${step.id}` }],
                details: { progress: this.calculateProgress(state) },
            });
            
        } catch (error) {
            state.failedSteps.push({
                stepId: step.id,
                error: error.message,
            });
        }
        
        await this.stateManager.save(state);
    }
    
    private async runSubagent(step: PlanStep): Promise<StepResult> {
        // 使用 subagent 工具
        const result = await this.pi.callTool("subagent", {
            agent: step.agent,
            task: step.task,
        });
        
        return result;
    }
}
```

### 4.3 使用示例

**启动代码审查任务：**
```typescript
// 用户输入
{
    "tool": "long_task",
    "params": {
        "type": "code-review",
        "target": "./src",
        "scope": "project",
        "options": {
            "includeTests": true,
            "focusAreas": ["security", "performance"],
            "outputFormat": "markdown"
        }
    }
}
```

**任务执行流程：**
```
1. TaskPlanner 分析项目结构
   └── 生成 Repo Map
   └── 估算 token 成本
   └── 创建执行计划（15个步骤）

2. Executor 开始执行
   ├── Step 1-3: 并行分析核心模块 (3 subagents)
   ├── Checkpoint 1: 保存状态
   ├── Step 4-6: 并行分析工具模块
   ├── Checkpoint 2: 保存状态
   ├── ...
   └── Step 15: 生成总结报告

3. 结果汇总
   └── 合并所有子任务结果
   └── 生成最终报告
   └── 保存到文件
```

---

## 五、风险评估与缓解

### 5.1 主要风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Rate limiting | 任务中断 | 指数退避重试，并发限制 |
| Context overflow | 分析失败 | 智能分块，代码地图 |
| Token 超支 | 成本过高 | 事前估算，预算限制 |
| 任务无限循环 | 无法完成 | 步骤限制，超时检测 |
| 状态损坏 | 无法恢复 | 多版本检查点，校验和 |

### 5.2 监控指标

```typescript
interface TaskMetrics {
    // 进度指标
    stepsTotal: number;
    stepsCompleted: number;
    stepsFailed: number;
    
    // Token 指标
    tokensUsed: number;
    tokensEstimated: number;
    tokensPerStep: number;
    
    // 时间指标
    elapsedTime: number;
    estimatedTimeRemaining: number;
    averageStepTime: number;
    
    // 成本指标
    apiCalls: number;
    estimatedCost: number;
}
```

---

## 六、结论

### 6.1 可行性评估

| 方面 | 评估 | 说明 |
|------|------|------|
| 技术可行性 | ✅ 高 | pi-coding-agent 提供完整的扩展机制 |
| 实现复杂度 | ⚠️ 中等 | 需要精心设计状态管理和错误处理 |
| Token 效率 | ✅ 高 | 通过代码地图和分块优化 |
| 可维护性 | ✅ 高 | 模块化设计，清晰的职责分离 |

### 6.2 推荐实现路径

1. **Phase 1: 基础框架** (1-2 天)
   - Skill 注册和基本结构
   - 状态管理实现
   - 简单的顺序执行器

2. **Phase 2: Subagent 集成** (2-3 天)
   - Agent 定义文件
   - 并行执行支持
   - 结果汇总

3. **Phase 3: 高级功能** (2-3 天)
   - 代码地图生成
   - 智能分块
   - 进度追踪 UI

4. **Phase 4: 优化和测试** (2-3 天)
   - 错误处理完善
   - 性能优化
   - 大规模测试

### 6.3 关键成功因素

1. **状态持久化** - 确保任务可中断恢复
2. **Token 估算** - 避免运行中超出预算
3. **错误隔离** - 单步失败不影响整体
4. **进度可见** - 长时间运行需要反馈

---

## 附录：代码索引

| 组件 | 参考文件 | 行号 |
|------|---------|------|
| Session 持久化 | `packages/coding-agent/src/core/session-manager.ts` | 1-100 |
| Custom Entry | `packages/coding-agent/src/core/session-manager.ts` | 76-85 |
| Plan Mode | `packages/coding-agent/examples/extensions/plan-mode/index.ts` | 1-50 |
| Subagent | `packages/coding-agent/examples/extensions/subagent/index.ts` | 195-215 |
| Full Control SDK | `packages/coding-agent/examples/sdk/12-full-control.ts` | 1-80 |
| Summarize | `packages/coding-agent/examples/extensions/summarize.ts` | 1-50 |
