# @mariozechner/pi-tui

Terminal UI framework with surgical differential rendering for building flicker-free interactive CLI applications.

## Features

- **Surgical Differential Rendering**: Three-strategy system that minimizes redraws to 1-2 lines for typical updates
- **Scrollback Buffer Preservation**: Correctly maintains terminal history when content exceeds viewport
- **Zero Flicker**: Components like text editors remain perfectly still while other parts update
- **Interactive Components**: Text editor with autocomplete, selection lists, markdown rendering
- **Composable Architecture**: Container-based component system with automatic lifecycle management

## Quick Start

```typescript
import { TUI, Container, TextComponent, TextEditor } from "@mariozechner/pi-tui";

// Create TUI manager
const ui = new TUI();

// Create components
const header = new TextComponent("🚀 My TUI App");
const chatContainer = new Container();
const editor = new TextEditor();

// Add components to UI
ui.addChild(header);
ui.addChild(chatContainer);
ui.addChild(editor);

// Set focus to the editor
ui.setFocus(editor);

// Handle editor submissions
editor.onSubmit = (text: string) => {
	if (text.trim()) {
		const message = new TextComponent(`💬 ${text}`);
		chatContainer.addChild(message);
		// Note: Container automatically calls requestRender when children change
	}
};

// Start the UI
ui.start();
```

## Core Components

### TUI

Main TUI manager with surgical differential rendering that handles input and component lifecycle.

**Key Features:**
- **Three rendering strategies**: Automatically selects optimal approach
  - Surgical: Updates only changed lines (1-2 lines typical)
  - Partial: Re-renders from first change when structure shifts
  - Full: Complete re-render when changes are above viewport
- **Performance metrics**: Built-in tracking via `getLinesRedrawn()` and `getAverageLinesRedrawn()`
- **Terminal abstraction**: Works with any Terminal interface implementation

**Methods:**
- `addChild(component)` - Add a component
- `removeChild(component)` - Remove a component
- `setFocus(component)` - Set keyboard focus
- `start()` / `stop()` - Lifecycle management
- `requestRender()` - Queue re-render (automatically debounced)
- `configureLogging(config)` - Enable debug logging

### Container

Component that manages child components. Automatically triggers re-renders when children change.

```typescript
const container = new Container();
container.addChild(new TextComponent("Child 1"));
container.removeChild(component);
container.clear();
```

### TextEditor

Interactive multiline text editor with autocomplete support.

```typescript
const editor = new TextEditor();
editor.setText("Initial text");
editor.onSubmit = (text) => console.log("Submitted:", text);
editor.setAutocompleteProvider(provider);
```

**Key Bindings:**
- `Enter` - Submit text
- `Shift+Enter` - New line
- `Tab` - Autocomplete
- `Ctrl+K` - Delete line
- `Ctrl+A/E` - Start/end of line
- Arrow keys, Backspace, Delete work as expected

### TextComponent

Simple text display with automatic word wrapping.

```typescript
const text = new TextComponent("Hello World", { top: 1, bottom: 1 });
text.setText("Updated text");
```

### MarkdownComponent

Renders markdown content with syntax highlighting and proper formatting.

**Constructor:**

```typescript
new MarkdownComponent(text?: string)
```

**Methods:**

- `setText(text)` - Update markdown content
- `render(width)` - Render parsed markdown

**Features:**

- **Headings**: Styled with colors and formatting
- **Code blocks**: Syntax highlighting with gray background
- **Lists**: Bullet points (•) and numbered lists
- **Emphasis**: **Bold** and _italic_ text
- **Links**: Underlined with URL display
- **Blockquotes**: Styled with left border
- **Inline code**: Highlighted with background
- **Horizontal rules**: Terminal-width separator lines
- Differential rendering for performance

### SelectList

Interactive selection component for choosing from options.

**Constructor:**

```typescript
new SelectList(items: SelectItem[], maxVisible?: number)

interface SelectItem {
	value: string;
	label: string;
	description?: string;
}
```

**Properties:**

- `onSelect?: (item: SelectItem) => void` - Called when item is selected
- `onCancel?: () => void` - Called when selection is cancelled

**Methods:**

- `setFilter(filter)` - Filter items by value
- `getSelectedItem()` - Get currently selected item
- `handleInput(keyData)` - Handle keyboard navigation
- `render(width)` - Render the selection list

**Features:**

- Keyboard navigation (arrow keys, Enter)
- Search/filter functionality
- Scrolling for long lists
- Custom option rendering with descriptions
- Visual selection indicator (→)
- Scroll position indicator

### Autocomplete System

Comprehensive autocomplete system supporting slash commands and file paths.

#### AutocompleteProvider Interface

```typescript
interface AutocompleteProvider {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): {
		items: AutocompleteItem[];
		prefix: string;
	} | null;

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
}

interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}
```

#### CombinedAutocompleteProvider

Built-in provider supporting slash commands and file completion.

**Constructor:**

```typescript
new CombinedAutocompleteProvider(
	commands: (SlashCommand | AutocompleteItem)[] = [],
	basePath: string = process.cwd()
)

interface SlashCommand {
	name: string;
	description?: string;
	getArgumentCompletions?(argumentPrefix: string): AutocompleteItem[] | null;
}
```

**Features:**

**Slash Commands:**

- Type `/` to trigger command completion
- Auto-completion for command names
- Argument completion for commands that support it
- Space after command name for argument input

**File Completion:**

- `Tab` key triggers file completion
- `@` prefix for file attachments
- Home directory expansion (`~/`)
- Relative and absolute path support
- Directory-first sorting
- Filters to attachable files for `@` prefix

**Path Patterns:**

- `./` and `../` - Relative paths
- `~/` - Home directory
- `@path` - File attachment syntax
- Tab completion from any context

**Methods:**

- `getSuggestions()` - Get completions for current context
- `getForceFileSuggestions()` - Force file completion (Tab key)
- `shouldTriggerFileCompletion()` - Check if file completion should trigger
- `applyCompletion()` - Apply selected completion

## Surgical Differential Rendering

The TUI uses a three-strategy rendering system that minimizes redraws to only what's necessary:

### Rendering Strategies

1. **Surgical Updates** (most common)
   - When: Only content changes, same line counts, all changes in viewport
   - Action: Updates only specific changed lines (typically 1-2 lines)
   - Example: Loading spinner animation, updating status text

2. **Partial Re-render** 
   - When: Line count changes or structural changes within viewport
   - Action: Clears from first change to end of screen, re-renders tail
   - Example: Adding new messages to a chat, expanding text editor

3. **Full Re-render**
   - When: Changes occur above the viewport (in scrollback buffer)
   - Action: Clears scrollback and screen, renders everything fresh
   - Example: Content exceeds viewport and early components change

### How Components Participate

Components implement the simple `Component` interface:

```typescript
interface ComponentRenderResult {
  lines: string[];      // The lines to display
  changed: boolean;     // Whether content changed since last render
}

interface Component {
  readonly id: number;  // Unique ID for tracking
  render(width: number): ComponentRenderResult;
  handleInput?(keyData: string): void;
}
```

The TUI tracks component IDs and line positions to determine the optimal strategy automatically.

### Performance Metrics

Monitor rendering efficiency:

```typescript
const ui = new TUI();
// After some rendering...
console.log(`Total lines redrawn: ${ui.getLinesRedrawn()}`);
console.log(`Average per render: ${ui.getAverageLinesRedrawn()}`);
```

Typical performance: 1-2 lines redrawn for animations, 0 for static content.

## Advanced Examples

### Chat Application with Autocomplete

```typescript
import { TUI, Container, TextEditor, MarkdownComponent, CombinedAutocompleteProvider } from "@mariozechner/pi-tui";

const ui = new TUI();
const chatHistory = new Container();
const editor = new TextEditor();

// Set up autocomplete with slash commands
const autocompleteProvider = new CombinedAutocompleteProvider([
	{ name: "clear", description: "Clear chat history" },
	{ name: "help", description: "Show help information" },
	{
		name: "attach",
		description: "Attach a file",
		getArgumentCompletions: (prefix) => {
			// Return file suggestions for attach command
			return null; // Use default file completion
		},
	},
]);

editor.setAutocompleteProvider(autocompleteProvider);

editor.onSubmit = (text) => {
	// Handle slash commands
	if (text.startsWith("/")) {
		const [command, ...args] = text.slice(1).split(" ");
		if (command === "clear") {
			chatHistory.clear();
			return;
		}
		if (command === "help") {
			const help = new MarkdownComponent(`
## Available Commands
- \`/clear\` - Clear chat history
- \`/help\` - Show this help
- \`/attach <file>\` - Attach a file
			`);
			chatHistory.addChild(help);
			ui.requestRender();
			return;
		}
	}

	// Regular message
	const message = new MarkdownComponent(`**You:** ${text}`);
	chatHistory.addChild(message);

	// Add AI response (simulated)
	setTimeout(() => {
		const response = new MarkdownComponent(`**AI:** Response to "${text}"`);
		chatHistory.addChild(response);
		ui.requestRender();
	}, 1000);
};

ui.addChild(chatHistory);
ui.addChild(editor);
ui.setFocus(editor);
ui.start();
```

### File Browser

```typescript
import { TUI, SelectList } from "@mariozechner/pi-tui";
import { readdirSync, statSync } from "fs";
import { join } from "path";

const ui = new TUI();
let currentPath = process.cwd();

function createFileList(path: string) {
	const entries = readdirSync(path).map((entry) => {
		const fullPath = join(path, entry);
		const isDir = statSync(fullPath).isDirectory();
		return {
			value: entry,
			label: entry,
			description: isDir ? "directory" : "file",
		};
	});

	// Add parent directory option
	if (path !== "/") {
		entries.unshift({
			value: "..",
			label: "..",
			description: "parent directory",
		});
	}

	return entries;
}

function showDirectory(path: string) {
	ui.clear();

	const entries = createFileList(path);
	const fileList = new SelectList(entries, 10);

	fileList.onSelect = (item) => {
		if (item.value === "..") {
			currentPath = join(currentPath, "..");
			showDirectory(currentPath);
		} else if (item.description === "directory") {
			currentPath = join(currentPath, item.value);
			showDirectory(currentPath);
		} else {
			console.log(`Selected file: ${join(currentPath, item.value)}`);
			ui.stop();
		}
	};

	ui.addChild(fileList);
	ui.setFocus(fileList);
}

showDirectory(currentPath);
ui.start();
```

### Multi-Component Layout

```typescript
import { TUI, Container, TextComponent, TextEditor, MarkdownComponent } from "@mariozechner/pi-tui";

const ui = new TUI();

// Create layout containers
const header = new TextComponent("📝 Advanced TUI Demo", { bottom: 1 });
const mainContent = new Container();
const sidebar = new Container();
const footer = new TextComponent("Press Ctrl+C to exit", { top: 1 });

// Sidebar content
sidebar.addChild(new TextComponent("📁 Files:", { bottom: 1 }));
sidebar.addChild(new TextComponent("- config.json"));
sidebar.addChild(new TextComponent("- README.md"));
sidebar.addChild(new TextComponent("- package.json"));

// Main content area
const chatArea = new Container();
const inputArea = new TextEditor();

// Add welcome message
chatArea.addChild(
	new MarkdownComponent(`
# Welcome to the TUI Demo

This demonstrates multiple components working together:

- **Header**: Static title with padding
- **Sidebar**: File list (simulated)
- **Chat Area**: Scrollable message history
- **Input**: Interactive text editor
- **Footer**: Status information

Try typing a message and pressing Enter!
`),
);

inputArea.onSubmit = (text) => {
	if (text.trim()) {
		const message = new MarkdownComponent(`
**${new Date().toLocaleTimeString()}:** ${text}
		`);
		chatArea.addChild(message);
		ui.requestRender();
	}
};

// Build layout
mainContent.addChild(chatArea);
mainContent.addChild(inputArea);

ui.addChild(header);
ui.addChild(mainContent);
ui.addChild(footer);
ui.setFocus(inputArea);

// Configure debug logging
ui.configureLogging({
	enabled: true,
	level: "info",
	logFile: "tui-debug.log",
});

ui.start();
```

## Interfaces and Types

### Core Types

```typescript
interface ComponentRenderResult {
	lines: string[];
	changed: boolean;
}

interface ContainerRenderResult extends ComponentRenderResult {
	keepLines: number;
}

interface Component {
	render(width: number): ComponentRenderResult;
	handleInput?(keyData: string): void;
}

interface Padding {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
}
```

### Autocomplete Types

```typescript
interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

interface SlashCommand {
	name: string;
	description?: string;
	getArgumentCompletions?(argumentPrefix: string): AutocompleteItem[] | null;
}

interface AutocompleteProvider {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): {
		items: AutocompleteItem[];
		prefix: string;
	} | null;

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
}
```

### Selection Types

```typescript
interface SelectItem {
	value: string;
	label: string;
	description?: string;
}
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- test/tui-rendering.test.ts

# Run tests matching a pattern
npm test -- --test-name-pattern="preserves existing"
```

### Test Infrastructure

The TUI uses a **VirtualTerminal** for testing that provides accurate terminal emulation via `@xterm/headless`:

```typescript
import { VirtualTerminal } from "./test/virtual-terminal.js";
import { TUI, TextComponent } from "../src/index.js";

test("my TUI test", async () => {
  const terminal = new VirtualTerminal(80, 24);
  const ui = new TUI(terminal);
  ui.start();
  
  ui.addChild(new TextComponent("Hello"));
  
  // Wait for render
  await new Promise(resolve => process.nextTick(resolve));
  
  // Get rendered output
  const viewport = await terminal.flushAndGetViewport();
  assert.strictEqual(viewport[0], "Hello");
  
  ui.stop();
});
```

### Writing a New Test

1. **Create test file** in `test/` directory with `.test.ts` extension
2. **Use VirtualTerminal** for accurate terminal emulation
3. **Key testing patterns**:

```typescript
import { test, describe } from "node:test";
import assert from "node:assert";
import { VirtualTerminal } from "./virtual-terminal.js";
import { TUI, Container, TextComponent } from "../src/index.js";

describe("My Feature", () => {
  test("should handle dynamic content", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const ui = new TUI(terminal);
    ui.start();
    
    // Setup components
    const container = new Container();
    ui.addChild(container);
    
    // Initial render
    await new Promise(resolve => process.nextTick(resolve));
    await terminal.flush();
    
    // Check viewport (visible content)
    let viewport = terminal.getViewport();
    assert.strictEqual(viewport.length, 24);
    
    // Check scrollback buffer (all content including history)
    let scrollBuffer = terminal.getScrollBuffer();
    
    // Simulate user input
    terminal.sendInput("Hello");
    
    // Wait for processing
    await new Promise(resolve => process.nextTick(resolve));
    await terminal.flush();
    
    // Verify changes
    viewport = terminal.getViewport();
    // ... assertions
    
    ui.stop();
  });
});
```

### VirtualTerminal API

- `new VirtualTerminal(columns, rows)` - Create terminal with dimensions
- `write(data)` - Write ANSI sequences to terminal
- `sendInput(data)` - Simulate keyboard input
- `flush()` - Wait for all writes to complete
- `getViewport()` - Get visible lines (what user sees)
- `getScrollBuffer()` - Get all lines including scrollback
- `flushAndGetViewport()` - Convenience method
- `getCursorPosition()` - Get cursor row/column
- `resize(columns, rows)` - Resize terminal

### Testing Best Practices

1. **Always flush after renders**: Terminal writes are async
   ```typescript
   await new Promise(resolve => process.nextTick(resolve));
   await terminal.flush();
   ```

2. **Test both viewport and scrollback**: Ensure content preservation
   ```typescript
   const viewport = terminal.getViewport();     // Visible content
   const scrollBuffer = terminal.getScrollBuffer(); // All content
   ```

3. **Use exact string matching**: Don't trim() - whitespace matters
   ```typescript
   assert.strictEqual(viewport[0], "Expected text"); // Good
   assert.strictEqual(viewport[0].trim(), "Expected"); // Bad
   ```

4. **Test rendering strategies**: Verify surgical vs partial vs full
   ```typescript
   const beforeLines = ui.getLinesRedrawn();
   // Make change...
   const afterLines = ui.getLinesRedrawn();
   assert.strictEqual(afterLines - beforeLines, 1); // Only 1 line changed
   ```

### Performance Testing

Use `test/bench.ts` as a template for performance testing:

```bash
npx tsx test/bench.ts
```

Monitor real-time performance metrics:
- Render count and timing
- Lines redrawn per render
- Visual verification of flicker-free updates

## Development

```bash
# Install dependencies (from monorepo root)
npm install

# Build the package
npm run build

# Run type checking
npm run check

# Run tests
npm test
```

**Debugging:**
Enable logging to see detailed component behavior:

```typescript
ui.configureLogging({
	enabled: true,
	level: "debug", // "error" | "warn" | "info" | "debug"
	logFile: "tui-debug.log",
});
```
