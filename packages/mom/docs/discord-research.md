# Discord Bot Development Research

## Overview: Creating a Discord Version of "Mom"

Based on research, creating a Discord version of "mom" is **highly feasible** and would map quite well to Discord's API capabilities.

---

## 1. Core Architecture Comparison

| Aspect | Mom (Slack) | Discord Equivalent |
|--------|-------------|-------------------|
| **Connection Type** | Socket Mode (WebSocket) | Gateway WebSocket |
| **Library** | `@slack/socket-mode` + `@slack/web-api` | `discord.js` (v14) |
| **Event Model** | `app_mention`, `message.im` | `messageCreate`, `interactionCreate` |
| **Authentication** | App Token + Bot Token | Bot Token + Application ID |
| **Message Formatting** | mrkdwn (Slack flavor) | Discord Markdown |

---

## 2. Key Discord.js Features

### Required Intents

```javascript
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // PRIVILEGED - needed for message content
    GatewayIntentBits.DirectMessages,
  ]
});
```

### Event Handling Mapping

| Mom Event | Discord.js Event |
|-----------|-----------------|
| `app_mention` | Check `message.mentions.has(client.user)` in `messageCreate` |
| `message.im` | `messageCreate` with `channel.type === 'DM'` |
| `message.channels` | `messageCreate` for all guild messages |

---

## 3. Critical Considerations

### MESSAGE_CONTENT Privileged Intent

This is the **biggest difference** from Slack:

- **Under 100 servers**: Enable in Developer Portal, works immediately
- **Over 100 servers**: Must apply for verification and justify the use case
- **Without it**: Bot cannot read message content (only sees empty content)
- **Exception**: Bot CAN read content in DMs, when mentioned, and its own messages

**For mom-discord**: Since it's a coding agent that reads/responds to messages, the MESSAGE_CONTENT intent is **required**. For small deployments (< 100 servers), this isn't an issue.

### Rate Limits

- **Global**: 50 requests/second
- **Gateway**: 120 events/60 seconds (2/sec average)
- **Message sending**: ~5 messages per 5 seconds per channel
- Discord.js handles rate limiting automatically with queuing

---

## 4. Feature Mapping (Mom → Discord)

| Mom Feature | Discord Implementation |
|-------------|----------------------|
| **@mentions** | `message.mentions.has(client.user)` |
| **DMs** | `channel.type === ChannelType.DM` |
| **Threads** | Discord has native threads (`ThreadChannel`) |
| **File attachments** | `message.attachments` collection, `channel.send({ files: [...] })` |
| **File uploads** | `AttachmentBuilder` class |
| **Message editing** | `message.edit()` |
| **Rich formatting** | Embeds (`EmbedBuilder`) + Discord Markdown |
| **User/channel lookup** | `guild.members.fetch()`, `guild.channels.cache` |

---

## 5. Discord-Specific Advantages

1. **Slash Commands**: Native `/command` support with autocomplete
2. **Message Components**: Buttons, select menus, modals
3. **Threads**: Better organized than Slack threads
4. **Forum Channels**: Native support for Q&A style interactions
5. **Free**: No message history limits like Slack free tier

---

## 6. Discord-Specific Challenges

1. **Privileged Intent verification** (for > 100 servers)
2. **No native "working" indicator** (would need to use typing indicator or message editing)
3. **Embed limitations**: 6000 char total, 4096 char description max
4. **Different markdown syntax** (similar but not identical to Slack's mrkdwn)

---

## 7. Proposed Architecture

```
mom-discord/
├── src/
│   ├── main.ts          # Entry point, CLI args
│   ├── discord.ts       # Discord.js client, event handling (replaces slack.ts)
│   ├── agent.ts         # Can likely reuse most of mom's agent.ts
│   ├── store.ts         # Channel data persistence (similar structure)
│   ├── sandbox.ts       # REUSE from mom (unchanged)
│   ├── log.ts           # REUSE from mom (unchanged)
│   └── tools/           # REUSE from mom (unchanged)
│       ├── bash.ts
│       ├── read.ts
│       ├── write.ts
│       ├── edit.ts
│       └── attach.ts    # Adapt for Discord file upload API
```

**Reusability estimate**: ~60-70% of mom's code could be reused

---

## 8. Required Setup

### Environment Variables

```bash
DISCORD_BOT_TOKEN=...       # Bot token from Developer Portal
DISCORD_APPLICATION_ID=...  # Application ID
ANTHROPIC_API_KEY=...       # Same as mom
```

### Discord Developer Portal Setup

1. Create application at https://discord.com/developers/applications
2. Create Bot, get token
3. Enable **MESSAGE_CONTENT** privileged intent
4. Generate OAuth2 URL with scopes: `bot`, `applications.commands`
5. Set bot permissions: Send Messages, Read Message History, Attach Files, Use Threads, etc.

---

## 9. Key Documentation Sources

- [Discord Developer Portal](https://discord.com/developers/docs/intro)
- [discord.js Guide](https://discordjs.guide/)
- [discord.js Documentation](https://discord.js.org/docs)
- [Gateway Intents Guide](https://discordjs.guide/popular-topics/intents)
- [Message Content Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ)
- [Threads Documentation](https://discord.com/developers/docs/topics/threads)
- [OAuth2 & Permissions](https://discord.com/developers/docs/topics/oauth2)
- [Rate Limits Guide](https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited)

---

## 10. Feasibility Assessment

| Criteria | Assessment |
|----------|------------|
| **Technical feasibility** | ✅ High - all mom features can be implemented |
| **Code reuse** | ✅ 60-70% - core agent, tools, sandbox reusable |
| **Library maturity** | ✅ discord.js is very mature and well-documented |
| **Complexity** | 🟡 Medium - different event model, new formatting |
| **Scaling concerns** | 🟡 MESSAGE_CONTENT intent verification for > 100 servers |
