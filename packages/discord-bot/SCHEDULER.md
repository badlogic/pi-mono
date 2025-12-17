# Task Scheduler

The Discord bot now includes a user-configurable task scheduling system that allows users to create, manage, and execute scheduled tasks using cron expressions.

## Features

- **User-specific tasks**: Each user can create and manage their own scheduled tasks
- **Flexible scheduling**: Use standard cron expressions to define when tasks run
- **Multiple action types**: Support for predefined actions and custom prompts
- **Database persistence**: Tasks are stored in SQLite and survive bot restarts
- **Per-channel execution**: Tasks can be configured to run in specific channels

## Slash Commands

### `/schedule add`

Create a new scheduled task.

**Options:**
- `name` (required): A descriptive name for your task
- `cron` (required): Cron expression defining when the task runs
- `action` (required): The action to perform (see Actions below)
- `channel` (optional): Channel where results will be sent (defaults to current channel)

**Example:**
```
/schedule add name:"Daily Report" cron:"0 9 * * *" action:"report:daily"
```

### `/schedule list`

List all your scheduled tasks.

**Example:**
```
/schedule list
```

### `/schedule remove`

Remove a scheduled task.

**Options:**
- `id` (required): The task ID to remove

**Example:**
```
/schedule remove id:task_1234567890_abc123def
```

### `/schedule toggle`

Enable or disable a scheduled task.

**Options:**
- `id` (required): The task ID to toggle

**Example:**
```
/schedule toggle id:task_1234567890_abc123def
```

### `/schedule info`

Get detailed information about a scheduled task.

**Options:**
- `id` (required): The task ID to view

**Example:**
```
/schedule info id:task_1234567890_abc123def
```

## Cron Expression Format

Cron expressions consist of 5 fields:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, where both 0 and 7 are Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Common Examples:**

- `0 9 * * *` - Every day at 9:00 AM
- `30 14 * * *` - Every day at 2:30 PM
- `0 0 * * 0` - Every Sunday at midnight
- `0 */6 * * *` - Every 6 hours
- `0 0 1 * *` - First day of every month at midnight
- `0 9 * * 1-5` - Weekdays at 9:00 AM

## Predefined Actions

### `report:daily`

Generates and sends a daily analytics report with bot usage statistics from the previous day.

### `report:weekly`

Generates and sends a weekly analytics summary covering the last 7 days.

### `health:check`

Performs a system health check and reports:
- Bot uptime
- Memory usage
- Commands processed
- Active channels

### `backup:auto`

Creates an automatic backup of the bot's database, including:
- User data
- Scheduled tasks
- Database statistics

The backup is saved to the `backups/` directory with a timestamped filename.

### Custom Prompts

Any action that doesn't match a predefined action type will be treated as a custom prompt. You can use this to create tasks with custom messages or behaviors.

**Example:**
```
/schedule add name:"Morning Greeting" cron:"0 8 * * *" action:"Good morning everyone! Have a great day!"
```

## Security & Permissions

- **User isolation**: Users can only view and modify their own scheduled tasks
- **Channel-specific**: Tasks only run in the channels where they were configured
- **Database-backed**: All tasks are persisted to SQLite for reliability

## Technical Details

### Database Schema

Tasks are stored in the `scheduled_tasks` table:

```sql
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Architecture

- **TaskScheduler class** (`src/scheduler.ts`): Manages task lifecycle, scheduling, and execution
- **Database integration** (`src/database.ts`): Provides persistence for tasks
- **Action executor**: Handles execution of predefined and custom actions
- **node-cron**: Powers the underlying cron scheduling

### Error Handling

- Invalid cron expressions are validated before task creation
- Failed task executions are logged and reported to the task's channel
- Scheduler gracefully shuts down on bot termination

## Migration from Hardcoded Cron Jobs

The bot previously had hardcoded cron jobs for trading system health checks and analytics. These remain in place for backward compatibility, but users can now create equivalent tasks using the scheduler:

**Old hardcoded job:**
```javascript
cron.schedule("0 9 * * *", async () => {
    // Daily health check
});
```

**New user-configurable equivalent:**
```
/schedule add name:"Daily Health" cron:"0 9 * * *" action:"health:check"
```

## Future Enhancements

Potential future improvements:
- AI agent integration for custom action execution
- Webhook triggers
- Task templates
- Recurring task series (e.g., "every weekday for the next month")
- Task dependencies and chaining
- Advanced scheduling options (timezone support, etc.)
