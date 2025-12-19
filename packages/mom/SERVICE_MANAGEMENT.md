# Pi-Mom Slack Bot - SystemD Service Management

## Service Status

The pi-mom bot is now running as a permanent systemd service that automatically:
- Reads fresh OAuth tokens from `~/.claude/.credentials.json` on each start
- Auto-restarts on failure (10 second delay)
- Starts automatically on system boot
- Logs to journald

## Service Files

**SystemD Service:** `/etc/systemd/system/pi-mom.service`
**Wrapper Script:** `/home/majinbu/organized/active-projects/pi-mono/packages/mom/start-mom.sh`
**Working Directory:** `/home/majinbu/organized/active-projects/pi-mono/packages/mom`
**Data Directory:** `/home/majinbu/mom-data`

## Common Commands

### Check Service Status
```bash
sudo systemctl status pi-mom.service
```

### View Real-time Logs
```bash
sudo journalctl -u pi-mom.service -f
```

### View Recent Logs
```bash
sudo journalctl -u pi-mom.service -n 50
```

### Restart Service
```bash
sudo systemctl restart pi-mom.service
```

### Stop Service
```bash
sudo systemctl stop pi-mom.service
```

### Start Service
```bash
sudo systemctl start pi-mom.service
```

### Disable Auto-start
```bash
sudo systemctl disable pi-mom.service
```

### Enable Auto-start
```bash
sudo systemctl enable pi-mom.service
```

### Reload SystemD After Config Changes
```bash
sudo systemctl daemon-reload
sudo systemctl restart pi-mom.service
```

## Environment Variables

The service sets these environment variables:

- **MOM_SLACK_APP_TOKEN**: xapp-1-A0A41A3JN9K-... (hardcoded, doesn't expire)
- **MOM_SLACK_BOT_TOKEN**: xoxb-10136992794325-... (hardcoded, doesn't expire)
- **ANTHROPIC_OAUTH_TOKEN**: Extracted from `~/.claude/.credentials.json` (refreshed on each start)

## OAuth Token Refresh

When Claude Code refreshes the OAuth token in `~/.claude/.credentials.json`, simply restart the service to pick up the new token:

```bash
sudo systemctl restart pi-mom.service
```

The wrapper script automatically extracts the token from `claudeAiOauth.accessToken` in the credentials file.

## Process Details

- **User:** majinbu
- **PID:** Check with `systemctl status pi-mom.service`
- **Memory:** ~70-120MB typical
- **Restart Policy:** Always restart with 10 second delay
- **Security:** NoNewPrivileges, PrivateTmp enabled

## Troubleshooting

### Service won't start
```bash
# Check logs for errors
sudo journalctl -u pi-mom.service -n 100

# Verify credentials file exists
ls -la ~/.claude/.credentials.json

# Test wrapper script manually
/home/majinbu/organized/active-projects/pi-mono/packages/mom/start-mom.sh
```

### Token extraction fails
```bash
# Check credentials file format
jq . ~/.claude/.credentials.json

# Verify token path
jq -r '.claudeAiOauth.accessToken' ~/.claude/.credentials.json
```

### Build issues
```bash
# Rebuild from source
cd /home/majinbu/organized/active-projects/pi-mono/packages/mom
npm run build
sudo systemctl restart pi-mom.service
```

## Service Health Check

Quick health check command:
```bash
echo "Service: $(sudo systemctl is-active pi-mom.service)"
echo "Enabled: $(sudo systemctl is-enabled pi-mom.service)"
echo "Process: $(pgrep -f 'node.*mom' && echo 'Running' || echo 'Not running')"
echo "Logs: $(sudo journalctl -u pi-mom.service -n 1 --no-pager | tail -1)"
```

## Created: December 19, 2025
