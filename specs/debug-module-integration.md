# Debug Module Integration Plan

Integrate the oh-my-pi debug module into pi-mono, providing debugging tools, bug report generation, and system diagnostics.

## Problem Statement

pi-mono lacks a comprehensive debugging toolkit. The current `handleDebugCommand()` in interactive-mode.ts only dumps TUI render data to a file. The oh-my-pi debug module provides:

1. Interactive debug menu with multiple options
2. Log viewer with filtering, pagination, and selection
3. CPU profiling via V8 inspector API
4. Heap snapshots for memory analysis
5. Report bundle creation (tar.gz with session, logs, system info, profiles)
6. System information collection
7. Artifact cache management

## Objectives

- Port all debug module functionality to pi-mono
- Adapt code to pi-mono's architecture and naming conventions
- Provide keyboard-accessible debug menu in interactive mode
- Skip work profile feature (requires native bindings not in pi-mono)

## Architecture

### Directory Structure

```
packages/coding-agent/src/
├── core/
│   └── debug/
│       ├── index.ts           # DebugSelectorComponent + menu
│       ├── log-formatting.ts  # Log text utilities
│       ├── log-viewer.ts      # Interactive log viewer component
│       ├── profiler.ts        # CPU/heap profiling
│       ├── report-bundle.ts   # Report bundle creation
│       └── system-info.ts     # System diagnostics
├── config.ts                  # Add getLogsDir(), getReportsDir()
└── utils/
    └── format.ts              # Add formatBytes(), sanitizeText()
```

### Dependencies Mapping

| oh-my-pi | pi-mono Equivalent |
|----------|-------------------|
| `@oh-my-pi/pi-natives.getWorkProfile()` | **SKIP** - no native bindings |
| `@oh-my-pi/pi-natives.sanitizeText()` | Create in `utils/format.ts` |
| `@oh-my-pi/pi-natives.wrapTextWithAnsi()` | `@mariozechner/pi-tui/utils.wrapTextWithAnsi` |
| `@oh-my-pi/pi-natives.copyToClipboard()` | `utils/clipboard.ts.copyToClipboard` |
| `@oh-my-pi/pi-utils.getSessionsDir()` | `config.getSessionsDir` |
| `@oh-my-pi/pi-utils.getLogPath()` | `config.getDebugLogPath` (adapt) |
| `@oh-my-pi/pi-utils.getLogsDir()` | Create in `config.ts` |
| `@oh-my-pi/pi-utils.getReportsDir()` | Create in `config.ts` |
| `@oh-my-pi/pi-utils.formatBytes()` | Create in `utils/format.ts` |
| `@oh-my-pi/pi-utils.VERSION` | `config.VERSION` |
| `@oh-my-pi/pi-utils.APP_NAME` | `config.APP_NAME` |
| `@oh-my-pi/pi-tui` | `@mariozechner/pi-tui` |

## Implementation Steps

### Phase 1: Add Missing Utilities

#### 1.1 Add Path Utilities to config.ts

Add to `packages/coding-agent/src/config.ts`:

```typescript
/** Get path to logs directory */
export function getLogsDir(): string {
	return join(getAgentDir(), "logs");
}

/** Get path to debug reports directory */
export function getReportsDir(): string {
	return join(getAgentDir(), "reports");
}
```

Modify `getDebugLogPath()` to use dated log files:

```typescript
/** Get path to today's log file */
export function getLogPath(): string {
	const today = new Date().toISOString().slice(0, 10);
	return join(getLogsDir(), `${APP_NAME}.${today}.log`);
}

/** Get path to debug log file (single file, legacy) */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
```

Add `isEnoent` helper:

```typescript
export function isEnoent(err: unknown): boolean {
	return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}
```

#### 1.2 Create utils/format.ts

Create `packages/coding-agent/src/utils/format.ts`:

```typescript
/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	while (bytes >= 1024 && i < units.length - 1) {
		bytes /= 1024;
		i++;
	}
	return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Sanitize text by replacing control characters with safe alternatives.
 * Replaces null bytes, control chars (except newline/tab), and other
 * problematic characters for safe display.
 */
export function sanitizeText(text: string): string {
	let result = "";
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		// Keep newlines, tabs, and printable chars
		if (code === 0x0a || code === 0x0d || code === 0x09) {
			result += text[i];
		} else if (code < 0x20 || code === 0x7f) {
			// Replace control chars with space
			result += " ";
		} else {
			result += text[i];
		}
	}
	return result;
}

/**
 * Create padding string of specified width.
 */
export function padding(width: number): string {
	return " ".repeat(Math.max(0, width));
}

/**
 * Replace tabs with spaces.
 */
export function replaceTabs(text: string, tabWidth = 3): string {
	return text.replace(/\t/g, " ".repeat(tabWidth));
}
```

### Phase 2: Port Debug Module Files

#### 2.1 system-info.ts

Port from oh-my-pi with these changes:
- Import `formatBytes`, `VERSION`, `APP_NAME` from pi-mono locations
- Remove `getProjectDir()` dependency, use `process.cwd()` instead

```typescript
// packages/coding-agent/src/core/debug/system-info.ts

import * as os from "node:os";
import { formatBytes } from "../../utils/format.js";
import { APP_NAME, VERSION } from "../../config.js";

export interface SystemInfo {
	os: string;
	arch: string;
	cpu: string;
	memory: {
		total: number;
		free: number;
	};
	versions: {
		app: string;
		bun: string;
		node: string;
	};
	cwd: string;
	shell: string;
	terminal: string | undefined;
}

function macosMarketingName(release: string): string | undefined {
	const major = Number.parseInt(release.split(".")[0] ?? "", 10);
	if (Number.isNaN(major)) return undefined;
	const names: Record<number, string> = {
		25: "Tahoe",
		24: "Sequoia",
		23: "Sonoma",
		22: "Ventura",
		21: "Monterey",
		20: "Big Sur",
	};
	return names[major];
}

export async function collectSystemInfo(): Promise<SystemInfo> {
	const cpus = os.cpus();
	const cpuModel = cpus[0]?.model ?? "Unknown CPU";
	const shell = Bun.env.SHELL ?? Bun.env.ComSpec ?? "unknown";
	const terminal = Bun.env.TERM_PROGRAM ?? Bun.env.TERM ?? undefined;

	let osStr = `${os.type()} ${os.release()} (${os.platform()})`;
	if (os.platform() === "darwin") {
		const name = macosMarketingName(os.release());
		if (name) osStr = `${osStr} ${name}`;
	}

	return {
		os: osStr,
		arch: os.arch(),
		cpu: cpuModel,
		memory: {
			total: os.totalmem(),
			free: os.freemem(),
		},
		versions: {
			app: VERSION,
			bun: Bun.version,
			node: process.version,
		},
		cwd: process.cwd(),
		shell,
		terminal,
	};
}

export function formatSystemInfo(info: SystemInfo): string {
	const lines = [
		"System Information",
		"━━━━━━━━━━━━━━━━━━",
		`OS:      ${info.os}`,
		`Arch:    ${info.arch}`,
		`CPU:     ${info.cpu}`,
		`Memory:  ${formatBytes(info.memory.total)} (${formatBytes(info.memory.free)} free)`,
		`Bun:     ${info.versions.bun}`,
		`App:     ${APP_NAME} ${info.versions.app}`,
		`Node:    ${info.versions.node} (compat)`,
		`CWD:     ${info.cwd}`,
		`Shell:   ${info.shell}`,
	];
	if (info.terminal) {
		lines.push(`Terminal: ${info.terminal}`);
	}
	return lines.join("\n");
}

export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
	const SENSITIVE_PATTERNS = [/key/i, /secret/i, /token/i, /pass/i, /auth/i, /credential/i, /api/i, /private/i];
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		const isSensitive = SENSITIVE_PATTERNS.some(p => p.test(k));
		result[k] = isSensitive ? "[REDACTED]" : v;
	}
	return result;
}
```

#### 2.2 log-formatting.ts

Port with pi-mono imports:

```typescript
// packages/coding-agent/src/core/debug/log-formatting.ts

import { wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { sanitizeText, replaceTabs } from "../../utils/format.js";
import { truncateToWidth } from "@mariozechner/pi-tui";

export function formatDebugLogLine(line: string, maxWidth: number): string {
	const sanitized = sanitizeText(line);
	const normalized = replaceTabs(sanitized);
	const width = Math.max(1, maxWidth);
	return truncateToWidth(normalized, width);
}

export function formatDebugLogExpandedLines(line: string, maxWidth: number): string[] {
	const sanitized = sanitizeText(line);
	const normalized = replaceTabs(sanitized);
	const width = Math.max(1, maxWidth);
	if (normalized.length === 0) {
		return [""];
	}
	return normalized.split("\n").flatMap(segment => wrapTextWithAnsi(segment, width));
}

export function parseDebugLogTimestampMs(line: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object") return undefined;
		const timestamp = (parsed as { timestamp?: unknown }).timestamp;
		if (typeof timestamp !== "string") return undefined;
		const timestampMs = Date.parse(timestamp);
		return Number.isFinite(timestampMs) ? timestampMs : undefined;
	} catch {
		return undefined;
	}
}

export function parseDebugLogPid(line: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object") return undefined;
		const pid = (parsed as { pid?: unknown }).pid;
		if (typeof pid !== "number") return undefined;
		return Number.isFinite(pid) ? pid : undefined;
	} catch {
		return undefined;
	}
}
```

#### 2.3 profiler.ts

Port directly (uses only Node.js built-ins and Bun):

```typescript
// packages/coding-agent/src/core/debug/profiler.ts

/**
 * CPU and heap profiling wrappers for debug reports.
 */

export interface CpuProfile {
	data: string;
	markdown: string;
}

export interface ProfilerSession {
	stop(): Promise<CpuProfile>;
}

interface CpuProfileNode {
	id: number;
	callFrame?: {
		functionName?: string;
		url?: string;
		lineNumber?: number;
	};
	hitCount?: number;
	children?: number[];
}

interface CpuProfileData {
	nodes?: CpuProfileNode[];
	samples?: number[];
	timeDeltas?: number[];
	startTime?: number;
	endTime?: number;
}

function formatProfileAsMarkdown(profileJson: string): string {
	try {
		const profile = JSON.parse(profileJson) as CpuProfileData;
		const nodes = profile.nodes ?? [];

		interface NodeInfo {
			id: number;
			functionName: string;
			url: string;
			lineNumber: number;
			selfTime: number;
			hitCount: number;
		}

		const nodeMap = new Map<number, NodeInfo>();
		for (const node of nodes) {
			nodeMap.set(node.id, {
				id: node.id,
				functionName: node.callFrame?.functionName ?? "(anonymous)",
				url: node.callFrame?.url ?? "",
				lineNumber: node.callFrame?.lineNumber ?? 0,
				selfTime: 0,
				hitCount: node.hitCount ?? 0,
			});
		}

		const samples = profile.samples ?? [];
		const timeDeltas = profile.timeDeltas ?? [];
		for (let i = 0; i < samples.length; i++) {
			const nodeId = samples[i];
			const info = nodeId !== undefined ? nodeMap.get(nodeId) : undefined;
			const delta = timeDeltas[i] ?? 0;
			if (info) {
				info.selfTime += delta;
			}
		}

		const sorted = Array.from(nodeMap.values())
			.filter(n => n.selfTime > 0 && n.functionName !== "(root)" && n.functionName !== "(idle)")
			.sort((a, b) => b.selfTime - a.selfTime)
			.slice(0, 30);

		if (sorted.length === 0) {
			return "# CPU Profile Summary\n\nNo significant CPU activity recorded.";
		}

		const totalTime = sorted.reduce((sum, n) => sum + n.selfTime, 0);
		const lines = ["# CPU Profile Summary", "", `Total profiled time: ${(totalTime / 1000).toFixed(1)}ms`, "", "## Top Functions by Self Time", "", "| Function | Self Time (ms) | % | Location |", "|----------|----------------|---|----------|"];

		for (const node of sorted) {
			const selfMs = (node.selfTime / 1000).toFixed(1);
			const pct = ((node.selfTime / totalTime) * 100).toFixed(1);
			const location = node.url ? `${node.url}:${node.lineNumber}` : "-";
			lines.push(`| ${node.functionName} | ${selfMs} | ${pct}% | ${location} |`);
		}

		return lines.join("\n");
	} catch {
		return "# CPU Profile Summary\n\nFailed to parse profile data.";
	}
}

export async function startCpuProfile(): Promise<ProfilerSession> {
	const v8 = await import("node:v8");
	v8.setFlagsFromString("--allow-natives-syntax");

	const { Session } = await import("node:inspector/promises");
	const session = new Session();
	session.connect();

	await session.post("Profiler.enable");
	await session.post("Profiler.start");

	return {
		async stop(): Promise<CpuProfile> {
			const result = await session.post("Profiler.stop");
			await session.post("Profiler.disable");
			session.disconnect();

			const data = JSON.stringify(result.profile, null, 2);
			const markdown = formatProfileAsMarkdown(data);

			return { data, markdown };
		},
	};
}

export interface HeapSnapshot {
	data: string;
}

export function generateHeapSnapshotData(): HeapSnapshot {
	Bun.gc(true);
	const snapshot = Bun.generateHeapSnapshot("v8");
	return { data: snapshot };
}
```

#### 2.4 report-bundle.ts

Port with pi-mono imports:

```typescript
// packages/coding-agent/src/core/debug/report-bundle.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { APP_NAME, getLogPath, getLogsDir, getReportsDir, getSessionsDir, isEnoent } from "../../config.js";
import type { CpuProfile, HeapSnapshot } from "./profiler.js";
import { collectSystemInfo, sanitizeEnv } from "./system-info.js";

const MAX_LOG_LINES = 5000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

async function readLastLines(filePath: string, n: number, maxBytes = MAX_LOG_BYTES): Promise<string> {
	try {
		const file = Bun.file(filePath);
		const size = file.size;
		const start = Math.max(0, size - maxBytes);
		const content = start > 0 ? await file.slice(start, size).text() : await file.text();
		const lines = content.split("\n");
		if (start > 0 && lines.length > 0) {
			lines.shift();
		}
		return lines.slice(-n).join("\n");
	} catch (err) {
		if (isEnoent(err)) return "";
		throw err;
	}
}

export interface ReportBundleOptions {
	sessionFile: string | undefined;
	settings?: Record<string, unknown>;
	cpuProfile?: CpuProfile;
	heapSnapshot?: HeapSnapshot;
}

export interface ReportBundleResult {
	path: string;
	files: string[];
}

export interface DebugLogSource {
	getInitialText(): Promise<string>;
	hasOlderLogs(): boolean;
	loadOlderLogs(limitDays?: number): Promise<string>;
}

export async function createReportBundle(options: ReportBundleOptions): Promise<ReportBundleResult> {
	const reportsDir = getReportsDir();
	await fs.mkdir(reportsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = path.join(reportsDir, `pi-report-${timestamp}.tar.gz`);

	const data: Record<string, string> = {};
	const files: string[] = [];

	// Collect system info
	const systemInfo = await collectSystemInfo();
	data["system.json"] = JSON.stringify(systemInfo, null, 2);
	files.push("system.json");

	// Sanitized environment
	data["env.json"] = JSON.stringify(sanitizeEnv(Bun.env as Record<string, string>), null, 2);
	files.push("env.json");

	// Settings/config
	if (options.settings) {
		data["config.json"] = JSON.stringify(options.settings, null, 2);
		files.push("config.json");
	}

	// Recent logs
	const logPath = getLogPath();
	const logs = await readLastLines(logPath, 1000);
	if (logs) {
		data["logs.txt"] = logs;
		files.push("logs.txt");
	}

	// Session file
	if (options.sessionFile) {
		try {
			const sessionContent = await Bun.file(options.sessionFile).text();
			data["session.jsonl"] = sessionContent;
			files.push("session.jsonl");
		} catch {
			// Session file might not exist yet
		}

		// Artifacts directory
		const artifactsDir = options.sessionFile.slice(0, -6);
		await addDirectoryToArchive(data, files, artifactsDir, "artifacts");

		// Subagent sessions
		const sessionDir = path.dirname(options.sessionFile);
		const sessionBasename = path.basename(options.sessionFile, ".jsonl");
		await addSubagentSessions(data, files, sessionDir, sessionBasename);
	}

	// CPU profile
	if (options.cpuProfile) {
		data["profile.cpuprofile"] = options.cpuProfile.data;
		files.push("profile.cpuprofile");
		data["profile.md"] = options.cpuProfile.markdown;
		files.push("profile.md");
	}

	// Heap snapshot
	if (options.heapSnapshot) {
		data["heap.heapsnapshot"] = options.heapSnapshot.data;
		files.push("heap.heapsnapshot");
	}

	// Write archive
	await Bun.Archive.write(outputPath, data, { compress: "gzip" });

	return { path: outputPath, files };
}

async function addDirectoryToArchive(
	data: Record<string, string>,
	files: string[],
	dirPath: string,
	archivePrefix: string,
): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const filePath = path.join(dirPath, entry.name);
			const archivePath = `${archivePrefix}/${entry.name}`;
			try {
				const content = await Bun.file(filePath).text();
				data[archivePath] = content;
				files.push(archivePath);
			} catch {
				// Skip unreadable files
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

async function addSubagentSessions(
	data: Record<string, string>,
	files: string[],
	sessionDir: string,
	parentBasename: string,
): Promise<void> {
	try {
		const entries = await fs.readdir(sessionDir, { withFileTypes: true });
		const sessionFiles = entries
			.filter(e => e.isFile() && e.name.endsWith(".jsonl") && e.name !== `${parentBasename}.jsonl`)
			.map(e => e.name)
			.sort()
			.slice(-10);

		for (const filename of sessionFiles) {
			const filePath = path.join(sessionDir, filename);
			const archivePath = `subagents/${filename}`;
			try {
				const content = await Bun.file(filePath).text();
				data[archivePath] = content;
				files.push(archivePath);

				const artifactsDir = filePath.slice(0, -6);
				await addDirectoryToArchive(data, files, artifactsDir, `subagents/${filename.slice(0, -6)}`);
			} catch {
				// Skip unreadable files
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

export async function getLogText(): Promise<string> {
	return readLastLines(getLogPath(), MAX_LOG_LINES);
}

const LOG_FILE_PATTERN = new RegExp(`^${APP_NAME}\\.(\\d{4}-\\d{2}-\\d{2})\\.log$`);

export async function createDebugLogSource(): Promise<DebugLogSource> {
	const logsDir = getLogsDir();
	const todayPath = getLogPath();
	const todayName = path.basename(todayPath);
	let olderFiles: string[] = [];

	try {
		const entries = await fs.readdir(logsDir, { withFileTypes: true });
		const datedFiles = entries
			.filter(entry => entry.isFile())
			.map(entry => {
				const match = LOG_FILE_PATTERN.exec(entry.name);
				return match ? { name: entry.name, date: match[1] } : undefined;
			})
			.filter((entry): entry is { name: string; date: string } => entry !== undefined)
			.filter(entry => entry.name !== todayName)
			.sort((a, b) => b.date.localeCompare(a.date));
		olderFiles = datedFiles.map(entry => entry.name);
	} catch {
		olderFiles = [];
	}

	let cursor = 0;

	const getInitialText = async (): Promise<string> => {
		return readLastLines(todayPath, MAX_LOG_LINES);
	};

	const hasOlderLogs = (): boolean => cursor < olderFiles.length;

	const loadOlderLogs = async (limitDays: number = 1): Promise<string> => {
		if (!hasOlderLogs()) return "";
		const count = Math.max(1, limitDays);
		const slice = olderFiles.slice(cursor, cursor + count);
		cursor += slice.length;
		const chunks: string[] = [];

		for (const filename of slice.reverse()) {
			const filePath = path.join(logsDir, filename);
			try {
				const content = await readLastLines(filePath, MAX_LOG_LINES);
				if (content.length > 0) chunks.push(content);
			} catch (err) {
				if (!isEnoent(err)) throw err;
			}
		}
		return chunks.filter(chunk => chunk.length > 0).join("\n");
	};

	return { getInitialText, hasOlderLogs, loadOlderLogs };
}

export async function getArtifactCacheStats(
	sessionsDir: string,
): Promise<{ count: number; totalSize: number; oldestDate: Date | null }> {
	let count = 0;
	let totalSize = 0;
	let oldestDate: Date | null = null;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });
		for (const session of sessions) {
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					const files = await fs.readdir(dirPath);
					for (const file of files) {
						const filePath = path.join(dirPath, file);
						const fileStat = await fs.stat(filePath);
						if (fileStat.isFile()) {
							count++;
							totalSize += fileStat.size;
						}
					}
					if (!oldestDate || stat.mtime < oldestDate) {
						oldestDate = stat.mtime;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { count, totalSize, oldestDate };
}

export async function clearArtifactCache(sessionsDir: string, daysOld: number = 30): Promise<{ removed: number }> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysOld);
	let removed = 0;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });
		for (const session of sessions) {
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					if (stat.mtime < cutoff) {
						await fs.rm(dirPath, { recursive: true, force: true });
						removed++;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { removed };
}
```

#### 2.5 log-viewer.ts

This is a large file (~800 lines). Port with these key changes:
- Replace `@oh-my-pi/pi-tui` with `@mariozechner/pi-tui`
- Replace `@oh-my-pi/pi-natives.copyToClipboard` with `../../utils/clipboard.js.copyToClipboard`
- Replace `@oh-my-pi/pi-natives.sanitizeText` with `../../utils/format.js.sanitizeText`
- Use `truncateToWidth`, `visibleWidth`, `matchesKey` from `@mariozechner/pi-tui`
- Use `padding` from `../../utils/format.js`
- Import `theme` from `../../modes/interactive/theme/theme.js`
- Replace `../tools/render-utils.replaceTabs` with `../../utils/format.js.replaceTabs`

The log viewer component provides:
- Paginated log display
- Text filtering (type to filter)
- PID filtering (Ctrl+P)
- Selection and range selection (Shift+Up/Down)
- Copy to clipboard (Ctrl+C)
- Expand/collapse log lines (Left/Right)
- Load older logs from previous days (Ctrl+O)

#### 2.6 index.ts (DebugSelectorComponent)

Port the main debug menu with these changes:
- Remove `work` option (requires native bindings for flamegraphs)
- Replace all oh-my-pi imports with pi-mono equivalents
- Add `showDebugSelector` function for easy integration

Menu options after porting:
1. **Open: artifact folder** - Opens session artifacts in file manager
2. **Report: performance issue** - CPU profile + bundle
3. **Report: dump session** - Create report bundle immediately
4. **Report: memory issue** - Heap snapshot + bundle
5. **View: recent logs** - Interactive log viewer
6. **View: system info** - Show environment details
7. **Export: TUI transcript** - Write visible TUI conversation to temp file
8. **Clear: artifact cache** - Remove old session artifacts

### Phase 3: Integration with Interactive Mode

#### 3.1 Add to InteractiveModeContext

In `interactive-mode.ts`, add methods needed by debug selector:

```typescript
// Add to InteractiveModeContext interface (implicit via usage)
showDebugSelector(): void;
handleDebugTranscriptCommand(): Promise<void>;
```

#### 3.2 Update handleDebugCommand

Replace the current simple implementation with the full debug menu:

```typescript
import { showDebugSelector } from "./core/debug/index.js";

// In InteractiveMode class:
private handleDebugCommand(): void {
	const selector = showDebugSelector(
		this, // context
		() => {
			this.editorContainer.clear();
			this.ui.setFocus(this.editor);
		}
	);
	this.editorContainer.clear();
	this.editorContainer.addChild(selector);
	this.ui.setFocus(selector);
}
```

#### 3.3 Add handleDebugTranscriptCommand

```typescript
private async handleDebugTranscriptCommand(): Promise<void> {
	const width = this.ui.terminal.columns;
	const allLines = this.ui.render(width);

	const tmpPath = `/tmp/pi-transcript-${Date.now()}.txt`;
	await Bun.write(tmpPath, allLines.join("\n"));

	this.chatContainer.addChild(new Spacer(1));
	this.chatContainer.addChild(
		new Text(`${theme.fg("success", "✓ TUI transcript exported")}\n${theme.fg("muted", tmpPath)}`, 1, 1)
	);
	this.ui.requestRender();
}
```

#### 3.4 Add Helper Methods

Add `openPath` utility for opening files/folders:

```typescript
// In utils/open.ts (create new file)
import { spawn } from "child_process";
import { platform } from "os";

export function openPath(path: string): void {
	const p = platform();
	if (p === "darwin") {
		spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
	} else if (p === "win32") {
		spawn("cmd", ["/c", "start", "", path], { detached: true, stdio: "ignore" }).unref();
	} else {
		spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
	}
}
```

### Phase 4: Testing

#### 4.1 Unit Tests

Create test file `test/debug-module.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatBytes, sanitizeText, replaceTabs } from "../src/utils/format.js";
import { parseDebugLogTimestampMs, parseDebugLogPid } from "../src/core/debug/log-formatting.js";

describe("formatBytes", () => {
	it("formats bytes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1048576)).toBe("1.0 MB");
	});
});

describe("sanitizeText", () => {
	it("removes control characters", () => {
		expect(sanitizeText("hello\x00world")).toBe("hello world");
		expect(sanitizeText("test\x1b[31mcolor")).toBe("testcolor");
	});
});

describe("parseDebugLogTimestampMs", () => {
	it("parses timestamp from JSON log line", () => {
		const line = JSON.stringify({ timestamp: "2024-01-15T10:30:00.000Z", message: "test" });
		const ms = parseDebugLogTimestampMs(line);
		expect(ms).toBe(1705315800000);
	});

	it("returns undefined for invalid JSON", () => {
		expect(parseDebugLogTimestampMs("not json")).toBeUndefined();
	});
});
```

#### 4.2 Manual Testing Checklist

1. Start pi in interactive mode
2. Type `/debug` to open debug menu
3. Test each menu option:
   - [ ] Open artifacts folder opens file manager
   - [ ] Performance report starts profiling, stops on Enter, creates tar.gz
   - [ ] Dump session creates tar.gz with session.jsonl, logs.txt, system.json
   - [ ] Memory report creates tar.gz with heap.heapsnapshot
   - [ ] View logs opens log viewer, can filter and copy
   - [ ] System info displays OS, CPU, memory, versions
   - [ ] TUI transcript writes render output to temp file
   - [ ] Clear cache removes old artifacts

### Phase 5: Documentation

Add to `packages/coding-agent/README.md` under "Interactive Mode":

```markdown
### Debug Tools

Type `/debug` to open the debug tools menu:

- **Open: artifact folder** - Opens session artifacts in your file manager
- **Report: performance issue** - Profile CPU, reproduce the issue, then creates a report bundle
- **Report: dump session** - Creates a tar.gz with session, logs, and system info
- **Report: memory issue** - Takes a heap snapshot and creates a report bundle
- **View: recent logs** - Opens an interactive log viewer with filtering and search
- **View: system info** - Displays OS, CPU, memory, and version information
- **Export: TUI transcript** - Writes the current TUI state to a temp file
- **Clear: artifact cache** - Removes session artifacts older than 30 days

Report bundles are saved to `~/.pi/agent/reports/` and can be shared when reporting bugs.
```

### Phase 2.5: Complete Code for log-viewer.ts

The log viewer is the largest file (~800 lines). Here's the complete implementation:

```typescript
// packages/coding-agent/src/core/debug/log-viewer.ts

import { copyToClipboard } from "../../utils/clipboard.js";
import { padding, replaceTabs, sanitizeText } from "../../utils/format.js";
import { matchesKey, truncateToWidth, type Component, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../../modes/interactive/theme/theme.js";
import {
	formatDebugLogExpandedLines,
	formatDebugLogLine,
	parseDebugLogPid,
	parseDebugLogTimestampMs,
} from "./log-formatting.js";
import type { DebugLogSource } from "./report-bundle.js";

export const SESSION_BOUNDARY_WARNING = "### WARNING - Logs above are older than current session!";
export const LOAD_OLDER_LABEL = "### MOVE UP TO LOAD MORE...";

const INITIAL_LOG_CHUNK = 50;
const LOAD_OLDER_CHUNK = 50;

type LogEntry = {
	rawLine: string;
	timestampMs: number | undefined;
	pid: number | undefined;
};

type CursorToken = { kind: "log"; logIndex: number } | { kind: "load-older" };

type DebugLogViewerModelOptions = {
	processStartMs?: number;
	processPid?: number;
	hasOlderLogs?: () => boolean;
	loadOlderLogs?: (limitDays?: number) => Promise<string>;
};

type ViewerRow =
	| { kind: "warning" }
	| { kind: "load-older" }
	| { kind: "log"; logIndex: number };

function getProcessStartMs(): number {
	return Date.now() - process.uptime() * 1000;
}

export function splitLogText(logText: string): string[] {
	return logText.split("\n").filter(line => line.length > 0);
}

export function buildLogCopyPayload(lines: string[]): string {
	return lines
		.map(line => sanitizeText(line))
		.filter(line => line.length > 0)
		.join("\n");
}

export class DebugLogViewerModel {
	#entries: LogEntry[];
	#rows: ViewerRow[];
	#visibleLogIndices: number[];
	#selectableRowIndices: number[];
	#cursorSelectableIndex = 0;
	#selectionAnchorSelectableIndex: number | undefined;
	#expandedLogIndices = new Set<number>();
	#filterQuery = "";
	#processStartMs: number;
	#loadedStartIndex: number;
	#processFilterEnabled = false;
	#processPid: number;
	#hasOlderLogs?: () => boolean;
	#loadOlderLogs?: (limitDays?: number) => Promise<string>;

	constructor(logText: string, options: DebugLogViewerModelOptions = {}) {
		const { processStartMs = getProcessStartMs(), processPid = process.pid, hasOlderLogs, loadOlderLogs } = options;
		this.#entries = splitLogText(logText).map(rawLine => ({
			rawLine,
			timestampMs: parseDebugLogTimestampMs(rawLine),
			pid: parseDebugLogPid(rawLine),
		}));
		this.#processStartMs = processStartMs;
		this.#processPid = processPid;
		this.#hasOlderLogs = hasOlderLogs;
		this.#loadOlderLogs = loadOlderLogs;
		this.#loadedStartIndex = Math.max(0, this.#entries.length - INITIAL_LOG_CHUNK);
		this.#rows = [];
		this.#visibleLogIndices = [];
		this.#selectableRowIndices = [];
		this.#rebuildRows();
	}

	get logCount(): number { return this.#entries.length; }
	get visibleLogCount(): number { return this.#visibleLogIndices.length; }
	get rows(): readonly ViewerRow[] { return this.#rows; }
	get cursorRowIndex(): number | undefined { return this.#selectableRowIndices[this.#cursorSelectableIndex]; }
	get cursorLogIndex(): number | undefined {
		const row = this.#getCursorRow();
		return row?.kind === "log" ? row.logIndex : undefined;
	}
	get filterQuery(): string { return this.#filterQuery; }
	get cursorRowKind(): ViewerRow["kind"] | undefined { return this.#getCursorRow()?.kind; }
	get expandedCount(): number { return this.#expandedLogIndices.size; }

	isProcessFilterEnabled(): boolean { return this.#processFilterEnabled; }
	isCursorAtFirstSelectableRow(): boolean { return this.#cursorSelectableIndex === 0; }
	getRawLine(logIndex: number): string { return this.#entries[logIndex]?.rawLine ?? ""; }

	setFilterQuery(query: string): void {
		if (query === this.#filterQuery) return;
		this.#filterQuery = query;
		this.#rebuildRows();
	}

	toggleProcessFilter(): void {
		this.#processFilterEnabled = !this.#processFilterEnabled;
		this.#rebuildRows();
	}

	moveCursor(delta: number, extendSelection: boolean): void {
		if (this.#selectableRowIndices.length === 0) return;

		if (extendSelection && this.#selectionAnchorSelectableIndex === undefined) {
			const row = this.#getCursorRow();
			if (row?.kind === "log") {
				this.#selectionAnchorSelectableIndex = this.#cursorSelectableIndex;
			}
		}

		this.#cursorSelectableIndex = Math.max(0, Math.min(this.#selectableRowIndices.length - 1, this.#cursorSelectableIndex + delta));

		if (!extendSelection) {
			this.#selectionAnchorSelectableIndex = undefined;
		}

		if (this.#getCursorRow()?.kind !== "log" && !extendSelection) {
			this.#selectionAnchorSelectableIndex = undefined;
		}
	}

	getSelectedLogIndices(): number[] {
		if (this.#selectableRowIndices.length === 0) return [];

		const cursorRow = this.#getCursorRow();
		if (this.#selectionAnchorSelectableIndex === undefined) {
			if (cursorRow?.kind !== "log") return [];
			return [cursorRow.logIndex];
		}

		const min = Math.min(this.#selectionAnchorSelectableIndex, this.#cursorSelectableIndex);
		const max = Math.max(this.#selectionAnchorSelectableIndex, this.#cursorSelectableIndex);
		const selected: number[] = [];
		for (let i = min; i <= max; i++) {
			const rowIndex = this.#selectableRowIndices[i];
			const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
			if (row?.kind === "log") selected.push(row.logIndex);
		}
		return selected;
	}

	getSelectedCount(): number { return this.getSelectedLogIndices().length; }
	isSelected(logIndex: number): boolean { return this.getSelectedLogIndices().includes(logIndex); }
	isExpanded(logIndex: number): boolean { return this.#expandedLogIndices.has(logIndex); }

	expandSelected(): void {
		for (const index of this.getSelectedLogIndices()) this.#expandedLogIndices.add(index);
	}

	collapseSelected(): void {
		for (const index of this.getSelectedLogIndices()) this.#expandedLogIndices.delete(index);
	}

	getSelectedRawLines(): string[] {
		return this.getSelectedLogIndices().map(index => this.getRawLine(index));
	}

	selectAllVisible(): void {
		if (this.#selectableRowIndices.length === 0) return;

		let firstLogIndex: number | undefined;
		let lastLogIndex: number | undefined;
		for (let i = 0; i < this.#selectableRowIndices.length; i++) {
			const rowIndex = this.#selectableRowIndices[i];
			const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
			if (row?.kind === "log") {
				if (firstLogIndex === undefined) firstLogIndex = i;
				lastLogIndex = i;
			}
		}

		if (firstLogIndex !== undefined && lastLogIndex !== undefined) {
			this.#selectionAnchorSelectableIndex = firstLogIndex;
			this.#cursorSelectableIndex = lastLogIndex;
		}
	}

	canLoadOlder(): boolean {
		return this.#loadedStartIndex > 0 || this.#hasExternalOlderLogs();
	}

	async loadOlder(additionalCount: number = LOAD_OLDER_CHUNK): Promise<boolean> {
		if (this.#loadedStartIndex > 0) return this.#loadOlderInMemory(additionalCount);
		if (!this.#loadOlderLogs || !this.#hasExternalOlderLogs()) return false;

		const olderText = await this.#loadOlderLogs();
		if (olderText.length === 0) {
			if (!this.#hasExternalOlderLogs()) this.#rebuildRows();
			return false;
		}
		const added = this.prependLogs(olderText);
		if (added === 0) {
			if (!this.#hasExternalOlderLogs()) this.#rebuildRows();
			return false;
		}
		return this.#loadOlderInMemory(additionalCount);
	}

	prependLogs(logText: string): number {
		const previousCursor = this.#getCursorToken();
		const previousAnchorLogIndex = this.#getAnchorLogIndex();
		const newEntries = splitLogText(logText).map(rawLine => ({
			rawLine,
			timestampMs: parseDebugLogTimestampMs(rawLine),
			pid: parseDebugLogPid(rawLine),
		}));
		if (newEntries.length === 0) return 0;

		const offset = newEntries.length;
		this.#entries = [...newEntries, ...this.#entries];
		this.#loadedStartIndex += offset;
		this.#expandedLogIndices = new Set([...this.#expandedLogIndices].map(logIndex => logIndex + offset));

		const adjustedCursor: CursorToken | undefined = previousCursor?.kind === "log"
			? { kind: "log", logIndex: previousCursor.logIndex + offset }
			: previousCursor;
		const adjustedAnchor = previousAnchorLogIndex === undefined ? undefined : previousAnchorLogIndex + offset;
		this.#rebuildRows(adjustedCursor, adjustedAnchor);
		return offset;
	}

	#loadOlderInMemory(additionalCount: number = LOAD_OLDER_CHUNK): boolean {
		if (this.#loadedStartIndex === 0) return false;
		const requested = Math.max(1, additionalCount);
		const nextStart = Math.max(0, this.#loadedStartIndex - requested);
		if (nextStart === this.#loadedStartIndex) return false;
		this.#loadedStartIndex = nextStart;
		this.#rebuildRows();
		return true;
	}

	#rebuildRows(previousCursor: CursorToken | undefined = this.#getCursorToken(), previousAnchorLogIndex = this.#getAnchorLogIndex()): void {
		const query = this.#filterQuery.toLowerCase();
		const visible: number[] = [];
		for (let i = this.#loadedStartIndex; i < this.#entries.length; i++) {
			const entry = this.#entries[i];
			if (entry && this.#matchesFilters(entry, query)) visible.push(i);
		}
		this.#visibleLogIndices = visible;

		const rows: ViewerRow[] = [];
		if (this.#hasOlderEntries(query)) rows.push({ kind: "load-older" });

		let olderSeen = false;
		let warningInserted = false;
		for (const logIndex of visible) {
			const timestampMs = this.#entries[logIndex]?.timestampMs;
			if (timestampMs !== undefined) {
				if (timestampMs < this.#processStartMs) {
					olderSeen = true;
				} else if (olderSeen && !warningInserted) {
					rows.push({ kind: "warning" });
					warningInserted = true;
				}
			}
			rows.push({ kind: "log", logIndex });
		}
		this.#rows = rows;
		this.#selectableRowIndices = rows
			.map((row, index) => (row.kind === "warning" ? undefined : index))
			.filter((index): index is number => index !== undefined);

		if (this.#selectableRowIndices.length === 0) {
			this.#cursorSelectableIndex = 0;
			this.#selectionAnchorSelectableIndex = undefined;
			return;
		}

		if (previousCursor?.kind === "log") {
			const rowIndex = this.#rows.findIndex(row => row.kind === "log" && row.logIndex === previousCursor.logIndex);
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			this.#cursorSelectableIndex = selectableIndex >= 0 ? selectableIndex : this.#selectableRowIndices.length - 1;
		} else if (previousCursor?.kind === "load-older") {
			const rowIndex = this.#rows.findIndex(row => row.kind === "load-older");
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			this.#cursorSelectableIndex = selectableIndex >= 0 ? selectableIndex : this.#selectableRowIndices.length - 1;
		} else {
			this.#cursorSelectableIndex = this.#selectableRowIndices.length - 1;
		}

		if (previousAnchorLogIndex !== undefined) {
			const rowIndex = this.#rows.findIndex(row => row.kind === "log" && row.logIndex === previousAnchorLogIndex);
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			this.#selectionAnchorSelectableIndex = selectableIndex >= 0 ? selectableIndex : undefined;
		} else {
			this.#selectionAnchorSelectableIndex = undefined;
		}
	}

	#matchesFilters(entry: LogEntry, query: string): boolean {
		if (query.length > 0 && !entry.rawLine.toLowerCase().includes(query)) return false;
		if (!this.#processFilterEnabled) return true;
		return entry.pid === this.#processPid;
	}

	#hasOlderEntries(query: string): boolean {
		if (this.#hasExternalOlderLogs()) return true;
		if (this.#loadedStartIndex === 0) return false;
		for (let i = 0; i < this.#loadedStartIndex; i++) {
			const entry = this.#entries[i];
			if (entry && this.#matchesFilters(entry, query)) return true;
		}
		return false;
	}

	#hasExternalOlderLogs(): boolean { return this.#hasOlderLogs?.() ?? false; }
	#getCursorRow(): ViewerRow | undefined {
		const rowIndex = this.cursorRowIndex;
		return rowIndex === undefined ? undefined : this.#rows[rowIndex];
	}
	#getCursorToken(): CursorToken | undefined {
		const row = this.#getCursorRow();
		if (!row) return undefined;
		if (row.kind === "log") return { kind: "log", logIndex: row.logIndex };
		if (row.kind === "load-older") return { kind: "load-older" };
		return undefined;
	}
	#getAnchorLogIndex(): number | undefined {
		if (this.#selectionAnchorSelectableIndex === undefined) return undefined;
		const rowIndex = this.#selectableRowIndices[this.#selectionAnchorSelectableIndex];
		const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
		return row?.kind === "log" ? row.logIndex : undefined;
	}
}

interface DebugLogViewerComponentOptions {
	logs: string;
	terminalRows: number;
	onExit: () => void;
	onStatus?: (message: string) => void;
	onError?: (message: string) => void;
	processStartMs?: number;
	processPid?: number;
	logSource?: DebugLogSource;
	onUpdate?: () => void;
}

export class DebugLogViewerComponent implements Component {
	#model: DebugLogViewerModel;
	#terminalRows: number;
	#onExit: () => void;
	#onStatus?: (message: string) => void;
	#onError?: (message: string) => void;
	#onUpdate?: () => void;
	#logSource?: DebugLogSource;
	#lastRenderWidth = 80;
	#scrollRowOffset = 0;
	#statusMessage: string | undefined;
	#loadingOlder = false;

	constructor(options: DebugLogViewerComponentOptions) {
		this.#logSource = options.logSource;
		this.#model = new DebugLogViewerModel(options.logs, {
			processStartMs: options.processStartMs,
			processPid: options.processPid,
			hasOlderLogs: this.#logSource?.hasOlderLogs.bind(this.#logSource),
			loadOlderLogs: this.#logSource?.loadOlderLogs.bind(this.#logSource),
		});
		this.#terminalRows = options.terminalRows;
		this.#onExit = options.onExit;
		this.#onStatus = options.onStatus;
		this.#onError = options.onError;
		this.#onUpdate = options.onUpdate;
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.#onExit();
			return;
		}
		if (matchesKey(keyData, "ctrl+c")) {
			this.#copySelected();
			return;
		}
		if (matchesKey(keyData, "ctrl+p")) {
			this.#statusMessage = undefined;
			this.#model.toggleProcessFilter();
			this.#ensureCursorVisible();
			return;
		}
		if (matchesKey(keyData, "ctrl+a")) {
			this.#statusMessage = undefined;
			this.#model.selectAllVisible();
			this.#ensureCursorVisible();
			return;
		}
		if (matchesKey(keyData, "ctrl+o")) {
			this.#statusMessage = undefined;
			void this.#handleLoadOlder(this.#bodyHeight() + 1);
			return;
		}
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return")) {
			if (this.#model.cursorRowKind === "load-older") {
				this.#statusMessage = undefined;
				void this.#handleLoadOlder();
			}
			return;
		}
		if (matchesKey(keyData, "shift+up")) {
			this.#statusMessage = undefined;
			void this.#handleMoveUp(true);
			return;
		}
		if (matchesKey(keyData, "shift+down")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(1, true);
			this.#ensureCursorVisible();
			return;
		}
		if (matchesKey(keyData, "up")) {
			this.#statusMessage = undefined;
			void this.#handleMoveUp(false);
			return;
		}
		if (matchesKey(keyData, "down")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(1, false);
			this.#ensureCursorVisible();
			return;
		}
		if (matchesKey(keyData, "right")) {
			this.#statusMessage = undefined;
			if (this.#model.cursorRowKind === "load-older") {
				void this.#handleLoadOlder();
				return;
			}
			this.#model.expandSelected();
			return;
		}
		if (matchesKey(keyData, "left")) {
			this.#statusMessage = undefined;
			this.#model.collapseSelected();
			return;
		}
		if (matchesKey(keyData, "backspace")) {
			if (this.#model.filterQuery.length > 0) {
				this.#statusMessage = undefined;
				this.#model.setFilterQuery(this.#model.filterQuery.slice(0, -1));
				this.#ensureCursorVisible();
			}
			return;
		}

		const hasControlChars = [...keyData].some(ch => {
			const code = ch.charCodeAt(0);
			return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		});
		if (!hasControlChars && keyData.length > 0) {
			this.#statusMessage = undefined;
			this.#model.setFilterQuery(this.#model.filterQuery + keyData);
			this.#ensureCursorVisible();
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		this.#lastRenderWidth = Math.max(20, width);
		this.#ensureCursorVisible();

		const innerWidth = Math.max(1, this.#lastRenderWidth - 2);
		const bodyHeight = this.#bodyHeight();
		const rows = this.#renderRows(innerWidth);
		const visibleBodyLines = this.#renderVisibleBodyLines(rows, innerWidth, bodyHeight);

		return [
			this.#frameTop(innerWidth),
			this.#frameLine(this.#summaryText(), innerWidth),
			this.#frameSeparator(innerWidth),
			this.#frameLine(this.#filterText(), innerWidth),
			this.#frameSeparator(innerWidth),
			...visibleBodyLines,
			this.#frameLine(this.#statusText(), innerWidth),
			this.#frameBottom(innerWidth),
		];
	}

	#summaryText(): string {
		return ` # ${this.#model.visibleLogCount}/${this.#model.logCount} logs | ${this.#controlsText()}`;
	}

	#controlsText(): string {
		return "Esc: back  Ctrl+C: copy  Up/Down: move  Shift+Up/Down: select range  Left/Right: collapse/expand  Ctrl+A: select all  Ctrl+O: load older  Ctrl+P: pid filter";
	}

	#filterText(): string {
		const sanitized = replaceTabs(sanitizeText(this.#model.filterQuery));
		const query = sanitized.length === 0 ? "" : theme.fg("accent", sanitized);
		const pidStatus = this.#model.isProcessFilterEnabled()
			? theme.fg("success", "pid:on")
			: theme.fg("muted", "pid:off");
		return ` filter: ${query}  ${pidStatus}`;
	}

	#statusText(): string {
		const base = ` Selected: ${this.#model.getSelectedCount()}  Expanded: ${this.#model.expandedCount}`;
		if (this.#statusMessage) return `${base}  ${this.#statusMessage}`;
		return base;
	}

	#bodyHeight(): number { return Math.max(3, this.#terminalRows - 8); }

	async #handleLoadOlder(additionalCount: number = LOAD_OLDER_CHUNK): Promise<void> {
		const loaded = await this.#loadOlder(additionalCount);
		if (loaded) {
			this.#ensureCursorVisible();
			this.#onUpdate?.();
		}
	}

	async #handleMoveUp(extendSelection: boolean): Promise<void> {
		if (this.#model.cursorRowKind === "load-older") {
			const loaded = await this.#loadOlder(LOAD_OLDER_CHUNK);
			if (loaded) {
				this.#ensureCursorVisible();
				this.#onUpdate?.();
				return;
			}
		}
		if (this.#model.canLoadOlder() && this.#model.isCursorAtFirstSelectableRow()) {
			const loaded = await this.#loadOlder(LOAD_OLDER_CHUNK);
			if (loaded) {
				this.#model.moveCursor(-1, extendSelection);
				this.#ensureCursorVisible();
				this.#onUpdate?.();
				return;
			}
		}
		this.#model.moveCursor(-1, extendSelection);
		this.#ensureCursorVisible();
		this.#onUpdate?.();
	}

	async #loadOlder(additionalCount: number): Promise<boolean> {
		if (this.#loadingOlder || !this.#model.canLoadOlder()) return false;
		this.#loadingOlder = true;
		const previousCursorRowIndex = this.#model.cursorRowIndex;
		const previousScrollOffset = this.#scrollRowOffset;
		try {
			const didLoad = await this.#model.loadOlder(additionalCount);
			if (didLoad) this.#preserveScrollPosition(previousCursorRowIndex, previousScrollOffset);
			return didLoad;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#statusMessage = `Load older failed: ${message}`;
			this.#onError?.(`Failed to load older logs: ${message}`);
			this.#onUpdate?.();
			return false;
		} finally {
			this.#loadingOlder = false;
		}
	}

	#preserveScrollPosition(previousCursorRowIndex: number | undefined, previousScrollOffset: number): void {
		const cursorRowIndex = this.#model.cursorRowIndex;
		if (previousCursorRowIndex === undefined || cursorRowIndex === undefined) return;
		const delta = cursorRowIndex - previousCursorRowIndex;
		const maxOffset = Math.max(0, this.#model.rows.length - this.#bodyHeight());
		this.#scrollRowOffset = Math.max(0, Math.min(maxOffset, previousScrollOffset + delta));
	}

	#renderRows(innerWidth: number): Array<{ lines: string[]; rowIndex: number }> {
		const rendered: Array<{ lines: string[]; rowIndex: number }> = [];

		for (let rowIndex = 0; rowIndex < this.#model.rows.length; rowIndex++) {
			const row = this.#model.rows[rowIndex];
			if (!row) continue;

			if (row.kind === "warning") {
				rendered.push({ rowIndex, lines: [theme.fg("muted", truncateToWidth(SESSION_BOUNDARY_WARNING, innerWidth))] });
				continue;
			}

			if (row.kind === "load-older") {
				const active = this.#model.cursorRowIndex === rowIndex;
				const marker = active ? theme.fg("accent", ">") : " ";
				const contentWidth = Math.max(1, innerWidth - visibleWidth(`${marker}  `));
				const label = truncateToWidth(LOAD_OLDER_LABEL, contentWidth);
				rendered.push({ rowIndex, lines: [truncateToWidth(`${marker}  ${theme.fg("muted", label)}`, innerWidth)] });
				continue;
			}

			const logIndex = row.logIndex;
			const selected = this.#model.isSelected(logIndex);
			const cursorLogIndex = this.#model.cursorLogIndex;
			const active = cursorLogIndex !== undefined && cursorLogIndex === logIndex;
			const expanded = this.#model.isExpanded(logIndex);
			const marker = active ? theme.fg("accent", ">") : selected ? theme.fg("accent", "*") : " ";
			const fold = expanded ? theme.fg("accent", "v") : theme.fg("muted", ">");
			const prefix = `${marker}${fold} `;
			const contentWidth = Math.max(1, innerWidth - visibleWidth(prefix));

			if (expanded) {
				const wrapped = formatDebugLogExpandedLines(this.#model.getRawLine(logIndex), contentWidth);
				const indent = padding(visibleWidth(prefix));
				const lines = wrapped.map((segment, index) => {
					const content = selected ? theme.bold(segment) : segment;
					return truncateToWidth(`${index === 0 ? prefix : indent}${content}`, innerWidth);
				});
				rendered.push({ rowIndex, lines });
				continue;
			}

			const preview = formatDebugLogLine(this.#model.getRawLine(logIndex), contentWidth);
			const content = selected ? theme.bold(preview) : preview;
			rendered.push({ rowIndex, lines: [truncateToWidth(`${prefix}${content}`, innerWidth)] });
		}

		return rendered;
	}

	#renderVisibleBodyLines(rows: Array<{ lines: string[]; rowIndex: number }>, innerWidth: number, bodyHeight: number): string[] {
		const lines: string[] = [];
		if (rows.length === 0) lines.push(this.#frameLine(theme.fg("muted", "no matches"), innerWidth));

		for (let i = this.#scrollRowOffset; i < rows.length && lines.length < bodyHeight; i++) {
			const row = rows[i];
			if (!row) continue;
			for (const line of row.lines) {
				if (lines.length >= bodyHeight) break;
				lines.push(this.#frameLine(line, innerWidth));
			}
		}

		while (lines.length < bodyHeight) lines.push(this.#frameLine("", innerWidth));
		return lines;
	}

	#getRowRenderedLineCount(rowIndex: number, innerWidth: number): number {
		const row = this.#model.rows[rowIndex];
		if (!row || row.kind === "warning" || row.kind === "load-older") return 1;
		if (!this.#model.isExpanded(row.logIndex)) return 1;
		const contentWidth = Math.max(1, innerWidth - 3);
		return Math.max(1, formatDebugLogExpandedLines(this.#model.getRawLine(row.logIndex), contentWidth).length);
	}

	#ensureCursorVisible(): void {
		const cursorRowIndex = this.#model.cursorRowIndex;
		if (cursorRowIndex === undefined) { this.#scrollRowOffset = 0; return; }
		const bodyHeight = Math.max(1, this.#bodyHeight());
		const innerWidth = Math.max(1, this.#lastRenderWidth - 2);

		if (cursorRowIndex < this.#scrollRowOffset) { this.#scrollRowOffset = cursorRowIndex; return; }

		let usedLines = 0;
		for (let i = this.#scrollRowOffset; i <= cursorRowIndex; i++) {
			usedLines += this.#getRowRenderedLineCount(i, innerWidth);
		}
		if (usedLines > bodyHeight) {
			while (this.#scrollRowOffset < cursorRowIndex) {
				usedLines -= this.#getRowRenderedLineCount(this.#scrollRowOffset, innerWidth);
				this.#scrollRowOffset++;
				if (usedLines <= bodyHeight) break;
			}
		}
	}

	#frameTop(innerWidth: number): string {
		return `${theme.boxSharp.topLeft}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.topRight}`;
	}
	#frameSeparator(innerWidth: number): string {
		return `${theme.boxSharp.teeRight}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.teeLeft}`;
	}
	#frameBottom(innerWidth: number): string {
		return `${theme.boxSharp.bottomLeft}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.bottomRight}`;
	}
	#frameLine(content: string, innerWidth: number): string {
		const truncated = truncateToWidth(content, innerWidth);
		const remaining = Math.max(0, innerWidth - visibleWidth(truncated));
		return `${theme.boxSharp.vertical}${truncated}${padding(remaining)}${theme.boxSharp.vertical}`;
	}

	#copySelected(): void {
		const selectedPayload = buildLogCopyPayload(this.#model.getSelectedRawLines());
		const selected = selectedPayload.length === 0 ? [] : selectedPayload.split("\n");

		if (selected.length === 0) {
			const message = "No log entry selected";
			this.#statusMessage = message;
			this.#onStatus?.(message);
			return;
		}

		try {
			copyToClipboard(selectedPayload);
			const message = `Copied ${selected.length} log ${selected.length === 1 ? "entry" : "entries"}`;
			this.#statusMessage = message;
			this.#onStatus?.(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#statusMessage = `Copy failed: ${message}`;
			this.#onError?.(`Failed to copy logs: ${message}`);
		}
	}
}
```

### Phase 2.6: Complete Code for index.ts (DebugSelectorComponent)

```typescript
// packages/coding-agent/src/core/debug/index.ts

import * as fs from "node:fs/promises";
import * as url from "node:url";
import * as path from "node:path";
import { Container, Loader, type SelectItem, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { getSessionsDir, VERSION } from "../../config.js";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.js";
import { getSelectListTheme, theme } from "../../modes/interactive/theme/theme.js";
import { formatBytes } from "../../utils/format.js";
import { openPath } from "../../utils/open.js";
import { DebugLogViewerComponent } from "./log-viewer.js";
import { generateHeapSnapshotData, type ProfilerSession, startCpuProfile } from "./profiler.js";
import { clearArtifactCache, createDebugLogSource, createReportBundle, getArtifactCacheStats } from "./report-bundle.js";
import { collectSystemInfo, formatSystemInfo } from "./system-info.js";

/**
 * Context interface for debug operations.
 * Matches the public interface of InteractiveMode needed by debug components.
 */
export interface DebugContext {
	// UI containers
	chatContainer: Container;
	editorContainer: Container;
	statusContainer: Container;
	ui: {
		terminal: { rows: number; columns: number };
		requestRender(): void;
		setFocus(component: unknown): void;
	};

	// Session access
	sessionManager: {
		getSessionFile(): string | undefined;
	};

	// Session state
	session: {
		model?: { id: string };
		thinkingLevel?: string;
	};

	// UI state
	planModeEnabled: boolean;
	toolOutputExpanded: boolean;
	hideThinkingBlock: boolean;

	// Feedback methods
	showError(message: string): void;
	showWarning(message: string): void;
	showStatus(message: string): void;

	// Editor reference for input interception
	editor: {
		onEscape?: () => void;
		onSubmit?: () => void;
	};

	// Transcript export
	handleDebugTranscriptCommand(): Promise<void>;
}

/** Debug menu options */
const DEBUG_MENU_ITEMS: SelectItem[] = [
	{ value: "open-artifacts", label: "Open: artifact folder", description: "Open session artifacts in file manager" },
	{ value: "performance", label: "Report: performance issue", description: "Profile CPU, reproduce, then bundle" },
	{ value: "dump", label: "Report: dump session", description: "Create report bundle immediately" },
	{ value: "memory", label: "Report: memory issue", description: "Heap snapshot + bundle" },
	{ value: "logs", label: "View: recent logs", description: "Show last 50 log entries" },
	{ value: "system", label: "View: system info", description: "Show environment details" },
	{ value: "transcript", label: "Export: TUI transcript", description: "Write visible TUI conversation to a temp txt" },
	{ value: "clear-cache", label: "Clear: artifact cache", description: "Remove old session artifacts" },
];

const formatFileHyperlink = (path: string): string => {
	const fileUrl = url.pathToFileURL(path).href;
	return `\x1b]8;;${fileUrl}\x07${path}\x1b]8;;\x07`;
};

/**
 * Debug selector component.
 */
export class DebugSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(
		private ctx: DebugContext,
		onDone: () => void,
	) {
		super();

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", "Debug Tools")), 1, 0));
		this.addChild(new Spacer(1));

		this.#selectList = new SelectList(DEBUG_MENU_ITEMS, 7, getSelectListTheme());

		this.#selectList.onSelect = item => {
			onDone();
			void this.#handleSelection(item.value);
		};

		this.#selectList.onCancel = () => {
			onDone();
		};

		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		this.#selectList.handleInput(keyData);
	}

	async #handleSelection(value: string): Promise<void> {
		switch (value) {
			case "open-artifacts": await this.#handleOpenArtifacts(); break;
			case "performance": await this.#handlePerformanceReport(); break;
			case "dump": await this.#handleDumpReport(); break;
			case "memory": await this.#handleMemoryReport(); break;
			case "logs": await this.#handleViewLogs(); break;
			case "system": await this.#handleViewSystemInfo(); break;
			case "transcript": await this.#handleTranscriptExport(); break;
			case "clear-cache": await this.#handleClearCache(); break;
		}
	}

	async #handlePerformanceReport(): Promise<void> {
		let session: ProfilerSession;
		try {
			session = await startCpuProfile();
		} catch (err) {
			this.ctx.showError(`Failed to start profiler: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new Text(theme.fg("accent", `${theme.status.info} CPU profiling started`), 1, 0));
		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(
			new Text(theme.fg("muted", "Reproduce the performance issue, then press Enter to stop profiling."), 1, 0),
		);
		this.ctx.ui.requestRender();

		const { promise, resolve } = Promise.withResolvers<void>();
		const originalOnEscape = this.ctx.editor.onEscape;
		const originalOnSubmit = this.ctx.editor.onSubmit;

		this.ctx.editor.onSubmit = () => {
			this.ctx.editor.onEscape = originalOnEscape;
			this.ctx.editor.onSubmit = originalOnSubmit;
			resolve();
		};
		this.ctx.editor.onEscape = () => {
			this.ctx.editor.onEscape = originalOnEscape;
			this.ctx.editor.onSubmit = originalOnSubmit;
			resolve();
		};

		await promise;

		const loader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			"Generating report...",
			theme.symbols.spinnerFrames,
		);
		this.ctx.statusContainer.addChild(loader);
		this.ctx.ui.requestRender();

		try {
			const cpuProfile = await session.stop();
			const result = await createReportBundle({
				sessionFile: this.ctx.sessionManager.getSessionFile(),
				settings: this.#getResolvedSettings(),
				cpuProfile,
			});

			loader.stop();
			this.ctx.statusContainer.clear();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(new Text(theme.fg("success", `${theme.status.success} Performance report saved`), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", formatFileHyperlink(result.path)), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", `Files: ${result.files.length}`), 1, 0));
		} catch (err) {
			loader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleDumpReport(): Promise<void> {
		const loader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			"Creating report bundle...",
			theme.symbols.spinnerFrames,
		);
		this.ctx.statusContainer.addChild(loader);
		this.ctx.ui.requestRender();

		try {
			const result = await createReportBundle({
				sessionFile: this.ctx.sessionManager.getSessionFile(),
				settings: this.#getResolvedSettings(),
			});

			loader.stop();
			this.ctx.statusContainer.clear();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(new Text(theme.fg("success", `${theme.status.success} Report bundle saved`), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", formatFileHyperlink(result.path)), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", `Files: ${result.files.length}`), 1, 0));
		} catch (err) {
			loader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleMemoryReport(): Promise<void> {
		const loader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			"Generating heap snapshot...",
			theme.symbols.spinnerFrames,
		);
		this.ctx.statusContainer.addChild(loader);
		this.ctx.ui.requestRender();

		try {
			const heapSnapshot = generateHeapSnapshotData();
			loader.setText("Creating report bundle...");

			const result = await createReportBundle({
				sessionFile: this.ctx.sessionManager.getSessionFile(),
				settings: this.#getResolvedSettings(),
				heapSnapshot,
			});

			loader.stop();
			this.ctx.statusContainer.clear();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(new Text(theme.fg("success", `${theme.status.success} Memory report saved`), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", formatFileHyperlink(result.path)), 1, 0));
			this.ctx.chatContainer.addChild(new Text(theme.fg("dim", `Files: ${result.files.length}`), 1, 0));
		} catch (err) {
			loader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.showError(`Failed to create report: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleViewLogs(): Promise<void> {
		try {
			const logSource = await createDebugLogSource();
			const logs = await logSource.getInitialText();
			if (!logs && !logSource.hasOlderLogs()) {
				this.ctx.showWarning("No log entries found for today.");
				return;
			}

			const viewer = new DebugLogViewerComponent({
				logs,
				terminalRows: this.ctx.ui.terminal.rows,
				onExit: () => this.#showDebugSelector(),
				onStatus: message => this.ctx.showStatus(message),
				onError: message => this.ctx.showError(message),
				onUpdate: () => this.ctx.ui.requestRender(),
				logSource,
			});

			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(viewer);
			this.ctx.ui.setFocus(viewer);
		} catch (err) {
			this.ctx.showError(`Failed to read logs: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleViewSystemInfo(): Promise<void> {
		try {
			const info = await collectSystemInfo();
			const formatted = formatSystemInfo(info);

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(new DynamicBorder());
			this.ctx.chatContainer.addChild(new Text(formatted, 1, 0));
			this.ctx.chatContainer.addChild(new DynamicBorder());
		} catch (err) {
			this.ctx.showError(`Failed to collect system info: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	async #handleTranscriptExport(): Promise<void> {
		await this.ctx.handleDebugTranscriptCommand();
	}

	async #handleOpenArtifacts(): Promise<void> {
		const sessionFile = this.ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			this.ctx.showWarning("No active session file.");
			return;
		}

		const artifactsDir = sessionFile.slice(0, -6);

		try {
			const stat = await fs.stat(artifactsDir);
			if (!stat.isDirectory()) {
				this.ctx.showWarning("Artifact folder does not exist yet.");
				return;
			}
		} catch {
			this.ctx.showWarning("Artifact folder does not exist yet.");
			return;
		}

		openPath(artifactsDir);
		this.ctx.showStatus(`Opened: ${artifactsDir}`);
	}

	async #handleClearCache(): Promise<void> {
		const sessionsDir = getSessionsDir();
		const stats = await getArtifactCacheStats(sessionsDir);

		if (stats.count === 0) {
			this.ctx.showStatus("Artifact cache is empty.");
			return;
		}

		const sizeStr = formatBytes(stats.totalSize);
		const oldestStr = stats.oldestDate ? stats.oldestDate.toLocaleDateString() : "unknown";

		this.ctx.chatContainer.addChild(new Spacer(1));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.chatContainer.addChild(new Text(theme.fg("accent", "Clear Artifact Cache"), 1, 0));
		this.ctx.chatContainer.addChild(new Text(`Found ${stats.count} artifact files (${sizeStr})`, 1, 0));
		this.ctx.chatContainer.addChild(new Text(`Oldest: ${oldestStr}`, 1, 0));
		this.ctx.chatContainer.addChild(new Text("", 1, 0));
		this.ctx.chatContainer.addChild(new Text(theme.fg("muted", "Press Enter to remove artifacts older than 30 days, or Esc to cancel"), 1, 0));
		this.ctx.chatContainer.addChild(new DynamicBorder());
		this.ctx.ui.requestRender();

		const { promise, resolve } = Promise.withResolvers<boolean>();
		const originalOnEscape = this.ctx.editor.onEscape;
		const originalOnSubmit = this.ctx.editor.onSubmit;

		this.ctx.editor.onSubmit = () => {
			this.ctx.editor.onEscape = originalOnEscape;
			this.ctx.editor.onSubmit = originalOnSubmit;
			resolve(true);
		};
		this.ctx.editor.onEscape = () => {
			this.ctx.editor.onEscape = originalOnEscape;
			this.ctx.editor.onSubmit = originalOnSubmit;
			resolve(false);
		};

		const confirmed = await promise;
		if (!confirmed) {
			this.ctx.showStatus("Cache clear cancelled.");
			return;
		}

		const loader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			"Clearing artifact cache...",
			theme.symbols.spinnerFrames,
		);
		this.ctx.statusContainer.addChild(loader);
		this.ctx.ui.requestRender();

		try {
			const result = await clearArtifactCache(sessionsDir, 30);

			loader.stop();
			this.ctx.statusContainer.clear();

			this.ctx.chatContainer.addChild(new Spacer(1));
			this.ctx.chatContainer.addChild(
				new Text(theme.fg("success", `${theme.status.success} Cleared ${result.removed} artifact directories`), 1, 0),
			);
		} catch (err) {
			loader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.showError(`Failed to clear cache: ${err instanceof Error ? err.message : String(err)}`);
		}

		this.ctx.ui.requestRender();
	}

	#getResolvedSettings(): Record<string, unknown> {
		return {
			model: this.ctx.session.model?.id,
			thinkingLevel: this.ctx.session.thinkingLevel,
			planModeEnabled: this.ctx.planModeEnabled,
			toolOutputExpanded: this.ctx.toolOutputExpanded,
			hideThinkingBlock: this.ctx.hideThinkingBlock,
		};
	}

	#showDebugSelector(): void {
		// Re-show the debug selector (called when exiting log viewer)
		const selector = new DebugSelectorComponent(this.ctx, () => {
			this.ctx.editorContainer.clear();
		});
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(selector);
		this.ctx.ui.setFocus(selector);
		this.ctx.ui.requestRender();
	}
}

/**
 * Show the debug selector.
 */
export function showDebugSelector(ctx: DebugContext, onDone: () => void): DebugSelectorComponent {
	return new DebugSelectorComponent(ctx, onDone);
}
```

## Phase 6: Security Considerations

### 6.1 Environment Variable Sanitization

The `sanitizeEnv()` function in `system-info.ts` redacts sensitive values. Review and extend patterns:

```typescript
const SENSITIVE_PATTERNS = [
	/key/i, /secret/i, /token/i, /pass/i, /auth/i,
	/credential/i, /api/i, /private/i,
	/session/i, /cookie/i, /jwt/i, /bearer/i,
];
```

### 6.2 Report Bundle Privacy

Report bundles contain:
- Session transcript (may contain user code/data)
- Environment variables (sanitized)
- Log files (may contain file paths)

**Recommendations:**
1. Add a warning when creating reports: "Report may contain sensitive data. Review before sharing."
2. Consider adding an option to exclude session transcript from reports.
3. Store reports with restrictive file permissions (0600).

### 6.3 Heap Snapshot Security

Heap snapshots can contain strings from memory including:
- API keys that were used during the session
- User data that was processed

**Recommendation:** Add warning before generating memory reports.

## Phase 7: Error Handling Strategy

### 7.1 Graceful Degradation

Each debug feature should fail independently:

| Feature | Failure Mode |
|---------|--------------|
| CPU profiling | Show error, suggest Node.js version check |
| Heap snapshot | Show error, suggest Bun version check |
| Log viewer | Show error, suggest checking log path |
| Artifact cache | Show error, continue without cache stats |
| Report bundle | Show error, list which files failed |

### 7.2 Error Messages

Use clear, actionable error messages:

```typescript
// Good
this.ctx.showError("Failed to start profiler: V8 inspector unavailable. Are you running with --inspect?");

// Bad
this.ctx.showError("Error: profiler failed");
```

### 7.3 Error Recovery

For operations that can be retried:
- CPU profiling: Allow user to try again
- Log loading: Show partial results, allow loading more
- Report bundle: List failed files, allow partial bundle

## Phase 8: Performance Considerations

### 8.1 Log File Handling

Large log files are handled efficiently:
- `MAX_LOG_LINES = 5000` limits in-memory entries
- `MAX_LOG_BYTES = 2MB` limits tail reads
- Pagination via `INITIAL_LOG_CHUNK = 50`

### 8.2 Report Bundle Size

For large sessions:
- Consider truncating session.jsonl to last N entries
- Skip binary files in artifacts directory
- Add progress indicator for large bundles

### 8.3 Profiling Overhead

CPU profiling adds minimal overhead:
- Uses V8 built-in profiler
- Inspector session overhead is ~1-2%
- Profile data is compressed in tar.gz

## Phase 9: Rollback Strategy

### 9.1 Feature Flag (Optional)

Add a feature flag for gradual rollout:

```typescript
// In config.ts
export const DEBUG_TOOLS_ENABLED = process.env.PI_DEBUG_TOOLS !== "false";
```

### 9.2 Fallback Behavior

If debug module fails to load:
- Show simple message: "Debug tools unavailable"
- Fall back to original `handleDebugCommand()` behavior

### 9.3 Rollback Steps

1. Remove `/debug` command handling
2. Revert to original debug dump behavior
3. Debug module files can remain (unused) for hotfix

## Phase 10: CHANGELOG Entry

Add to `packages/coding-agent/CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- Interactive debug tools menu via `/debug` command with:
  - Open artifact folder in file manager
  - Performance report generation (CPU profiling + bundle)
  - Memory report generation (heap snapshot + bundle)
  - Session dump (report bundle with logs, system info)
  - Interactive log viewer with filtering and selection
  - System information display
  - TUI transcript export
  - Artifact cache clearing
- New utilities in `utils/format.ts`: `formatBytes()`, `sanitizeText()`, `replaceTabs()`, `padding()`
- New utilities in `utils/open.ts`: `openPath()` for cross-platform file/folder opening
- New config functions: `getLogsDir()`, `getReportsDir()`, `getLogPath()`, `isEnoent()`
```

## Files Changed Summary

### New Files

1. `packages/coding-agent/src/core/debug/index.ts` - Debug menu component
2. `packages/coding-agent/src/core/debug/log-formatting.ts` - Log utilities
3. `packages/coding-agent/src/core/debug/log-viewer.ts` - Log viewer component
4. `packages/coding-agent/src/core/debug/profiler.ts` - CPU/heap profiling
5. `packages/coding-agent/src/core/debug/report-bundle.ts` - Report creation
6. `packages/coding-agent/src/core/debug/system-info.ts` - System diagnostics
7. `packages/coding-agent/src/utils/format.ts` - formatBytes, sanitizeText utilities
8. `packages/coding-agent/src/utils/open.ts` - openPath utility
9. `packages/coding-agent/test/debug-module.test.ts` - Unit tests

### Modified Files

1. `packages/coding-agent/src/config.ts` - Add getLogsDir(), getReportsDir(), getLogPath(), isEnoent()
2. `packages/coding-agent/src/modes/interactive/interactive-mode.ts` - Replace handleDebugCommand, add handleDebugTranscriptCommand

## Potential Challenges

1. **Bun API Compatibility**: The profiler and report-bundle use Bun-specific APIs (`Bun.write`, `Bun.gc`, `Bun.generateHeapSnapshot`, `Bun.Archive`). These are already available in pi-mono.

2. **Log File Location**: oh-my-pi uses dated log files (`app.YYYY-MM-DD.log`), while pi-mono currently uses a single debug log file. Need to ensure both approaches work during transition.

3. **Missing Native Bindings**: The work profile feature (flamegraphs) requires `getWorkProfile()` from `@oh-my-pi/pi-natives`. This will be skipped in the initial port.

4. **Theme Integration**: The debug components use the theme system. Ensure proper imports from `modes/interactive/theme/theme.ts`.

## Success Criteria

1. `/debug` command opens an interactive debug menu
2. All menu options work correctly (except work profile which is skipped)
3. Report bundles can be created and extracted
4. Log viewer displays logs with filtering and pagination
5. CPU profiles can be recorded and viewed in Chrome DevTools
6. Heap snapshots can be captured and analyzed
7. All unit tests pass
8. TypeScript compilation succeeds with no errors

## Estimated Effort

- Phase 1 (Utilities): 1 hour
- Phase 2 (Port Files): 3-4 hours
- Phase 3 (Integration): 1 hour
- Phase 4 (Testing): 1-2 hours
- Phase 5 (Documentation): 30 minutes

**Total: 6-8 hours**
