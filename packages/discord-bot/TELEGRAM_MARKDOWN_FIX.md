# Telegram Markdown Parsing Error Fix

## Problem
The bot was encountering Telegram API errors when sending messages:
```
Dec 18 16:21:19 [ERROR] can't parse entities: Can't find end of the entity starting at byte offset 35
```

This error occurred because Telegram's MarkdownV2 format requires specific characters to be escaped, and the bot was sending unescaped text.

## Root Cause
The bot was using `parse_mode: "Markdown"` (legacy format) without escaping special characters. Telegram MarkdownV2 requires the following characters to be escaped with a backslash:
- `_` `*` `[` `]` `(` `)` `~` `` ` `` `>` `#` `+` `-` `=` `|` `{` `}` `.` `!` `\`

## Solution
Created an `escapeMarkdownV2()` function that properly escapes all special characters and applied it to all Telegram message sends.

## Files Modified

### 1. `/src/telegram/telegram-bot.ts`
- **Added** `escapeMarkdownV2()` utility function (line 786-788)
- **Updated** all `ctx.reply()` calls to use `parse_mode: "MarkdownV2"` instead of `"Markdown"`
- **Applied escaping** to all user-generated content before sending

#### Changes:
- `/start` command - Escaped all static messages
- `/help` command - Escaped help text
- `/status` command - Escaped dynamic content (mode names, etc.)
- `/mode` command - Escaped mode names and descriptions
- `/price` command - Escaped token names, prices, and symbols
- `/browse` command - Escaped URLs, titles, and content
- `/search` command - Escaped queries and search results
- `sendLongMessage()` - Added try/catch with automatic fallback to plain text
- Inline query handler - Escaped query and response text
- `bridgeMessage()` - Escaped cross-platform messages

### 2. `/src/telegram/index.ts`
- **Exported** `escapeMarkdownV2` function for use in other modules

### 3. `/src/main.ts`
- **Imported** `escapeMarkdownV2` from telegram module
- **Updated** `/telegram send` slash command to escape messages before sending

## Key Features of the Fix

### 1. Comprehensive Escaping
All special characters are properly escaped using regex:
```typescript
function escapeMarkdownV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
```

### 2. Graceful Fallback
If MarkdownV2 parsing still fails (edge cases), messages automatically fall back to plain text:
```typescript
try {
    await ctx.reply(escapeMarkdownV2(text), { parse_mode: "MarkdownV2" });
} catch {
    await ctx.reply(text); // Fallback to plain text
}
```

### 3. Consistent Application
Applied escaping to:
- Static command responses (help text, welcome messages)
- Dynamic content (prices, search results, user input)
- Cross-platform bridge messages
- Long messages (split into chunks)

## Testing

Created and ran comprehensive tests covering:
- Simple text with punctuation
- Special characters (parentheses, brackets, symbols)
- URLs and links
- Lists with dashes
- Math expressions with operators
- Code snippets with braces

All tests passed ✅

## Impact

### Before Fix
- Messages with special characters caused API errors
- Bot would fail to send responses
- Error logs showed byte offset parsing failures

### After Fix
- All messages properly escaped
- No more parsing errors
- Graceful fallback ensures messages always deliver
- Better compatibility with Telegram's MarkdownV2 format

## Migration Notes

The fix maintains backward compatibility:
- Existing functionality unchanged
- All commands work as before
- Automatic escaping is transparent to users
- Fallback ensures reliability

## Future Considerations

1. **Rich Formatting**: For intentional markdown (bold, italic), use pre-escaped formats:
   ```typescript
   // Bold (escaped asterisks around text)
   `*${escapeMarkdownV2(text)}*`

   // Link (escaped brackets and parentheses)
   `[${escapeMarkdownV2(linkText)}](${url})`
   ```

2. **HTML Alternative**: If MarkdownV2 proves problematic, consider `parse_mode: "HTML"` with different escaping rules.

3. **Monitoring**: Watch logs for any remaining parsing errors and adjust escaping as needed.

## Related Links

- [Telegram Bot API - Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [MarkdownV2 Specification](https://core.telegram.org/bots/api#markdownv2-style)
- Error log reference: Dec 18 16:21:19 parsing error

## Verification

To verify the fix is working:

1. Send a message with special characters via `/telegram send`
2. Use the `/price` command with various tokens
3. Test the `/browse` command with URLs
4. Check logs for absence of "can't parse entities" errors

All Telegram bot interactions should now work without markdown parsing errors.
