# Pi Reader Browser Extension

A cross-browser extension that provides an AI-powered reading assistant in a side panel (Chrome/Edge) or sidebar (Firefox), built with mini-lit components and Tailwind CSS v4.

## Browser Support

- **Chrome/Edge** - Uses Side Panel API (Manifest V3)
- **Firefox** - Uses Sidebar Action API (Manifest V3)
- **Opera** - Sidebar support (untested but should work with Firefox manifest)

## Architecture

The extension adapts to each browser's UI paradigm:
- **Chrome/Edge** - Side Panel API for dedicated panel UI
- **Firefox** - Sidebar Action API for sidebar UI
- **Direct API Access** - Both can call AI APIs directly (no background worker needed)
- **Page Content Access** - Uses `chrome.scripting.executeScript` to extract page text

## Understanding mini-lit

Before working on the UI, read these files to understand the component library:

- `node_modules/@mariozechner/mini-lit/README.md` - Complete component documentation
- `node_modules/@mariozechner/mini-lit/llms.txt` - LLM-friendly component reference
- `node_modules/@mariozechner/mini-lit/dist/*.ts` - Source files for specific components

Key concepts:
- **Functional Components** - Stateless functions that return `TemplateResult` (Button, Badge, etc.)
- **Custom Elements** - Stateful LitElement classes (`<theme-toggle>`, `<markdown-block>`, etc.)
- **Reactive State** - Use `createState()` for reactive UI updates
- **Claude Theme** - We use the Claude theme from mini-lit

## Project Structure

```
packages/browser-extension/
├── src/
│   ├── app.css                 # Tailwind v4 entry point with Claude theme
│   ├── background.ts           # Service worker for opening side panel
│   ├── sidepanel.html          # Side panel HTML entry point
│   └── sidepanel.ts            # Main side panel app with hot reload
├── scripts/
│   ├── build.mjs               # esbuild bundler configuration
│   └── dev-server.mjs          # WebSocket server for hot reloading
├── manifest.chrome.json        # Chrome/Edge manifest
├── manifest.firefox.json       # Firefox manifest
├── icon-*.png                  # Extension icons
├── dist-chrome/                # Chrome build (git-ignored)
└── dist-firefox/               # Firefox build (git-ignored)
```

## Development Setup

### Prerequisites
1. Install dependencies from monorepo root:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   # Build for both browsers
   npm run build -w @mariozechner/pi-reader-extension

   # Or build for specific browser
   npm run build:chrome -w @mariozechner/pi-reader-extension
   npm run build:firefox -w @mariozechner/pi-reader-extension
   ```

3. Load the extension:

   **Chrome/Edge:**
   - Open `chrome://extensions/` or `edge://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/browser-extension/dist-chrome/`

   **Firefox:**
   - Open `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select any file in `packages/browser-extension/dist-firefox/`

### Development Workflow

1. **Start the dev server** (from monorepo root):
   ```bash
   # For Chrome development
   npm run dev -w @mariozechner/pi-reader-extension

   # For Firefox development
   npm run dev:firefox -w @mariozechner/pi-reader-extension
   ```

   This runs three processes in parallel:
   - **esbuild** - Watches and rebuilds TypeScript files
   - **Tailwind CSS v4** - Watches and rebuilds styles
   - **WebSocket server** - Watches dist/ and triggers extension reload

2. **Automatic reloading**:
   - Any change to source files triggers a rebuild
   - The WebSocket server detects dist/ changes
   - Side panel connects to `ws://localhost:8765`
   - Extension auto-reloads via `chrome.runtime.reload()`

3. **Open the side panel**:
   - Click the extension icon in Chrome toolbar
   - Or use Chrome's side panel button (top-right)

## Key Files

### `src/sidepanel.ts`
Main application logic:
- Extracts page content via `chrome.scripting.executeScript`
- Manages chat UI with mini-lit components
- Handles WebSocket connection for hot reload
- Direct AI API calls (no background worker needed)

### `src/app.css`
Tailwind v4 configuration:
- Imports Claude theme from mini-lit
- Uses `@source` directive to scan mini-lit components
- Compiled to `dist/app.css` during build

### `scripts/build.mjs`
Build configuration:
- Uses esbuild for fast TypeScript bundling
- Copies static files (HTML, manifest, icons)
- Supports watch mode for development

### `scripts/dev-server.mjs`
Hot reload server:
- WebSocket server on port 8765
- Watches `dist/` directory for changes
- Sends reload messages to connected clients

## Working with mini-lit Components

### Basic Usage
Read `../../mini-lit/llms.txt` and `../../mini-lit/README.md` in full. If in doubt, find the component in `../../mini-lit/src/` and read its source file in full.

### Tailwind Classes
All standard Tailwind utilities work, plus mini-lit's theme variables:
- `bg-background`, `text-foreground` - Theme-aware colors
- `bg-card`, `border-border` - Component backgrounds
- `text-muted-foreground` - Secondary text
- `bg-primary`, `text-primary-foreground` - Primary actions

## Troubleshooting

### Extension doesn't reload automatically
- Check WebSocket server is running (port 8765)
- Check console for connection errors
- Manually reload at `chrome://extensions/`

### Side panel doesn't open
- Check manifest permissions
- Ensure background service worker is loaded
- Try clicking extension icon directly

### Styles not updating
- Ensure Tailwind watcher is running
- Check `src/app.css` imports
- Clear Chrome extension cache

## Building for Production

```bash
npm run build -w @mariozechner/pi-reader-extension
```

This creates an optimized build in `dist/` without hot reload code.