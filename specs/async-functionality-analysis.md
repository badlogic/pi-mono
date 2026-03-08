# Async Functionality Analysis: pi-mono vs oh-my-pi

## Executive Summary

**The async functionality from oh-my-pi is already fully implemented in pi-mono.**

This document analyzes the async background job execution system in both codebases to determine what, if anything, needs to be added to pi-mono.

## pi-mono Current Implementation

### Core Components

#### 1. AsyncJobManager (`packages/coding-agent/src/core/tools/async-jobs.ts`)

A complete async job manager with:

- **Job Types**: `"bash"` (extensible for other types)
- **Job Status**: `"running" | "completed" | "failed" | "cancelled"`
- **Job Registration**: `register(type, label, run, options)` - returns job ID
- **Cancellation**: `cancel(id)`, `cancelAll()`
- **Progress Updates**: `reportProgress(text, details)` callback
- **Job Queries**: `getJob(id)`, `getRunningJobs()`, `getRecentJobs(limit)`, `getAllJobs()`
- **Waiting**: `waitForAny(jobIds?, signal?)`, `waitForAll()`
- **Delivery Retry**: Exponential backoff with jitter (500ms base, 30s max)
- **Retention**: 5-minute default, automatic eviction
- **Markdown Formatting**: `formatJobsListMarkdown()`, `formatJobMarkdown(id)`

#### 2. BashTool with Async (`packages/coding-agent/src/core/tools/bash.ts`)

Extended bash tool with:

- **`async: true`** parameter for background execution
- Returns immediately with job ID
- Progress streaming via `onUpdate` callback
- Full output streaming to truncated buffer

#### 3. AwaitTool (`packages/coding-agent/src/core/tools/await.ts`)

Tool to wait for background jobs:

- **`jobs`** parameter: array of job IDs to wait for (optional)
- If no jobs specified, waits for any running job
- Returns completed/running job status
- Acknowledges deliveries to suppress retry notifications

#### 4. CancelJobTool (`packages/coding-agent/src/core/tools/cancel-job.ts`)

Tool to cancel running jobs:

- **`job_id`** parameter: the job to cancel
- Returns status: `"cancelled" | "not_found" | "already_completed"`

#### 5. jobs:// Protocol (`packages/coding-agent/src/core/tools/read.ts`)

Built into the read tool:

- `read jobs://` - Lists all jobs with status, type, label, duration
- `read jobs://<job-id>` - Shows detailed job information with result/error

### Settings Integration

Located in `packages/coding-agent/src/core/settings-manager.ts`:

```typescript
interface AsyncExecutionSettings {
  enabled?: boolean;   // Enable async execution
  maxJobs?: number;    // Max concurrent jobs (default: 100)
}
```

Methods:
- `getAsyncExecutionEnabled(): boolean`
- `setAsyncExecutionEnabled(enabled: boolean): void`
- `getAsyncMaxJobs(): number`
- `setAsyncMaxJobs(maxJobs: number): void`

### AgentSession Integration

Located in `packages/coding-agent/src/core/agent-session.ts`:

1. **AsyncJobManager Creation** (line ~291):
```typescript
this._asyncJobManager = new AsyncJobManager({
  maxRunningJobs: this.settingsManager.getAsyncMaxJobs(),
});
```

2. **Completion Handler** - Sends custom message when jobs complete:
```typescript
this._asyncJobManager.setCompletionHandler(async (jobId, text, job) => {
  await this.sendCustomMessage({
    customType: "async-job",
    content: [{ type: "text", text: `[async ${status}] ${jobId}${label}\n\n${text}` }],
    display: true,
    details: { jobId, status, label: job?.label, type: job?.type },
  }, { deliverAs: "followUp" });
});
```

3. **Tool Creation** (line ~2184):
```typescript
return createAllTools(this._cwd, {
  async: {
    enabled: this.settingsManager.getAsyncExecutionEnabled(),
    maxJobs: this.settingsManager.getAsyncMaxJobs(),
    jobManager: this._asyncJobManager,
  },
});
```

4. **Dynamic Tool Management** - Adds/removes await/cancel_job tools based on settings:
```typescript
private _refreshBaseToolsFromSettings(options?: { syncAsyncTools?: boolean }): void {
  const asyncEnabled = this.settingsManager.getAsyncExecutionEnabled();
  if (asyncEnabled) {
    nextActiveToolNames.push("await", "cancel_job");
  }
}
```

## Comparison with oh-my-pi

### Similarities

| Feature | pi-mono | oh-my-pi |
|---------|---------|----------|
| AsyncJobManager | ✅ Full implementation | ✅ Full implementation |
| Bash async mode | ✅ `async: true` parameter | ✅ `async: true` parameter |
| Await tool | ✅ Waits for jobs | ✅ Waits for jobs |
| Cancel job tool | ✅ Cancels jobs | ✅ Cancels jobs |
| jobs:// protocol | ✅ In read tool | ✅ Via JobsProtocolHandler |
| Settings | ✅ `async.enabled`, `async.maxJobs` | ✅ Same settings |
| Progress updates | ✅ Streaming updates | ✅ Streaming updates |
| Delivery retry | ✅ Exponential backoff | ✅ Exponential backoff |
| Job retention | ✅ 5-minute default | ✅ 5-minute default |

### Minor Differences

| Aspect | pi-mono | oh-my-pi |
|--------|---------|----------|
| Job ID format | UUID-based (`bg_<uuid>`) | Snowflake-based (`bg_<snowflake>`) |
| Sleep implementation | `setTimeout` | `Bun.sleep` |
| Jobs protocol | Inline in read.ts | Separate `JobsProtocolHandler` class |
| Logging | Minimal | More detailed via `logger` |
| Task tool integration | Not present | Deeper integration with task tool |
| Max jobs default | 100 | 15 |

### What oh-my-pi Has That pi-mono Doesn't

1. **Separate JobsProtocolHandler class** - pi-mono has this inline in read.ts, which is simpler but less modular

2. **Task tool async integration** - oh-my-pi's task tool has more sophisticated async background execution for subagents

3. **More detailed logging** - oh-my-pi uses a logger utility for async job events

## Conclusion

**No implementation work is required.** The async functionality from oh-my-pi is already present in pi-mono with equivalent features:

- ✅ Background job execution via `bash` tool with `async: true`
- ✅ `await` tool to wait for job completion
- ✅ `cancel_job` tool to cancel running jobs
- ✅ `jobs://` protocol to inspect job status
- ✅ Settings to enable/disable and configure limits
- ✅ Automatic delivery of job completion as follow-up messages
- ✅ Progress streaming during execution
- ✅ Job retention and cleanup

## Usage Examples

### Enable Async Execution

In `.pi/settings.json`:
```json
{
  "async": {
    "enabled": true,
    "maxJobs": 50
  }
}
```

### Run Background Command

```typescript
// In the bash tool
{
  "command": "npm run build",
  "async": true
}
// Returns: "Background job bg_abc123 started: npm run build"
```

### Check Job Status

```typescript
// Read all jobs
{ "path": "jobs://" }

// Read specific job
{ "path": "jobs://bg_abc123" }
```

### Wait for Jobs

```typescript
// Wait for any running job
{ }

// Wait for specific jobs
{ "jobs": ["bg_abc123", "bg_def456"] }
```

### Cancel Job

```typescript
{ "job_id": "bg_abc123" }
```

## Optional Enhancements

If additional features are desired, these could be considered:

1. **Snowflake ID generation** - For better job ID sorting and uniqueness
2. **Task tool async integration** - Allow subagents to run in background
3. **Enhanced logging** - Add structured logging for job lifecycle events
4. **Web UI support** - Add async job management to the web interface
5. **Job priorities** - Allow prioritizing certain job types
