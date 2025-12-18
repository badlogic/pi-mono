# Session Persistence System

Complete session management for resumable agent workflows in the discord-bot package.

## Features

- **Filesystem-based persistence** - Sessions survive bot restarts
- **Iteration tracking** - Bounded execution prevents infinite loops
- **Pause/Resume** - Long-running tasks can be interrupted and continued
- **Event logging** - Full lifecycle tracking for debugging and monitoring
- **Context accumulation** - State preservation for continuation
- **Webhook notifications** - Optional external notifications for session events
- **Session statistics** - Analytics and monitoring capabilities
- **Auto-cleanup** - Configurable retention for old sessions

## Architecture

```
src/agents/session/
├── types.ts       # TypeScript type definitions
├── store.ts       # Filesystem storage layer
├── manager.ts     # High-level lifecycle API
├── index.ts       # Public exports
├── examples.ts    # Integration examples
└── README.md      # This file
```

### Session Directory Structure

```
src/agents/sessions/
├── session_abc123_xyz/
│   └── session.json      # Complete session state
├── session_def456_uvw/
│   └── session.json
└── ...
```

## Session Lifecycle

```
┌─────────┐
│  Start  │ ──────────────┐
└─────────┘               │
     │                    │
     v                    │
┌─────────┐          ┌────▼────┐
│ Active  │ ◄──────► │ Paused  │
└─────────┘          └─────────┘
     │
     ├──► Completed
     ├──► Failed
     └──► Timeout (max iterations)
```

## Usage

### Basic Session Management

```typescript
import {
  startSession,
  pauseSession,
  resumeSession,
  completeSession,
  failSession,
  getSession,
} from "./agents/index.js";

// Start a new session
const session = await startSession("Implement feature X", "developer", {
  userId: "user123",
  channelId: "channel456",
  maxIterations: 50,
  context: { priority: "high" },
});

console.log(`Session started: ${session.id}`);

// Pause for later
await pauseSession(session.id, "User requested pause");

// Resume
await resumeSession(session.id);

// Complete successfully
await completeSession(session.id, "Feature implemented");

// Or fail with error
await failSession(session.id, "Build failed");
```

### Event Tracking

```typescript
import {
  incrementIteration,
  recordToolCall,
  recordLearning,
  addEvent,
} from "./agents/index.js";

// Track iteration progress
await incrementIteration(session.id, {
  step: "analysis",
  phase: "planning",
});

// Record tool usage
await recordToolCall(
  session.id,
  "bash",
  { command: "npm test" },
  { exitCode: 0, output: "All tests passed" }
);

// Record learning events
await recordLearning(
  session.id,
  "Learned to handle edge case X",
  "expertise/developer.md"
);

// Custom events
await addEvent(session.id, "custom_event", {
  customField: "value",
});
```

### Context and Resumption

```typescript
import { getSessionContext, isSessionResumable } from "./agents/index.js";

// Check if session can be resumed
if (isSessionResumable(session.id)) {
  // Get accumulated context
  const context = getSessionContext(session.id);

  console.log(`Task: ${context.task}`);
  console.log(`Progress: ${context.iterations}/${context.maxIterations}`);
  console.log(`Recent history:`, context.recentHistory);

  // Resume execution with context
  await resumeSession(session.id);
}
```

### Session Queries

```typescript
import {
  getActiveSessions,
  getPausedSessions,
  getCompletedSessions,
  getFailedSessions,
  findSessions,
  getStats,
} from "./agents/index.js";

// Get active sessions for a user
const active = getActiveSessions({ userId: "user123" });

// Get all paused sessions
const paused = getPausedSessions();

// Get completed sessions in the last 24 hours
const recent = getCompletedSessions({
  createdAfter: new Date(Date.now() - 86400000).toISOString(),
});

// Complex filtering
const sessions = findSessions({
  userId: "user123",
  mode: "developer",
  status: ["active", "paused"],
  limit: 10,
});

// Get statistics
const stats = getStats();
console.log(`Total: ${stats.total}`);
console.log(`Success rate: ${stats.successRate}%`);
console.log(`Average iterations: ${stats.averageIterations}`);
console.log(`By status:`, stats.byStatus);
console.log(`By mode:`, stats.byMode);
```

### Session Cleanup

```typescript
import { cleanupSessions, removeSession } from "./agents/index.js";

// Clean up sessions older than 30 days
const cleaned = cleanupSessions(30);
console.log(`Cleaned ${cleaned} old sessions`);

// Delete specific session
removeSession(session.id);
```

### Webhook Notifications

```typescript
import { configureWebhook } from "./agents/index.js";

// Configure webhook endpoint
configureWebhook("http://localhost:3001/webhooks/sessions");

// Webhook payload format:
// {
//   event: "start" | "pause" | "resume" | "complete" | "error" | "timeout",
//   session: {
//     id: string,
//     mode: string,
//     status: string,
//     task: string,
//     userId?: string,
//     channelId?: string,
//   },
//   timestamp: string,
//   data?: Record<string, unknown>
// }
```

## Integration with Agents

### OpenHands Agent

```typescript
import { runOpenHandsAgent } from "./agents/index.js";
import {
  startSession,
  incrementIteration,
  completeSession,
  failSession,
} from "./agents/index.js";

async function runWithSession(task: string, mode: string) {
  const session = await startSession(task, mode, { maxIterations: 50 });

  try {
    await incrementIteration(session.id, { phase: "initialization" });

    const result = await runOpenHandsAgent({
      task,
      mode,
      sessionId: session.id,
      persist: true,
    });

    if (result.success) {
      await completeSession(session.id, result.output);
    } else {
      await failSession(session.id, result.error || "Failed");
    }

    return result;
  } catch (error) {
    await failSession(session.id, error.message);
    throw error;
  }
}
```

### Lightweight Agent

```typescript
import { runLearningAgent } from "./agents/index.js";
import {
  startSession,
  recordLearning,
  completeSession,
} from "./agents/index.js";

async function runLightweightWithSession(prompt: string, mode: string) {
  const session = await startSession(prompt, mode);

  try {
    const result = await runLearningAgent({
      prompt,
      mode,
      enableLearning: true,
    });

    if (result.learned) {
      await recordLearning(
        session.id,
        result.learned.insight,
        result.learned.expertiseFile
      );
    }

    await completeSession(session.id, result.output);
    return result;
  } catch (error) {
    await failSession(session.id, error.message);
    throw error;
  }
}
```

## Session Types

### AgentSession

```typescript
interface AgentSession {
  // Identification
  id: string;
  userId?: string;
  channelId?: string;

  // Task information
  mode: string;
  task: string;
  workspace?: string;

  // Session state
  status: "active" | "paused" | "completed" | "failed" | "timeout";
  createdAt: string;
  updatedAt: string;

  // Execution tracking
  iterations: number;
  maxIterations: number;

  // Context and results
  context: Record<string, unknown>;
  history: SessionEvent[];
  result?: string;
  error?: string;

  // Metadata
  metadata?: {
    model?: string;
    timeout?: number;
    enableLearning?: boolean;
    delegated?: boolean;
    blockedActions?: Array<{ action: string; reason: string }>;
    toolsUsed?: string[];
    cost?: number;
    tokens?: { prompt: number; completion: number; total: number };
  };
}
```

### SessionEvent

```typescript
interface SessionEvent {
  timestamp: string;
  type: "start" | "iteration" | "tool_call" | "learning" | "pause" | "resume" | "complete" | "error" | "timeout";
  data: Record<string, unknown>;
}
```

## Best Practices

### 1. Set Appropriate Max Iterations

```typescript
// Quick tasks: 10-20 iterations
const session = await startSession(task, mode, { maxIterations: 15 });

// Complex tasks: 50-100 iterations
const session = await startSession(task, mode, { maxIterations: 75 });

// Very long tasks: 100-200 iterations
const session = await startSession(task, mode, { maxIterations: 150 });
```

### 2. Track Progress Regularly

```typescript
// Increment at meaningful milestones
await incrementIteration(session.id, { phase: "analysis" });
await incrementIteration(session.id, { phase: "implementation" });
await incrementIteration(session.id, { phase: "testing" });
```

### 3. Preserve Context for Resumption

```typescript
// Save important state in context
await updateContext(session.id, {
  currentPhase: "implementation",
  completedSteps: ["analysis", "planning"],
  nextStep: "write_tests",
});

// Use context when resuming
const context = getSessionContext(session.id);
const nextStep = context.context.nextStep;
```

### 4. Handle Timeouts Gracefully

```typescript
const session = await startSession(task, mode, { maxIterations: 50 });

for (let i = 0; i < session.maxIterations; i++) {
  await incrementIteration(session.id);

  const current = getSession(session.id);
  if (current?.status === "timeout") {
    console.log("Max iterations reached, pausing for review");
    await pauseSession(session.id, "Max iterations reached");
    break;
  }

  // ... do work ...
}
```

### 5. Regular Cleanup

```typescript
// Clean up old sessions daily
setInterval(() => {
  const cleaned = cleanupSessions(30); // 30 days
  console.log(`Cleaned ${cleaned} old sessions`);
}, 86400000); // 24 hours
```

## Advanced Usage

### Multi-Step Workflows

See `examples.ts` for complete multi-step workflow examples with pause/resume.

### Session-Aware Agent Wrapper

```typescript
import { SessionAwareAgent } from "./agents/session/examples.js";

const agent = new SessionAwareAgent("user123", "channel456");

// Execute with automatic session management
const result = await agent.execute("Review code", "code_review");

// Get user's active sessions
const sessions = agent.getActiveSessions();

// Pause and resume
await agent.pause(session.id, "User requested pause");
await agent.resume(session.id);
```

## Performance Considerations

- **Filesystem I/O**: Each session operation reads/writes JSON files. For high-frequency operations, consider batching updates.
- **Session Cleanup**: Run cleanup during off-peak hours to avoid I/O contention.
- **Session Directory**: Monitor `src/agents/sessions/` directory size. Each session is ~2-10KB depending on history length.

## Troubleshooting

### Session Not Found

```typescript
const session = getSession(sessionId);
if (!session) {
  console.error(`Session ${sessionId} not found or was deleted`);
}
```

### Cannot Pause/Resume

```typescript
try {
  await pauseSession(sessionId);
} catch (error) {
  console.error(`Cannot pause: ${error.message}`);
  // Session might not be in "active" status
}
```

### Session Corruption

If a session file becomes corrupted:

```bash
# Delete the session manually
rm -rf src/agents/sessions/session_abc123_xyz
```

Or programmatically:

```typescript
import { removeSession } from "./agents/index.js";
removeSession(corruptedSessionId);
```

## API Reference

See `types.ts` for complete type definitions and `manager.ts` for full API documentation.

## Testing

Run tests:

```bash
npx vitest run src/agents/session/session.test.ts
```

All session operations are thoroughly tested, including:
- Session creation and persistence
- Lifecycle transitions (pause/resume/complete/fail)
- Event tracking and history
- Context preservation
- Filtering and statistics
- Cleanup operations

## License

Part of the pi-mono discord-bot package.
