# Minimal Theme Color Set

## Complete list of required theme colors

Based on analysis of all color usage in the codebase.

### Text Hierarchy (3 colors)
- **textPrimary** - Main content text (default terminal color)
- **textSecondary** - Metadata, supporting text
- **textTertiary** - De-emphasized text (dimmed/muted)

### UI Chrome (4 colors)
- **border** - Primary borders (around changelog, selectors)
- **borderSubtle** - Subtle borders/separators
- **uiBackground** - General UI background elements
- **scrollInfo** - Scroll position indicators like "(1/10)"

### Interactive Elements (4 colors)
- **interactionDefault** - Default interactive state (unselected)
- **interactionHover** - Hovered/focused state
- **interactionActive** - Currently active/selected item
- **interactionSuccess** - Success indicator (checkmarks)

### Feedback/Status (4 colors)
- **feedbackError** - Errors, failures
- **feedbackSuccess** - Success, completed
- **feedbackWarning** - Warnings, cautions
- **feedbackInfo** - Informational messages

### Branding (2 colors)
- **brandPrimary** - Logo, primary brand color
- **brandSecondary** - Secondary brand elements

### Tool Execution (6 colors + 3 backgrounds)
- **toolCommand** - Command text in tool headers
- **toolPath** - File paths
- **toolStdout** - Standard output
- **toolStderr** - Standard error
- **toolDimmed** - Truncated/hidden lines
- **toolNeutral** - Neutral tool output
- **toolBgPending** - Background for pending tool execution
- **toolBgSuccess** - Background for successful tool execution
- **toolBgError** - Background for failed tool execution

### Markdown - Structure (5 colors)
- **mdHeading1** - H1 headings
- **mdHeading2** - H2 headings
- **mdHeading3** - H3+ headings
- **mdHr** - Horizontal rules
- **mdTable** - Table borders and structure

### Markdown - Code (4 colors)
- **mdCodeBlock** - Code block content
- **mdCodeBlockDelimiter** - Code block ``` delimiters
- **mdCodeInline** - Inline `code` content
- **mdCodeInlineDelimiter** - Inline code ` backticks

### Markdown - Lists & Quotes (3 colors)
- **mdListBullet** - List bullets (- or 1.)
- **mdQuoteText** - Blockquote text
- **mdQuoteBorder** - Blockquote border (│)

### Markdown - Links (2 colors)
- **mdLinkText** - Link text
- **mdLinkUrl** - Link URL in parentheses

### Backgrounds (2 colors)
- **bgUserMessage** - Background for user messages
- **bgDefault** - Default/transparent background

### Special/Optional (2 colors)
- **spinner** - Loading spinner animation
- **thinking** - Thinking/reasoning text

## Total: 44 colors

### Grouped by Common Values

Many of these will share the same value. Typical groupings:

**"Secondary" family** (gray-ish):
- textSecondary
- textTertiary
- borderSubtle
- scrollInfo
- toolDimmed
- mdHr
- mdCodeBlockDelimiter
- mdCodeInlineDelimiter
- mdQuoteBorder
- mdLinkUrl

**"Primary accent" family** (blue-ish):
- border
- interactionDefault
- interactionHover
- interactionActive
- brandPrimary
- mdLinkText

**"Success" family** (green-ish):
- feedbackSuccess
- interactionSuccess
- toolStdout
- mdCodeBlock

**"Error" family** (red-ish):
- feedbackError
- toolStderr

**"Code/Tech" family** (cyan-ish):
- brandPrimary
- mdCodeInline
- mdListBullet
- spinner

**"Emphasis" family** (yellow-ish):
- mdHeading1
- mdHeading2
- feedbackWarning

## Simplified Minimal Set (Alternative)

If we want to reduce further, we could consolidate to ~25 colors by using more shared values:

### Core Colors (8)
- **text** - Primary text
- **textMuted** - Secondary/dimmed text
- **accent** - Primary accent (blue)
- **accentSubtle** - Subtle accent
- **success** - Green
- **error** - Red
- **warning** - Yellow
- **info** - Cyan

### Backgrounds (4)
- **bgDefault** - Transparent/default
- **bgUserMessage** - User message background
- **bgSuccess** - Success state background
- **bgError** - Error state background

### Specialized (13)
- **border** - Primary borders
- **borderSubtle** - Subtle borders
- **selection** - Selected items
- **brand** - Brand/logo color
- **mdHeading** - All headings (or separate h1/h2)
- **mdCode** - All code (blocks + inline)
- **mdCodeDelimiter** - Code delimiters
- **mdList** - List bullets
- **mdLink** - Links
- **mdQuote** - Quotes
- **toolCommand** - Command text
- **toolPath** - File paths
- **spinner** - Loading indicator

**Total: 25 colors** (vs 44 in the detailed version)

## Recommendation

Start with the **44-color detailed set** because:
1. Gives maximum flexibility for theming
2. Each has a clear semantic purpose
3. Themes can set many to the same value if desired
4. Easier to add granular control than to split apart later

Users creating themes can start by setting common values and override specific ones:

```json
{
  "name": "my-theme",
  "_comment": "Set common values first",
  "textSecondary": "gray",
  "textTertiary": "gray",
  "borderSubtle": "gray",
  "mdCodeBlockDelimiter": "gray",
  
  "_comment": "Then override specific ones",
  "mdHeading1": "yellow",
  "error": "red"
}
```
