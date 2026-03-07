# 24×7 持久运行下的日志、审计与失败恢复策略研究

## 研究背景与意义

在人工智能代理系统的商业化落地过程中，24×7 持久运行是核心需求之一。与传统的按需调用模式不同，持久运行的 Agent 系统面临着独特的挑战：如何在长时间运行过程中保持可观测性？如何在发生故障时快速恢复？哪些指标是衡量系统健康状态的关键？

OpenClaw 作为一个生产级的 Agent 平台，在其代码库中实现了完善的可观测性体系、健康监控机制和故障恢复策略。本文将通过深入分析其源代码，探讨以下核心问题：如何设计高可观测性体系？哪些指标是健康运行监控的核心？失败恢复的策略如何制定？这些设计选择对系统的长期稳定运行有何深远影响？

---

## 一、日志系统架构设计

### 1.1 日志系统的整体架构

OpenClaw 的日志系统采用了分层架构设计，从底层到高层依次为：

- **日志库层**：基于 `tslog` 库实现结构化日志
- **子系统日志层**：通过 `createSubsystemLogger` 创建子模块日志器
- **诊断事件层**：通过 `emitDiagnosticEvent` 实现关键事件追踪
- **外部传输层**：支持外部日志收集系统

```typescript
// src/logging/logger.ts
import { Logger as TsLogger } from "tslog";

const logger = new TsLogger<LogObj>({
  name: "openclaw",
  minLevel: levelToMinLevel(settings.level),
  type: "hidden", // no ansi formatting
});
```

这种分层设计使得日志系统既保持了简洁的 API，又支持灵活的功能扩展。

### 1.2 结构化日志设计

OpenClaw 采用结构化日志格式，每个日志条目包含以下核心字段：

```typescript
type LogObj = { date?: Date } & Record<string, unknown>;
```

结构化日志的优势在于：

1. **便于检索**：可以通过日志字段进行高效查询
2. **便于分析**：结构化数据易于进行统计分析
3. **便于关联**：通过 sessionKey、traceId 等字段关联跨模块日志

### 1.3 日志级别管理

```typescript
// src/logging/levels.ts
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export const levelToMinLevel = (level: LogLevel): number => {
  switch (level) {
    case "trace":
      return 0;
    case "debug":
      return 1;
    case "info":
      return 2;
    // ...
  }
};
```

日志级别与输出目标的分离配置：

```typescript
// 可分别为文件和控制台设置不同级别
export type LoggerSettings = {
  level?: LogLevel;           // 文件日志级别
  file?: string;              // 日志文件路径
  consoleLevel?: LogLevel;    // 控制台日志级别
  consoleStyle?: ConsoleStyle;
};
```

### 1.4 日志轮转与清理机制

```typescript
// src/logging/logger.ts
const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000; // 24小时

function pruneOldRollingLogs(dir: string) {
  // 清理超过24小时的旧日志文件
}
```

日志系统支持自动轮转和清理，防止磁盘空间耗尽。

### 1.5 子系统日志器

```typescript
// src/logging/subsystem.ts
export function createSubsystemLogger(subsystem: string) {
  return new Logger({
    name: subsystem,
    minLevel: /* 从配置读取 */,
  });
}

// 使用示例
const log = createSubsystemLogger("gateway/heartbeat");
log.info("heartbeat triggered", { agentId, reason });
```

子系统日志器使得日志分类更加清晰，便于问题定位。

---

## 二、诊断事件系统

### 2.1 诊断事件的类型定义

OpenClaw 定义了丰富的诊断事件类型，覆盖了系统运行的各个方面：

```typescript
// src/infra/diagnostic-events.ts
export type DiagnosticUsageEvent = DiagnosticBaseEvent & {
  type: "model.usage";
  sessionKey?: string;
  provider?: string;
  model?: string;
  usage: { input?: number; output?: number; total?: number };
  costUsd?: number;
  durationMs?: number;
};

export type DiagnosticWebhookReceivedEvent = DiagnosticBaseEvent & {
  type: "webhook.received";
  channel: string;
  updateType?: string;
  chatId?: number | string;
};

export type DiagnosticMessageQueuedEvent = DiagnosticBaseEvent & {
  type: "message.queued";
  sessionKey?: string;
  source: string;
  queueDepth?: number;
};

export type DiagnosticMessageProcessedEvent = DiagnosticBaseEvent & {
  type: "message.processed";
  channel: string;
  durationMs?: number;
  outcome: "completed" | "skipped" | "error";
};
```

### 2.2 诊断事件的应用

诊断事件系统被广泛应用于关键操作的追踪：

```typescript
// src/logging/diagnostic.ts
export function logWebhookReceived(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
}) {
  webhookStats.received += 1;
  emitDiagnosticEvent({
    type: "webhook.received",
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
  });
}

export function logMessageProcessed(params: {
  channel: string;
  durationMs?: number;
  outcome: "completed" | "skipped" | "error";
}) {
  emitDiagnosticEvent({
    type: "message.processed",
    channel: params.channel,
    durationMs: params.durationMs,
    outcome: params.outcome,
  });
}
```

### 2.3 会话状态追踪

```typescript
// src/logging/diagnostic-session-state.ts
export type SessionStateValue = {
  state: DiagnosticSessionState;
  changedAt: number;
  queueDepth?: number;
  currentMessageId?: string;
};

// 追踪每个会话的状态
export const diagnosticSessionStates = new Map<string, SessionStateValue>();
```

会话状态追踪对于分析消息处理延迟、识别卡顿会话至关重要。

---

## 三、审计机制

### 3.1 安全审计

OpenClaw 实现了全面的安全审计机制，记录所有敏感操作：

```typescript
// src/security/audit.ts
export async function auditToolCall(params: {
  toolName: string;
  params: unknown;
  result?: unknown;
  error?: unknown;
  sessionKey: string;
  timestamp: number;
}): Promise<void> {
  // 记录完整的工具调用轨迹
  // 包括参数、结果、错误信息
}
```

### 3.2 危险工具标记

```typescript
// src/security/dangerous-tools.ts
export const DANGEROUS_ACP_TOOL_NAMES = [
  "exec",
  "spawn",
  "shell",
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
] as const;

export const DANGEROUS_ACP_TOOLS = new Set<string>(DANGEROUS_ACP_TOOL_NAMES);
```

危险工具需要额外审批，确保执行安全：

```typescript
// ACP 场景下，危险工具需要用户明确授权
export function requiresApproval(toolName: string): boolean {
  return DANGEROUS_ACP_TOOLS.has(toolName);
}
```

### 3.3 执行审计日志

```typescript
// src/agents/bash-tools.exec-runtime.ts
function emitExecSystemEvent(params: {
  sessionKey: string;
  agentId: string;
  command: string;
  exitCode?: number;
  durationMs: number;
}) {
  // 记录命令执行的完整上下文
}
```

---

## 四、健康监控指标体系

### 4.1 系统级健康指标

OpenClaw 定义了全面的健康检查接口：

```typescript
// src/commands/health.ts
export type HealthSummary = {
  ok: true;
  ts: number;
  durationMs: number;
  channels: Record<string, ChannelHealthSummary>;
  channelOrder: string[];
  heartbeatSeconds: number;
  defaultAgentId: string;
  agents: AgentHealthSummary[];
  sessions: {
    path: string;
    count: number;
    recent: Array<{
      key: string;
      updatedAt: number | null;
      age: number | null;
    }>;
  };
};
```

### 4.2 通道健康监控

```typescript
// src/gateway/channel-health-monitor.ts
export function startChannelHealthMonitor(deps: ChannelHealthMonitorDeps): ChannelHealthMonitor {
  const DEFAULT_CHECK_INTERVAL_MS = 5 * 60_000;    // 5分钟检查一次
  const DEFAULT_STARTUP_GRACE_MS = 60_000;         // 启动后60秒内不检查
  const DEFAULT_COOLDOWN_CYCLES = 2;
  const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
  
  // 检查通道是否健康
  function isChannelHealthy(snapshot: {
    running?: boolean;
    connected?: boolean;
  }): boolean {
    if (!snapshot.running) return false;
    if (snapshot.connected === false) return false;
    return true;
  }
}
```

通道健康监控的核心指标：

- **running**：通道进程是否运行
- **connected**：网络连接状态
- **enabled**：通道是否启用
- **configured**：通道是否配置完成

### 4.3 运行时快照

```typescript
// src/gateway/server/health-state.ts
export function buildGatewaySnapshot(): Snapshot {
  const uptimeMs = Math.round(process.uptime() * 1000);
  const presence = listSystemPresence();
  
  return {
    presence,
    health: emptyHealth,
    uptimeMs,                    // 运行时长
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    sessionDefaults: {...},
  };
}
```

关键运行时指标：

- **uptimeMs**：服务运行时长
- **presence**：系统在线状态
- **stateVersion**：状态版本号（用于缓存失效）

### 4.4 会话健康指标

```typescript
// 健康检查中的会话指标
sessions: {
  path: string;        // 会话存储路径
  count: number;      // 会话总数
  recent: Array<{     // 最近更新的会话
    key: string;
    updatedAt: number | null;
    age: number | null;
  }>;
}
```

---

## 五、失败恢复策略

### 5.1 会话状态修复机制

长时间运行可能导致会话状态损坏，OpenClaw 实现了自动修复机制：

```typescript
// src/agents/session-transcript-repair.ts
export function repairToolCallInputs(messages: AgentMessage[]): ToolCallInputRepairReport {
  // 检测并修复缺失的工具调用输入
  // 为缺失的工具结果插入合成错误结果
  
  return {
    messages: repaired,
    droppedToolCalls: count,
    droppedAssistantMessages: count,
  };
}

// 修复缺失的工具结果
function makeMissingToolResult(params: {
  toolCallId: string;
  toolName?: string;
}): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId,
    toolName: params.toolName ?? "unknown",
    content: [{
      type: "text",
      text: "[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.",
    }],
    isError: true,
    timestamp: Date.now(),
  };
}
```

### 5.2 进程守护与自动重启

```typescript
// src/gateway/channel-health-monitor.ts
async function runCheck() {
  // 检查通道健康状态
  for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
    if (!isChannelHealthy(status)) {
      // 记录重启
      log.info(`[${channelId}:${accountId}] restarting (reason: ${reason})`);
      
      // 执行重启
      await channelManager.stopChannel(channelId, accountId);
      await channelManager.startChannel(channelId, accountId);
      
      // 记录重启时间
      record.lastRestartAt = now;
    }
  }
}
```

重启保护机制：

```typescript
// 每小时最多重启次数限制
if (record.restartsThisHour.length >= maxRestartsPerHour) {
  log.warn(`hit ${maxRestartsPerHour} restarts/hour limit, skipping`);
  continue;
}
```

### 5.3 优雅关闭机制

```typescript
// src/gateway/server-close.ts
export async function gracefulShutdown(opts: {
  reason: string;
  forceAfterMs?: number;
}) {
  // 1. 停止接收新请求
  stopAcceptingConnections();
  
  // 2. 等待正在处理的请求完成
  await waitForInflightRequests(opts.forceAfterMs ?? 30000);
  
  // 3. 关闭通道连接
  await channelManager.stopAll();
  
  // 4. 保存状态
  await saveState();
  
  // 5. 退出进程
  process.exit(0);
}
```

### 5.4 SIGUSR1 热重启

```typescript
// src/infra/restart.ts
export function emitGatewayRestart(): boolean {
  // 授权重启信号
  authorizeGatewaySigusr1Restart();
  
  // 发送 SIGUSR1 信号
  if (process.listenerCount("SIGUSR1") > 0) {
    process.emit("SIGUSR1");
  } else {
    process.kill(process.pid, "SIGUSR1");
  }
  
  return true;
}
```

热重启的优势：

- 无需关闭端口，客户端无感知
- 保留内存状态
- 快速恢复服务

### 5.5 预重启延迟检查

```typescript
// src/infra/restart.ts
export function setPreRestartDeferralCheck(fn: () => number): void {
  preRestartCheck = fn;
}

// 重启前检查待处理项数量
if (preRestartCheck && preRestartCheck() > 0) {
  // 延迟重启
  scheduleDelayedRestart();
}
```

---

## 六、可观测性体系设计

### 6.1 关键操作追踪

OpenClaw 的可观测性体系覆盖了以下关键操作：

```typescript
// Webhook 接收
logWebhookReceived({ channel, updateType, chatId });

// Webhook 处理
logWebhookProcessed({ channel, durationMs });

// 消息入队
logMessageQueued({ sessionKey, source, queueDepth });

// 消息处理完成
logMessageProcessed({ channel, durationMs, outcome });

// 会话状态变更
logSessionState({ sessionKey, prevState, state, reason });
```

### 6.2 延迟追踪

```typescript
// 消息处理延迟
durationMs: number;

// 心跳执行时长
durationMs: Date.now() - startedAt;

// API 调用耗时
durationMs: Date.now() - callStartedAt;
```

### 6.3 吞吐量指标

```typescript
// 统计数据
webhookStats = {
  received: 0,      // 已接收
  processed: 0,    // 已处理
  errors: 0,        // 错误数
  lastReceived: 0, // 最后接收时间
};
```

### 6.4 错误追踪

```typescript
// 诊断错误事件
type DiagnosticWebhookErrorEvent = DiagnosticBaseEvent & {
  type: "webhook.error";
  channel: string;
  updateType?: string;
  chatId?: number | string;
  error: string;
};

type DiagnosticSessionStuckEvent = DiagnosticBaseEvent & {
  type: "session.stuck";
  sessionKey?: string;
  sessionId?: string;
  state: DiagnosticSessionState;
  ageMs: number;
};
```

---

## 七、核心监控指标总结

### 7.1 系统级指标

| 指标名称 | 描述 | 告警阈值 |
|---------|------|---------|
| uptimeMs | 服务运行时长 | - |
| memoryUsage | 内存使用量 | > 80% |
| cpuUsage | CPU 使用率 | > 90% |
| activeHandles | 活跃句柄数 | 持续增长 |

### 7.2 通道级指标

| 指标名称 | 描述 | 告警阈值 |
|---------|------|---------|
| channel.running | 通道运行状态 | false |
| channel.connected | 连接状态 | false |
| restartsPerHour | 每小时重启次数 | > 3 |

### 7.3 会话级指标

| 指标名称 | 描述 | 告警阈值 |
|---------|------|---------|
| sessions.total | 会话总数 | - |
| sessions.recent | 最近活跃会话 | - |
| session.state | 会话状态 | stuck > 5min |
| queueDepth | 队列深度 | > 100 |

### 7.4 消息处理指标

| 指标名称 | 描述 | 告警阈值 |
|---------|------|---------|
| webhook.received | 接收速率 | - |
| webhook.processed | 处理速率 | - |
| message.duration | 处理延迟 | > 30s |
| message.error | 错误率 | > 5% |

### 7.5 资源消耗指标

| 指标名称 | 描述 | 告警阈值 |
|---------|------|---------|
| model.usage.tokens | Token 消耗 | - |
| model.cost | 成本 | > 阈值 |
| api.calls | API 调用次数 | - |

---

## 八、架构启示与最佳实践

### 8.1 可观测性设计原则

通过对 OpenClaw 代码的分析，我们可以总结出以下可观测性设计原则：

#### 8.1.1 事件驱动

采用事件驱动的日志模型：

```
关键操作 → 发出诊断事件 → 异步处理
```

这种方式的优势在于：

- 不阻塞主流程
- 便于扩展处理逻辑
- 支持多个订阅者

#### 8.1.2 结构化日志

所有日志都采用结构化格式：

```typescript
log.info("message", { key: "value", ... });
```

结构化日志便于：

- 自动化解析
- 条件查询
- 统计分析

#### 8.1.3 分层监控

监控指标分为多个层次：

```
系统层 → 通道层 → 会话层 → 消息层
```

每层都有独立的健康检查和告警策略。

### 8.2 失败恢复设计原则

#### 8.2.1 快速失败

当检测到问题时，应尽快失败并记录上下文：

```typescript
if (!isChannelHealthy(status)) {
  log.error(`channel unhealthy: ${channelId}`);
  await restartChannel();
}
```

#### 8.2.2 自动恢复

尽可能自动化恢复操作：

- 通道自动重启
- 会话状态自动修复
- 连接自动重连

#### 8.2.3 保护机制

防止无限重试导致的雪崩：

```typescript
// 每小时最多重启次数
if (restartsThisHour >= MAX_RESTARTS_PER_HOUR) {
  // 停止自动恢复
  log.error("max restarts reached, manual intervention required");
}
```

### 8.3 长期运行的最佳实践

#### 8.3.1 资源管理

- 定期清理过期数据
- 限制缓存大小
- 监控资源使用

#### 8.3.2 状态一致性

- 定期保存状态
- 实现状态修复机制
- 支持状态回滚

#### 8.3.3 可用性保障

- 实施健康检查
- 设置合理的重启策略
- 优雅关闭支持

---

## 九、总结与展望

### 9.1 核心发现

通过对 OpenClaw 代码库的深入分析，我们可以看到一个生产级 Agent 平台在 24×7 持久运行方面的精心设计：

**可观测性体系**：

- 分层日志架构（Logger → Subsystem → Diagnostic）
- 结构化诊断事件系统
- 完整的审计追踪

**健康监控**：

- 多层次健康检查（系统、通道、会话）
- 自动恢复机制
- 保护性限流

**失败恢复**：

- 会话状态自动修复
- 通道健康监控与自动重启
- 优雅关闭与热重启支持

### 9.2 架构价值

OpenClaw 的可观测性和恢复机制代表了现代 Agent 平台的核心设计范式：

1. **全面覆盖**：从系统到消息的完整监控
2. **自动化恢复**：减少人工干预需求
3. **保护机制**：防止故障扩散
4. **可追溯性**：完整的日志和审计记录

### 9.3 演进方向

基于当前架构，长期运行系统可以进一步演进：

1. **智能预测**：基于历史数据预测潜在故障
2. **自适应恢复**：根据问题类型选择最佳恢复策略
3. **分布式追踪**：跨实例的完整请求追踪
4. **自动化运维**：基于指标的自我修复

---

*文档版本：1.0*
*编写日期：2026-02-18*
*研究对象：OpenClaw Observability & Recovery System*
