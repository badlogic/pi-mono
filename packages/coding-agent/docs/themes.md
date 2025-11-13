# Theme System Analysis

## Problem Statement

Issue #7: In terminals with light backgrounds, some outputs use dark colors that are hard to read. We need a theme system that allows users to choose between light and dark themes.

## Current Color Usage Analysis

### Color Usage Statistics

Total chalk color calls: 132 across 14 files

Most frequent colors:
- `chalk.dim` (48 occurrences) - Used for secondary text
- `chalk.gray` (28 occurrences) - Used for borders, metadata, dimmed content
- `chalk.bold` (20 occurrences) - Used for emphasis
- `chalk.blue` (12 occurrences) - Used for selections, borders, links
- `chalk.cyan` (9 occurrences) - Used for primary UI elements (logo, list bullets, code)
- `chalk.red` (7 occurrences) - Used for errors, stderr output
- `chalk.green` (6 occurrences) - Used for success, stdout output
- `chalk.yellow` (3 occurrences) - Used for headings in markdown
- `chalk.bgRgb` (6 occurrences) - Used for custom backgrounds in Text/Markdown

### Files Using Colors

#### coding-agent Package
1. **main.ts** - CLI output messages
2. **tui/assistant-message.ts** - Thinking text (gray italic), errors (red), aborted (red)
3. **tui/dynamic-border.ts** - Configurable border color (default blue)
4. **tui/footer.ts** - Stats and pwd (gray)
5. **tui/model-selector.ts** - Borders (blue), selection arrow (blue), provider badge (gray), checkmark (green)
6. **tui/session-selector.ts** - Border (blue), selection cursor (blue), metadata (dim)
7. **tui/thinking-selector.ts** - Border (blue)
8. **tui/tool-execution.ts** - stdout (green), stderr (red), dim lines (dim), line numbers
9. **tui/tui-renderer.ts** - Logo (bold cyan), instructions (dim/gray)

#### tui Package
1. **components/editor.ts** - Horizontal border (gray)
2. **components/loader.ts** - Spinner (cyan), message (dim)
3. **components/markdown.ts** - Complex color system:
   - H1 headings: bold.underline.yellow
   - H2 headings: bold.yellow
   - H3+ headings: bold
   - Code blocks: gray (delimiters), dim (indent), green (code)
   - List bullets: cyan
   - Blockquotes: gray (pipe), italic (text)
   - Horizontal rules: gray
   - Inline code: gray (backticks), cyan (code)
   - Links: underline.blue (text), gray (URL)
   - Strikethrough: strikethrough
   - Tables: bold (headers)
4. **components/select-list.ts** - No matches (gray), selection arrow (blue), selected item (blue), description (gray)
5. **components/text.ts** - Custom bgRgb support

### Color System Architecture

#### Current Implementation
- Colors are hardcoded using `chalk` directly
- No centralized theme management
- No way to switch themes at runtime
- Some components accept color parameters (e.g., DynamicBorder, Text, Markdown)

#### Markdown Component Color System
The Markdown component has a `Color` type enum:
```typescript
type Color = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray" | 
             "bgBlack" | "bgRed" | "bgGreen" | "bgYellow" | "bgBlue" | "bgMagenta" | "bgCyan" | "bgWhite" | "bgGray"
```

It accepts optional `bgColor` and `fgColor` parameters, plus `customBgRgb`.

## Proposed Solution

### Theme Structure

Create a centralized theme system with semantic color names:

```typescript
interface Theme {
  name: string;
  
  // UI Chrome
  border: ChalkFunction;
  selection: ChalkFunction;
  selectionText: ChalkFunction;
  
  // Text hierarchy
  primary: ChalkFunction;
  secondary: ChalkFunction;
  dim: ChalkFunction;
  
  // Semantic colors
  error: ChalkFunction;
  success: ChalkFunction;
  warning: ChalkFunction;
  info: ChalkFunction;
  
  // Code/output
  code: ChalkFunction;
  codeDelimiter: ChalkFunction;
  stdout: ChalkFunction;
  stderr: ChalkFunction;
  
  // Markdown specific
  heading1: ChalkFunction;
  heading2: ChalkFunction;
  heading3: ChalkFunction;
  link: ChalkFunction;
  linkUrl: ChalkFunction;
  listBullet: ChalkFunction;
  blockquote: ChalkFunction;
  blockquotePipe: ChalkFunction;
  inlineCode: ChalkFunction;
  inlineCodeDelimiter: ChalkFunction;
  
  // Backgrounds (optional, for components like Text/Markdown)
  backgroundRgb?: { r: number; g: number; b: number };
}

type ChalkFunction = (str: string) => string;
```

### Built-in Themes

#### Dark Theme (current default)
```typescript
const darkTheme: Theme = {
  name: "dark",
  border: chalk.blue,
  selection: chalk.blue,
  selectionText: chalk.blue,
  primary: (s) => s, // no color
  secondary: chalk.gray,
  dim: chalk.dim,
  error: chalk.red,
  success: chalk.green,
  warning: chalk.yellow,
  info: chalk.cyan,
  code: chalk.green,
  codeDelimiter: chalk.gray,
  stdout: chalk.green,
  stderr: chalk.red,
  heading1: chalk.bold.underline.yellow,
  heading2: chalk.bold.yellow,
  heading3: chalk.bold,
  link: chalk.underline.blue,
  linkUrl: chalk.gray,
  listBullet: chalk.cyan,
  blockquote: chalk.italic,
  blockquotePipe: chalk.gray,
  inlineCode: chalk.cyan,
  inlineCodeDelimiter: chalk.gray,
};
```

#### Light Theme
```typescript
const lightTheme: Theme = {
  name: "light",
  border: chalk.blue,
  selection: chalk.blue,
  selectionText: chalk.blue.bold,
  primary: (s) => s,
  secondary: chalk.gray,
  dim: chalk.gray, // Don't use chalk.dim on light backgrounds
  error: chalk.red.bold,
  success: chalk.green.bold,
  warning: chalk.yellow.bold,
  info: chalk.cyan.bold,
  code: chalk.green.bold,
  codeDelimiter: chalk.gray,
  stdout: chalk.green.bold,
  stderr: chalk.red.bold,
  heading1: chalk.bold.underline.blue,
  heading2: chalk.bold.blue,
  heading3: chalk.bold,
  link: chalk.underline.blue,
  linkUrl: chalk.blue,
  listBullet: chalk.blue.bold,
  blockquote: chalk.italic,
  blockquotePipe: chalk.gray,
  inlineCode: chalk.blue.bold,
  inlineCodeDelimiter: chalk.gray,
};
```

### Implementation Plan

#### 1. Create Theme Module
**Location:** `packages/tui/src/theme.ts`

```typescript
export interface Theme { ... }
export const darkTheme: Theme = { ... };
export const lightTheme: Theme = { ... };
export const themes = { dark: darkTheme, light: lightTheme };

let currentTheme: Theme = darkTheme;

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

export function getTheme(): Theme {
  return currentTheme;
}
```

#### 2. Update Settings Manager
**Location:** `packages/coding-agent/src/settings-manager.ts`

Add `theme` field to Settings interface:
```typescript
export interface Settings {
  lastChangelogVersion?: string;
  theme?: "dark" | "light";
}
```

#### 3. Create Theme Selector Component
**Location:** `packages/coding-agent/src/tui/theme-selector.ts`

Similar to ModelSelector and ThinkingSelector, create a TUI component for selecting themes.

#### 4. Refactor Color Usage

Replace all hardcoded `chalk.*` calls with `theme.*`:

**Example - Before:**
```typescript
lines.push(chalk.blue("─".repeat(width)));
const cursor = chalk.blue("› ");
```

**Example - After:**
```typescript
const theme = getTheme();
lines.push(theme.border("─".repeat(width)));
const cursor = theme.selection("› ");
```

#### 5. Update Components

##### High Priority (User-facing content issues)
1. **markdown.ts** - Update all color calls to use theme
2. **tool-execution.ts** - stdout/stderr colors
3. **assistant-message.ts** - Error messages
4. **tui-renderer.ts** - Logo and instructions
5. **footer.ts** - Stats display

##### Medium Priority (UI chrome)
6. **dynamic-border.ts** - Accept theme parameter
7. **model-selector.ts** - Selection colors
8. **session-selector.ts** - Selection colors
9. **thinking-selector.ts** - Border colors
10. **select-list.ts** - Selection colors
11. **loader.ts** - Spinner color
12. **editor.ts** - Border color

##### Low Priority (CLI output)
13. **main.ts** - CLI messages

#### 6. Add Theme Slash Command
**Location:** `packages/coding-agent/src/tui/tui-renderer.ts`

Add `/theme` command similar to `/model` and `/thinking`.

#### 7. Initialize Theme on Startup
**Location:** `packages/coding-agent/src/main.ts`

```typescript
// Load theme from settings
const settingsManager = new SettingsManager();
const themeName = settingsManager.getTheme() || "dark";
const theme = themes[themeName] || darkTheme;
setTheme(theme);
```

### Migration Strategy

1. **Phase 1:** Create theme infrastructure (theme.ts, types, built-in themes)
2. **Phase 2:** Update TUI package components (markdown, text, loader, editor, select-list)
3. **Phase 3:** Update coding-agent TUI components (all tui/*.ts files)
4. **Phase 4:** Add theme selector and persistence
5. **Phase 5:** Update CLI output in main.ts (optional, low priority)

### Testing Plan

1. Test both themes in terminals with light backgrounds
2. Test both themes in terminals with dark backgrounds
3. Verify theme switching works at runtime via `/theme`
4. Verify theme persists across sessions via settings.json
5. Test all components for readability in both themes

### Open Questions

1. Should we support custom user themes loaded from a JSON file?
2. Should we auto-detect terminal background color and choose theme automatically?
3. Should theme apply to background colors used in Text/Markdown components?
4. Do we need more than two themes initially?

### Breaking Changes

None - the default theme will remain "dark" matching current behavior.

### Performance Considerations

- Theme getter is called frequently (on every render)
- Should be a simple variable access, not a function call chain
- Consider caching theme functions if performance becomes an issue
