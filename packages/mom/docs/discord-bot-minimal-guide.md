# Discord Bot Setup

Get mom running on Discord in ~5 minutes.

---

## 1. Create Discord App

1. Go to https://discord.com/developers/applications
2. Click **New Application**
3. Name it (e.g., "mom") > **Create**

---

## 2. Get Bot Token

1. Click **Bot** in left sidebar
2. Click **Reset Token** > **Yes, do it!**
3. Copy the token (save it - you can't see it again)

```bash
export DISCORD_BOT_TOKEN=your-token-here
```

---

## 3. Enable Intents

Still on the **Bot** page, scroll to **Privileged Gateway Intents**:

- [x] MESSAGE CONTENT INTENT - ON
- [x] SERVER MEMBERS INTENT - ON

Click **Save Changes**

---

## 4. Generate Invite URL

1. Click **OAuth2 > URL Generator** in left sidebar
2. **Scopes** - check:
   - [x] bot
   - [x] applications.commands
3. **Bot Permissions** - check:
   - [x] Send Messages
   - [x] Read Message History
   - [x] Attach Files
   - [x] Embed Links
   - [x] Add Reactions
4. Copy the **Generated URL** at bottom

---

## 5. Invite Bot

1. Open the URL in browser
2. Select your server
3. **Authorize**

---

## 6. Run Mom

```bash
mom --transport=discord ~/mom-workspace
```

---

## 7. Test

In Discord:
- `@mom hello` (in a channel)
- Or: `/mom hello`

**Note:** DMs are disabled by default. See [DM Authorization](./dm-authorization.md) to allow specific users.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from step 2 |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `ANTHROPIC_OAUTH_TOKEN` | Yes* | Or Claude Pro/Max OAuth token |

*One of the two Anthropic options is required.

---

## Workspace Settings

Create `settings.json` in your workspace directory:

```json
{
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "off",
  "usageSummary": true
}
```

### Bot Profile (Optional)

You can configure the Discord bot profile (presence/activity + optional username/avatar) via `settings.json`:

```json
{
  "profile": {
    "discord": {
      "status": "online",
      "activity": { "name": "Helping users", "type": "Watching" },
      "avatar": "assets/mom.png",
      "username": "mom"
    }
  }
}
```

Notes:
- `avatar` can be a local path (absolute or relative to the workspace root) or an `http(s)` URL.
- Set `"avatar": ""` to clear the avatar.
- Discord rate-limits username/avatar changes; frequent updates may fail. Settings are still persisted.

### Usage Summary Options

Disable completely:
```json
{ "usageSummary": false }
```

Customize fields and formatting:
```json
{
  "usageSummary": {
    "enabled": true,
    "title": "Stats",
    "fields": {
      "tokens": { "enabled": true, "label": "Tokens", "format": "`{input}` in / `{output}` out" },
      "context": { "enabled": true, "label": "Context", "format": "`{percent}` of {max}" },
      "cost": { "enabled": true, "label": "Cost", "format": "**${total}**" },
      "cache": false
    },
    "footer": {
      "enabled": true,
      "format": "In: ${input} | Out: ${output}"
    }
  }
}
```

Use external formatter script (receives JSON on stdin, outputs JSON):
```json
{
  "usageSummary": {
    "formatter": "./scripts/my-formatter.js"
  }
}
```

Formatter output format:
```json
{
  "title": "Custom Title",
  "color": 16711680,
  "fields": [{ "name": "Cost", "value": "$0.05", "inline": true }],
  "footer": "Custom footer text"
}
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/mom <message>` | Talk to mom |
| `/mom-stop` | Stop current task |
| `/mom-memory` | View/edit memory |

---

## Troubleshooting

**Mom doesn't respond:**
- MESSAGE CONTENT INTENT enabled?
- Check terminal for errors

**Slash commands not showing:**
- Wait 1-2 minutes (Discord caches)
- Restart mom

**"Invalid Token" error:**
- Token was regenerated - get new one from developer portal
