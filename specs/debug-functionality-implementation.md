# Debug Functionality Implementation Plan

## Executive Summary

This plan describes how to replicate the oh-my-pi debug functionality in pi-mono. The debug system provides tools for debugging, bug report generation, profiling, and system diagnostics through an interactive menu.

## Problem Statement

pi-mono currently has a minimal debug implementation (`/debug` command) that only dumps TUI render output to a file. oh-my-pi has a comprehensive debug toolkit including:

- Interactive debug menu with multiple options
- CPU and heap profiling for performance analysis
- Log viewer with filtering, selection, and expansion
- Report bundle creation (tar.gz archives with session data, logs, system info)
- System information collection
- Artifact cache management
- Work scheduling flamegraphs (requires Bun-specific APIs)

## Goals

1. Create an interactive debug menu accessible via `/debug` command or keybinding
2. Implement CPU profiling using Node.js Inspector API
3. Implement heap snapshot generation using V8 API
4. Create a log viewer component with filtering and navigation
5. Implement report bundle creation for bug reports
6. Add system information collection and display
7. Add artifact cache management

## Non-Goals

- **Work scheduling flamegraphs** - This requires Bun-specific `getWorkProfile()` from `@oh-my-pi/pi-natives`. Can be added later if Node.js equivalent is found.

## Architecture

### File Structure

```
packages/coding-agent/src/core/debug/
├── index.ts              # Main debug selector component
├── log-formatting.ts     # Log line formatting utilities
├── log-viewer.ts         # Interactive log viewer TUI component
├── profiler.ts           # CPU and heap profiling
├── report-bundle.ts      # Report bundle creation
└── system-info.ts        # System information collection
```

### Dependencies

The debug module depends on:
- `@mariozechner/pi-tui` - TUI components (Container, Loader, SelectList, Text, etc.)
- `node:fs/promises` - File operations
- `node:os` - System information
- `node:inspector/promises` - CPU profiling
- `node:v8` - Heap snapshots
- `archiver` or `tar` - Tar.gz creation (npm package)

## Implementation Details

### 1. Config Additions

Add new path functions to `src/config.ts`:

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

### 2. Utility Functions

Add to `src/utils/` or appropriate location:

```typescript
// src/utils/format.ts
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}
	return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}
```

### 3. System Info Collection (`system-info.ts`)

```typescript
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
	const shell = process.env.SHELL ?? process.env.ComSpec ?? "unknown";
	const terminal = process.env.TERM_PROGRAM ?? process.env.TERM ?? undefined;

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
		`App:     ${APP_NAME} ${info.versions.app}`,
		`Node:    ${info.versions.node}`,
		`CWD:     ${info.cwd}`,
		`Shell:   ${info.shell}`,
	];
	if (info.terminal) {
		lines.push(`Terminal: ${info.terminal}`);
	}
	return lines.join("\n");
}

export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
	const SENSITIVE_PATTERNS = [
		/key/i,
		/secret/i,
		/token/i,
		/pass/i,
		/auth/i,
		/credential/i,
		/api/i,
		/private/i,
	];

	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		const isSensitive = SENSITIVE_PATTERNS.some((p) => p.test(k));
		result[k] = isSensitive ? "[REDACTED]" : v;
	}
	return result;
}
```

### 4. Profiler (`profiler.ts`)

```typescript
import * as v8 from "node:v8";
import { Session } from "node:inspector/promises";

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
			.filter((n) => n.selfTime > 0 && n.functionName !== "(root)" && n.functionName !== "(idle)")
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
	// Force GC before snapshot if possible
	if (global.gc) {
		global.gc();
	}

	// Use V8 heap snapshot - returns file path, read and delete it
	const snapshotPath = v8.writeHeapSnapshot();
	
	// Note: In Node.js, writeHeapSnapshot writes to a file and returns the path
	// We need to read it and then can optionally delete it
	return {
		data: snapshotPath, // Return path for report bundle to include
	};
}
```

### 5. Log Formatting (`log-formatting.ts`)

```typescript
import { replaceTabs, truncateToWidth } from "../tools/render-utils.js";

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

	return normalized.split("\n").flatMap((segment) => wrapText(segment, width));
}

export function parseDebugLogTimestampMs(line: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object") {
			return undefined;
		}
		const timestamp = (parsed as { timestamp?: unknown }).timestamp;
		if (typeof timestamp !== "string") {
			return undefined;
		}
		const timestampMs = Date.parse(timestamp);
		return Number.isFinite(timestampMs) ? timestampMs : undefined;
	} catch {
		return undefined;
	}
}

export function parseDebugLogPid(line: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object") {
			return undefined;
		}
		const pid = (parsed as { pid?: unknown }).pid;
		if (typeof pid !== "number") {
			return undefined;
		}
		return Number.isFinite(pid) ? pid : undefined;
	} catch {
		return undefined;
	}
}

// Helper functions that would normally come from natives
function sanitizeText(text: string): string {
	// Remove control characters except newlines
	return text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function wrapText(text: string, width: number): string[] {
	if (text.length <= width) {
		return [text];
	}
	const lines: string[] = [];
	let remaining = text;
	while (remaining.length > width) {
		lines.push(remaining.slice(0, width));
		remaining = remaining.slice(width);
	}
	if (remaining.length > 0) {
		lines.push(remaining);
	}
	return lines;
}
```

### 6. Report Bundle (`report-bundle.ts`)

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as tar from "tar"; // npm package: tar
import { APP_NAME, getLogPath, getLogsDir, getReportsDir } from "../../config.js";
import type { CpuProfile, HeapSnapshot } from "./profiler.js";
import { collectSystemInfo, sanitizeEnv } from "./system-info.js";

const MAX_LOG_LINES = 5000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

async function readLastLines(filePath: string, n: number, maxBytes = MAX_LOG_BYTES): Promise<string> {
	try {
		const stat = await fs.stat(filePath);
		const size = stat.size;
		const start = Math.max(0, size - maxBytes);
		
		const fd = await fs.open(filePath, "r");
		const buffer = Buffer.alloc(size - start);
		await fd.read(buffer, 0, buffer.length, start);
		await fd.close();
		
		const content = buffer.toString("utf-8");
		const lines = content.split("\n");
		
		// If we sliced mid-file, drop the first (partial) line
		if (start > 0 && lines.length > 0) {
			lines.shift();
		}
		return lines.slice(-n).join("\n");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
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
	const outputDir = path.join(reportsDir, `pi-report-${timestamp}`);
	await fs.mkdir(outputDir, { recursive: true });

	const files: string[] = [];

	// Collect system info
	const systemInfo = await collectSystemInfo();
	await fs.writeFile(path.join(outputDir, "system.json"), JSON.stringify(systemInfo, null, 2));
	files.push("system.json");

	// Sanitized environment
	await fs.writeFile(
		path.join(outputDir, "env.json"),
		JSON.stringify(sanitizeEnv(process.env as Record<string, string>), null, 2)
	);
	files.push("env.json");

	// Settings/config
	if (options.settings) {
		await fs.writeFile(path.join(outputDir, "config.json"), JSON.stringify(options.settings, null, 2));
		files.push("config.json");
	}

	// Recent logs (last 1000 lines)
	const logPath = getLogPath();
	const logs = await readLastLines(logPath, 1000);
	if (logs) {
		await fs.writeFile(path.join(outputDir, "logs.txt"), logs);
		files.push("logs.txt");
	}

	// Session file
	if (options.sessionFile) {
		try {
			const sessionContent = await fs.readFile(options.sessionFile, "utf-8");
			await fs.writeFile(path.join(outputDir, "session.jsonl"), sessionContent);
			files.push("session.jsonl");
		} catch {
			// Session file might not exist yet
		}

		// Artifacts directory
		const artifactsDir = options.sessionFile.slice(0, -6);
		await addDirectoryToArchive(outputDir, artifactsDir, "artifacts", files);

		// Subagent sessions
		const sessionDir = path.dirname(options.sessionFile);
		const sessionBasename = path.basename(options.sessionFile, ".jsonl");
		await addSubagentSessions(outputDir, sessionDir, sessionBasename, files);
	}

	// CPU profile
	if (options.cpuProfile) {
		await fs.writeFile(path.join(outputDir, "profile.cpuprofile"), options.cpuProfile.data);
		files.push("profile.cpuprofile");
		await fs.writeFile(path.join(outputDir, "profile.md"), options.cpuProfile.markdown);
		files.push("profile.md");
	}

	// Heap snapshot - copy from the generated path
	if (options.heapSnapshot) {
		try {
			const snapshotContent = await fs.readFile(options.heapSnapshot.data, "utf-8");
			await fs.writeFile(path.join(outputDir, "heap.heapsnapshot"), snapshotContent);
			files.push("heap.heapsnapshot");
			// Optionally delete the original
			await fs.unlink(options.heapSnapshot.data).catch(() => {});
		} catch {
			// Skip if can't read
		}
	}

	// Create tar.gz
	const outputPath = `${outputDir}.tar.gz`;
	await tar.create(
		{
			gzip: true,
			file: outputPath,
			cwd: reportsDir,
		},
		[`pi-report-${timestamp}`]
	);

	// Remove the directory after creating archive
	await fs.rm(outputDir, { recursive: true, force: true });

	return { path: outputPath, files };
}

async function addDirectoryToArchive(
	outputDir: string,
	dirPath: string,
	archivePrefix: string,
	files: string[]
): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const filePath = path.join(dirPath, entry.name);
			const archivePath = `${archivePrefix}/${entry.name}`;
			try {
				const content = await fs.readFile(filePath, "utf-8");
				await fs.writeFile(path.join(outputDir, archivePath), content);
				files.push(archivePath);
			} catch {
				// Skip files we can't read
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

async function addSubagentSessions(
	outputDir: string,
	sessionDir: string,
	parentBasename: string,
	files: string[]
): Promise<void> {
	try {
		const entries = await fs.readdir(sessionDir, { withFileTypes: true });
		const sessionFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith(".jsonl") && e.name !== `${parentBasename}.jsonl`)
			.map((e) => e.name);

		const sortedFiles = sessionFiles.sort().slice(-10);

		for (const filename of sortedFiles) {
			const filePath = path.join(sessionDir, filename);
			const archivePath = `subagents/${filename}`;
			try {
				const content = await fs.readFile(filePath, "utf-8");
				await fs.writeFile(path.join(outputDir, archivePath), content);
				files.push(archivePath);

				const artifactsDir = filePath.slice(0, -6);
				await addDirectoryToArchive(
					outputDir,
					artifactsDir,
					`subagents/${filename.slice(0, -6)}`,
					files
				);
			} catch {
				// Skip files we can't read
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

export async function getLogText(): Promise<string> {
	return readLastLines(getLogPath(), MAX_LOG_LINES);
}

export async function createDebugLogSource(): Promise<DebugLogSource> {
	const logsDir = getLogsDir();
	const todayPath = getLogPath();
	const todayName = path.basename(todayPath);
	
	const LOG_FILE_PATTERN = new RegExp(`^${APP_NAME}\\.(\\d{4}-\\d{2}-\\d{2})\\.log$`);
	
	let olderFiles: string[] = [];
	try {
		const entries = await fs.readdir(logsDir, { withFileTypes: true });
		const datedFiles = entries
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const match = LOG_FILE_PATTERN.exec(entry.name);
				return match ? { name: entry.name, date: match[1] } : undefined;
			})
			.filter((entry): entry is { name: string; date: string } => entry !== undefined)
			.filter((entry) => entry.name !== todayName)
			.sort((a, b) => b.date.localeCompare(a.date));
		olderFiles = datedFiles.map((entry) => entry.name);
	} catch {
		olderFiles = [];
	}

	let cursor = 0;

	const getInitialText = async (): Promise<string> => {
		return readLastLines(todayPath, MAX_LOG_LINES);
	};

	const hasOlderLogs = (): boolean => cursor < olderFiles.length;

	const loadOlderLogs = async (limitDays: number = 1): Promise<string> => {
		if (!hasOlderLogs()) {
			return "";
		}
		const count = Math.max(1, limitDays);
		const slice = olderFiles.slice(cursor, cursor + count);
		cursor += slice.length;
		const chunks: string[] = [];
		for (const filename of slice.reverse()) {
			const filePath = path.join(logsDir, filename);
			try {
				const content = await readLastLines(filePath, MAX_LOG_LINES);
				if (content.length > 0) {
					chunks.push(content);
				}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					throw err;
				}
			}
		}
		return chunks.filter((chunk) => chunk.length > 0).join("\n");
	};

	return {
		getInitialText,
		hasOlderLogs,
		loadOlderLogs,
	};
}

export async function getArtifactCacheStats(
	sessionsDir: string
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

### 7. Log Viewer (`log-viewer.ts`)

This is the most complex file - a full TUI component for viewing logs. The key features are:

- Model/view separation
- Cursor navigation and selection
- Filtering by text
- Process ID filtering
- Log expansion
- Loading older logs
- Copy to clipboard

Due to length, this should be ported directly from oh-my-pi with Node.js adaptations:

1. Replace `@oh-my-pi/pi-natives` imports with local implementations:
   - `copyToClipboard` -> use `../../utils/clipboard.js`
   - `sanitizeText` -> implement locally
   - `wrapTextWithAnsi` -> implement simple version

2. Replace `@oh-my-pi/pi-tui` imports with `@mariozechner/pi-tui`:
   - Most components should be compatible

### 8. Main Debug Selector (`index.ts`)

The main entry point with the interactive menu:

```typescript
import * as fs from "node:fs/promises";
import * as url from "node:url";
import { Container, Loader, type SelectItem, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { getSessionsDir } from "../../config.js";
import { type InteractiveModeContext } from "../types.js";
import { formatBytes } from "../../utils/format.js";
import { openPath } from "../../utils/open.js";
import { DebugLogViewerComponent } from "./log-viewer.js";
import { generateHeapSnapshotData, type ProfilerSession, startCpuProfile } from "./profiler.js";
import { clearArtifactCache, createDebugLogSource, createReportBundle, getArtifactCacheStats } from "./report-bundle.js";
import { collectSystemInfo, formatSystemInfo } from "./system-info.js";

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

// ... rest of DebugSelectorComponent implementation similar to oh-my-pi
```

### 9. Integration with Interactive Mode

Modify `src/modes/interactive/interactive-mode.ts`:

```typescript
// Add import
import { showDebugSelector } from "../../core/debug/index.js";

// Replace handleDebugCommand with:
private handleDebugCommand(): void {
	const selector = showDebugSelector(
		this.getContext(),
		() => {
			// Cleanup after selector closes
			this.editorContainer.clear();
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		}
	);
	this.editorContainer.clear();
	this.editorContainer.addChild(selector);
	this.ui.setFocus(selector);
}
```

### 10. Add tar Package Dependency

Add to `package.json`:
```json
{
  "dependencies": {
    "tar": "^7.0.0"
  }
}
```

Add types:
```bash
npm install -D @types/tar
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. Add new path functions to `config.ts`
2. Create `utils/format.ts` with formatBytes and formatDuration
3. Create `core/debug/system-info.ts`
4. Create `core/debug/profiler.ts`
5. Add `tar` package dependency

### Phase 2: Report Bundle
6. Create `core/debug/report-bundle.ts`
7. Test report bundle creation manually

### Phase 3: Log Viewer
8. Create `core/debug/log-formatting.ts`
9. Create `core/debug/log-viewer.ts` (port from oh-my-pi)
10. Test log viewer functionality

### Phase 4: Debug Menu
11. Create `core/debug/index.ts` with DebugSelectorComponent
12. Integrate with interactive mode
13. Add `openPath` utility if not present

### Phase 5: Testing & Polish
14. Add unit tests for debug utilities
15. Manual testing of all debug features
16. Documentation updates

## Potential Challenges

### 1. Node.js vs Bun API Differences

| Feature | Bun | Node.js Solution |
|---------|-----|------------------|
| `Bun.generateHeapSnapshot()` | Built-in | `v8.writeHeapSnapshot()` (writes to file) |
| `Bun.Archive.write()` | Built-in tar.gz | `tar` npm package |
| `Bun.file().text()` | Built-in | `fs.promises.readFile()` |
| `Bun.gc()` | Built-in | `global.gc()` (needs `--expose-gc` flag) |
| `Bun.version` | Built-in | `process.version` |
| `Bun.env` | Built-in | `process.env` |

### 2. Log File Format

The log viewer expects JSON-formatted log lines with `timestamp` and `pid` fields. pi-mono may need to ensure its logging outputs this format, or the parser needs to be adapted.

### 3. Work Profile Flamegraphs

The `getWorkProfile()` function from `@oh-my-pi/pi-natives` is Bun-specific and cannot be easily replicated in Node.js. This feature should be omitted or marked as Bun-only.

### 4. Clipboard Support

The `copyToClipboard` utility must work cross-platform. Verify pi-mono's implementation handles all terminals.

### 5. File Opening

The `openPath` utility for opening files/URLs must work cross-platform. If not present, implement using:
- macOS: `open <path>`
- Linux: `xdg-open <path>`
- Windows: `start <path>`

## Testing Strategy

### Unit Tests

1. **system-info.ts**
   - Test `collectSystemInfo()` returns expected fields
   - Test `sanitizeEnv()` redacts sensitive keys
   - Test `formatSystemInfo()` output format

2. **profiler.ts**
   - Test `startCpuProfile()` starts profiling
   - Test `ProfilerSession.stop()` returns valid profile
   - Test `generateHeapSnapshotData()` creates snapshot file

3. **report-bundle.ts**
   - Test `createReportBundle()` creates tar.gz
   - Test `getArtifactCacheStats()` counts correctly
   - Test `clearArtifactCache()` removes old files

4. **log-formatting.ts**
   - Test `parseDebugLogTimestampMs()` parses correctly
   - Test `parseDebugLogPid()` parses correctly
   - Test `formatDebugLogLine()` truncates properly

### Integration Tests

1. Debug menu opens and all options work
2. CPU profile captures real activity
3. Report bundle includes all expected files
4. Log viewer loads and navigates logs
5. Artifact cache clears correctly

### Manual Testing

1. Run `/debug` command
2. Test each menu option:
   - Open artifacts
   - Performance report (with actual profiling)
   - Session dump
   - Memory report
   - Log viewer navigation
   - System info display
   - Transcript export
   - Cache clearing

## Success Criteria

1. ✅ `/debug` command opens interactive menu
2. ✅ All menu options work without errors
3. ✅ CPU profiling captures and saves profile data
4. ✅ Heap snapshot generates valid .heapsnapshot file
5. ✅ Report bundle creates valid .tar.gz with all contents
6. ✅ Log viewer displays logs with filtering and navigation
7. ✅ System info shows correct environment details
8. ✅ Artifact cache management works correctly
9. ✅ All features work on macOS, Linux, and Windows
10. ✅ Unit tests pass with >80% coverage

## Future Enhancements

1. **Work Profile Flamegraphs** - If Node.js equivalent is found
2. **Remote Debugging** - Allow attaching to remote sessions
3. **Debug Dashboard** - Web UI for debugging
4. **Automated Bug Reports** - GitHub issue creation from reports
5. **Performance Timeline** - Visual timeline of session events

## References

- oh-my-pi debug implementation: `/home/mewtwo/Zykairotis/pi-mono/pi-guide/oh-my-pi/packages/coding-agent/src/debug/`
- Node.js Inspector API: https://nodejs.org/api/inspector.html
- V8 Heap Snapshot: https://nodejs.org/api/v8.html#v8writeheapsnapshotfilename
- tar npm package: https://www.npmjs.com/package/tar
