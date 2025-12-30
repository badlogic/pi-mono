# @mariozechner/pi-tui

Minimal terminal UI framework with differential rendering and synchronized output for flicker-free interactive CLI applications.

## Features

- **Differential Rendering**: Three-strategy rendering system that only updates what changed
- **Synchronized Output**: Uses CSI 2026 for atomic screen updates (no flicker)
- **Bracketed Paste Mode**: Handles large pastes correctly with markers for >10 line pastes
- **Component-based**: Simple Component interface with render() method
- **Theme Support**: Components accept theme interfaces for customizable styling
- **Built-in Components**: Text, TruncatedText, Input, Editor, Markdown, Loader, SelectList, SettingsList, Spacer, Image, Box, Container
- **Inline Images**: Renders images in terminals that support Kitty or iTerm2 graphics protocols
- **Autocomplete Support**: File paths and slash commands

## Quick Start

```typescript
import { TUI, Text, Editor, ProcessTerminal } from "@mariozechner/pi-tui";

// Create terminal
const terminal = new ProcessTerminal();

// Create TUI
const tui = new TUI(terminal);

// Add components
tui.addChild(new Text("Welcome to my app!"));

const editor = new Editor(editorTheme);
editor.onSubmit = (text) => {
  console.log("Submitted:", text);
  tui.addChild(new Text(`You said: ${text}`));
};
tui.addChild(editor);

// Start
tui.start();
```

## Core API

### TUI

Main container that manages components and rendering.

```typescript
const tui = new TUI(terminal);
tui.addChild(component);
tui.removeChild(component);
tui.start();
tui.stop();
tui.requestRender(); // Request a re-render

// Global debug key handler (Shift+Ctrl+D)
tui.onDebug = () => console.log("Debug triggered");
```

### Component Interface

All components implement:

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}
```

## Built-in Components

### Container

Groups child components.

```typescript
const container = new Container();
container.addChild(component);
container.removeChild(component);
```

### Box

Container that applies padding and background color to all children.

```typescript
const box = new Box(
  1,                              // paddingX (default: 1)
  1,                              // paddingY (default: 1)
  (text) => chalk.bgGray(text)   // optional background function
);
box.addChild(new Text("Content"));
box.setBgFn((text) => chalk.bgBlue(text));  // Change background dynamically
```

### Text

Displays multi-line text with word wrapping and padding.

```typescript
const text = new Text(
  "Hello World",                  // text content
  1,                              // paddingX (default: 1)
  1,                              // paddingY (default: 1)
  (text) => chalk.bgGray(text)   // optional background function
);
text.setText("Updated text");
text.setCustomBgFn((text) => chalk.bgBlue(text));
```

### TruncatedText

Single-line text that truncates to fit viewport width. Useful for status lines and headers.

```typescript
const truncated = new TruncatedText(
  "This is a very long line that will be truncated...",
  0,  // paddingX (default: 0)
  0   // paddingY (default: 0)
);
```

### Input

Single-line text input with horizontal scrolling.

```typescript
const input = new Input();
input.onSubmit = (value) => console.log(value);
input.setValue("initial");
input.getValue();
```

**Key Bindings:**
- `Enter` - Submit
- `Ctrl+A` / `Ctrl+E` - Line start/end
- `Ctrl+W` or `Alt+Backspace` - Delete word backwards
- `Ctrl+U` - Delete to start of line
- `Ctrl+K` - Delete to end of line
- `Ctrl+Left` / `Ctrl+Right` - Word navigation
- `Alt+Left` / `Alt+Right` - Word navigation
- Arrow keys, Backspace, Delete work as expected

### Editor

Multi-line text editor with autocomplete, file completion, and paste handling.

```typescript
interface EditorTheme {
  borderColor: (str: string) => string;
  selectList: SelectListTheme;
}

const editor = new Editor(theme);
editor.onSubmit = (text) => console.log(text);
editor.onChange = (text) => console.log("Changed:", text);
editor.disableSubmit = true; // Disable submit temporarily
editor.setAutocompleteProvider(provider);
editor.borderColor = (s) => chalk.blue(s); // Change border dynamically
```

**Features:**
- Multi-line editing with word wrap
- Slash command autocomplete (type `/`)
- File path autocomplete (press `Tab`)
- Large paste handling (>10 lines creates `[paste #1 +50 lines]` marker)
- Horizontal lines above/below editor
- Fake cursor rendering (hidden real cursor)

**Key Bindings:**
- `Enter` - Submit
- `Shift+Enter`, `Ctrl+Enter`, or `Alt+Enter` - New line (terminal-dependent, Alt+Enter most reliable)
- `Tab` - Autocomplete
- `Ctrl+K` - Delete line
- `Ctrl+A` / `Ctrl+E` - Line start/end
- Arrow keys, Backspace, Delete work as expected

### Markdown

Renders markdown with syntax highlighting and theming support.

```typescript
interface MarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];
}

interface DefaultTextStyle {
  color?: (text: string) => string;
  bgColor?: (text: string) => string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
}

const md = new Markdown(
  "# Hello\n\nSome **bold** text",
  1,              // paddingX
  1,              // paddingY
  theme,          // MarkdownTheme
  defaultStyle    // optional DefaultTextStyle
);
md.setText("Updated markdown");
```

**Features:**
- Headings, bold, italic, code blocks, lists, links, blockquotes
- HTML tags rendered as plain text
- Optional syntax highlighting via `highlightCode`
- Padding support
- Render caching for performance

### Loader

Animated loading spinner.

```typescript
const loader = new Loader(
  tui,                              // TUI instance for render updates
  (s) => chalk.cyan(s),            // spinner color function
  (s) => chalk.gray(s),            // message color function
  "Loading..."                      // message (default: "Loading...")
);
loader.start();
loader.setMessage("Still loading...");
loader.stop();
```

### SelectList

Interactive selection list with keyboard navigation.

```typescript
interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

const list = new SelectList(
  [
    { value: "opt1", label: "Option 1", description: "First option" },
    { value: "opt2", label: "Option 2", description: "Second option" },
  ],
  5,      // maxVisible
  theme   // SelectListTheme
);

list.onSelect = (item) => console.log("Selected:", item);
list.onCancel = () => console.log("Cancelled");
list.onSelectionChange = (item) => console.log("Highlighted:", item);
list.setFilter("opt"); // Filter items
```

**Controls:**
- Arrow keys: Navigate
- Enter: Select
- Escape: Cancel

### SettingsList

Settings panel with value cycling and submenus.

```typescript
interface SettingItem {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];  // If provided, Enter/Space cycles through these
  submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
}

interface SettingsListTheme {
  label: (text: string, selected: boolean) => string;
  value: (text: string, selected: boolean) => string;
  description: (text: string) => string;
  cursor: string;
  hint: (text: string) => string;
}

const settings = new SettingsList(
  [
    { id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light"] },
    { id: "model", label: "Model", currentValue: "gpt-4", submenu: (val, done) => modelSelector },
  ],
  10,      // maxVisible
  theme,   // SettingsListTheme
  (id, newValue) => console.log(`${id} changed to ${newValue}`),
  () => console.log("Cancelled")
);
settings.updateValue("theme", "light");
```

**Controls:**
- Arrow keys: Navigate
- Enter/Space: Activate (cycle value or open submenu)
- Escape: Cancel

### Spacer

Empty lines for vertical spacing.

```typescript
const spacer = new Spacer(2); // 2 empty lines (default: 1)
```

### Image

Renders images inline for terminals that support the Kitty graphics protocol (Kitty, Ghostty, WezTerm) or iTerm2 inline images. Falls back to a text placeholder on unsupported terminals.

```typescript
interface ImageTheme {
  fallbackColor: (str: string) => string;
}

interface ImageOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  filename?: string;
}

const image = new Image(
  base64Data,       // base64-encoded image data
  "image/png",      // MIME type
  theme,            // ImageTheme
  options           // optional ImageOptions
);
tui.addChild(image);
```

Supported formats: PNG, JPEG, GIF, WebP. Dimensions are parsed from the image headers automatically.

## Autocomplete

### CombinedAutocompleteProvider

Supports both slash commands and file paths.

```typescript
import { CombinedAutocompleteProvider } from "@mariozechner/pi-tui";

const provider = new CombinedAutocompleteProvider(
  [
    { name: "help", description: "Show help" },
    { name: "clear", description: "Clear screen" },
    { name: "delete", description: "Delete last message" },
  ],
  process.cwd() // base path for file completion
);

editor.setAutocompleteProvider(provider);
```

**Features:**
- Type `/` to see slash commands
- Press `Tab` for file path completion
- Works with `~/`, `./`, `../`, and `@` prefix
- Filters to attachable files for `@` prefix

## Key Detection

Helper functions for detecting keyboard input (supports Kitty keyboard protocol):

```typescript
import {
  isEnter, isEscape, isTab, isShiftTab,
  isArrowUp, isArrowDown, isArrowLeft, isArrowRight,
  isCtrlA, isCtrlC, isCtrlE, isCtrlK, isCtrlO, isCtrlP,
  isCtrlLeft, isCtrlRight, isAltLeft, isAltRight,
  isShiftEnter, isAltEnter,
  isShiftCtrlO, isShiftCtrlD, isShiftCtrlP,
  isBackspace, isDelete, isHome, isEnd,
  // ... and more
} from "@mariozechner/pi-tui";

if (isCtrlC(data)) {
  process.exit(0);
}
```

## Differential Rendering

The TUI uses three rendering strategies:

1. **First Render**: Output all lines without clearing scrollback
2. **Width Changed or Change Above Viewport**: Clear screen and full re-render
3. **Normal Update**: Move cursor to first changed line, clear to end, render changed lines

All updates are wrapped in **synchronized output** (`\x1b[?2026h` ... `\x1b[?2026l`) for atomic, flicker-free rendering.

## Terminal Interface

The TUI works with any object implementing the `Terminal` interface:

```typescript
interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  get columns(): number;
  get rows(): number;
  moveBy(lines: number): void;
  hideCursor(): void;
  showCursor(): void;
  clearLine(): void;
  clearFromCursor(): void;
  clearScreen(): void;
}
```

**Built-in implementations:**
- `ProcessTerminal` - Uses `process.stdin/stdout`
- `VirtualTerminal` - For testing (uses `@xterm/headless`)

## Utilities

```typescript
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

// Get visible width of string (ignoring ANSI codes)
const width = visibleWidth("\x1b[31mHello\x1b[0m"); // 5

// Truncate string to width (preserving ANSI codes)
const truncated = truncateToWidth("Hello World", 8); // "Hello..."
```

## Example

See `test/chat-simple.ts` for a complete chat interface example with:
- Markdown messages with custom background colors
- Loading spinner during responses
- Editor with autocomplete and slash commands
- Spacers between messages

Run it:
```bash
npx tsx test/chat-simple.ts
```

## Development

```bash
# Install dependencies (from monorepo root)
npm install

# Run type checking
npm run check

# Run the demo
npx tsx test/chat-simple.ts
```
