# Usage Summary Customization

Configure how the Usage Summary appears after each run via `settings.json` in your workspace.

## Quick Reference

```json
// Disable entirely
{ "usageSummary": false }

// Customize fields
{
  "usageSummary": {
    "title": "Stats",
    "fields": {
      "tokens": { "label": "I/O", "format": "{input} in / {output} out" },
      "cache": false
    }
  }
}

// Full control via script
{ "usageSummary": { "formatter": "./scripts/my-formatter.js" } }
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Show/hide usage summary |
| `title` | string | `"Usage Summary"` | Header text |
| `formatter` | string | - | Path to custom script (bypasses templates) |
| `fields` | object | - | Per-field configuration |
| `footer` | object | - | Footer configuration |

## Field Configuration

Each field (`tokens`, `context`, `cost`, `cache`) accepts:
- `false` - hide the field
- `{ enabled, label, format }` - customize the field

**Placeholders:**
- `tokens`: `{input}`, `{output}`
- `context`: `{used}`, `{max}`, `{percent}`
- `cost`: `{total}`, `{input}`, `{output}`, `{cacheRead}`, `{cacheWrite}`
- `cache`: `{read}`, `{write}`

## Custom Formatter

For full control, create a script that receives usage data on stdin and outputs JSON:

```javascript
#!/usr/bin/env node
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify({
  title: "My Stats",
  color: 0x2b2d31,
  fields: [{ name: "Cost", value: `$${data.cost.total.toFixed(4)}`, inline: true }],
  footer: "Custom footer"
}));
```

**Input:** `{ tokens, cache, context, cost }` (same structure as UsageSummaryData)

**Output (Discord):** `{ title?, color?, fields?, footer? }`

**Output (Slack):** `{ text: "..." }`

If the formatter fails, falls back to template system.
