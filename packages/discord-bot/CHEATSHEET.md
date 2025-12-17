# Pi Discord Bot - Quick Reference

## Commands

| Category | Example |
|----------|---------|
| **System** | `what's my IP?` `show disk usage` `check memory` |
| **Files** | `read /etc/hosts` `create file.txt with "hello"` |
| **Packages** | `install htop` `pip install requests` |
| **Docker** | `list containers` `show docker logs nginx` |
| **Git** | `clone repo` `show git status` |
| **Memory** | `remember X` `what do you know?` `forget X` |

## Service Management

```bash
systemctl status pi-discord    # Check status
systemctl restart pi-discord   # Restart
systemctl stop pi-discord      # Stop
journalctl -u pi-discord -f    # Live logs
```

## File Locations

| Path | Purpose |
|------|---------|
| `/opt/discord-bot-data/` | Workspace root |
| `/opt/discord-bot-data/MEMORY.md` | Global memory |
| `/opt/discord-bot-data/<id>/MEMORY.md` | Channel memory |
| `/opt/discord-bot-data/<id>/log.jsonl` | Message history |
| `/etc/systemd/system/pi-discord.service` | Service config |
| `/opt/pi-mono/packages/discord-bot/` | Source code |

## Change Model

Edit `src/main.ts` line 27:
```typescript
// Free
const model = getModel("openrouter", "mistralai/devstral-2512:free");

// Paid (better)
const model = getModel("openrouter", "anthropic/claude-3.5-sonnet");
```

Then: `npm run build && systemctl restart pi-discord`

## Environment Variables

```bash
DISCORD_BOT_TOKEN=xxx    # From Discord Developer Portal
OPENROUTER_API_KEY=xxx   # From openrouter.ai
```
