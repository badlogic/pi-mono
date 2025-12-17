# Task Scheduler Examples

Here are some practical examples of using the task scheduler in your Discord bot.

## Example 1: Daily Morning Report

Create a task that sends a daily analytics report every morning at 9 AM:

```
/schedule add name:"Daily Analytics" cron:"0 9 * * *" action:"report:daily"
```

This will:
- Run every day at 9:00 AM UTC
- Generate a daily analytics summary
- Send it to the channel where you created the task

## Example 2: Weekly Health Check

Schedule a weekly system health check every Monday at 8 AM:

```
/schedule add name:"Weekly Health" cron:"0 8 * * 1" action:"health:check"
```

This will:
- Run every Monday at 8:00 AM UTC
- Check bot uptime, memory usage, and active channels
- Report the health status to your channel

## Example 3: Automatic Backups

Create automatic backups every day at midnight:

```
/schedule add name:"Daily Backup" cron:"0 0 * * *" action:"backup:auto"
```

This will:
- Run every day at midnight UTC
- Create a timestamped backup of the database
- Save it to the `backups/` directory
- Report backup status to your channel

## Example 4: Custom Reminder

Set up a custom reminder for team standup meetings:

```
/schedule add name:"Standup Reminder" cron:"0 10 * * 1-5" action:"@team Daily standup in 30 minutes! Please prepare your updates."
```

This will:
- Run Monday through Friday at 10:00 AM UTC
- Send your custom message to the channel

## Example 5: Hourly Status Update

Monitor system status every hour:

```
/schedule add name:"Hourly Status" cron:"0 * * * *" action:"health:check"
```

This will:
- Run every hour on the hour
- Check and report system health

## Example 6: End-of-Week Summary

Get a weekly summary every Friday afternoon:

```
/schedule add name:"Friday Summary" cron:"0 17 * * 5" action:"report:weekly"
```

This will:
- Run every Friday at 5:00 PM UTC
- Generate a weekly analytics summary
- Send it to your channel

## Example 7: Multi-Channel Setup

Create different tasks for different channels by specifying the channel option:

```
/schedule add name:"Team Report" cron:"0 9 * * *" action:"report:daily" channel:#team-reports
/schedule add name:"Admin Health" cron:"0 */6 * * *" action:"health:check" channel:#admin-alerts
```

This allows you to:
- Route different reports to different channels
- Organize notifications by purpose
- Keep channels focused

## Managing Your Tasks

### List all your tasks:
```
/schedule list
```

### View task details:
```
/schedule info id:task_1234567890_abc123def
```

### Pause a task temporarily:
```
/schedule toggle id:task_1234567890_abc123def
```

### Resume a paused task:
```
/schedule toggle id:task_1234567890_abc123def
```

### Remove a task permanently:
```
/schedule remove id:task_1234567890_abc123def
```

## Advanced Cron Patterns

### Every 30 minutes:
```
cron:"*/30 * * * *"
```

### Twice a day (9 AM and 6 PM):
```
cron:"0 9,18 * * *"
```

### First Monday of every month:
```
cron:"0 9 1-7 * 1"
```

### Every 3 hours during business hours:
```
cron:"0 9-17/3 * * *"
```

### Weekend mornings only:
```
cron:"0 10 * * 0,6"
```

## Best Practices

1. **Use descriptive names**: Make task names clear and meaningful
2. **Test cron expressions**: Verify your cron pattern works as expected before creating the task
3. **Choose appropriate channels**: Send reports to dedicated channels to avoid spam
4. **Monitor task execution**: Check the "Last Run" timestamp in `/schedule list`
5. **Clean up unused tasks**: Remove tasks you no longer need with `/schedule remove`
6. **Start with daily tasks**: Begin with simple daily schedules before trying complex patterns

## Troubleshooting

### Task not running?
1. Check if the task is enabled: `/schedule info id:YOUR_TASK_ID`
2. Verify the cron expression is valid
3. Ensure the bot has permissions in the target channel
4. Check the bot logs for error messages

### Wrong timezone?
All times are in UTC. Convert your local time to UTC:
- EST: UTC-5 (add 5 hours)
- PST: UTC-8 (add 8 hours)
- CET: UTC+1 (subtract 1 hour)

For example, to run at 9 AM EST (2 PM UTC):
```
cron:"0 14 * * *"
```

### Task failed?
If a task fails:
1. The bot will send an error message to the task's channel
2. The task remains enabled and will try again at the next scheduled time
3. Check the error message to diagnose the issue
4. Fix the issue (e.g., update permissions, fix the action)

## Integration Ideas

Combine scheduled tasks with other bot features:

- **Analytics + Backups**: Schedule backups after daily analytics generation
- **Health Checks + Alerts**: Use health checks to monitor system status
- **Custom Messages + Webhooks**: Send scheduled updates to external systems
- **Reports + Channels**: Route different report types to specialized channels

## Notes

- All task IDs are unique and automatically generated
- Tasks survive bot restarts (stored in SQLite database)
- Each user can create multiple tasks
- Users can only modify their own tasks
- Tasks are isolated by user for security
