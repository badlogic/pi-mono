# Bot Profile Configuration

Mom supports bot profile customization for both Discord and Slack, but the capabilities differ significantly between platforms.

---

## Discord

Discord allows actual bot profile changes that persist and are visible everywhere.

### Capabilities

| Feature | Support | Description |
|---------|---------|-------------|
| Avatar | Yes | Changes the bot's actual profile picture |
| Username | Yes | Changes the bot's display name |
| Status | Yes | Sets presence (online, idle, dnd, invisible) |
| Activity | Yes | Sets activity text ("Playing...", "Watching...", etc.) |

### Configuration

Add to `settings.json` in your workspace root:

```json
{
  "profile": {
    "discord": {
      "avatar": "assets/mom.png",
      "username": "mom",
      "status": "online",
      "activity": { "name": "Helping users", "type": "Watching" }
    }
  }
}
```

### Avatar Options

The `avatar` field accepts:
- Local file path (absolute or relative to workspace root): `"assets/mom.png"`
- HTTP/HTTPS URL: `"https://example.com/avatar.png"`
- Empty string to clear: `""`

### Activity Types

Valid `activity.type` values: `Playing`, `Streaming`, `Listening`, `Watching`, `Competing`

### Rate Limits

Discord rate-limits username and avatar changes. Frequent updates may fail silently. Settings are still persisted and will apply on next restart.

---

## Slack

Slack does not allow bots to change their actual profile via API. Instead, mom uses per-message authorship overrides.

### Capabilities

| Feature | Support | Description |
|---------|---------|-------------|
| Avatar | No | Cannot change actual bot profile picture |
| Message Icon | Yes | Override icon on each message mom sends |
| Message Username | Yes | Override display name on each message |
| Status/Presence | No | Not available for Socket Mode bots |

### How It Works

When mom posts a message, Slack's `chat.postMessage` API allows overriding the `username`, `icon_emoji`, or `icon_url` for that specific message. This makes mom's messages appear with custom branding, but:

- The bot's actual profile (visible in DMs, app directory, etc.) remains unchanged
- You must still configure the bot's real name/icon in the Slack App settings
- Requires the `chat:write.customize` OAuth scope

### Configuration

Add to `settings.json` in your workspace root:

```json
{
  "profile": {
    "slack": {
      "username": "mom-bot",
      "iconEmoji": ":robot_face:"
    }
  }
}
```

Or use a URL for the icon:

```json
{
  "profile": {
    "slack": {
      "username": "mom-bot",
      "iconUrl": "https://example.com/icon.png"
    }
  }
}
```

### Required Scope

Add `chat:write.customize` to your Slack app's OAuth scopes. Without this scope, the overrides will fail and mom will fall back to default bot identity.

---

## LLM Profile Tool

Mom exposes a `profile` tool that allows the LLM to update profile settings during a conversation. Changes are persisted to `settings.json`.

Discord example (LLM can change status based on workload):
```
"Set my status to dnd and activity to 'Deep in thought'"
```

Slack example (LLM can change message appearance):
```
"Use the :thinking_face: emoji for my messages"
```

---

## Comparison

| Feature | Discord | Slack |
|---------|---------|-------|
| Change actual avatar | Yes | No (admin panel only) |
| Change actual username | Yes | No (admin panel only) |
| Set presence/status | Yes | No |
| Set activity text | Yes | No |
| Per-message icon override | N/A | Yes |
| Per-message name override | N/A | Yes |
| LLM can modify at runtime | Yes | Yes |
| Persists to settings.json | Yes | Yes |
