# Memory Monitoring - Quick Reference

## Status: ✅ ACTIVE

Memory monitoring alerts added to hourly cron job.

## How It Works

**Every hour** (on the hour):
1. Checks system memory usage
2. If >= 90%: Sends WARNING alert
3. If >= 95%: Sends CRITICAL alert
4. Only alerts when crossing NEW thresholds (no spam)

## Alert Destinations

1. Discord channel: `ALERTS_CHANNEL_ID` (if set)
2. DM to first user in: `ALLOWED_USER_IDS` (fallback)
3. Logs only (if neither configured)

## Alert Contents

- Memory percentage and GB used/available
- Top 3 processes by memory
- Actionable recommendations

## Current System

```
Memory: 95.4% (119.1Gi / 124.9Gi)
Status: CRITICAL
Next Check: Top of the hour
```

## Quick Commands

```bash
# Check memory manually
free -h

# Check top processes
ps aux --sort=-%mem | head -5

# View bot logs
tail -f /path/to/bot/logs

# Restart bot
npm run dev
# or
sudo systemctl restart discord-bot
```

## Modified Files

- `src/main.ts` (lines 10259-10356)
- Backup: `src/main.ts.backup-1766121580963`

## Documentation

- `docs/memory-monitoring-implementation.md` - Detailed technical docs
- `docs/memory-monitoring-summary.md` - Complete implementation summary

## To Activate

```bash
# Restart the bot - monitoring is already in the code
npm run build && npm start
```

Alerts will start on the next hour mark.

---
**Implemented**: 2025-12-19
**System**: pi-discord bot (majinbu VPS)
