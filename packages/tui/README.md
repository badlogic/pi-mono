# @mariozechner/pi-tui

Terminal UI framework with differential rendering for building interactive CLI applications.

## Features

- **Differential Rendering**: Only re-renders content that has changed for optimal performance
- **Interactive Components**: Text editor, autocomplete, selection lists, and markdown rendering
- **Composable Architecture**: Container-based component system with proper lifecycle management
- **Text Editor Autocomplete System**: File completion and slash commands with provider interface

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
		ui.requestRender();
	}
};

// Start the UI
ui.start();
```

## Core Components

### TUI

Main TUI manager that handles rendering, input, and component coordination.

**Methods:**

- `addChild(component)` - Add a component to the TUI
- `removeChild(component)` - Remove a component from the TUI
- `setFocus(component)` - Set which component receives keyboard input
- `start()` - Start the TUI (enables raw mode)
- `stop()` - Stop the TUI (disables raw mode)
- `requestRender()` - Request a re-render on next tick
- `configureLogging(config)` - Configure debug logging
- `cleanupSentinels()` - Remove placeholder components after removal operations
- `findComponent(component)` - Check if a component exists in the hierarchy (private)
- `findInContainer(container, component)` - Search for component in container (private)

### Container

Component that manages child components with differential rendering.

**Constructor:**

```typescript
new Container(parentTui?: TUI | undefined)
```

**Methods:**

- `addChild(component)` - Add a child component
- `removeChild(component)` - Remove a child component
- `getChild(index)` - Get a specific child component
- `getChildCount()` - Get the number of child components
- `clear()` - Remove all child components
- `setParentTui(tui)` - Set the parent TUI reference
- `cleanupSentinels()` - Clean up removed component placeholders
- `render(width)` - Render all child components (returns ContainerRenderResult)

### TextEditor

Interactive multiline text editor with cursor support and comprehensive keyboard shortcuts.

**Constructor:**

```typescript
new TextEditor(config?: TextEditorConfig)
```

**Configuration:**

```typescript
interface TextEditorConfig {
	// Configuration options for text editor
}

editor.configure(config: Partial<TextEditorConfig>)
```

**Properties:**

- `onSubmit?: (text: string) => void` - Callback when user presses Enter
- `onChange?: (text: string) => void` - Callback when text content changes

**Methods:**

- `getText()` - Get current text content
- `setText(text)` - Set text content and move cursor to end
- `setAutocompleteProvider(provider)` - Set autocomplete provider for Tab completion
- `render(width)` - Render the editor with current state
- `handleInput(data)` - Process keyboard input

**Keyboard Shortcuts:**

**Navigation:**

- `Arrow Keys` - Move cursor
- `Home` / `Ctrl+A` - Move to start of line
- `End` / `Ctrl+E` - Move to end of line

**Editing:**

- `Backspace` - Delete character before cursor
- `Delete` / `Fn+Backspace` - Delete character at cursor
- `Ctrl+K` - Delete current line
- `Enter` - Submit text (calls onSubmit)
- `Shift+Enter` / `Option+Enter` - Add new line
- `Tab` - Trigger autocomplete

**Autocomplete (when active):**

- `Tab` - Apply selected completion
- `Arrow Up/Down` - Navigate suggestions
- `Escape` - Cancel autocomplete
- `Enter` - Cancel autocomplete and submit

**Paste Detection:**

- Automatically handles multi-line paste
- Converts tabs to 4 spaces
- Filters non-printable characters

### TextComponent

Simple text component with automatic text wrapping and differential rendering.

**Constructor:**

```typescript
new TextComponent(text: string, padding?: Padding)

interface Padding {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
}
```

**Methods:**

- `setText(text)` - Update the text content
- `getText()` - Get current text content
- `render(width)` - Render with word wrapping

**Features:**

- Automatic text wrapping to fit terminal width
- Configurable padding on all sides
- Preserves line breaks in source text
- Uses differential rendering to avoid unnecessary updates

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

## Differential Rendering

The core concept: components return `{lines: string[], changed: boolean, keepLines?: number}`:

- `lines`: All lines the component should display
- `changed`: Whether the component has changed since last render
- `keepLines`: (Containers only) How many lines from the beginning are unchanged

**How it works:**

1. TUI calculates total unchanged lines from top (`keepLines`)
2. Moves cursor up by `(totalLines - keepLines)` positions
3. Clears from cursor position down with `\x1b[0J`
4. Prints only the changing lines: `result.lines.slice(keepLines)`

This approach minimizes screen updates and provides smooth performance even with large amounts of text.

**Important:** Don't add extra cursor positioning after printing - it interferes with terminal scrolling and causes rendering artifacts.

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

## Development

```bash
# Install dependencies (from monorepo root)
npm install

# Build the package
npm run build

# Run type checking
npm run check
```

**Testing:**
Create a test file and run it with tsx:

```bash
# From packages/tui directory
npx tsx test/demo.ts
```

Special input keywords for simulation: "TAB", "ENTER", "SPACE", "ESC"

**Debugging:**
Enable logging to see detailed component behavior:

```typescript
ui.configureLogging({
	enabled: true,
	level: "debug", // "error" | "warn" | "info" | "debug"
	logFile: "tui-debug.log",
});
```

Check the log file to debug rendering issues, input handling, and component lifecycle.
