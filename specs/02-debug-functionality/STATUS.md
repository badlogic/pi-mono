# Debug Functionality Implementation Status

**Generated:** 2026-03-07
**Spec Reference:** `../debug-functionality-implementation.md`

## Summary

| Component | Status | Priority |
|-----------|--------|----------|
| `core/debug/index.ts` | ❌ Not implemented | Phase 4 |
| `core/debug/log-formatting.ts` | ❌ Not implemented | Phase 3 |
| `core/debug/log-viewer.ts` | ❌ Not implemented | Phase 3 |
| `core/debug/profiler.ts` | ❌ Not implemented | Phase 1 |
| `core/debug/report-bundle.ts` | ❌ Not implemented | Phase 2 |
| `core/debug/system-info.ts` | ❌ Not implemented | Phase 1 |
| `utils/format.ts` | ❌ Not implemented | Phase 1 |
| `config.ts` additions | ❌ Not implemented | Phase 1 |
| `tar` npm package | ❌ Not in dependencies | Phase 1 |
| Integration with interactive mode | ⚠️ Partial (minimal) | Phase 4 |

**Current State:** Only a minimal `/debug` command exists that dumps TUI render output to a file. The full interactive debug menu with profiling, log viewing, and report bundles does not exist.

---

## Detailed Component Analysis

### 1. `packages/coding-agent/src/core/debug/index.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- `DebugSelectorComponent` - Main interactive menu with SelectList
- Menu items for all debug options:
  - Open artifact folder
  - Performance report (CPU profiling)
  - Dump session (immediate bundle)
  - Memory report (heap snapshot)
  - View recent logs
  - View system info
  - Export TUI transcript
  - Clear artifact cache
- Integration with `InteractiveModeContext`
- Handlers for each menu action
- `showDebugSelector()` function to mount the component

**Spec location:** Section 8 - Main Debug Selector

---

### 2. `packages/coding-agent/src/core/debug/log-formatting.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- `formatDebugLogLine(line, maxWidth)` - Sanitize and truncate log lines
- `formatDebugLogExpandedLines(line, maxWidth)` - Wrap text for expanded view
- `parseDebugLogTimestampMs(line)` - Extract timestamp from JSON log
- `parseDebugLogPid(line)` - Extract PID from JSON log
- Helper functions:
  - `sanitizeText()` - Remove control characters
  - `wrapText()` - Simple text wrapping

**Dependencies:**
- `replaceTabs`, `truncateToWidth` from `../tools/render-utils.js` (needs verification)

**Spec location:** Section 5 - Log Formatting

---

### 3. `packages/coding-agent/src/core/debug/log-viewer.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- Full TUI component `DebugLogViewerComponent`
- Model/view separation for log data
- Cursor navigation and selection
- Text filtering
- Process ID filtering
- Log expansion
- Loading older logs
- Copy to clipboard functionality

**Dependencies:**
- `@mariozechner/pi-tui` components (Container, SelectList, Text, etc.)
- `../../utils/clipboard.js` for clipboard support
- `./log-formatting.js` for parsing

**Challenges:**
- Complex component requiring port from oh-my-pi
- Need to replace `@oh-my-pi/pi-natives` with Node.js equivalents
- `wrapTextWithAnsi` needs implementation

**Spec location:** Section 7 - Log Viewer

---

### 4. `packages/coding-agent/src/core/debug/profiler.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- `CpuProfile` interface
- `ProfilerSession` interface  
- `startCpuProfile()` - Start CPU profiling session using `node:inspector/promises`
- `ProfilerSession.stop()` - Stop and return profile data + markdown summary
- `generateHeapSnapshotData()` - Create heap snapshot using `node:v8`
- `formatProfileAsMarkdown()` - Convert CPU profile to readable summary

**Dependencies:**
- `node:inspector/promises` (Session class)
- `node:v8` (writeHeapSnapshot)

**Notes:**
- Node.js `v8.writeHeapSnapshot()` writes to a file (returns path), unlike Bun's `generateHeapSnapshot()` which returns data directly
- `global.gc()` requires `--expose-gc` flag for forced GC before heap snapshot

**Spec location:** Section 4 - Profiler

---

### 5. `packages/coding-agent/src/core/debug/report-bundle.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- `ReportBundleOptions` interface
- `ReportBundleResult` interface
- `DebugLogSource` interface
- `createReportBundle(options)` - Create tar.gz with all debug data
- `createDebugLogSource()` - Factory for log source with older log loading
- `getLogText()` - Read recent log lines
- `getArtifactCacheStats()` - Count artifacts and size
- `clearArtifactCache()` - Remove old artifacts
- Helper functions:
  - `readLastLines()` - Efficient tail-like file reading
  - `addDirectoryToArchive()` - Add directory contents to bundle
  - `addSubagentSessions()` - Include subagent data

**Dependencies:**
- `tar` npm package (NOT INSTALLED)
- `node:fs/promises`
- `node:path`
- `../../config.js` (getLogPath, getLogsDir, getReportsDir - ALSO NOT IMPLEMENTED)
- `./profiler.js` (CpuProfile, HeapSnapshot types)
- `./system-info.js` (collectSystemInfo, sanitizeEnv)

**Spec location:** Section 6 - Report Bundle

---

### 6. `packages/coding-agent/src/core/debug/system-info.ts`

**Status:** ❌ Does not exist

**What needs to be implemented:**
- `SystemInfo` interface
- `collectSystemInfo()` - Gather OS, CPU, memory, versions, shell, terminal info
- `formatSystemInfo(info)` - Format as readable text
- `sanitizeEnv(env)` - Redact sensitive environment variables
- `macosMarketingName(release)` - Map macOS version to marketing name

**Dependencies:**
- `node:os`
- `../../utils/format.js` (formatBytes - ALSO NOT IMPLEMENTED)
- `../../config.js` (APP_NAME, VERSION)

**Spec location:** Section 3 - System Info Collection

---

### 7. `packages/coding-agent/src/utils/format.ts`

**Status:** ❌ Does not exist (utils folder exists but no format.ts)

**What needs to be implemented:**
```typescript
export function formatBytes(bytes: number): string {
  // Convert bytes to human-readable (B, KB, MB, GB)
}

export function formatDuration(ms: number): string {
  // Convert milliseconds to human-readable (Xs, Xm Xs, Xh Xm)
}
```

**Dependencies:** None (standalone utilities)

**Spec location:** Section 2 - Utility Functions

---

### 8. `packages/coding-agent/src/config.ts` Additions

**Status:** ❌ Not implemented (file exists but missing required functions)

**Existing functions in config.ts:**
- `getAgentDir()` ✅
- `getSessionsDir()` ✅
- `getDebugLogPath()` ✅ (different from spec's getLogPath)

**Missing functions to add:**
```typescript
/** Get path to logs directory */
export function getLogsDir(): string {
  return join(getAgentDir(), "logs");
}

/** Get path to current log file (YYYY-MM-DD format) */
export function getLogPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return join(getLogsDir(), `${APP_NAME}.${today}.log`);
}

/** Get path to reports directory */
export function getReportsDir(): string {
  return join(getAgentDir(), "reports");
}
```

**Notes:**
- The existing `getDebugLogPath()` returns `{agent-dir}/pi-debug.log` (single file for TUI debug output)
- The spec's `getLogPath()` returns dated log files in a logs subdirectory
- These serve different purposes and should coexist

**Spec location:** Section 1 - Config Additions

---

### 9. `tar` npm package

**Status:** ❌ Not in dependencies

**Current package.json dependencies:** (relevant ones)
- `@mariozechner/pi-tui`
- `chalk`, `cli-highlight`, `diff`, `extract-zip`, `glob`, etc.

**Required addition:**
```json
{
  "dependencies": {
    "tar": "^7.0.0"
  },
  "devDependencies": {
    "@types/tar": "^7.0.0"
  }
}
```

**Notes:**
- Spec recommends `tar` npm package for cross-platform tar.gz creation
- Alternative: `archiver` package, but `tar` is simpler for this use case

---

### 10. Integration with Interactive Mode

**Status:** ⚠️ Partial - minimal implementation exists

**Current implementation:** (`interactive-mode.ts` line 4413-4439)
```typescript
private handleDebugCommand(): void {
  // Dumps TUI render output to debug log file
  // No interactive menu
  // No profiling
  // No log viewer
  // No report bundles
}
```

**What needs to change:**
- Replace current `handleDebugCommand()` to call `showDebugSelector()`
- Import debug module: `import { showDebugSelector } from "../../core/debug/index.js"`
- Mount selector component in editor container
- Handle cleanup when selector closes

**Spec location:** Section 9 - Integration with Interactive Mode

---

## Implementation Order

Based on the spec's phased approach:

### Phase 1: Core Infrastructure
1. ✅ Create `specs/02-debug-functionality/` folder
2. ❌ Add path functions to `config.ts`
3. ❌ Create `utils/format.ts`
4. ❌ Create `core/debug/system-info.ts`
5. ❌ Create `core/debug/profiler.ts`
6. ❌ Add `tar` package dependency

### Phase 2: Report Bundle
7. ❌ Create `core/debug/report-bundle.ts`
8. ❌ Test report bundle creation

### Phase 3: Log Viewer
9. ❌ Create `core/debug/log-formatting.ts`
10. ❌ Create `core/debug/log-viewer.ts`

### Phase 4: Debug Menu
11. ❌ Create `core/debug/index.ts`
12. ❌ Integrate with interactive mode

### Phase 5: Testing & Polish
13. ❌ Add unit tests
14. ❌ Manual testing
15. ❌ Documentation updates

---

## Open Questions

1. **Log format compatibility:** Does pi-mono's logging output JSON with `timestamp` and `pid` fields as expected by the log viewer?

2. **Clipboard utility:** Does `utils/clipboard.ts` have a working `copyToClipboard()` function for all platforms?

3. **File opening utility:** Is there an `openPath()` utility for opening files/URLs cross-platform? (Needed for "Open artifact folder" option)

4. **render-utils dependency:** Do `replaceTabs` and `truncateToWidth` exist in `../tools/render-utils.js` for log formatting?

---

## Files to Create/Modify

### New Files (6 files)
- `packages/coding-agent/src/core/debug/index.ts`
- `packages/coding-agent/src/core/debug/log-formatting.ts`
- `packages/coding-agent/src/core/debug/log-viewer.ts`
- `packages/coding-agent/src/core/debug/profiler.ts`
- `packages/coding-agent/src/core/debug/report-bundle.ts`
- `packages/coding-agent/src/core/debug/system-info.ts`
- `packages/coding-agent/src/utils/format.ts`

### Modified Files (2 files)
- `packages/coding-agent/src/config.ts` - Add getLogsDir, getLogPath, getReportsDir
- `packages/coding-agent/package.json` - Add tar dependency
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` - Replace handleDebugCommand

---

## Estimated Effort

| Component | Complexity | Estimated Lines |
|-----------|------------|-----------------|
| config.ts additions | Low | ~15 lines |
| utils/format.ts | Low | ~25 lines |
| system-info.ts | Medium | ~100 lines |
| profiler.ts | Medium | ~150 lines |
| report-bundle.ts | High | ~250 lines |
| log-formatting.ts | Low | ~60 lines |
| log-viewer.ts | Very High | ~500+ lines |
| index.ts (debug menu) | High | ~300 lines |
| **Total** | | **~1400 lines** |
