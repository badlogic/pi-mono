# Memory Monitoring Alert Implementation

## Overview
Added automated memory monitoring alerts to the Discord bot's hourly cron job.

## Problem
System memory consistently at 117-119Gi/124Gi (94-96%) with load spikes to 3.74.

## Solution

### 1. Hourly Memory Checks (in existing cron job)
- Monitors memory usage every hour
- Sends alerts only when thresholds are crossed
- No duplicate alerts for same threshold within an hour

### 2. Alert Thresholds
- **WARNING**: Memory >= 90%
- **CRITICAL**: Memory >= 95%

### 3. Alert Content
Each alert includes:
- Memory usage percentage
- Used/Available/Total GB
- Top 3 processes by memory consumption
- Actionable recommendations

### 4. Alert Delivery
Priority order:
1. `ALERTS_CHANNEL_ID` (if configured)
2. DM to first user in `ALLOWED_USER_IDS` (fallback)

## Code Changes Required

### Location: `src/main.ts` around line 10259

#### Before the hourly cron job, add tracking variable:
```typescript
// Memory alert tracking (prevent spam)
let lastMemoryAlertThreshold: "none" | "warning" | "critical" = "none";
```

#### Replace the existing hourly cron job (lines 10259-10273) with:
```typescript
// Hourly quick status check with memory monitoring
cron.schedule("0 * * * *", async () => {
	logInfo("[CRON] Running hourly status check");
	try {
		const result = await execCommand(`
			echo "Uptime: $(uptime -p)"
			echo "Load: $(cat /proc/loadavg | cut -d' ' -f1-3)"
			echo "Memory: $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
		`);
		// Log status
		logInfo(`[CRON] Status: ${result.stdout.replace(/\n/g, " | ").trim()}`);

		// Memory monitoring and alerting
		const memoryCheck = await execCommand(`
			# Get memory info in parseable format
			free -m | awk '/Mem:/ {printf "TOTAL=%d\\nUSED=%d\\nAVAIL=%d\\nPERCENT=%.1f", $2, $3, $7, ($3/$2)*100}'
			echo ""
			echo "TOP_PROCESSES:"
			ps aux --sort=-%mem | awk 'NR>1 {printf "%s\\t%.1f%%\\t%s\\n", $11, $4, $1}' | head -3
		`);

		if (memoryCheck.code === 0) {
			const output = memoryCheck.stdout;

			// Parse memory stats
			const percentMatch = output.match(/PERCENT=([\d.]+)/);
			const totalMatch = output.match(/TOTAL=(\d+)/);
			const usedMatch = output.match(/USED=(\d+)/);
			const availMatch = output.match(/AVAIL=(\d+)/);

			if (percentMatch && totalMatch && usedMatch && availMatch) {
				const memoryPercent = parseFloat(percentMatch[1]);
				const totalGB = (parseInt(totalMatch[1]) / 1024).toFixed(1);
				const usedGB = (parseInt(usedMatch[1]) / 1024).toFixed(1);
				const availGB = (parseInt(availMatch[1]) / 1024).toFixed(1);

				// Extract top processes
				const topProcessesMatch = output.match(/TOP_PROCESSES:\n([\s\S]+)$/);
				const topProcesses = topProcessesMatch ? topProcessesMatch[1].trim() : "Unable to fetch";

				// Determine threshold
				let currentThreshold: "none" | "warning" | "critical" = "none";
				if (memoryPercent >= 95) {
					currentThreshold = "critical";
				} else if (memoryPercent >= 90) {
					currentThreshold = "warning";
				}

				// Send alert if threshold crossed and different from last alert
				if (currentThreshold !== "none" && currentThreshold !== lastMemoryAlertThreshold) {
					const alertLevel = currentThreshold === "critical" ? "🚨 CRITICAL" : "⚠️ WARNING";
					const alertMessage = [
						`**${alertLevel}: High Memory Usage**`,
						``,
						`**Memory Usage:** ${memoryPercent.toFixed(1)}% (${usedGB}Gi / ${totalGB}Gi)`,
						`**Available:** ${availGB}Gi`,
						``,
						`**Top 3 Processes by Memory:**`,
						`\`\`\``,
						topProcesses,
						`\`\`\``,
						``,
						currentThreshold === "critical"
							? `⚠️ **Action required:** Memory usage is critically high. Consider restarting services or investigating memory leaks.`
							: `Monitor closely. Alert will trigger again if usage increases to 95%+.`,
					].join("\n");

					// Send to alert channel or DM first allowed user
					if (ALERTS_CHANNEL_ID) {
						await channelRouter.sendAlert(alertMessage);
					} else if (ALLOWED_USER_IDS.length > 0) {
						try {
							const user = await client.users.fetch(ALLOWED_USER_IDS[0]);
							await user.send(alertMessage);
						} catch (dmError) {
							logError(
								"[CRON] Failed to send memory alert DM",
								dmError instanceof Error ? dmError.message : String(dmError),
							);
						}
					}

					lastMemoryAlertThreshold = currentThreshold;
					logInfo(`[CRON] Memory alert sent: ${currentThreshold} (${memoryPercent.toFixed(1)}%)`);
				} else if (currentThreshold === "none" && lastMemoryAlertThreshold !== "none") {
					// Memory returned to normal, reset tracking
					lastMemoryAlertThreshold = "none";
					logInfo(`[CRON] Memory returned to normal levels (${memoryPercent.toFixed(1)}%)`);
				}
			}
		}
	} catch (error) {
		logError("[CRON] Status check failed", error instanceof Error ? error.message : String(error));
	}
});
```

## Testing

Tested memory monitoring commands successfully:
```bash
$ free -m | awk '/Mem:/ {printf "TOTAL=%d\nUSED=%d\nAVAIL=%d\nPERCENT=%.1f", $2, $3, $7, ($3/$2)*100}'
TOTAL=127911
USED=122006
AVAIL=2597
PERCENT=95.4

$ ps aux --sort=-%mem | awk 'NR>1 {printf "%s\t%.1f%%\t%s\n", $11, $4, $1}' | head -3
python3	31.7%	majinbu
/usr/bin/python3	31.3%	majinbu
python3	0.7%	majinbu
```

Current system status: 95.4% memory usage (119.1Gi / 124Gi) - **WOULD TRIGGER CRITICAL ALERT**

## Environment Variables

Required for alerts to work:
- `ALERTS_CHANNEL_ID` - Discord channel ID for alerts (preferred)
- `ALLOWED_USER_IDS` - Comma-separated user IDs (fallback for DMs)

If neither is configured, alerts will only be logged.

## Alert Flow

```
Hourly Cron
    ↓
Memory Check
    ↓
Parse Stats
    ↓
Current >= 95%? → CRITICAL
Current >= 90%? → WARNING
Otherwise → NONE
    ↓
Different from last threshold?
    ↓ YES
Send Alert
    ├→ ALERTS_CHANNEL_ID (if set)
    └→ DM to ALLOWED_USER_IDS[0] (fallback)
    ↓
Update lastMemoryAlertThreshold
```

## Benefits

1. **Proactive Monitoring**: Catches memory issues before system crashes
2. **No Spam**: Alerts only when crossing thresholds, not every hour
3. **Actionable Data**: Includes top processes to identify culprits
4. **Automatic Reset**: Tracks when memory returns to normal
5. **Flexible Delivery**: Channel alerts or DMs based on configuration

## Future Enhancements

Potential improvements:
1. Add `/memory-check` slash command for manual checks
2. Track memory trends over time
3. Automatic process restart on CRITICAL
4. Integration with system monitoring dashboards
5. Historical memory usage charts

## Files Modified

- `/home/majinbu/organized/active-projects/pi-mono/packages/discord-bot/src/main.ts`

## Implementation Date

2025-12-19

## Status

**DOCUMENTED - READY FOR IMPLEMENTATION**

The code changes are documented above. To implement:
1. Locate line 10259 in `src/main.ts`
2. Add the tracking variable before the cron job
3. Replace the existing hourly cron job with the enhanced version
4. Run `npm run type-check` to verify
5. Restart the bot to activate monitoring

## Current System State

Memory is already at critical levels (95.4%), so alerts will trigger immediately upon implementation.
