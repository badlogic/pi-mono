# OpenClaw Agents 协同执行架构设计与可扩展性分析

> 深度研究 OpenClaw 的多 Agent 协调执行机制、主从 Agent 生命周期管理、以及 Agent 内部状态冲突解决方案

---

## 一、架构概览

### 1.1 多 Agent 架构全景图

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              OpenClaw 多 Agent 协同架构                                              │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              主 Agent (Parent Agent)                                         │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                          Agent Loop (pi-embedded-runner)                             │   │   │
│   │   │                                                                                      │   │   │
│   │   │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │   │   │
│   │   │   │   Planning   │───▶│  Tool Call   │───▶│  Execution   │───▶│   Response   │     │   │   │
│   │   │   └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘     │   │   │
│   │   │                                                                                      │   │   │
│   │   │   Lane: Main (CommandLane.Main)                                                      │   │   │
│   │   │   Session: agent:{agentId}:main                                                      │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                        Subagent Tool (sessions_spawn)                                │   │   │
│   │   │                                                                                      │   │   │
│   │   │   spawnSubagentDirect({                                                            │   │   │
│   │   │     task: "分析代码依赖",                                                           │   │   │
│   │   │     label: "dependency-analysis",                                                   │   │   │
│   │   │     agentId: "analyzer",                                                            │   │   │
│   │   │     model: "anthropic/claude-sonnet-4",                                             │   │   │
│   │   │     runTimeoutSeconds: 300,                                                         │   │   │
│   │   │     cleanup: "delete"                                                               │   │   │
│   │   │   })                                                                                │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                  │                                                   │
│                                                  │ 1. 创建子 Agent Session                            │
│                                                  │ 2. 注册到 SubagentRegistry                         │
│                                                  │ 3. 启动嵌入式 Agent Run                            │
│                                                  ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              子 Agent 层 (Child Agents)                                      │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐     │   │
│   │   │    Subagent #1          │  │    Subagent #2          │  │    Subagent #N          │     │   │
│   │   │    (depth=1)            │  │    (depth=1)            │  │    (depth=1)            │     │   │
│   │   │                         │  │                         │  │                         │     │   │
│   │   │  Session:               │  │  Session:               │  │  Session:               │     │   │
│   │   │  agent:analyzer:        │  │  agent:tester:          │  │  agent:doc:             │     │   │
│   │   │  subagent:{uuid}        │  │  subagent:{uuid}        │  │  subagent:{uuid}        │     │   │
│   │   │                         │  │                         │  │                         │     │   │
│   │   │  Lane: Subagent         │  │  Lane: Subagent         │  │  Lane: Subagent         │     │   │
│   │   │  (CommandLane.Subagent) │  │  (CommandLane.Subagent) │  │  (CommandLane.Subagent) │     │   │
│   │   │                         │  │                         │  │                         │     │   │
│   │   │  spawnedBy: parent      │  │  spawnedBy: parent      │  │  spawnedBy: parent      │     │   │
│   │   │  spawnDepth: 1          │  │  spawnDepth: 1          │  │  spawnDepth: 1          │     │   │
│   │   └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘     │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                      嵌套子 Agent (Nested Subagents, depth=2)                        │   │   │
│   │   │                                                                                      │   │   │
│   │   │   Subagent #1 可以进一步 spawn 子 Agent (如果 maxSpawnDepth >= 2)                     │   │   │
│   │   │   Lane: Nested (CommandLane.Nested)                                                  │   │   │
│   │   │   spawnDepth: 2                                                                      │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                  │                                                   │
│                                                  │ 任务完成通知                                       │
│                                                  ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              结果回传机制 (Result Propagation)                               │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                         Subagent Announce Flow                                       │   │   │
│   │   │                                                                                      │   │   │
│   │   │   1. 子 Agent 完成 → 2. 读取输出 → 3. 构建通知消息 → 4. 发送给父 Agent                │   │   │
│   │   │                                                                                      │   │   │
│   │   │   Delivery Path:                                                                     │   │   │
│   │   │   - queued: 父 Agent 忙时入队，稍后批量处理                                         │   │   │
│   │   │   - steered: 直接插入父 Agent 的当前对话                                            │   │   │
│   │   │   - direct: 直接发送消息                                                            │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心组件关系图

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              核心组件关系                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   ┌───────────────────────────────┐         ┌───────────────────────────────┐                       │
│   │   sessions_spawn Tool         │         │   subagents Tool              │                       │
│   │   (创建子 Agent)               │         │   (管理子 Agent)               │                       │
│   │                               │         │                               │                       │
│   │   • spawnSubagentDirect()     │         │   • list: 列出活跃子 Agent     │                       │
│   │   • 参数验证                  │         │   • kill: 终止子 Agent         │                       │
│   │   • 深度检查                  │         │   • steer: 发送指令            │                       │
│   │   • 子 Agent 数量限制         │         │                               │                       │
│   └───────────────┬───────────────┘         └───────────────┬───────────────┘                       │
│                   │                                         │                                        │
│                   │                                         │                                        │
│                   ▼                                         ▼                                        │
│   ┌───────────────────────────────────────────────────────────────────────────────┐                 │
│   │                      SubagentRegistry (子 Agent 注册表)                        │                 │
│   │                                                                                │                 │
│   │   Map<string, SubagentRunRecord> subagentRuns                                  │                 │
│   │                                                                                │                 │
│   │   SubagentRunRecord:                                                           │                 │
│   │   ├── runId: string              // 唯一运行 ID                                │                 │
│   │   ├── childSessionKey: string    // 子 Agent Session Key                       │                 │
│   │   ├── requesterSessionKey: string // 父 Agent Session Key                      │                 │
│   │   ├── task: string               // 任务描述                                   │                 │
│   │   ├── createdAt: number          // 创建时间                                   │                 │
│   │   ├── startedAt?: number         // 开始时间                                   │                 │
│   │   ├── endedAt?: number           // 结束时间                                   │                 │
│   │   ├── outcome?: SubagentRunOutcome // 运行结果                                │                 │
│   │   ├── cleanup: "delete" | "keep" // 清理策略                                  │                 │
│   │   └── expectsCompletionMessage: boolean // 是否等待完成消息                   │                 │
│   │                                                                                │                 │
│   │   持久化: ~/.openclaw/state/subagents/runs.json                               │                 │
│   └───────────────────────────────┬───────────────────────────────────────────────┘                 │
│                                   │                                                                  │
│                                   │                                                                  │
│                                   ▼                                                                  │
│   ┌───────────────────────────────────────────────────────────────────────────────┐                 │
│   │                      pi-embedded-runner (嵌入式 Agent 运行器)                  │                 │
│   │                                                                                │                 │
│   │   ┌─────────────────────────────────────────────────────────────────────────┐ │                 │
│   │   │   ACTIVE_EMBEDDED_RUNS                                                 │  │ │                 │
│   │   │   Map<sessionId, EmbeddedPiQueueHandle>                                 │  │ │                 │
│   │   │                                                                          │  │ │                 │
│   │   │   EmbeddedPiQueueHandle:                                                │  │ │                 │
│   │   │   ├── queueMessage(text): Promise<void>    // 消息队列                  │  │ │                 │
│   │   │   ├── isStreaming(): boolean             // 是否正在流式输出          │  │ │                 │
│   │   │   ├── isCompacting(): boolean            // 是否正在压缩上下文        │  │ │                 │
│   │   │   └── abort(): void                      // 中止运行                  │  │ │                 │
│   │   └─────────────────────────────────────────────────────────────────────────┘ │                 │
│   │                                                                                │                 │
│   │   功能:                                                                        │                 │
│   │   • runEmbeddedPiAgent()     // 运行 Agent                                    │                 │
│   │   • abortEmbeddedPiRun()     // 中止 Agent                                    │                 │
│   │   • queueEmbeddedPiMessage() // 队列消息                                      │                 │
│   │   • waitForEmbeddedPiRunEnd() // 等待结束                                     │                 │
│   └───────────────────────────────────────────────────────────────────────────────┘                 │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、多 Agent 协调执行机制

### 2.1 Agent 创建流程

```typescript
// agents/subagent-spawn.ts
// 子 Agent 创建的核心流程

export async function spawnSubagentDirect(
  params: SpawnSubagentParams,
  ctx: SpawnSubagentContext,
): Promise<SpawnSubagentResult> {
  // 1. 深度检查 - 防止无限递归
  const callerDepth = getSubagentDepthFromSessionStore(requesterInternalKey, { cfg });
  const maxSpawnDepth = cfg.agents?.defaults?.subagents?.maxSpawnDepth ?? 1;
  if (callerDepth >= maxSpawnDepth) {
    return {
      status: "forbidden",
      error: `sessions_spawn is not allowed at this depth (current: ${callerDepth}, max: ${maxSpawnDepth})`,
    };
  }

  // 2. 子 Agent 数量限制
  const maxChildren = cfg.agents?.defaults?.subagents?.maxChildrenPerAgent ?? 5;
  const activeChildren = countActiveRunsForSession(requesterInternalKey);
  if (activeChildren >= maxChildren) {
    return {
      status: "forbidden",
      error: `sessions_spawn has reached max active children (${activeChildren}/${maxChildren})`,
    };
  }

  // 3. Agent 权限检查
  const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
  if (!allowAny && !allowSet.has(normalizedTargetId)) {
    return { status: "forbidden", error: `agentId is not allowed` };
  }

  // 4. 创建子 Agent Session
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
  const childDepth = callerDepth + 1;
  
  await callGateway({
    method: "sessions.patch",
    params: { key: childSessionKey, spawnDepth: childDepth },
  });

  // 5. 设置模型和思考级别
  if (resolvedModel) {
    await callGateway({
      method: "sessions.patch",
      params: { key: childSessionKey, model: resolvedModel },
    });
  }

  // 6. 构建系统提示和任务消息
  const childSystemPrompt = buildSubagentSystemPrompt({
    requesterSessionKey,
    requesterOrigin,
    childSessionKey,
    label: label || undefined,
    task,
    childDepth,
    maxSpawnDepth,
  });

  const childTaskMessage = [
    `[Subagent Context] You are running as a subagent (depth ${childDepth}/${maxSpawnDepth}).`,
    `[Subagent Task]: ${task}`,
  ].join("\n\n");

  // 7. 启动子 Agent
  const response = await callGateway<{ runId: string }>({
    method: "agent",
    params: {
      message: childTaskMessage,
      sessionKey: childSessionKey,
      idempotencyKey: childIdem,
      deliver: false,
      lane: AGENT_LANE_SUBAGENT,  // 使用 Subagent Lane
      extraSystemPrompt: childSystemPrompt,
      spawnedBy: spawnedByKey,
    },
  });

  // 8. 注册到 SubagentRegistry
  registerSubagentRun({
    runId: childRunId,
    childSessionKey,
    requesterSessionKey: requesterInternalKey,
    requesterOrigin,
    task,
    cleanup,
    expectsCompletionMessage: params.expectsCompletionMessage === true,
  });

  return { status: "accepted", childSessionKey, runId: childRunId };
}
```

### 2.2 执行 Lane 机制

```typescript
// process/lanes.ts
// Lane 定义 - 用于隔离不同类型任务的执行

export const enum CommandLane {
  Main = "main",           // 主 Agent 执行
  Cron = "cron",           // 定时任务
  Subagent = "subagent",   // 子 Agent 执行
  Nested = "nested",       // 嵌套子 Agent (depth >= 2)
}

// agents/lanes.ts
export const AGENT_LANE_NESTED = CommandLane.Nested;
export const AGENT_LANE_SUBAGENT = CommandLane.Subagent;
```

**Lane 的作用**:
1. **并发控制**: 每个 Lane 有独立的执行队列
2. **资源隔离**: 防止子 Agent 阻塞主 Agent
3. **优先级管理**: Main Lane 优先级最高
4. **错误隔离**: Lane 内错误不影响其他 Lane

### 2.3 任务分发策略

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              任务分发策略                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   父 Agent 决定 spawn 子 Agent 的场景:                                                               │
│   ─────────────────────────────────                                                                  │
│                                                                                                      │
│   1. 任务分解 (Task Decomposition)                                                                   │
│      主 Agent: "我需要分析这个项目的依赖关系"                                                         │
│      → spawn analyzer subagent                                                                       │
│      → 等待结果 → 整合到主流程                                                                       │
│                                                                                                      │
│   2. 并行处理 (Parallel Processing)                                                                  │
│      主 Agent: "同时检查代码风格和运行测试"                                                           │
│      → spawn linter subagent (并行)                                                                  │
│      → spawn tester subagent (并行)                                                                  │
│      → 等待所有结果 → 综合报告                                                                       │
│                                                                                                      │
│   3. 专业化分工 (Specialization)                                                                     │
│      主 Agent: "这个任务需要特定的 Agent 能力"                                                        │
│      → spawn specialized agent (如 security-auditor)                                                 │
│      → 利用特定 Agent 的配置和工具                                                                   │
│                                                                                                      │
│   4. 错误隔离 (Fault Isolation)                                                                      │
│      主 Agent: "这个任务可能失败，需要隔离"                                                           │
│      → spawn subagent with timeout                                                                   │
│      → 即使失败也不影响主 Agent 状态                                                                 │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、主从 Agent 生命周期管理

### 3.1 生命周期状态机

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              子 Agent 生命周期状态机                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   ┌──────────┐     spawnSubagent      ┌──────────┐     agent event    ┌──────────┐                  │
│   │  Initial │ ─────────────────────▶ │ Accepted │ ─────────────────▶ │  Start   │                  │
│   └──────────┘                         └──────────┘                    └────┬─────┘                  │
│                                                                             │                        │
│                                                                             │ runEmbeddedPiAgent     │
│                                                                             ▼                        │
│   ┌──────────┐     completion/        ┌──────────┐     lifecycle        ┌──────────┐                  │
│   │ Cleaned  │ ◀───────────────────── │  Ended   │ ◀───────────────── │ Running  │                  │
│   └──────────┘     error/timeout      └──────────┘     "end"/"error"   └──────────┘                  │
│        │                                                                  │                          │
│        │ announce cleanup                                               │ abort/kill               │
│        │                                                                  │                          │
│        ▼                                                                  ▼                          │
│   ┌──────────┐                                                      ┌──────────┐                     │
│   │ Archived │                                                      │ Killed   │                     │
│   └──────────┘                                                      └──────────┘                     │
│                                                                                                      │
│   状态说明:                                                                                          │
│   ─────────                                                                                          │
│   • Initial:  创建请求已接收，正在处理                                                                │
│   • Accepted: 子 Agent Session 已创建，等待启动                                                       │
│   • Start:    收到 lifecycle "start" 事件，开始执行                                                   │
│   • Running:  正在执行任务                                                                            │
│   • Ended:    收到 lifecycle "end" 或 "error" 事件，执行结束                                          │
│   • Cleaned:  已完成结果通知和清理                                                                    │
│   • Archived: 已归档，等待最终删除                                                                    │
│   • Killed:   被父 Agent 主动终止                                                                     │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 生命周期管理代码

```typescript
// agents/subagent-registry.ts
// 子 Agent 生命周期管理核心

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  task: string;
  cleanup: "delete" | "keep";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
  expectsCompletionMessage?: boolean;
};

// 内存中的注册表
const subagentRuns = new Map<string, SubagentRunRecord>();

// 生命周期事件监听
function ensureListener() {
  if (listenerStarted) return;
  listenerStarted = true;
  
  listenerStop = onAgentEvent((evt) => {
    if (evt.stream !== "lifecycle") return;
    
    const entry = subagentRuns.get(evt.runId);
    if (!entry) return;

    const phase = evt.data?.phase;
    
    if (phase === "start") {
      // 记录开始时间
      entry.startedAt = evt.data?.startedAt;
      persistSubagentRuns();
    }
    else if (phase === "end" || phase === "error") {
      // 记录结束时间和结果
      entry.endedAt = evt.data?.endedAt ?? Date.now();
      
      if (phase === "error") {
        entry.outcome = { status: "error", error: evt.data?.error };
      } else if (evt.data?.aborted) {
        entry.outcome = { status: "timeout" };
      } else {
        entry.outcome = { status: "ok" };
      }
      
      persistSubagentRuns();
      
      // 启动结果通知流程
      startSubagentAnnounceCleanupFlow(evt.runId, entry);
    }
  });
}

// 持久化到磁盘
function persistSubagentRuns() {
  try {
    saveSubagentRegistryToDisk(subagentRuns);
  } catch {
    // ignore persistence failures
  }
}

// 定期清理归档的 runs
async function sweepSubagentRuns() {
  const now = Date.now();
  for (const [runId, entry] of subagentRuns.entries()) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) continue;
    
    subagentRuns.delete(runId);
    
    // 删除 session
    await callGateway({
      method: "sessions.delete",
      params: { key: entry.childSessionKey, deleteTranscript: true },
    });
  }
}
```

### 3.3 级联终止机制

```typescript
// agents/tools/subagents-tool.ts
// 级联终止：终止父 Agent 时同时终止所有子 Agent

async function cascadeKillChildren(params: {
  cfg: ReturnType<typeof loadConfig>;
  parentChildSessionKey: string;
  cache: Map<string, Record<string, SessionEntry>>;
  seenChildSessionKeys?: Set<string>;
}): Promise<{ killed: number; labels: string[] }> {
  // 获取该父 Agent 的所有子 Agent
  const childRuns = listSubagentRunsForRequester(params.parentChildSessionKey);
  const seenChildSessionKeys = params.seenChildSessionKeys ?? new Set<string>();
  let killed = 0;
  const labels: string[] = [];

  for (const run of childRuns) {
    const childKey = run.childSessionKey?.trim();
    if (!childKey || seenChildSessionKeys.has(childKey)) continue;
    seenChildSessionKeys.add(childKey);

    // 终止当前子 Agent
    if (!run.endedAt) {
      const stopResult = await killSubagentRun({
        cfg: params.cfg,
        entry: run,
        cache: params.cache,
      });
      if (stopResult.killed) {
        killed += 1;
        labels.push(resolveRunLabel(run));
      }
    }

    // 递归终止孙 Agent
    const cascade = await cascadeKillChildren({
      cfg: params.cfg,
      parentChildSessionKey: childKey,
      cache: params.cache,
      seenChildSessionKeys,
    });
    killed += cascade.killed;
    labels.push(...cascade.labels);
  }

  return { killed, labels };
}

// 终止单个 Agent
async function killSubagentRun(params: {
  cfg: ReturnType<typeof loadConfig>;
  entry: SubagentRunRecord;
  cache: Map<string, Record<string, SessionEntry>>;
}): Promise<{ killed: boolean; sessionId?: string }> {
  if (params.entry.endedAt) {
    return { killed: false };  // 已经结束了
  }

  const childSessionKey = params.entry.childSessionKey;
  const resolved = resolveSessionEntryForKey({...});
  const sessionId = resolved.entry?.sessionId;

  // 1. 中止嵌入式运行
  const aborted = sessionId ? abortEmbeddedPiRun(sessionId) : false;
  
  // 2. 清理消息队列
  const cleared = clearSessionQueues([childSessionKey, sessionId]);
  
  // 3. 标记为已终止
  await updateSessionStore(resolved.storePath, (store) => {
    const current = store[childSessionKey];
    if (current) {
      current.abortedLastRun = true;
      current.updatedAt = Date.now();
    }
  });

  // 4. 更新注册表
  markSubagentRunTerminated({
    runId: params.entry.runId,
    childSessionKey,
    reason: "killed",
  });

  return { killed: aborted || cleared.followupCleared > 0, sessionId };
}
```

---

## 四、Agent 内部状态冲突解决方案

### 4.1 深度限制防止无限递归

```typescript
// agents/subagent-depth.ts
// 深度追踪和限制

export function getSubagentDepthFromSessionStore(
  sessionKey: string | undefined | null,
  opts?: { cfg?: OpenClawConfig; store?: Record<string, SessionDepthEntry> }
): number {
  const raw = (sessionKey ?? "").trim();
  const fallbackDepth = getSubagentDepth(raw);  // 从 key 解析深度
  if (!raw) return fallbackDepth;

  const cache = new Map<string, Record<string, SessionDepthEntry>>();
  const visited = new Set<string>();

  const depthFromStore = (key: string): number | undefined => {
    const normalizedKey = normalizeSessionKey(key);
    if (!normalizedKey) return undefined;
    if (visited.has(normalizedKey)) return undefined;  // 防止循环
    visited.add(normalizedKey);

    // 从 session store 读取 spawnDepth
    const entry = resolveEntryForSessionKey({...});
    const storedDepth = normalizeSpawnDepth(entry?.spawnDepth);
    if (storedDepth !== undefined) return storedDepth;

    // 递归查找父 Agent 深度
    const spawnedBy = normalizeSessionKey(entry?.spawnedBy);
    if (!spawnedBy) return undefined;

    const parentDepth = depthFromStore(spawnedBy);
    if (parentDepth !== undefined) {
      return parentDepth + 1;
    }

    return getSubagentDepth(spawnedBy) + 1;
  };

  return depthFromStore(raw) ?? fallbackDepth;
}
```

### 4.2 子 Agent 数量限制

```typescript
// agents/subagent-spawn.ts

const maxChildren = cfg.agents?.defaults?.subagents?.maxChildrenPerAgent ?? 5;
const activeChildren = countActiveRunsForSession(requesterInternalKey);

if (activeChildren >= maxChildren) {
  return {
    status: "forbidden",
    error: `sessions_spawn has reached max active children (${activeChildren}/${maxChildren})`,
  };
}

// agents/subagent-registry.ts
export function countActiveRunsForSession(requesterSessionKey: string): number {
  let count = 0;
  for (const entry of subagentRuns.values()) {
    if (entry.requesterSessionKey !== requesterSessionKey) continue;
    if (entry.endedAt) continue;  // 只统计活跃的
    count++;
  }
  return count;
}
```

### 4.3 并发控制与队列管理

```typescript
// agents/pi-embedded-runner/runs.ts
// 嵌入式 Agent 运行的并发控制

type EmbeddedPiQueueHandle = {
  queueMessage: (text: string) => Promise<void>;
  isStreaming: () => boolean;
  isCompacting: () => boolean;
  abort: () => void;
};

// 活跃的嵌入式运行
const ACTIVE_EMBEDDED_RUNS = new Map<string, EmbeddedPiQueueHandle>();

// 等待运行结束的回调
const EMBEDDED_RUN_WAITERS = new Map<string, Set<EmbeddedRunWaiter>>();

export function setActiveEmbeddedRun(
  sessionId: string,
  handle: EmbeddedPiQueueHandle,
  sessionKey?: string
) {
  const wasActive = ACTIVE_EMBEDDED_RUNS.has(sessionId);
  ACTIVE_EMBEDDED_RUNS.set(sessionId, handle);
  
  logSessionStateChange({
    sessionId,
    sessionKey,
    state: "processing",
    reason: wasActive ? "run_replaced" : "run_started",
  });
}

export function clearActiveEmbeddedRun(
  sessionId: string,
  handle: EmbeddedPiQueueHandle,
  sessionKey?: string
) {
  if (ACTIVE_EMBEDDED_RUNS.get(sessionId) === handle) {
    ACTIVE_EMBEDDED_RUNS.delete(sessionId);
    
    logSessionStateChange({
      sessionId,
      sessionKey,
      state: "idle",
      reason: "run_completed",
    });
    
    notifyEmbeddedRunEnded(sessionId);
  }
}

// 等待运行结束
export function waitForEmbeddedPiRunEnd(
  sessionId: string, 
  timeoutMs = 15_000
): Promise<boolean> {
  if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
    return Promise.resolve(true);  // 已经结束了
  }

  return new Promise((resolve) => {
    const waiters = EMBEDDED_RUN_WAITERS.get(sessionId) ?? new Set();
    const waiter: EmbeddedRunWaiter = {
      resolve,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        resolve(false);  // 超时
      }, Math.max(100, timeoutMs)),
    };
    waiters.add(waiter);
    EMBEDDED_RUN_WAITERS.set(sessionId, waiters);
  });
}
```

### 4.4 结果通知的幂等性保证

```typescript
// agents/announce-idempotency.ts
// 结果通知的幂等性

export function buildAnnounceIdempotencyKey(announceId: string): string {
  return `subagent-announce:${announceId}`;
}

export function buildAnnounceIdFromChildRun(
  childSessionKey: string,
  childRunId: string
): string {
  return `${childSessionKey}:${childRunId}`;
}

// agents/subagent-announce.ts
async function sendAnnounce(item: AnnounceQueueItem) {
  // 生成幂等性 key
  const idempotencyKey = buildAnnounceIdempotencyKey(
    resolveQueueAnnounceId({
      announceId: item.announceId,
      sessionKey: item.sessionKey,
      enqueuedAt: item.enqueuedAt,
    })
  );

  // 发送通知（带幂等性 key）
  await callGateway({
    method: "agent",
    params: {
      sessionKey: item.sessionKey,
      message: item.prompt,
      idempotencyKey,  // Gateway 会据此去重
    },
  });
}
```

### 4.5 消息队列冲突解决

```typescript
// agents/subagent-announce-queue.ts
// 结果通知队列管理

type AnnounceQueueState = {
  items: AnnounceQueueItem[];
  draining: boolean;
  lastEnqueuedAt: number;
  mode: QueueMode;        // "steer" | "followup" | "collect" | "steer-backlog" | "interrupt"
  debounceMs: number;
  cap: number;
  dropPolicy: QueueDropPolicy;  // "summarize" | "drop"
  droppedCount: number;
  summaryLines: string[];
};

// 队列模式说明:
// - steer: 直接插入当前对话
// - followup: 作为后续消息
// - collect: 批量收集后一次性发送
// - steer-backlog: 优先 steer，失败则 backlog
// - interrupt: 中断当前运行，插入消息

function scheduleAnnounceDrain(key: string) {
  const queue = ANNOUNCE_QUEUES.get(key);
  if (!queue || queue.draining) return;
  
  queue.draining = true;
  void (async () => {
    try {
      while (queue.items.length > 0 || queue.droppedCount > 0) {
        await waitForQueueDebounce(queue);
        
        if (queue.mode === "collect") {
          // 批量收集模式
          const items = queue.items.slice();
          const summary = previewQueueSummaryPrompt(queue);
          const prompt = buildCollectPrompt({
            title: "[Queued announce messages while agent was busy]",
            items,
            summary,
          });
          await queue.send({ ...last, prompt });
          queue.items.splice(0, items.length);
        } else {
          // 单个处理
          const next = queue.items[0];
          await queue.send(next);
          queue.items.shift();
        }
      }
    } finally {
      queue.draining = false;
    }
  })();
}
```

---

## 五、可扩展性分析

### 5.1 当前架构的可扩展性评估

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              可扩展性评估矩阵                                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   维度                    │ 当前能力    │ 限制                    │ 改进建议                        │
│   ────────────────────────┼─────────────┼─────────────────────────┼─────────────────────────────────│
│   并发子 Agent 数量       │ 5个/父Agent │ 硬编码限制              │ 配置化 + 动态调整                │
│   Agent 嵌套深度          │ 1-2层       │ maxSpawnDepth 配置      │ 支持更深但需资源管理             │
│   跨 Agent 通信           │ 父→子单向   │ 无直接子→子通信         │ 引入消息总线                     │
│   动态负载均衡            │ 无          │ Lane 是静态分配         │ 基于负载的动态调度               │
│   Agent 发现机制          │ 静态配置    │ 需预先配置 allowAgents  │ 服务注册/发现                    │
│   分布式执行              │ 不支持      │ 单进程架构              │ 远程 Agent 协议                  │
│   资源隔离                │ Lane 级别   │ 无 CPU/内存隔离         │ 容器化隔离                       │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 扩展架构设计建议

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              建议的扩展架构                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              Agent 编排层 (Orchestration Layer)                              │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │   Workflow Engine                                                                    │   │   │
│   │   │   • DAG 任务依赖定义                                                                │   │   │
│   │   │   • 并行/串行执行策略                                                               │   │   │
│   │   │   • 条件分支                                                                        │   │   │
│   │   │   • 循环/重试机制                                                                   │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   │                                                                                              │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │   Resource Scheduler                                                               │   │   │
│   │   │   • 基于 token 预算的调度                                                           │   │   │
│   │   │   • 基于成本的优化                                                                  │   │   │
│   │   │   • 优先级队列                                                                      │   │   │
│   │   │   • 抢占式调度                                                                      │   │   │
│   │   └─────────────────────────────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                  │                                                   │
│                                                  ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              Agent 通信总线 (Message Bus)                                    │   │
│   │                                                                                              │   │
│   │   • Pub/Sub 消息发布订阅                                                                     │   │
│   │   • 点对点消息                                                                               │   │
│   │   • 消息持久化                                                                               │   │
│   │   • 死信队列                                                                                 │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                  │                                                   │
│                                                  ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              Agent 执行层 (Execution Layer)                                  │   │
│   │                                                                                              │   │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
│   │   │ Local Agent │  │ Local Agent │  │ Local Agent │  │ Remote Agent│  │ Remote Agent│       │   │
│   │   │  (进程内)    │  │  (进程内)    │  │  (进程内)    │  │  (WebSocket)│  │   (HTTP)    │       │   │
│   │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │   │
│   │                                                                                              │   │
│   │   执行环境:                                                                                  │   │
│   │   • 进程内 (当前实现)                                                                        │   │
│   │   • 独立进程 (更好的隔离)                                                                    │   │
│   │   • 容器 (资源隔离)                                                                          │   │
│   │   • 远程服务 (分布式)                                                                        │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 工作流定义示例

```yaml
# 建议的工作流定义格式 (workflow.yaml)

workflow:
  name: "代码审查工作流"
  version: "1.0"
  
  # 全局配置
  config:
    maxParallel: 3
    timeout: "10m"
    onFailure: "rollback"
  
  # Agent 定义
  agents:
    - id: "linter"
      type: "eslint-agent"
      model: "anthropic/claude-haiku"
      
    - id: "security"
      type: "security-scanner"
      model: "anthropic/claude-sonnet"
      
    - id: "tester"
      type: "test-runner"
      model: "openai/gpt-4o"
      
    - id: "reviewer"
      type: "code-reviewer"
      model: "anthropic/claude-opus"
  
  # 任务定义
  tasks:
    - id: "lint"
      agent: "linter"
      input: "${sourceCode}"
      
    - id: "security-scan"
      agent: "security"
      input: "${sourceCode}"
      
    - id: "test"
      agent: "tester"
      input: "${sourceCode}"
      dependsOn: ["lint"]  # 串行依赖
      
    - id: "review"
      agent: "reviewer"
      input:
        code: "${sourceCode}"
        lintResults: "${tasks.lint.output}"
        securityResults: "${tasks.security-scan.output}"
        testResults: "${tasks.test.output}"
      dependsOn: ["lint", "security-scan", "test"]  # 等待所有任务
```

---

## 六、总结

### 6.1 核心发现

| 研究方向 | 关键发现 |
|----------|----------|
| **多 Agent 协调** | 基于 `sessions_spawn` 工具 + SubagentRegistry 实现，支持父子关系和深度限制 |
| **生命周期管理** | 完整的生命周期状态机 (Initial → Accepted → Start → Running → Ended → Cleaned)，支持持久化和恢复 |
| **状态冲突解决** | 深度限制 + 数量限制 + Lane 隔离 + 幂等通知 + 队列管理，多重机制保障稳定性 |
| **可扩展性** | 当前为单进程架构，适合本地使用；分布式扩展需要额外开发 |

### 6.2 架构优势

1. **简单有效**: 基于现有 Session 机制的轻量级实现
2. **错误隔离**: 子 Agent 失败不影响父 Agent
3. **资源可控**: 深度和数量限制防止资源耗尽
4. **状态持久**: 支持进程重启后的状态恢复
5. **灵活配置**: 支持模型、超时、清理策略等参数

### 6.3 改进建议

1. **短期**:
   - 将硬编码限制配置化
   - 添加子 Agent 健康检查
   - 改进结果通知的可靠性

2. **中期**:
   - 实现 Agent 间直接通信
   - 添加工作流编排能力
   - 支持动态负载均衡

3. **长期**:
   - 分布式 Agent 执行
   - 基于容器的资源隔离
   - 智能任务调度算法

---

## 参考文档

- [subagent-spawn.ts](file:///d:/temp/openclaw/src/agents/subagent-spawn.ts)
- [subagent-registry.ts](file:///d:/temp/openclaw/src/agents/subagent-registry.ts)
- [subagent-registry.store.ts](file:///d:/temp/openclaw/src/agents/subagent-registry.store.ts)
- [subagent-depth.ts](file:///d:/temp/openclaw/src/agents/subagent-depth.ts)
- [subagent-announce.ts](file:///d:/temp/openclaw/src/agents/subagent-announce.ts)
- [subagent-announce-queue.ts](file:///d:/temp/openclaw/src/agents/subagent-announce-queue.ts)
- [subagents-tool.ts](file:///d:/temp/openclaw/src/agents/tools/subagents-tool.ts)
- [pi-embedded-runner/runs.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/runs.ts)
- [pi-embedded-runner/run.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run.ts)
- [lanes.ts](file:///d:/temp/openclaw/src/process/lanes.ts)
- [shared/subagents-format.ts](file:///d:/temp/openclaw/src/shared/subagents-format.ts)
