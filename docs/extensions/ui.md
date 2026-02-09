# Extension UI Components

Interact with users via `ctx.ui` methods and build custom TUI components.

## Dialogs

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

## Timed Dialogs

Auto-dismiss with countdown:

```typescript
const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { timeout: 5000 }
);

if (confirmed) {
  // User confirmed
} else {
  // User cancelled or timed out
}
```

Or use `AbortSignal` for more control:

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { signal: controller.signal }
);

clearTimeout(timeoutId);

if (confirmed) {
  // User confirmed
} else if (controller.signal.aborted) {
  // Dialog timed out
} else {
  // User cancelled
}
```

## Widgets & Status

```typescript
// Status in footer (persistent until cleared)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Working message (shown during streaming)
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // Restore default

// Widget above editor (default)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);

// Widget below editor
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"], { placement: "belowEditor" });

// Widget with custom component
ctx.ui.setWidget("my-widget", (tui, theme) =>
  new Text(theme.fg("accent", "Custom"), 0, 0)
);

// Clear widget
ctx.ui.setWidget("my-widget", undefined);

// Custom footer
ctx.ui.setFooter((tui, theme, footerData) => ({
  render(width) { return [theme.fg("dim", "Custom footer")]; },
  invalidate() {},
}));
ctx.ui.setFooter(undefined);  // Restore built-in footer

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();

// Paste into editor (triggers paste handling)
ctx.ui.pasteToEditor("pasted content");

// Tool output expansion
const wasExpanded = ctx.ui.getToolsExpanded();
ctx.ui.setToolsExpanded(true);
ctx.ui.setToolsExpanded(wasExpanded);

// Theme management
const themes = ctx.ui.getAllThemes();  // [{ name: "dark", path: "..." }, ...]
const lightTheme = ctx.ui.getTheme("light");  // Load without switching
const result = ctx.ui.setTheme("light");  // Switch by name
```

## Custom Components

Build full TUI components with keyboard input:

```typescript
import { Text, Box, SelectList } from "@mariozechner/pi-tui";

const result = await ctx.ui.custom((tui, theme, keybindings, done) => {
  // Simple text component
  return new Text("Hello!", 0, 0);

  // Or complex interactive component
  const list = new SelectList(["A", "B", "C"], theme);
  list.onSelect = (item) => done(item);
  return list;
}, {
  overlay: true,  // Show as overlay
  overlayOptions: { width: "50%", height: 10 },
  onHandle: (handle) => {
    // Control visibility dynamically
    handle.setVisible(false);
  }
});
```

## Custom Editor

Replace the input editor (vim mode, emacs mode, etc.):

```typescript
import { CustomEditor } from "@mariozechner/pi-coding-agent";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (this.mode === "normal") {
      // Handle vim normal mode keys...
      if (data === "i") { this.mode = "insert"; return; }
    }
    super.handleInput(data);  // App keybindings + text editing
  }
}

ctx.ui.setEditorComponent((tui, theme, keybindings) =>
  new VimEditor(tui, theme, keybindings)
);

// Restore default
ctx.ui.setEditorComponent(undefined);
```

## Has UI Check

In print/RPC mode, some UI methods are no-ops:

```typescript
if (ctx.hasUI) {
  // Safe to show dialogs
  const choice = await ctx.ui.select("Pick:", ["A", "B"]);
}
```

In RPC mode, dialog methods work via the extension UI sub-protocol. Some TUI-specific methods are no-ops.
