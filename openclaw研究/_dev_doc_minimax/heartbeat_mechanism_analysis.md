# 主动执行 vs 被动响应系统模型差异研究

## 研究背景与意义

在人工智能代理（Agent）系统的演进历程中，一个核心的范式转变正在发生：从传统的“对话系统”（Conversational System）进化为“自动执行引擎”（Autonomous Execution Engine）。这一转变的关键在于系统不再仅仅响应用户的显式指令，而是能够主动感知环境变化、监控任务状态并在适当的时机自动触发执行。

OpenClaw 作为这一领域的实践者，其架构设计深刻体现了这一理念。本文将深入分析 OpenClaw 代码库中实现主动执行与被动响应两种模式的核心机制——心跳（Heartbeat）系统，探讨其如何触发任务执行、如何保证任务的正确唤醒、不中断且不重复，以及这些设计选择对系统整体稳定性的深远影响。

---

## 一、核心概念定义

### 1.1 被动响应模式

被动响应模式是传统对话系统的典型特征。在这种模式下，Agent 仅在接收到用户输入后才开始执行任务。其工作流程可概括为：

```
用户输入 → 接收消息 → 解析意图 → 执行任务 → 返回结果 → 等待下一次输入
```

这种模式的优点在于实现简单、行为可预测——系统只在用户明确要求时才行动。然而，其局限性也十分明显：无法处理后台监控任务、无法实现定时执行、无法对环境变化做出即时响应。

### 1.2 主动执行模式

主动执行模式使 Agent 能够自主触发任务执行，而不依赖于用户的显式指令。OpenClaw 中的主动执行涵盖多种触发场景：

- **心跳定时触发**：基于时间间隔的周期性检查
- **事件驱动触发**：如外部命令执行完成、系统事件发生
- **Webhook 触发**：外部服务通过 HTTP 接口唤醒
- **手动触发**：用户通过特定指令立即执行

主动执行模式的工作流程可表示为：

```
时间周期/事件发生 → 检查条件 → 任务入队 → 执行任务 → 结果处理 → 继续监控
```

---

## 二、OpenClaw 心跳机制架构分析

### 2.1 心跳系统的核心组件

OpenClaw 的心跳系统由多个协同工作的模块组成，其核心位于 `src/infra/heartbeat-wake.ts` 和 `src/infra/heartbeat-runner.ts` 两个文件中。

#### 2.1.1 心跳唤醒管理器（HeartbeatWakeHandler）

心跳唤醒管理器是整个系统的调度中枢，负责协调所有心跳请求的触发时机。其核心数据结构包括：

```typescript
// pendingWakes: 存储待处理的心跳请求
const pendingWakes = new Map<string, PendingWakeReason>();

// running: 标识当前是否有心跳任务正在执行
let running = false;

// scheduled: 标识是否有已调度的定时器
let scheduled = false;
```

每个待处理的心跳请求包含以下信息：

```typescript
type PendingWakeReason = {
  reason: string;           // 触发原因（interval、exec-event、hook:xxx 等）
  priority: number;         // 优先级（决定处理顺序）
  requestedAt: number;     // 请求时间戳
  agentId?: string;         // 关联的 Agent ID
  sessionKey?: string;      // 关联的会话密钥
};
```

#### 2.1.2 心跳执行器（HeartbeatRunner）

心跳执行器负责实际运行心跳任务，其主要职责包括：

- 检查心跳是否启用
- 验证活跃时间窗口（quiet hours）
- 检查命令队列状态
- 读取和解析 HEARTBEAT.md 文件
- 构建系统事件并触发 Agent 执行

### 2.2 心跳触发的原因分类

OpenClaw 的心跳系统支持多种触发原因，通过优先级机制确保重要事件优先处理：

```typescript
const REASON_PRIORITY = {
  RETRY: 0,      // 重试请求（最低优先级）
  INTERVAL: 1,   // 定时心跳（普通优先级）
  DEFAULT: 2,    // 默认请求
  ACTION: 3,     // 动作请求（最高优先级）
} as const;
```

具体的触发原因包括：

| 触发原因 | 描述 | 优先级 |
|---------|------|--------|
| `interval` | 周期性心跳定时触发 | INTERVAL (1) |
| `exec-event` | 外部命令执行完成 | ACTION (3) |
| `cron:` | Cron 定时任务触发 | ACTION (3) |
| `hook:` | Webhook 或 Hook 触发 | ACTION (3) |
| `manual` | 手动触发 | ACTION (3) |
| `retry` | 重试请求 | RETRY (0) |

---

## 三、心跳机制如何触发任务执行

### 3.1 任务触发的完整流程

心跳触发任务执行的过程是一个精心设计的异步流程，确保在正确的时间、以正确的方式启动任务。

#### 3.1.1 请求入队（Request Enqueue）

当某个事件触发心跳时，首先将请求加入待处理队列：

```typescript
function requestHeartbeatNow(opts?: {
  reason?: string;
  coalesceMs?: number;
  agentId?: string;
  sessionKey?: string;
}) {
  queuePendingWakeReason({
    reason: opts?.reason,
    agentId: opts?.agentId,
    sessionKey: opts?.sessionKey,
  });
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS, "normal");
}
```

关键设计点：**请求合并（Coalescing）**。系统会将一段时间内的多个心跳请求合并处理，默认合并窗口为 250ms，避免短时间内频繁触发执行。

#### 3.1.2 调度与执行（Scheduling）

心跳调度器采用以下策略：

1. **优先级排序**：高优先级的请求优先处理
2. **去重机制**：相同目标（相同 agentId 和 sessionKey）的请求会被合并
3. **防抖处理**：使用 `setTimeout` 实现延迟执行

```typescript
function schedule(coalesceMs: number, kind: WakeTimerKind = "normal") {
  const delay = Number.isFinite(coalesceMs) 
    ? Math.max(0, coalesceMs) 
    : DEFAULT_COALESCE_MS;
  
  // 如果已有定时器且更早触发，则不创建新定时器
  if (timer && timerDueAt && timerDueAt <= Date.now() + delay) {
    return;
  }
  
  // 创建新的延迟执行定时器
  timer = setTimeout(async () => {
    // 执行心跳任务
  }, delay);
}
```

#### 3.1.3 条件检查（Condition Check）

在执行心跳任务前，系统会进行多项条件检查：

```typescript
// 检查心跳是否启用
if (!heartbeatsEnabled) {
  return { status: "skipped", reason: "disabled" };
}

// 检查是否在活跃时间窗口内
if (!isWithinActiveHours(cfg, heartbeat, startedAt)) {
  return { status: "skipped", reason: "quiet-hours" };
}

// 检查命令队列是否有待处理请求
const queueSize = getQueueSize(CommandLane.Main);
if (queueSize > 0) {
  return { status: "skipped", reason: "requests-in-flight" };
}

// 检查 HEARTBEAT.md 文件是否有实质内容
if (isHeartbeatContentEffectivelyEmpty(heartbeatFileContent)) {
  return { status: "skipped", reason: "empty-heartbeat-file" };
}
```

### 3.2 系统事件的传递

心跳触发后，系统通过“系统事件”（System Events）机制将上下文传递给 Agent：

```typescript
// src/infra/system-events.ts
export function enqueueSystemEvent(text: string, options: SystemEventOptions) {
  // 将事件加入会话队列
  entry.queue.push({
    text: cleaned,
    ts: Date.now(),
    contextKey: normalizedContextKey,
  });
}
```

系统事件包括：

- **Exec 事件**：外部命令执行完成的结果
- **Cron 事件**：定时任务触发的事件
- **Hook 事件**：外部 Hook 触发的事件
- **心跳内容**：HEARTBEAT.md 文件的当前状态

这些事件会被前缀到下一个 Agent 提示的开头，使 Agent 能够感知自上次执行以来的环境变化。

---

## 四、任务正确唤醒的保证机制

### 4.1 任务不中断的保证

#### 4.1.1 执行状态跟踪

系统通过 `running` 标志跟踪当前是否有任务正在执行：

```typescript
let running = false;

// 在 schedule 函数中
if (running) {
  scheduled = true;
  schedule(delay, kind);  // 如果正在执行，重新调度
  return;
}
```

这确保了**同一时间只有一个心跳任务在运行**，避免了并发执行导致的混乱。

#### 4.1.2 命令队列感知

心跳执行器会检查命令队列（Command Lane Main）的状态：

```typescript
const queueSize = getQueueSize(CommandLane.Main);
if (queueSize > 0) {
  return { status: "skipped", reason: "requests-in-flight" };
}
```

这确保了：

- 如果有用户请求正在处理，心跳任务会等待
- 避免心跳任务与用户请求竞争计算资源
- 保证用户请求的响应优先级

#### 4.1.3 失败重试机制

当心跳任务执行失败时，系统会自动重试：

```typescript
} catch {
  // 错误已被心跳执行器记录；安排重试
  for (const pendingWake of pendingBatch) {
    queuePendingWakeReason({
      reason: pendingWake.reason ?? "retry",
      agentId: pendingWake.agentId,
      sessionKey: pendingWake.sessionKey,
    });
  }
  schedule(DEFAULT_RETRY_MS, "retry");
}
```

重试机制确保了即使遇到临时性错误，任务也有机会最终完成。

### 4.2 任务不重复的保证

#### 4.2.1 请求去重（Deduplication）

系统通过多个维度实现请求去重：

1. **目标键去重**：相同 agentId 和 sessionKey 的请求只保留最新

```typescript
function getWakeTargetKey(params: { agentId?: string; sessionKey?: string }) {
  const agentId = normalizeWakeTarget(params.agentId);
  const sessionKey = normalizeWakeTarget(params.sessionKey);
  return `${agentId ?? ""}::${sessionKey ?? ""}`;
}
```

2. **优先级覆盖**：高优先级请求可以覆盖低优先级请求

```typescript
if (next.priority > previous.priority) {
  pendingWakes.set(wakeTargetKey, next);
  return;
}
```

3. **消息ID去重**：Followup 队列使用消息ID去重

```typescript
// src/auto-reply/reply/queue/enqueue.ts
function isRunAlreadyQueued(run: FollowupRun, items: FollowupRun[]): boolean {
  const messageId = run.messageId?.trim();
  if (messageId) {
    return items.some((item) => item.messageId?.trim() === messageId);
  }
  return items.some((item) => item.prompt === run.prompt);
}
```

#### 4.2.2 活跃时间窗口

心跳系统支持配置“静默时段”（Quiet Hours），在该时段内不执行心跳：

```typescript
if (!isWithinActiveHours(cfg, heartbeat, startedAt)) {
  return { status: "skipped", reason: "quiet-hours" };
}
```

这避免了在非工作时间产生不必要的执行和通知。

#### 4.2.3 空文件检测

系统会检查 HEARTBEAT.md 文件是否为空或仅包含注释：

```typescript
if (
  isHeartbeatContentEffectivelyEmpty(heartbeatFileContent) &&
  !isExecEventReason &&
  !isCronEventReason &&
  !isWakeReason
) {
  return { status: "skipped", reason: "empty-heartbeat-file" };
}
```

这节省了 API 调用成本，同时确保有实质内容时才触发执行。

---

## 五、两种模型对系统稳定性的影响

### 5.1 被动响应模型的稳定性特征

#### 5.1.1 优点

1. **确定性行为**：每次执行都可追溯到明确的用户输入
2. **资源可预测**：系统负载与用户活跃度直接相关
3. **调试简单**：执行路径清晰，问题容易定位

#### 5.1.2 缺点

1. **无法处理异步事件**：无法响应外部系统的回调
2. **延迟较高**：必须等待用户输入才能开始处理
3. **功能受限**：无法实现监控、定时任务等能力

### 5.2 主动执行模型的稳定性挑战

#### 5.2.1 并发控制复杂度

主动执行模式引入了并发问题，需要精心设计：

- **竞态条件**：多个心跳请求同时触发
- **资源竞争**：心跳任务与用户请求竞争计算资源
- **状态一致性**：需要维护跨请求的状态

#### 5.2.2 错误传播风险

主动执行模式中，错误可能自动传播：

- 心跳触发失败可能导致任务永远不被执行
- 错误的重试逻辑可能导致“螺旋失败”
- 空循环（Busy Loop）可能导致 CPU 占用率飙升

### 5.3 OpenClaw 的稳定性设计

OpenClaw 通过以下机制确保主动执行模式的稳定性：

#### 5.3.1 多层防御机制

```
第一层：心跳启用开关
    ↓
第二层：活跃时间窗口检查
    ↓
第三层：命令队列状态检查
    ↓
第四层：内容有效性检查
    ↓
第五层：执行过程中的异常处理
```

#### 5.3.2 优雅降级

当检测到问题时，系统选择跳过执行而不是强制执行：

```typescript
if (queueSize > 0) {
  return { status: "skipped", reason: "requests-in-flight" };
}
```

这种设计确保了用户请求始终具有最高优先级。

#### 5.3.3 生命周期管理

心跳系统支持热重载和进程重启：

```typescript
export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null): () => void {
  // 清理旧的生命周期状态
  if (timer) {
    clearTimeout(timer);
  }
  running = false;
  scheduled = false;
  // ...
}
```

这确保了在服务升级或重启时，系统状态保持一致。

---

## 六、架构启示与最佳实践

### 6.1 主动执行系统的设计原则

通过分析 OpenClaw 的实现，我们可以总结出主动执行系统的关键设计原则：

#### 6.1.1 优先级明确

将触发原因分为不同优先级，确保重要事件优先处理。EXEC 事件应该优先于定期心跳，手动触发应该优先于自动触发。

#### 6.1.2 防抖与合并

使用时间窗口合并短时间内多个请求，避免“惊群效应”（Thundering Herd）。

```typescript
const DEFAULT_COALESCE_MS = 250;  // 250ms 合并窗口
```

#### 6.1.3 可观测性

每个心跳执行都应有完整的日志和事件追踪：

```typescript
emitHeartbeatEvent({
  status: "skipped",
  reason: "requests-in-flight",
  durationMs: Date.now() - startedAt,
});
```

#### 6.1.4 幂等性

设计任务时考虑幂等性，确保重复执行不会产生副作用。

### 6.2 与传统 Cron 的对比

| 特性 | 传统 Cron | OpenClaw 心跳 |
|------|-----------|---------------|
| 触发精度 | 分钟级 | 秒级（可配置） |
| 上下文 | 无状态 | 携带完整会话上下文 |
| 条件执行 | 依赖脚本判断 | 内置条件检查 |
| 重试机制 | 需要自行实现 | 内置重试逻辑 |
| 与用户请求冲突 | 无感知 | 主动让路 |

### 6.3 演进方向建议

基于当前架构，OpenClaw 的心跳系统可以进一步演进：

1. **分布式心跳**：支持多实例部署时的心跳协调
2. **智能调度**：基于历史执行时间动态调整心跳间隔
3. **可配置背压**：在系统负载高时自动降低心跳频率
4. **审计追溯**：完整记录所有心跳触发决策的因果链

---

## 七Claw 的心跳机制代表了 AI、结论

Open Agent 从“对话系统”向“自动执行引擎”演进的核心技术路径。通过精心设计的请求调度、优先级管理、去重机制和条件检查，系统实现了在保持稳定性的同时支持多种主动执行场景。

关键技术要点总结：

1. **心跳触发机制**：基于优先级的时间驱动+事件驱动混合模式
2. **任务唤醒保证**：多层条件检查 + 命令队列感知
3. **不中断保证**：单例执行标志 + 失败重试机制
4. **不重复保证**：目标键去重 + 消息ID去重 + 优先级覆盖
5. **稳定性保障**：活跃时间窗口 + 优雅降级 + 生命周期管理

这一架构不仅支撑了 OpenClaw 的自动化能力，也为其他 AI Agent 系统的主动执行设计提供了有价值的参考模型。

---

*文档版本：1.0*
*编写日期：2026-02-18*
*研究对象：OpenClaw Heartbeat System*
