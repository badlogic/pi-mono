# Debug Module Integration - Implementation Status Report

**Generated:** 2026-03-07
**Spec File:** `./specs/debug-module-integration.md`

## Summary

The debug module integration is **NOT STARTED**. The current implementation only has a minimal `handleDebugCommand()` that dumps TUI render data to a file. None of the planned debug module components have been implemented.

---

## Integration Points Status

### 1. InteractiveMode Integration

**Status:** ❌ NOT IMPLEMENTED (minimal stub exists)

**Current Implementation:**
- Location: `src/modes/interactive/interactive-mode.ts` (lines 4413-4446)
- The existing `handleDebugCommand()` only:
  - Captures TUI render output with visible widths
  - Dumps agent messages as JSONL
  - Writes to `~/.pi/agent/pi-debug.log`
  - Shows a simple confirmation message

**What's Missing (per spec):**
- Integration with `showDebugSelector()` component
- `handleDebugTranscriptCommand()` method
- Debug menu UI with 8 options:
  1. Open artifact folder
  2. Report: performance issue (CPU profile)
  3. Report: dump session
  4. Report: memory issue (heap snapshot)
  5. View: recent logs
  6. View: system info
  7. Export: TUI transcript
  8. Clear: artifact cache

---

### 2. DebugSelectorComponent

**Status:** ❌ NOT IMPLEMENTED

**Location:** Should be `src/core/debug/index.ts`

**Missing Components:**
- `DebugSelectorComponent` class
- `showDebugSelector()` function
- Menu options for all 8 debug features
- Integration with profiler, log viewer, system info

**Related Files That Don't Exist:**
- `src/core/debug/index.ts` - Debug menu component
- `src/core/debug/log-viewer.ts` - Interactive log viewer (~800 lines)
- `src/core/debug/log-formatting.ts` - Log text utilities
- `src/core/debug/profiler.ts` - CPU/heap profiling
- `src/core/debug/report-bundle.ts` - Report bundle creation
- `src/core/debug/system-info.ts` - System diagnostics

---

### 3. Utility Functions

**Status:** ❌ NOT IMPLEMENTED

**Location:** Should be `src/utils/format.ts` (file doesn't exist)

| Function | Spec Description | Status |
|----------|------------------|--------|
| `formatBytes(bytes)` | Human-readable bytes (0 B, 1.0 KB, etc.) | ❌ Missing |
| `sanitizeText(text)` | Replace control chars with safe alternatives | ❌ Missing |
| `padding(width)` | Create padding string | ❌ Missing |
| `replaceTabs(text, tabWidth)` | Replace tabs with spaces (default 3) | ❌ Missing (partial in diff.ts) |

**Note:** A local `replaceTabs` exists in `src/modes/interactive/components/diff.ts` (lines 17-19) but it's not exported/shared.

**External Dependencies (Available):**
- `wrapTextWithAnsi` - Available from `@mariozechner/pi-tui`
- `truncateToWidth` - Available from `@mariozechner/pi-tui`
- `visibleWidth` - Available from `@mariozechner/pi-tui`
- `copyToClipboard` - Available from `../../utils/clipboard.js`

---

### 4. Config Additions

**Status:** ❌ NOT IMPLEMENTED

**Location:** `src/config.ts`

| Function | Spec Description | Status |
|----------|------------------|--------|
| `getLogsDir()` | Path to logs directory (`~/.pi/agent/logs/`) | ❌ Missing |
| `getReportsDir()` | Path to debug reports (`~/.pi/agent/reports/`) | ❌ Missing |
| `getLogPath()` | Path to today's dated log file | ❌ Missing |
| `getAgentDbPath()` | Path to agent database | ❌ Missing (not in spec?) |
| `isEnoent(err)` | Check if error is ENOENT | ❌ Missing |

**Existing Functions (can be used):**
- `getDebugLogPath()` - Returns `~/.pi/agent/pi-debug.log` (single file, legacy)
- `getSessionsDir()` - Returns `~/.pi/agent/sessions/`
- `getAgentDir()` - Returns `~/.pi/agent/`
- `APP_NAME`, `VERSION` - Available constants

---

## File Structure Status

### Current Structure
```
packages/coding-agent/src/
├── config.ts                    ✓ Exists (needs additions)
├── utils/
│   ├── clipboard.ts             ✓ Exists (copyToClipboard available)
│   ├── format.ts                ✗ MISSING - needs creation
│   └── ...
└── modes/interactive/
    └── interactive-mode.ts      ✓ Exists (needs handleDebugCommand update)
```

### Target Structure (per spec)
```
packages/coding-agent/src/
├── core/
│   └── debug/
│       ├── index.ts             ✗ MISSING - DebugSelectorComponent
│       ├── log-formatting.ts    ✗ MISSING
│       ├── log-viewer.ts        ✗ MISSING (~800 lines)
│       ├── profiler.ts          ✗ MISSING
│       ├── report-bundle.ts     ✗ MISSING
│       └── system-info.ts       ✗ MISSING
├── config.ts                    ⚠️ Needs additions
└── utils/
    └── format.ts                ✗ MISSING
```

---

## Dependencies Mapping

| oh-my-pi Source | pi-mono Target | Status |
|-----------------|----------------|--------|
| `@oh-my-pi/pi-natives.sanitizeText()` | `utils/format.ts` | ❌ Need to create |
| `@oh-my-pi/pi-natives.wrapTextWithAnsi()` | `@mariozechner/pi-tui/utils` | ✓ Available |
| `@oh-my-pi/pi-natives.copyToClipboard()` | `utils/clipboard.ts` | ✓ Available |
| `@oh-my-pi/pi-utils.getSessionsDir()` | `config.getSessionsDir` | ✓ Available |
| `@oh-my-pi/pi-utils.getLogsDir()` | `config.getLogsDir` | ❌ Need to create |
| `@oh-my-pi/pi-utils.getReportsDir()` | `config.getReportsDir` | ❌ Need to create |
| `@oh-my-pi/pi-utils.formatBytes()` | `utils/format.ts` | ❌ Need to create |
| `@oh-my-pi/pi-utils.VERSION` | `config.VERSION` | ✓ Available |
| `@oh-my-pi/pi-utils.APP_NAME` | `config.APP_NAME` | ✓ Available |
| `@oh-my-pi/pi-tui` | `@mariozechner/pi-tui` | ✓ Available |

---

## Implementation Phases (per spec)

### Phase 1: Add Missing Utilities
- [ ] Create `src/utils/format.ts` with `formatBytes`, `sanitizeText`, `padding`, `replaceTabs`
- [ ] Add `getLogsDir()`, `getReportsDir()`, `getLogPath()`, `isEnoent()` to `config.ts`

### Phase 2: Port Debug Module Files
- [ ] `src/core/debug/system-info.ts` - System diagnostics
- [ ] `src/core/debug/log-formatting.ts` - Log text utilities
- [ ] `src/core/debug/profiler.ts` - CPU/heap profiling
- [ ] `src/core/debug/report-bundle.ts` - Report bundle creation
- [ ] `src/core/debug/log-viewer.ts` - Interactive log viewer (~800 lines)
- [ ] `src/core/debug/index.ts` - DebugSelectorComponent + menu

### Phase 3: Integration with Interactive Mode
- [ ] Update `handleDebugCommand()` to use debug selector
- [ ] Add `handleDebugTranscriptCommand()` method
- [ ] Create `utils/open.ts` for `openPath()` utility

### Phase 4: Testing
- [ ] Create `test/debug-module.test.ts`
- [ ] Manual testing checklist for all 8 menu options

### Phase 5: Documentation
- [ ] Update README.md with debug tools section

---

## Risk Areas

1. **Log Viewer Complexity** - The `log-viewer.ts` is ~800 lines with complex state management
2. **Profiler Dependencies** - Uses Node.js inspector API which may have Bun compatibility issues
3. **Archive Writing** - Report bundle uses `Bun.Archive.write()` which is Bun-specific

---

## Notes

- The spec mentions `getAgentDbPath()` but it's not documented in the spec's config section - may need clarification
- The `replaceTabs` in diff.ts uses 3 spaces; spec says default should be 3, so that's consistent
- Work profile feature is explicitly skipped (requires native bindings not in pi-mono)
