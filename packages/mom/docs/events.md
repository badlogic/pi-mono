# Events System

The events system allows mom to be triggered by scheduled or immediate events. Events are JSON files in the `workspace/events/` directory. The harness watches this directory and executes events when they become due.

## Event Types

### Immediate

Executes as soon as the harness discovers the file. Used by programs mom writes to signal external events (webhooks, file changes, API callbacks, etc.).

```json
{
  "type": "immediate",
  "channelId": "C123ABC",
  "text": "New support ticket received: #12345"
}
```

After execution, the file is deleted. Staleness is determined by file mtime (see Startup Behavior).

### One-Shot

Executes once at a specific date/time. Used for reminders, scheduled tasks, or deferred actions.

```json
{
  "type": "one-shot",
  "channelId": "C123ABC",
  "text": "Remind Mario about the dentist appointment",
  "at": "2025-12-15T09:00:00+01:00"
}
```

The `at` timestamp must include a timezone offset. After execution, the file is deleted.

### Periodic

Executes repeatedly on a cron schedule. Used for recurring tasks like daily summaries, weekly reports, or regular checks.

```json
{
  "type": "periodic",
  "channelId": "C123ABC",
  "text": "Check inbox and post summary",
  "schedule": "0 9 * * 1-5",
  "timezone": "Europe/Vienna"
}
```

The `schedule` field uses standard cron syntax. The `timezone` field uses IANA timezone names. The file persists until explicitly deleted by mom or the program that created it.

#### Cron Format

`minute hour day-of-month month day-of-week`

Examples:
- `0 9 * * *` — daily at 9:00
- `0 9 * * 1-5` — weekdays at 9:00
- `30 14 * * 1` — Mondays at 14:30
- `0 0 1 * *` — first of each month at midnight
- `*/15 * * * *` — every 15 minutes

## Timezone Handling

All timestamps must include timezone information:
- For `one-shot`: Use ISO 8601 format with offset (e.g., `2025-12-15T09:00:00+01:00`)
- For `periodic`: Use the `timezone` field with an IANA timezone name (e.g., `Europe/Vienna`, `America/New_York`)

The harness runs in the host process timezone. When users mention times without specifying timezone, assume the harness timezone.

## Harness Behavior

### Startup

1. Scan `workspace/events/` for all `.json` files
2. Parse each event file
3. For each event:
   - **Immediate**: Check file mtime. If the file was created while the harness was NOT running (mtime < harness start time), it's stale. Delete without executing. Otherwise, execute immediately and delete.
   - **One-shot**: If `at` is in the past, delete the file. If `at` is in the future, set a `setTimeout` to execute at the specified time.
   - **Periodic**: Set up a cron job (using `croner` library) to execute on the specified schedule. If a scheduled time was missed while harness was down, do NOT catch up. Wait for the next scheduled occurrence.

### File System Watching

The harness watches `workspace/events/` using `fs.watch()` with 100ms debounce.

**New file added:**
- Parse the event
- Based on type: execute immediately, set `setTimeout`, or set up cron job

**Existing file modified:**
- Cancel any existing timer/cron for this file
- Re-parse and set up again (allows rescheduling)

**File deleted:**
- Cancel any existing timer/cron for this file

### Parse Errors

If a JSON file fails to parse:
1. Retry with exponential backoff (100ms, 200ms, 400ms)
2. If still failing after retries, delete the file and log error to console

### Execution Errors

If the agent errors while processing an event:
1. Post error message to the channel
2. Delete the event file (for immediate/one-shot)
3. No retries

## Queue Integration

Events integrate with the existing `ChannelQueue` in `SlackBot`:

- New method: `SlackBot.enqueueEvent(event: SlackEvent)` — always queues, no "already working" rejection
- Maximum 5 events can be queued per channel. If queue is full, discard and log to console.
- User @mom mentions retain current behavior: rejected with "Already working" message if agent is busy

When an event triggers:
1. Create a synthetic `SlackEvent` with formatted message
2. Call `slack.enqueueEvent(event)`
3. Event waits in queue if agent is busy, processed when idle

## Event Execution

When an event is dequeued and executes:

1. Post status message: "_Starting event: {filename}_"
2. Invoke the agent with message: `[EVENT:{filename}:{type}:{schedule}] {text}`
   - For immediate: `[EVENT:webhook-123.json:immediate] New support ticket`
   - For one-shot: `[EVENT:dentist.json:one-shot:2025-12-15T09:00:00+01:00] Remind Mario`
   - For periodic: `[EVENT:daily-inbox.json:periodic:0 9 * * 1-5] Check inbox`
3. After execution:
   - If response is `[SILENT]`: delete status message, post nothing to Slack
   - Immediate and one-shot: delete the event file
   - Periodic: keep the file, event will trigger again on schedule

## Silent Completion

For periodic events that check for activity (inbox, notifications, etc.), mom may find nothing to report. To avoid spamming the channel, mom can respond with just `[SILENT]`. This deletes the "Starting event..." status message and posts nothing to Slack.

Example: A periodic event checks for new emails every 15 minutes. If there are no new emails, mom responds `[SILENT]`. If there are new emails, mom posts a summary.

## File Naming

Event files should have descriptive names ending in `.json`:
- `webhook-12345.json` (immediate)
- `dentist-reminder-2025-12-15.json` (one-shot)
- `daily-inbox-summary.json` (periodic)

The filename is used as an identifier for tracking timers and in the event message. Avoid special characters.

## Implementation

### Files

- `src/events.ts` — Event parsing, timer management, fs watching
- `src/slack.ts` — Add `enqueueEvent()` method and `size()` to `ChannelQueue`
- `src/main.ts` — Initialize events watcher on startup
- `src/agent.ts` — Update system prompt with events documentation

### Key Components

```typescript
// events.ts

interface ImmediateEvent {
  type: "immediate";
  channelId: string;
  text: string;
}

interface OneShotEvent {
  type: "one-shot";
  channelId: string;
  text: string;
  at: string; // ISO 8601 with timezone offset
}

interface PeriodicEvent {
  type: "periodic";
  channelId: string;
  text: string;
  schedule: string; // cron syntax
  timezone: string; // IANA timezone
}

type MomEvent = ImmediateEvent | OneShotEvent | PeriodicEvent;

class EventsWatcher {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private crons: Map<string, Cron> = new Map();
  private startTime: number;
  
  constructor(
    private eventsDir: string,
    private slack: SlackBot,
    private onError: (filename: string, error: Error) => void
  ) {
    this.startTime = Date.now();
  }
  
  start(): void { /* scan existing, setup fs.watch */ }
  stop(): void { /* cancel all timers/crons, stop watching */ }
  
  private handleFile(filename: string): void { /* parse, schedule */ }
  private handleDelete(filename: string): void { /* cancel timer/cron */ }
  private execute(filename: string, event: MomEvent): void { /* enqueue */ }
}
```

### Dependencies

- `croner` — Cron scheduling with timezone support

## System Prompt Section

The following should be added to mom's system prompt:

```markdown
## Events

You can schedule events that wake you up at specific times or when external things happen. Events are JSON files in `/workspace/events/`.

### Event Types

**Immediate** — Triggers as soon as harness sees the file. Use in scripts/webhooks to signal external events.
```json
{"type": "immediate", "channelId": "C123", "text": "New GitHub issue opened"}
```

**One-shot** — Triggers once at a specific time. Use for reminders.
```json
{"type": "one-shot", "channelId": "C123", "text": "Remind Mario about dentist", "at": "2025-12-15T09:00:00+01:00"}
```

**Periodic** — Triggers on a cron schedule. Use for recurring tasks.
```json
{"type": "periodic", "channelId": "C123", "text": "Check inbox and summarize", "schedule": "0 9 * * 1-5", "timezone": "Europe/Vienna"}
```

### Cron Format

`minute hour day-of-month month day-of-week`

- `0 9 * * *` = daily at 9:00
- `0 9 * * 1-5` = weekdays at 9:00
- `30 14 * * 1` = Mondays at 14:30
- `0 0 1 * *` = first of each month at midnight

### Timezones

All `at` timestamps must include offset (e.g., `+01:00`). Periodic events use IANA timezone names. The harness runs in ${TIMEZONE}. When users mention times without timezone, assume ${TIMEZONE}.

### Creating Events

```bash
cat > /workspace/events/dentist-reminder.json << 'EOF'
{"type": "one-shot", "channelId": "${CHANNEL}", "text": "Dentist tomorrow", "at": "2025-12-14T09:00:00+01:00"}
EOF
```

### Managing Events

- List: `ls /workspace/events/`
- View: `cat /workspace/events/foo.json`
- Delete/cancel: `rm /workspace/events/foo.json`

### When Events Trigger

You receive a message like:
```
[EVENT:dentist-reminder.json:one-shot:2025-12-14T09:00:00+01:00] Dentist tomorrow
```

Immediate and one-shot events auto-delete after triggering. Periodic events persist until you delete them.

### Debouncing

When writing programs that create immediate events (email watchers, webhook handlers, etc.), always debounce. If 50 emails arrive in a minute, don't create 50 immediate events. Instead:

- Collect events over a window (e.g., 30 seconds)
- Create ONE immediate event summarizing what happened
- Or just signal "new activity, check inbox" rather than per-item events

Bad:
```bash
# Creates event per email — will flood the queue
on_email() { echo '{"type":"immediate"...}' > /workspace/events/email-$ID.json; }
```

Good:
```bash
# Debounce: flag file + single delayed event  
on_email() {
  echo "$SUBJECT" >> /tmp/pending-emails.txt
  if [ ! -f /workspace/events/email-batch.json ]; then
    (sleep 30 && mv /tmp/pending-emails.txt /workspace/events/email-batch.json) &
  fi
}
```

Or simpler: use a periodic event to check for new emails every 15 minutes instead of immediate events.

### Limits

Maximum 5 events can be queued. Don't create excessive immediate or periodic events.
```
