# Color Usage Inventory

## Complete list of all semantic color uses in the codebase

### UI Chrome & Structure
- **border** - cyan - Borders around sections (changelog, selectors)
- **borderSubtle** - blue - Borders in selectors (model, session, thinking)
- **borderHorizontal** - gray - Horizontal separator in editor

### Text Hierarchy
- **textPrimary** - default/none - Main content text
- **textSecondary** - gray - Metadata, timestamps, descriptions
- **textDim** - dim - De-emphasized content, placeholder text, "..." indicators
- **textBold** - bold - Emphasis (note: this is styling, not color)

### Interactive/Selection
- **selectionCursor** - blue - "›" cursor in selection lists
- **selectionText** - bold+blue - Selected item text in session selector
- **selectionInfo** - gray - Scroll info "(1/10)" in selectors
- **checkmark** - green - "✓" checkmark for current model
- **providerBadge** - gray - "[anthropic]" provider labels

### Feedback/Status
- **error** - red - Error messages
- **errorAborted** - red - "Aborted" message
- **success** - green - Success messages (stdout)
- **warning** - yellow - Warning messages
- **info** - cyan - Info messages

### Tool Execution
- **toolCommand** - bold - "$ command" in tool execution
- **toolPath** - cyan - File paths in read tool
- **stdout** - green - Standard output lines
- **stderr** - red - Standard error lines
- **stdoutDim** - dim - Truncated stdout lines
- **stderrDim** - dim - Truncated stderr lines

### Footer/Stats
- **footerText** - gray - All footer content (pwd and stats)

### Logo/Branding
- **logoBrand** - bold+cyan - "pi" logo text
- **logoVersion** - dim - Version number
- **instructionsKey** - dim - Keyboard shortcut keys (esc, ctrl+c, etc.)
- **instructionsText** - gray - Instruction text ("to interrupt", etc.)

### Markdown - Headings
- **markdownH1** - bold+underline+yellow - Level 1 headings
- **markdownH2** - bold+yellow - Level 2 headings
- **markdownH3** - bold - Level 3+ headings (uses bold modifier only)

### Markdown - Emphasis
- **markdownBold** - bold - **bold** text
- **markdownItalic** - italic - *italic* text (also used for thinking text)
- **markdownStrikethrough** - strikethrough - ~~strikethrough~~ text

### Markdown - Code
- **markdownCodeBlock** - green - Code block content
- **markdownCodeBlockIndent** - dim - "  " indent before code
- **markdownCodeDelimiter** - gray - "```" delimiters
- **markdownInlineCode** - cyan - `inline code` content
- **markdownInlineCodeDelimiter** - gray - "`" backticks

### Markdown - Links
- **markdownLinkText** - underline+blue - Link text
- **markdownLinkUrl** - gray - " (url)" when text != url

### Markdown - Lists
- **markdownListBullet** - cyan - "- " or "1. " bullets

### Markdown - Quotes
- **markdownQuoteText** - italic - Quoted text
- **markdownQuoteBorder** - gray - "│ " quote border

### Markdown - Other
- **markdownHr** - gray - "─────" horizontal rules
- **markdownTableHeader** - bold - Table header cells

### Loader/Spinner
- **spinnerFrame** - cyan - Spinner animation frame
- **spinnerMessage** - dim - Loading message text

## Summary Statistics

**Total semantic color uses: ~45**

### By Color
- gray: 15 uses (metadata, borders, delimiters, dim text)
- cyan: 9 uses (brand, borders, code, bullets)
- blue: 6 uses (selection, links, borders)
- red: 5 uses (errors, stderr)
- green: 4 uses (success, stdout, code blocks)
- yellow: 3 uses (headings, warnings)
- bold: 8 uses (emphasis, headings, commands)
- dim: 8 uses (de-emphasis, placeholders)
- italic: 3 uses (quotes, thinking, emphasis)
- underline: 2 uses (headings, links)

### By Category
- Markdown: 18 colors
- UI Chrome/Structure: 3 colors
- Text Hierarchy: 4 colors
- Interactive: 5 colors
- Feedback: 4 colors
- Tool Execution: 7 colors
- Footer: 1 color
- Logo/Instructions: 4 colors
- Loader: 2 colors

## Recommendation

We need approximately **35-40 distinct color values** for a complete theme, organized by semantic purpose. Some will be the same color (e.g., multiple uses of "gray"), but they should have separate semantic names so they can be customized independently.
