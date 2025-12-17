# Telegram Inline Mode Setup

## Issue
The bot's inline queries feature (`@Pi_discordbot <query>`) is disabled by default.

Current status from Telegram API:
```json
{"supports_inline_queries": false}
```

## Fix Required (One-time Setup)

### Step 1: Open BotFather
1. Open Telegram
2. Search for `@BotFather`
3. Start a chat

### Step 2: Enable Inline Mode
Send the following commands to BotFather:

```
/setinline
```

Then select your bot: `@Pi_discordbot`

### Step 3: Set Placeholder Text
When prompted, enter a placeholder like:
```
Ask AI anything...
```

### Step 4: Verify
Test by typing in any Telegram chat:
```
@Pi_discordbot what is bitcoin?
```

You should see AI suggestions appear.

## Technical Details

The inline handler is implemented in `src/telegram/telegram-bot.ts`:

```typescript
bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query;
    if (!query || query.length < 3) {
        return ctx.answerInlineQuery([]);
    }
    // AI response via OpenRouter claude-3-haiku
    // Fast response for inline queries
});
```

## Alternative: Direct Commands
If inline mode can't be enabled, users can still:
1. DM the bot directly: `/ask <question>`
2. Use in Telegram groups where bot is added
3. Use the /browse, /search commands

## Status Check Command
Run this to check current status:
```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
```

Look for `"supports_inline_queries": true` after enabling.
