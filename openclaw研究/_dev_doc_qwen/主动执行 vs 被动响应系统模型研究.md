# "主动执行 vs 被动响应"的系统模型差异对整体稳定性的影响

**研究对象**: OpenClaw (https://github.com/openclaw/openclaw)  
**研究日期**: 2026 年 2 月 18 日  
**研究目标**: 分析心跳机制如何触发任务执行，以及如何保证任务被正确唤醒、不中断且不重复

---

## 1. 执行摘要

OpenClaw 代表了一个关键的设计演进：**从"对话系统"进化为"自动执行引擎"**。本研究深入分析了 OpenClaw 中主动执行与被动响应两种模式的系统模型差异，以及这些差异对整体稳定性的影响。

### 核心发现

| 维度 | 被动响应模式 | 主动执行模式 |
|------|--------------|--------------|
| **触发源** | 外部事件 (webhook/消息) | 内部定时器 (心跳/cron) |
| **执行上下文** | 消息驱动会话 | 独立会话/主会话 |
| **并发控制** | 车道队列序列化 | 心跳唤醒合并 |
| **中断处理** | 会话写锁保护 | 世代计数器清理 |
| **重复防护** | 会话状态追踪 | 唤醒目标去重 |
| **稳定性风险** | 低 (事件驱动) | 中 (状态管理复杂) |

### 关键机制

1. **心跳唤醒机制**: `heartbeat-wake.ts` 实现唤醒请求合并、优先级排序、优雅重试
2. **车道队列系统**: `command-queue.ts` 实现任务序列化、并发控制、世代隔离
3. **会话写锁**: `session-write-lock.ts` 实现跨进程互斥、死锁检测、自动清理
4. **Cron 调度器**: `cron/service.ts` 实现定时任务、 webhook 交付、遥测追踪

### 稳定性保障指标

- **唤醒合并窗口**: 250ms (默认)
- **重试间隔**: 1000ms (指数退避)
- **锁超时**: 10s (默认), 最大持有 5 分钟
- ** stale 锁清理**: 30 分钟
- **看门狗检查**: 60 秒间隔

---

## 2. 系统模型对比

### 2.1 被动响应模型

**触发流程**:
```
外部事件 (Webhook/消息)
    ↓
渠道处理器 (Telegram/WhatsApp/Discord...)
    ↓
入队 → command-queue (车道序列化)
    ↓
getReplyFromConfig (配置解析)
    ↓
runReplyAgent (代理执行)
    ↓
响应交付 (渠道/会话)
```

**关键特征**:

1. **事件驱动**: 由外部 webhook 或用户消息触发
2. **会话绑定**: 执行绑定到特定会话 (sessionKey)
3. **即时响应**: 需要快速回复用户 (通常<30s)
4. **上下文连续**: 继承会话历史

**代码路径**:
```typescript
// src/channels/telegram/index.ts (简化)
export async function handleWebhook(ctx: TelegramContext) {
  // 1. 接收 webhook
  logWebhookReceived({ channel: "telegram", updateType: ctx.updateType });
  
  // 2. 入队处理
  await enqueueCommandInLane("telegram", async () => {
    // 3. 获取响应
    const reply = await getReplyFromConfig(ctx);
    
    // 4. 发送响应
    if (reply) {
      await sendReply(ctx, reply);
    }
  });
}
```

### 2.2 主动执行模型

**触发流程**:
```
定时器 (心跳/cron)
    ↓
requestHeartbeatNow (唤醒请求)
    ↓
setHeartbeatWakeHandler (唤醒处理器)
    ↓
心跳合并 (250ms 窗口)
    ↓
runHeartbeatOnce / runCronJob
    ↓
代理执行 (isolated/main 会话)
    ↓
交付 (webhook/announce/none)
```

**关键特征**:

1. **时间驱动**: 由内部定时器触发
2. **会话独立**: 可创建独立会话或使用主会话
3. **延迟可接受**: 不需要即时响应
4. **任务导向**: 执行预定义任务

**代码路径**:
```typescript
// src/infra/heartbeat-runner.ts (简化)
export function startHeartbeatRunner(config: OpenClawConfig): HeartbeatRunner {
  const intervalMs = resolveHeartbeatIntervalMs(config);
  
  const timer = setInterval(() => {
    const now = Date.now();
    if (now >= nextDueMs) {
      // 请求唤醒
      requestHeartbeatNow({
        reason: "interval",
        agentId,
        sessionKey,
      });
      nextDueMs = now + intervalMs;
    }
  }, 1000);
  
  return { stop: () => clearInterval(timer) };
}
```

### 2.3 模型差异对比

| 特性 | 被动响应 | 主动执行 |
|------|----------|----------|
| **触发时机** | 不可预测 (外部) | 可预测 (定时) |
| **并发模型** | 多车道并行 | 单唤醒合并 |
| **错误处理** | 即时失败 | 自动重试 |
| **资源竞争** | 车道隔离 | 会话锁竞争 |
| **状态管理** | 会话历史 | 唤醒目标追踪 |
| **中断恢复** | 写锁保护 | 世代计数器 |

---

## 3. 心跳触发机制详解

### 3.1 唤醒请求合并

**核心模块**: `src/infra/heartbeat-wake.ts`

```typescript
type PendingWakeReason = {
  reason: string;
  priority: number;
  requestedAt: number;
  agentId?: string;
  sessionKey?: string;
};

// 唤醒目标去重 key
function getWakeTargetKey(params: { agentId?: string; sessionKey?: string }) {
  const agentId = normalizeWakeTarget(params.agentId);
  const sessionKey = normalizeWakeTarget(params.sessionKey);
  return `${agentId ?? ""}::${sessionKey ?? ""}`;
}

// 优先级排序
const REASON_PRIORITY = {
  RETRY: 0,      // 重试最高优先级
  INTERVAL: 1,   // 定时心跳
  DEFAULT: 2,    // 默认请求
  ACTION: 3,     // 手动/钩子动作
} as const;

function queuePendingWakeReason(params: {
  reason?: string;
  requestedAt?: number;
  agentId?: string;
  sessionKey?: string;
}) {
  const next: PendingWakeReason = {
    reason: normalizeWakeReason(params.reason),
    priority: resolveReasonPriority(params.reason),
    requestedAt: params.requestedAt ?? Date.now(),
    agentId: normalizeWakeTarget(params.agentId),
    sessionKey: normalizeWakeTarget(params.sessionKey),
  };
  
  const wakeTargetKey = getWakeTargetKey(next);
  const previous = pendingWakes.get(wakeTargetKey);
  
  // 优先级高的覆盖优先级低的
  // 同优先级时，后请求的覆盖先请求的
  if (!previous || next.priority < previous.priority || 
      (next.priority === previous.priority && next.requestedAt >= previous.requestedAt)) {
    pendingWakes.set(wakeTargetKey, next);
  }
}
```

**合并策略**:

1. **时间窗口**: 默认 250ms 合并窗口
2. **目标去重**: 同一 agentId+sessionKey 只保留一个
3. **优先级覆盖**: 重试 > 定时 > 默认 > 手动
4. **批量处理**: 一次唤醒处理所有 pending 请求

### 3.2 调度器实现

```typescript
function schedule(coalesceMs: number, kind: WakeTimerKind = "normal") {
  const delay = Math.max(0, coalesceMs);
  const dueAt = Date.now() + delay;
  
  // 如果已有更早的定时器，保持原有定时器
  if (timer && timerDueAt && timerDueAt <= dueAt) {
    return;
  }
  
  // 重试定时器有特殊保护
  if (timer && timerKind === "retry") {
    return;
  }
  
  // 清除旧定时器，设置新定时器
  if (timer) {
    clearTimeout(timer);
  }
  
  timerDueAt = dueAt;
  timerKind = kind;
  timer = setTimeout(async () => {
    timer = null;
    timerDueAt = null;
    timerKind = null;
    scheduled = false;
    
    if (!handler || running) {
      // 处理器未就绪或正在运行，重新调度
      if (running) {
        scheduled = true;
      }
      schedule(delay, kind);
      return;
    }
    
    // 取出所有 pending 唤醒请求
    const pendingBatch = Array.from(pendingWakes.values());
    pendingWakes.clear();
    
    running = true;
    try {
      for (const pendingWake of pendingBatch) {
        const res = await handler({
          reason: pendingWake.reason,
          agentId: pendingWake.agentId,
          sessionKey: pendingWake.sessionKey,
        });
        
        // 如果车道忙，重新排队
        if (res.status === "skipped" && res.reason === "requests-in-flight") {
          queuePendingWakeReason({
            reason: "retry",
            agentId: pendingWake.agentId,
            sessionKey: pendingWake.sessionKey,
          });
          schedule(DEFAULT_RETRY_MS, "retry");
        }
      }
    } catch {
      // 错误时重新排队重试
      for (const pendingWake of pendingBatch) {
        queuePendingWakeReason({
          reason: "retry",
          agentId: pendingWake.agentId,
          sessionKey: pendingWake.sessionKey,
        });
      }
      schedule(DEFAULT_RETRY_MS, "retry");
    } finally {
      running = false;
      // 如果还有 pending 请求，继续调度
      if (pendingWakes.size > 0 || scheduled) {
        schedule(delay, "normal");
      }
    }
  }, delay);
  
  timer.unref?.();  // 不阻止进程退出
}
```

**调度特性**:

1. **防抖合并**: 250ms 窗口内合并多个请求
2. **重试保护**: 重试定时器不被新请求覆盖
3. **运行互斥**: 同一时间只有一个唤醒在执行
4. **优雅降级**: 错误时自动重试

### 3.3 唤醒处理器注册

```typescript
let handler: HeartbeatWakeHandler | null = null;
let handlerGeneration = 0;

export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null): () => void {
  handlerGeneration += 1;
  const generation = handlerGeneration;
  handler = next;
  
  if (next) {
    // 新处理器注册时清理旧状态
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
    timerDueAt = null;
    timerKind = null;
    running = false;
    scheduled = false;
  }
  
  // 如果有 pending 请求，立即调度
  if (handler && pendingWakes.size > 0) {
    schedule(DEFAULT_COALESCE_MS, "normal");
  }
  
  // 返回释放函数 (带世代检查)
  return () => {
    if (handlerGeneration !== generation) {
      return;  // 世代不匹配，忽略
    }
    if (handler !== next) {
      return;  // 处理器已变更，忽略
    }
    handlerGeneration += 1;
    handler = null;
  };
}
```

**世代计数器模式**:

```
注册 1 → generation=1, handler=handler1
注册 2 → generation=2, handler=handler2
释放 1 → generation 不匹配 (1≠2), 忽略
释放 2 → generation 匹配 (2=2), handler=null
```

这防止了旧处理器释放新处理器的注册。

---

## 4. 任务执行保障机制

### 4.1 车道队列系统

**核心模块**: `src/process/command-queue.ts`

```typescript
type LaneState = {
  lane: string;
  queue: QueueEntry[];
  activeTaskIds: Set<number>;
  maxConcurrent: number;
  draining: boolean;
  generation: number;  // 世代计数器
};

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};
```

**入队流程**:

```typescript
export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: { warnAfterMs?: number; onWait?: (...) => void; },
): Promise<T> {
  const state = getLaneState(lane);
  
  return new Promise<T>((resolve, reject) => {
    state.queue.push({
      task,
      resolve,
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs: opts?.warnAfterMs ?? 2000,
      onWait: opts?.onWait,
    });
    
    logLaneEnqueue(lane, state.queue.length + state.activeTaskIds.size);
    drainLane(lane);  // 触发泵送
  });
}
```

**泵送机制**:

```typescript
function drainLane(lane: string) {
  const state = getLaneState(lane);
  if (state.draining) {
    return;  // 防止重入
  }
  state.draining = true;
  
  const pump = () => {
    // 并发控制：不超过 maxConcurrent
    while (state.activeTaskIds.size < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift()!;
      const taskId = nextTaskId++;
      const taskGeneration = state.generation;
      state.activeTaskIds.add(taskId);
      
      void (async () => {
        try {
          const result = await entry.task();
          const completed = completeTask(state, taskId, taskGeneration);
          if (completed) {
            pump();  // 继续泵送
          }
          entry.resolve(result);
        } catch (err) {
          const completed = completeTask(state, taskId, taskGeneration);
          if (completed) {
            pump();
          }
          entry.reject(err);
        }
      })();
    }
    state.draining = false;
  };
  
  pump();
}

function completeTask(state: LaneState, taskId: number, taskGeneration: number): boolean {
  // 世代检查：任务完成时如果世代已变更，忽略
  if (taskGeneration !== state.generation) {
    return false;
  }
  state.activeTaskIds.delete(taskId);
  return true;
}
```

**世代隔离机制**:

```
Lane State: generation=1
  ├─ Task 1 (generation=1) → 完成，删除
  ├─ Task 2 (generation=1) → 完成，删除
  └─ Task 3 (generation=1) → 执行中...

重启后:
Lane State: generation=2 (bumped)
  └─ Task 3 (generation=1) → 完成时 1≠2, 忽略
     → 不会阻塞新任务
```

### 4.2 会话写锁

**核心模块**: `src/agents/session-write-lock.ts`

**锁获取**:

```typescript
export async function acquireSessionWriteLock(params: {
  sessionFile: string;
  timeoutMs?: number;
  staleMs?: number;
  maxHoldMs?: number;
  allowReentrant?: boolean;
}): Promise<{ release: () => Promise<void> }> {
  const sessionFile = path.resolve(params.sessionFile);
  const lockPath = `${sessionFile}.lock`;
  
  // 重入支持
  const held = HELD_LOCKS.get(sessionFile);
  if (params.allowReentrant && held) {
    held.count += 1;
    return {
      release: async () => {
        held.count -= 1;
        if (held.count === 0) {
          await releaseHeldLock(sessionFile, held);
        }
      },
    };
  }
  
  // 自旋获取锁
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < params.timeoutMs ?? 10000) {
    try {
      // "wx" 标志：文件存在时失败
      const handle = await fs.open(lockPath, "wx");
      const createdAt = new Date().toISOString();
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt }));
      
      const createdHeld: HeldLock = {
        count: 1,
        handle,
        lockPath,
        acquiredAt: Date.now(),
        maxHoldMs: params.maxHoldMs ?? 300000,  // 5 分钟
      };
      HELD_LOCKS.set(sessionFile, createdHeld);
      
      return {
        release: async () => {
          await releaseHeldLock(sessionFile, createdHeld);
        },
      };
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw err;
      }
      
      // 检查 stale 锁
      const payload = await readLockPayload(lockPath);
      const inspected = inspectLockPayload(payload, params.staleMs ?? 1800000);
      if (inspected.stale) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      
      // 指数退避
      const delay = Math.min(1000, 50 * ++attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw new Error(`session file locked (timeout): ${lockPath}`);
}
```

**Stale 锁检测**:

```typescript
function inspectLockPayload(
  payload: LockFilePayload | null,
  staleMs: number,
  nowMs: number,
): { stale: boolean; staleReasons: string[] } {
  const pid = payload?.pid ?? null;
  const pidAlive = pid !== null ? isPidAlive(pid) : false;
  const createdAt = payload?.createdAt ?? null;
  const ageMs = createdAt ? nowMs - Date.parse(createdAt) : null;
  
  const staleReasons: string[] = [];
  
  if (pid === null) {
    staleReasons.push("missing-pid");
  } else if (!pidAlive) {
    staleReasons.push("dead-pid");
  }
  
  if (ageMs === null) {
    staleReasons.push("invalid-createdAt");
  } else if (ageMs > staleMs) {
    staleReasons.push("too-old");
  }
  
  return {
    stale: staleReasons.length > 0,
    staleReasons,
  };
}
```

**Stale 条件** (满足任一):
1. `missing-pid`: 锁文件没有 PID
2. `dead-pid`: PID 对应的进程已死亡
3. `too-old`: 锁年龄超过 30 分钟

**看门狗清理**:

```typescript
function ensureWatchdogStarted(intervalMs: number): void {
  if (watchdogState.started) {
    return;
  }
  watchdogState.started = true;
  
  watchdogState.timer = setInterval(() => {
    void runLockWatchdogCheck().catch(() => {});
  }, intervalMs);
  
  watchdogState.timer.unref?.();
}

async function runLockWatchdogCheck(): Promise<number> {
  let released = 0;
  const nowMs = Date.now();
  
  for (const [sessionFile, held] of HELD_LOCKS.entries()) {
    const heldForMs = nowMs - held.acquiredAt;
    
    // 检查是否超过最大持有时间
    if (heldForMs > held.maxHoldMs) {
      console.warn(`releasing lock held for ${heldForMs}ms`);
      const didRelease = await releaseHeldLock(sessionFile, held, { force: true });
      if (didRelease) {
        released += 1;
      }
    }
  }
  
  return released;
}
```

### 4.3 重启状态清理

**问题场景**:
```
进程 A 获取锁 → 持有中 → SIGUSR1 重启 → 进程 A 终止
新进程 B 启动 → 尝试获取锁 → 锁文件存在 (stale) → 阻塞
```

**解决方案**:

```typescript
// src/infra/heartbeat-wake.ts
export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null) {
  handlerGeneration += 1;
  handler = next;
  
  if (next) {
    // 清理旧状态
    if (timer) clearTimeout(timer);
    timer = null;
    timerDueAt = null;
    timerKind = null;
    running = false;  // 关键：重置运行状态
    scheduled = false;
  }
  // ...
}

// src/process/command-queue.ts
export function resetAllLanes(): void {
  for (const state of lanes.values()) {
    state.generation += 1;  // 世代递增
    state.activeTaskIds.clear();  // 清空活跃任务
    state.draining = false;
  }
  // 重新泵送有队列的 lane
  for (const lane of lanesToDrain) {
    drainLane(lane);
  }
}

// src/agents/session-write-lock.ts
process.on("exit", () => {
  releaseAllLocksSync();  // 同步释放所有锁
});

for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT"]) {
  process.on(signal, () => {
    releaseAllLocksSync();
    process.kill(process.pid, signal);
  });
}
```

---

## 5. Cron 调度系统

### 5.1 Cron 服务架构

**核心模块**: `src/cron/service.ts`

```typescript
type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;  // cron 表达式或 interval
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};

type CronSchedule =
  | { kind: "cron"; expression: string }  // 标准 cron 表达式
  | { kind: "interval"; everyMs: number }; // 固定间隔
```

**调度循环**:

```typescript
export class CronService {
  private jobs: Map<string, CronJob>;
  private timers: Map<string, NodeJS.Timeout>;
  private runningRuns: Set<string>;
  
  start() {
    for (const [jobId, job] of this.jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
  }
  
  private scheduleJob(job: CronJob) {
    const nextRunAt = this.calculateNextRun(job.schedule);
    const delay = nextRunAt - Date.now();
    
    const timer = setTimeout(() => {
      this.runJob(job);
    }, delay);
    
    this.timers.set(job.id, timer);
  }
  
  private async runJob(job: CronJob) {
    if (this.runningRuns.has(job.id)) {
      // 防止重入
      this.scheduleJob(job);
      return;
    }
    
    this.runningRuns.add(job.id);
    const startedAt = Date.now();
    
    try {
      // 1. 解析会话目标
      const { agentId, sessionKey } = this.resolveSessionTarget(job);
      
      // 2. 执行任务
      let result: CronRunOutcome;
      if (job.sessionTarget === "isolated") {
        result = await runCronIsolatedAgentTurn({
          agentId,
          prompt: job.payload.prompt,
          config: this.config,
        });
      } else {
        // 唤醒主会话
        requestHeartbeatNow({
          reason: `cron:${job.id}`,
          agentId,
          sessionKey,
        });
        result = { status: "ok" };
      }
      
      // 3. 交付结果
      if (job.delivery?.mode === "webhook") {
        await this.deliverWebhook(job, result);
      }
      
      // 4. 记录遥测
      this.recordTelemetry(job, {
        status: result.status,
        durationMs: Date.now() - startedAt,
      });
      
    } finally {
      this.runningRuns.delete(job.id);
      this.scheduleJob(job);  // 调度下一次运行
    }
  }
}
```

### 5.2 Cron 与心跳集成

**唤醒模式**:

```typescript
type CronWakeMode = "next-heartbeat" | "now";

// "next-heartbeat": 等待下一次心跳触发
if (job.wakeMode === "next-heartbeat") {
  // 将 cron 任务标记为 pending
  // 下一次心跳时会执行
  this.markCronPending(job.id);
}

// "now": 立即触发
if (job.wakeMode === "now") {
  requestHeartbeatNow({
    reason: `cron:${job.id}`,
    agentId: job.agentId,
    sessionKey: job.sessionKey,
  });
}
```

**心跳执行 cron**:

```typescript
// src/infra/heartbeat-runner.ts
async function runHeartbeatOnce(params: {
  agentId: string;
  sessionKey?: string;
  reason?: string;
}): Promise<HeartbeatRunResult> {
  // 1. 检查是否有 pending cron 任务
  const pendingCrons = cronService.getPendingCrons(params.agentId);
  
  if (pendingCrons.length > 0) {
    // 2. 执行 cron 任务
    for (const cron of pendingCrons) {
      await runCronIsolatedAgentTurn({
        agentId: params.agentId,
        prompt: cron.prompt,
      });
    }
  }
  
  // 3. 执行标准心跳
  const result = await runHeartbeatPrompt(params);
  
  return { status: "ran", durationMs: Date.now() - startedAt };
}
```

### 5.3 Webhook 交付

```typescript
async function deliverWebhook(job: CronJob, result: CronRunOutcome) {
  const target = this.resolveWebhookTarget(job.delivery);
  if (!target) {
    return;
  }
  
  const payload = {
    jobId: job.id,
    jobName: job.name,
    status: result.status,
    timestamp: new Date().toISOString(),
    usage: result.usage,
  };
  
  try {
    const response = await fetchWithSsrFGuard(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.cron?.webhookToken}`,
      },
      body: JSON.stringify(payload),
      timeout: CRON_WEBHOOK_TIMEOUT_MS,
    });
    
    if (!response.ok) {
      throw new Error(`webhook responded ${response.status}`);
    }
    
    this.log.info(`cron webhook delivered: ${job.id}`);
  } catch (err) {
    this.log.error(`cron webhook failed: ${job.id} - ${err.message}`);
    
    // 记录失败，但不重试
    this.recordDeliveryFailure(job, err);
  }
}
```

---

## 6. 防重复机制

### 6.1 唤醒目标去重

```typescript
const pendingWakes = new Map<string, PendingWakeReason>();

function getWakeTargetKey(params: { agentId?: string; sessionKey?: string }) {
  const agentId = normalizeWakeTarget(params.agentId);
  const sessionKey = normalizeWakeTarget(params.sessionKey);
  return `${agentId ?? ""}::${sessionKey ?? ""}`;
}

function queuePendingWakeReason(params: {
  reason?: string;
  agentId?: string;
  sessionKey?: string;
}) {
  const wakeTargetKey = getWakeTargetKey(params);
  const next = createPendingWakeReason(params);
  const previous = pendingWakes.get(wakeTargetKey);
  
  // 优先级覆盖逻辑
  if (!previous) {
    pendingWakes.set(wakeTargetKey, next);
    return;
  }
  
  if (next.priority < previous.priority) {
    // 新请求优先级更高，覆盖
    pendingWakes.set(wakeTargetKey, next);
    return;
  }
  
  if (next.priority === previous.priority && next.requestedAt >= previous.requestedAt) {
    // 同优先级，后请求覆盖先请求
    pendingWakes.set(wakeTargetKey, next);
  }
  // 否则忽略新请求
}
```

**去重效果**:

```
T0: requestHeartbeatNow({ agentId: "default", sessionKey: "main" })
    → pendingWakes.set("default::main", { reason: "manual", priority: 3 })

T1: requestHeartbeatNow({ agentId: "default", sessionKey: "main", reason: "interval" })
    → priority: 1 < 3, 覆盖
    → pendingWakes.set("default::main", { reason: "interval", priority: 1 })

T2: 唤醒执行
    → pendingWakes.clear()
    → 执行一次，使用 "interval" reason
```

### 6.2 会话状态追踪

```typescript
// src/logging/diagnostic-session-state.ts
type SessionStateValue = {
  sessionId?: string;
  sessionKey?: string;
  state: "idle" | "processing" | "waiting";
  queueDepth: number;
  lastActivity: number;
};

const diagnosticSessionStates = new Map<string, SessionStateValue>();

export function logSessionStateChange(params: {
  sessionId?: string;
  sessionKey?: string;
  state: SessionStateValue;
  reason?: string;
}) {
  const state = getDiagnosticSessionState(params);
  const prevState = state.state;
  
  // 状态转换
  state.state = params.state;
  state.lastActivity = Date.now();
  
  if (params.state === "idle") {
    state.queueDepth = Math.max(0, state.queueDepth - 1);
  }
  
  emitDiagnosticEvent({
    type: "session.state",
    sessionId: state.sessionId,
    sessionKey: state.sessionKey,
    prevState,
    state: params.state,
    reason: params.reason,
    queueDepth: state.queueDepth,
  });
}
```

**状态转换图**:

```
idle ──────→ processing (收到消息/心跳)
  ↑            ↓
  │            ↓ (等待工具响应)
  │         waiting
  │            ↓
  └──────── processing (完成)
```

### 6.3 运行中追踪

```typescript
// src/agents/pi-embedded-runner/runs.ts
const activeRuns = new Map<string, EmbeddedPiRun>();

export function isEmbeddedPiRunActive(sessionKey: string): boolean {
  return activeRuns.has(sessionKey);
}

export async function runEmbeddedPiAgent(params: {
  sessionKey: string;
  // ...
}): Promise<EmbeddedPiRunResult> {
  // 检查是否已有活跃运行
  if (isEmbeddedPiRunActive(params.sessionKey)) {
    throw new Error(`run already active for session: ${params.sessionKey}`);
  }
  
  const run = createEmbeddedPiRun(params);
  activeRuns.set(params.sessionKey, run);
  
  try {
    return await run.execute();
  } finally {
    activeRuns.delete(params.sessionKey);
  }
}
```

---

## 7. 稳定性分析与改进建议

### 7.1 当前稳定性风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **唤醒丢失** | 心跳未触发 | 低 | 看门狗定时器 |
| **重复执行** | 任务运行多次 | 中 | 唤醒去重 + 会话锁 |
| **死锁** | 会话永久阻塞 | 低 | stale 检测 + 看门狗 |
| **内存泄漏** | pendingWakes 累积 | 低 | 定期清理 |
| **世代错乱** | 旧任务完成阻塞 | 中 | 世代计数器 |
| **重启状态丢失** | pending 任务丢失 | 中 | 持久化 pending 队列 |

### 7.2 改进建议

#### 建议 1: 持久化唤醒队列

**当前问题**: 进程重启后 pending wakes 丢失

**建议方案**:
```typescript
const PENDING_WAKES_PATH = path.join(stateDir, "pending-wakes.json");

async function persistPendingWakes() {
  const data = Array.from(pendingWakes.entries());
  await fs.writeFile(PENDING_WAKES_PATH, JSON.stringify(data));
}

async function restorePendingWakes() {
  try {
    const data = JSON.parse(await fs.readFile(PENDING_WAKES_PATH));
    for (const [key, value] of data) {
      pendingWakes.set(key, value);
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      log.warn(`failed to restore pending wakes: ${err.message}`);
    }
  }
}

// 启动时恢复
restorePendingWakes();

// 变更时持久化 (防抖)
let persistTimeout: NodeJS.Timeout | null = null;
function schedulePersist() {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    persistPendingWakes();
  }, 1000);
}
```

#### 建议 2: 增强世代追踪

**当前问题**: 世代计数器只在内存中，重启后失效

**建议方案**:
```typescript
type LaneMetadata = {
  generation: number;
  lastReset: string;
  resetReason?: string;
};

const METADATA_PATH = path.join(stateDir, "lane-metadata.json");

async function persistLaneMetadata() {
  const metadata: Record<string, LaneMetadata> = {};
  for (const [lane, state] of lanes) {
    metadata[lane] = {
      generation: state.generation,
      lastReset: new Date().toISOString(),
    };
  }
  await fs.writeFile(METADATA_PATH, JSON.stringify(metadata));
}

async function restoreLaneMetadata() {
  try {
    const metadata = JSON.parse(await fs.readFile(METADATA_PATH));
    for (const [lane, meta] of Object.entries(metadata)) {
      const state = getLaneState(lane);
      state.generation = meta.generation;
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      log.warn(`failed to restore lane metadata: ${err.message}`);
    }
  }
}
```

#### 建议 3: 分布式锁支持

**当前问题**: 会话锁只在单进程有效

**建议方案**:
```typescript
// 使用 Redis 实现分布式锁
async function acquireDistributedSessionLock(params: {
  sessionKey: string;
  timeoutMs: number;
}): Promise<{ release: () => Promise<void> }> {
  const lockKey = `session-lock:${params.sessionKey}`;
  const lockValue = `${process.pid}:${Date.now()}`;
  
  const acquired = await redis.set(lockKey, lockValue, "PX", params.timeoutMs, "NX");
  if (!acquired) {
    throw new Error(`failed to acquire distributed lock: ${lockKey}`);
  }
  
  // 看门狗续期
  const renewInterval = setInterval(async () => {
    const ttl = await redis.pttl(lockKey);
    if (ttl > 0 && ttl < params.timeoutMs / 2) {
      await redis.pexpire(lockKey, params.timeoutMs);
    }
  }, params.timeoutMs / 4);
  
  return {
    release: async () => {
      clearInterval(renewInterval);
      // Lua 脚本确保只删除自己的锁
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, lockKey, lockValue);
    },
  };
}
```

#### 建议 4: 可观测性增强

**当前问题**: 缺乏唤醒和队列的实时监控

**建议方案**:
```typescript
// 导出 Prometheus 指标
import { Counter, Histogram, Gauge } from "prom-client";

const heartbeatWakesTotal = new Counter({
  name: "heartbeat_wakes_total",
  help: "Total number of heartbeat wakes",
  labelNames: ["reason"],
});

const heartbeatWakeDuration = new Histogram({
  name: "heartbeat_wake_duration_ms",
  help: "Duration of heartbeat wake execution",
  buckets: [100, 500, 1000, 5000, 10000, 30000],
});

const queueDepth = new Gauge({
  name: "command_queue_depth",
  help: "Current command queue depth",
  labelNames: ["lane"],
});

const activeTasks = new Gauge({
  name: "command_active_tasks",
  help: "Number of actively executing tasks",
  labelNames: ["lane"],
});

const sessionLocksHeld = new Gauge({
  name: "session_locks_held",
  help: "Number of session locks currently held",
});

// 在关键位置记录指标
export function requestHeartbeatNow(opts: { reason?: string }) {
  heartbeatWakesTotal.inc({ reason: opts.reason ?? "unknown" });
  // ...
}

async function runHeartbeatOnce() {
  const end = heartbeatWakeDuration.startTimer();
  try {
    const result = await runHeartbeatPrompt();
    end({ status: result.status });
  } catch (err) {
    end({ status: "error" });
    throw err;
  }
}
```

### 7.3 稳定性最佳实践

#### 实践 1: 优雅关闭

```typescript
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  
  log.info(`graceful shutdown initiated (${signal})`);
  
  // 1. 停止接收新请求
  stopHeartbeatRunner();
  stopCronService();
  
  // 2. 等待活跃任务完成
  const { drained } = await waitForActiveTasks(30000);
  if (!drained) {
    log.warn("some tasks did not complete within timeout");
  }
  
  // 3. 释放所有锁
  releaseAllLocksSync();
  
  // 4. 持久化状态
  await persistPendingWakes();
  await persistLaneMetadata();
  
  // 5. 关闭日志
  await flushLogs();
  
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

#### 实践 2: 健康检查端点

```typescript
// src/gateway/server-health.ts
export async function getHealthStatus(): Promise<HealthStatus> {
  return {
    status: shuttingDown ? "shutting_down" : "healthy",
    uptime: process.uptime(),
    heartbeat: {
      handlerRegistered: hasHeartbeatWakeHandler(),
      pendingWakes: pendingWakes.size,
      running: isHeartbeatRunning(),
    },
    queues: {
      totalDepth: getTotalQueueSize(),
      activeTasks: getActiveTaskCount(),
      lanes: Array.from(lanes.entries()).map(([lane, state]) => ({
        lane,
        depth: state.queue.length,
        active: state.activeTaskIds.size,
      })),
    },
    locks: {
      held: HELD_LOCKS.size,
    },
    cron: {
      enabled: cronService.isEnabled(),
      jobsScheduled: cronService.getScheduledJobCount(),
      runningRuns: cronService.getRunningRunCount(),
    },
  };
}
```

#### 实践 3: 告警规则

```yaml
# Prometheus alerting rules
groups:
  - name: openclaw-stability
    rules:
      - alert: HeartbeatWakeBacklog
        expr: heartbeat_pending_wakes > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Heartbeat wake backlog growing"
          
      - alert: QueueDepthHigh
        expr: command_queue_depth > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Command queue depth is high"
          
      - alert: SessionLockStuck
        expr: session_locks_held > 50
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Too many session locks held"
          
      - alert: CronJobFailing
        expr: rate(cron_runs_total{status="error"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cron jobs are failing frequently"
```

---

## 8. 结论

### 8.1 核心发现总结

1. **唤醒合并是关键**: 250ms 合并窗口 + 优先级排序有效防止重复执行

2. **世代计数器模式**: 解决重启后状态不一致问题，防止旧任务阻塞新任务

3. **会话写锁必要但复杂**: 跨进程互斥需要 stale 检测 + 看门狗 + 信号处理

4. **Cron 与心跳集成**: "next-heartbeat" 模式减少独立定时器，提高资源效率

5. **持久化缺失**: pending wakes 和 lane metadata 在重启后丢失，需要持久化

### 8.2 架构演进建议

```
当前架构:
┌─────────────┐     ┌─────────────┐
│  Heartbeat  │     │    Cron     │
│   Wake      │     │   Service   │
│   Handler   │     │             │
└──────┬──────┘     └──────┬──────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────┐
│      Command Queue (Lanes)      │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│      Session Write Locks        │
└─────────────────────────────────┘

建议架构:
┌─────────────────────────────────┐
│    Persistent State Manager     │
│  (pending wakes + lane metadata)│
└──────────────┬──────────────────┘
               │
┌──────────────┼──────────────────┐
│              │                  │
▼              ▼                  ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Heartbeat  │ │    Cron     │ │   External  │
│   Wake      │ │   Service   │ │   Triggers  │
│   Handler   │ │             │ │  (Webhooks) │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │                │
       ▼               ▼                ▼
┌─────────────────────────────────────────────┐
│         Distributed Queue (Redis)           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│      Distributed Session Locks (Redis)      │
└─────────────────────────────────────────────┘
```

### 8.3 商用建议

对于商用 Agent 场景，建议优先实施:

1. **持久化唤醒队列** - 防止重启后任务丢失 (高优先级)
2. **健康检查端点** - 实时监控稳定性 (高优先级)
3. **优雅关闭** - 确保数据完整性 (高优先级)
4. **分布式锁** - 支持多实例部署 (中优先级)
5. **增强指标** - Prometheus 集成 (中优先级)

---

## 附录 A: 关键代码位置

| 功能 | 文件路径 |
|------|----------|
| 心跳唤醒 | `src/infra/heartbeat-wake.ts` |
| 心跳运行器 | `src/infra/heartbeat-runner.ts` |
| 车道队列 | `src/process/command-queue.ts` |
| 会话写锁 | `src/agents/session-write-lock.ts` |
| Cron 服务 | `src/cron/service.ts` |
| Cron 隔离执行 | `src/cron/isolated-agent.ts` |
| 诊断事件 | `src/infra/diagnostic-events.ts` |
| 会话状态 | `src/logging/diagnostic-session-state.ts` |
| 代理运行 | `src/auto-reply/reply/agent-runner.ts` |
| 会话初始化 | `src/auto-reply/reply/session.ts` |

## 附录 B: 配置示例

### 心跳配置

```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "30m",
        "prompt": "Read HEARTBEAT.md and execute any pending tasks.",
        "target": "last",
        "model": "claude-sonnet-4-5-20250929",
        "ackMaxChars": 300
      }
    }
  }
}
```

### Cron 配置

```json
{
  "cron": {
    "enabled": true,
    "store": "~/.openclaw/cron.json",
    "maxConcurrentRuns": 3,
    "webhookToken": "your-secret-token",
    "sessionRetention": "24h",
    "jobs": [
      {
        "id": "daily-report",
        "name": "Daily Report",
        "enabled": true,
        "schedule": {
          "kind": "cron",
          "expression": "0 9 * * *"
        },
        "sessionTarget": "isolated",
        "wakeMode": "now",
        "payload": {
          "prompt": "Generate a daily report of yesterday's activities."
        },
        "delivery": {
          "mode": "webhook",
          "to": "https://example.com/webhook/daily-report"
        }
      },
      {
        "id": "health-check",
        "name": "Health Check",
        "enabled": true,
        "schedule": {
          "kind": "interval",
          "everyMs": 3600000
        },
        "sessionTarget": "main",
        "wakeMode": "next-heartbeat",
        "payload": {
          "prompt": "Check system health and report any issues."
        },
        "delivery": {
          "mode": "announce"
        }
      }
    ]
  }
}
```

---

**文档版本**: 1.0  
**最后更新**: 2026 年 2 月 18 日  
**作者**: Qwen Code
