# TUI Components

Hooks and custom tools can render custom TUI components for interactive user interfaces. This page covers the component system and available building blocks.

**Source:** [`@mariozechner/pi-tui`](https://github.com/badlogic/pi-mono/tree/main/packages/tui)

## Component Interface

All components implement:

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}
```

| Method | Description |
|--------|-------------|
| `render(width)` | Return array of strings (one per line). Each line **must not exceed `width`**. |
| `handleInput?(data)` | Receive keyboard input when component has focus. |
| `invalidate?()` | Clear cached render state. |

## Using Components

**In hooks** via `ctx.ui.custom()`:

```typescript
pi.on("session_start", async (_event, ctx) => {
  const handle = ctx.ui.custom(myComponent);
  // handle.requestRender() - trigger re-render
  // handle.close() - restore normal UI
});
```

**In custom tools** via `pi.ui.custom()`:

```typescript
async execute(toolCallId, params, onUpdate, ctx, signal) {
  const handle = pi.ui.custom(myComponent);
  // ...
  handle.close();
}
```

## Built-in Components

Import from `@mariozechner/pi-tui`:

```typescript
import { Text, Box, Container, Spacer, Markdown } from "@mariozechner/pi-tui";
```

### Text

Multi-line text with word wrapping.

```typescript
const text = new Text(
  "Hello World",    // content
  1,                // paddingX (default: 1)
  1,                // paddingY (default: 1)
  (s) => bgGray(s)  // optional background function
);
text.setText("Updated");
```

### Box

Container with padding and background color.

```typescript
const box = new Box(
  1,                // paddingX
  1,                // paddingY
  (s) => bgGray(s)  // background function
);
box.addChild(new Text("Content", 0, 0));
box.setBgFn((s) => bgBlue(s));
```

### Container

Groups child components vertically.

```typescript
const container = new Container();
container.addChild(component1);
container.addChild(component2);
container.removeChild(component1);
```

### Spacer

Empty vertical space.

```typescript
const spacer = new Spacer(2);  // 2 empty lines
```

### Markdown

Renders markdown with syntax highlighting.

```typescript
const md = new Markdown(
  "# Title\n\nSome **bold** text",
  1,        // paddingX
  1,        // paddingY
  theme     // MarkdownTheme (see below)
);
md.setText("Updated markdown");
```

### Image

Renders images in supported terminals (Kitty, iTerm2, Ghostty, WezTerm).

```typescript
const image = new Image(
  base64Data,   // base64-encoded image
  "image/png",  // MIME type
  theme,        // ImageTheme
  { maxWidthCells: 80, maxHeightCells: 24 }
);
```

## Keyboard Input

Use key detection helpers:

```typescript
import {
  isEnter, isEscape, isTab,
  isArrowUp, isArrowDown, isArrowLeft, isArrowRight,
  isCtrlC, isCtrlO, isBackspace, isDelete,
  // ... and more
} from "@mariozechner/pi-tui";

handleInput(data: string) {
  if (isArrowUp(data)) {
    this.selectedIndex--;
  } else if (isEnter(data)) {
    this.onSelect?.(this.selectedIndex);
  } else if (isEscape(data)) {
    this.onCancel?.();
  }
}
```

## Line Width

**Critical:** Each line from `render()` must not exceed the `width` parameter.

```typescript
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

render(width: number): string[] {
  // Truncate long lines
  return [truncateToWidth(this.text, width)];
}
```

Utilities:
- `visibleWidth(str)` - Get display width (ignores ANSI codes)
- `truncateToWidth(str, width, ellipsis?)` - Truncate with optional ellipsis
- `wrapTextWithAnsi(str, width)` - Word wrap preserving ANSI codes

## Creating Custom Components

Example: Interactive selector

```typescript
import {
  isEnter, isEscape, isArrowUp, isArrowDown,
  truncateToWidth, visibleWidth
} from "@mariozechner/pi-tui";

class MySelector {
  private items: string[];
  private selected = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];
  
  public onSelect?: (item: string) => void;
  public onCancel?: () => void;

  constructor(items: string[]) {
    this.items = items;
  }

  handleInput(data: string): void {
    if (isArrowUp(data) && this.selected > 0) {
      this.selected--;
      this.invalidate();
    } else if (isArrowDown(data) && this.selected < this.items.length - 1) {
      this.selected++;
      this.invalidate();
    } else if (isEnter(data)) {
      this.onSelect?.(this.items[this.selected]);
    } else if (isEscape(data)) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    this.cachedLines = this.items.map((item, i) => {
      const prefix = i === this.selected ? "> " : "  ";
      return truncateToWidth(prefix + item, width);
    });
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

Usage in a hook:

```typescript
pi.registerCommand("pick", {
  description: "Pick an item",
  handler: async (args, ctx) => {
    const items = ["Option A", "Option B", "Option C"];
    const selector = new MySelector(items);
    
    let handle: { close: () => void; requestRender: () => void };
    
    await new Promise<void>((resolve) => {
      selector.onSelect = (item) => {
        ctx.ui.notify(`Selected: ${item}`, "info");
        handle.close();
        resolve();
      };
      selector.onCancel = () => {
        handle.close();
        resolve();
      };
      handle = ctx.ui.custom(selector);
    });
  }
});
```

## Theming

Components accept theme objects for styling. Use ANSI color functions (e.g., from `chalk` or pi's theme):

```typescript
// In hooks, use the theme from renderResult/renderCall
renderResult(result, options, theme) {
  return new Text(theme.fg("success", "Done!"), 0, 0);
}

// For custom components, define your own theme interface
interface MyTheme {
  selected: (s: string) => string;
  normal: (s: string) => string;
}
```

### MarkdownTheme

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
```

## Performance

Cache rendered output when possible:

```typescript
class CachedComponent {
  private cachedWidth?: number;
  private cachedLines?: string[];

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    // ... compute lines ...
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

Call `invalidate()` when state changes, then `handle.requestRender()` to trigger re-render.

## Examples

- **Snake game**: [examples/hooks/snake.ts](../examples/hooks/snake.ts) - Full game with keyboard input, game loop, state persistence
- **Custom tool rendering**: [examples/custom-tools/todo/](../examples/custom-tools/todo/) - Custom `renderCall` and `renderResult`
