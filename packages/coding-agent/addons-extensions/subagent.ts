/**
 * Subagent Extension for pi coding agent.
 *
 * Each subagent is a real `pi` process spawned in the background.
 * - Main agent is free immediately after subagent_create returns
 * - Each subagent gets its own live-streaming widget
 * - On completion, result is delivered back as a follow-up message
 * - Supports conversation continuations via subagent_continue
 *
 * Tools for the main agent:
 *   subagent_create   — spawn a background subagent, returns ID immediately
 *   subagent_continue — continue a finished subagent's conversation
 *   subagent_list     — list all subagents and their status
 *   subagent_kill     — stop a running subagent
 *
 * Commands:
 *   /sub <task>       — spawn subagent (same as subagent_create)
 *   /subcont <id> <msg> — continue subagent conversation
 *   /subrm <id>       — remove subagent widget
 *   /subclear         — clear all subagent widgets
 *
 * Usage:
 *   pi -e addons-extensions/subagent.ts
 *
 * @module extensions/subagent
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, discoverAgents } from "@mariozechner/pi-coding-agent";
import { parseSessionEntries } from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import type { SubagentConfig } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ─────────────────────────────────────────────────────────────────────

type SpawnedBy = "main-agent" | "user";
type SubRunMode = "batch" | "interactive";

interface SubState {
	id: number;
	status: "running" | "done" | "error";
	task: string;
	spawnedBy: SpawnedBy;
	runMode: SubRunMode;
	agentName?: string;       // named agent from ~/.pi/agent/agents/ or builtins
	textChunks: string[];
	toolCount: number;
	elapsed: number;
	sessionFile: string;
	turnCount: number;
	proc?: ReturnType<typeof spawn>;
	tmuxSession?: string;     // set when running in a tmux session
	tmuxLinkedSession?: string; // session where the tmux window is linked for easy switching
	tmuxWindow?: string;      // set when running in a tmux window
	pollTimer?: ReturnType<typeof setInterval>; // polling timer for tmux mode
	retryTimer?: ReturnType<typeof setTimeout>;
	lastReportTimestamp?: number;
	attempt: number;
	startedThisAttempt: boolean;
	failureCount: number;
	lastError?: string;
	workingDir: string;
}

interface PendingSubagentResult {
	id: number;
	turnCount: number;
	task: string;
	result: string;
	completedAt: number;
	agentName?: string;
}

interface PendingSubagentSnapshot {
	version: 1;
	pendingResults: PendingSubagentResult[];
}

interface SubagentTurnReportEntry {
	version: 1;
	kind: "first_activity" | "tool_progress" | "turn" | "agent_end";
	turnIndex: number;
	text: string;
	toolCount: number;
	timestamp: number;
}

type SubagentLifecycleEventType = "started" | "retrying" | "error" | "recovered";

interface PendingSubagentLifecycleEvent {
	id: number;
	turnCount: number;
	task: string;
	type: SubagentLifecycleEventType;
	attempt: number;
	maxRetries: number;
	message: string;
	occurredAt: number;
	agentName?: string;
	nextRetrySeconds?: number;
}

interface PendingLifecycleSnapshot {
	version: 1;
	events: PendingSubagentLifecycleEvent[];
}

// ── Module state ──────────────────────────────────────────────────────────────

const agents: Map<number, SubState> = new Map();
let nextId = 1;
let widgetCtx: ExtensionContext | null = null;
let pendingMainAgentResults: PendingSubagentResult[] = [];
let pendingLifecycleEvents: PendingSubagentLifecycleEvent[] = [];
let autoIngestTriggerQueued = false;

// Agent configurations loaded from ~/.pi/agent/agents/ + builtins
let agentConfigs: Map<string, SubagentConfig> = new Map();

const PENDING_RESULTS_SNAPSHOT_TYPE = "subagent-pending-results";
const PENDING_LIFECYCLE_SNAPSHOT_TYPE = "subagent-pending-lifecycle";
const SUBAGENT_TURN_REPORT_TYPE = "subagent-turn-report";
const MAX_PENDING_RESULT_CHARS = 4_000;
const MAX_INJECTED_RESULT_CHARS = 2_000;
const MAX_PENDING_RESULTS_QUEUE = 32;
const MAX_PENDING_LIFECYCLE_QUEUE = 128;
const MAX_AUTO_INGEST_RESULTS_PER_TURN = 2;
const MAX_AUTO_INGEST_LIFECYCLE_EVENTS_PER_TURN = 8;
const SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS = 8;
const MAX_TRACKED_SUBAGENTS = 40;
const SUBAGENT_RESULT_CHAT_PREVIEW_CHARS = 220;
const AUTO_INGEST_TRIGGER_TEXT = "[subagent-auto-ingest]";
const DISPATCH_TOOL_NAMES = ["todo_write", "subagent_create", "subagent_continue", "subagent_list", "subagent_clear_finished"] as const;
const DISPATCH_TOOL_SET = new Set<string>(DISPATCH_TOOL_NAMES);
const CANONICAL_NONREGULAR_SUBAGENT_TOOL_NAMES = [...DISPATCH_TOOL_NAMES, "subagent_kill"] as const;
const CANONICAL_NONREGULAR_SUBAGENT_TOOL_SET = new Set<string>(CANONICAL_NONREGULAR_SUBAGENT_TOOL_NAMES);
const LEGACY_SUBAGENT_TOOL_NAMES = [
	"subagent",
	"subagent_start",
	"subagent_wait",
	"subagent_send",
	"subagent_stop",
] as const;
const LEGACY_SUBAGENT_TOOL_SET = new Set<string>(LEGACY_SUBAGENT_TOOL_NAMES);
const VALID_THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const DEFAULT_SUBAGENT_THINKING: ThinkingLevel = "high";
const START_ACTIVITY_TIMEOUT_MS = 45_000;
const SUBAGENT_MAX_RETRIES = 10;
const SUBAGENT_RETRY_DELAYS_SECONDS = [5, 15, 30, 15, 30, 15, 30, 15, 30, 15] as const;
const DEFAULT_SUBAGENT_TMUX_SESSION_PREFIX = "pi-subagent";

let defaultMainAgentTools: string[] = [];
let dispatchModeRequested = false;

function hasExplicitSubagentRequest(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	if (!normalized) return false;
	const patterns: RegExp[] = [
		/\buse\s+subagents?\b/i,
		/\bspawn\s+subagents?\b/i,
		/\bspawn\s+\d+\s+\w+\s+agents?\b/i,
		/\bspawn\s+\d+\s+agents?\b/i,
		/\buse\s+the\s+\w+\s+agent\b/i,
		/\b(?:scout|planner|worker|tester|reviewer|documenter|coder)\s+agents?\b/i,
		/\bdispatch\s+subagents?\b/i,
		/\bdelegate\s+to\s+subagents?\b/i,
		/\bparallel\s+subagents?\b/i,
		/\bparallel\b.*\bagents?\b/i,
		/\bsubagent_create\b/i,
	];
	const knownAgentNames = Array.from(agentConfigs.keys()).map((name) => name.toLowerCase());
	if (
		knownAgentNames.some(
			(name) =>
				normalized.includes(`${name} agent`) ||
				normalized.includes(`${name} agents`) ||
				(normalized.includes(name) && (normalized.includes("spawn") || normalized.includes("parallel"))),
		)
	) {
		return true;
	}
	return patterns.some((pattern) => pattern.test(normalized));
}

function setMainAgentToolMode(pi: ExtensionAPI, mode: "regular" | "dispatch"): void {
	const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
	if (mode === "dispatch") {
		const dispatchTools = DISPATCH_TOOL_NAMES.filter((toolName) => availableTools.has(toolName));
		if (dispatchTools.length > 0) {
			pi.setActiveTools(dispatchTools);
		}
		return;
	}

	const baseline = defaultMainAgentTools.length > 0 ? defaultMainAgentTools : pi.getActiveTools();
	const regularTools = baseline.filter(
		(toolName) =>
			availableTools.has(toolName) &&
			!CANONICAL_NONREGULAR_SUBAGENT_TOOL_SET.has(toolName) &&
			!LEGACY_SUBAGENT_TOOL_SET.has(toolName),
	);
	if (regularTools.length > 0) {
		pi.setActiveTools(regularTools);
	}
}

function filterLegacySubagentTools(toolNames: string[]): string[] {
	return toolNames.filter((toolName) => !LEGACY_SUBAGENT_TOOL_SET.has(toolName));
}

function buildLegacySubagentToolReason(toolName: string): string {
	return [
		`Legacy subagent tool "${toolName}" is disabled in this session.`,
		"Use the tmux-backed subagent tools instead:",
		"`subagent_create` for new background agents, `subagent_continue` for follow-up, and `subagent_list` to inspect running work.",
	].join(" ");
}

function loadAgentConfigs(cwd: string): void {
	agentConfigs.clear();
	const discovery = discoverAgents(cwd);
	for (const cfg of discovery.agents) {
		agentConfigs.set(cfg.name, cfg);
	}
}

function getAgentCatalog(): string {
	if (agentConfigs.size === 0) return "No named agents loaded.";
	return Array.from(agentConfigs.values())
		.map((a) => `- **${a.name}** (${a.source}): ${a.description}${a.tools ? ` [tools: ${a.tools.join(", ")}]` : ""}`)
		.join("\n");
}

// ── Session file helpers ──────────────────────────────────────────────────────

function makeSessionFile(id: number): string {
	const dir = join(homedir(), ".pi", "agent", "sessions", "subagents");
	mkdirSync(dir, { recursive: true });
	return join(dir, `subagent-${id}-${Date.now()}.jsonl`);
}

function makePromptFile(id: number, turnCount: number, prompt: string): string {
	const dir = join(homedir(), ".pi", "agent", "tmp", "subagents");
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `subagent-${id}-turn-${turnCount}-prompt-${Date.now()}.txt`);
	writeFileSync(filePath, prompt, "utf-8");
	return filePath;
}

function makeSystemPromptFile(id: number, turnCount: number, systemPrompt: string): string {
	const dir = join(homedir(), ".pi", "agent", "tmp", "subagents");
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `subagent-${id}-turn-${turnCount}-system-${Date.now()}.txt`);
	writeFileSync(filePath, systemPrompt, "utf-8");
	return filePath;
}

function makeJsonStreamRendererFile(id: number, turnCount: number): string {
	const dir = join(homedir(), ".pi", "agent", "tmp", "subagents");
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `subagent-${id}-turn-${turnCount}-json-renderer-${Date.now()}.cjs`);
	const script = String.raw`const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let emittedDeltaInMessage = false;

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "message_start") {
    emittedDeltaInMessage = false;
    return;
  }

  if (event.type === "message_update") {
    const part = event.assistantMessageEvent;
    if (part && part.type === "text_delta" && typeof part.delta === "string") {
      emittedDeltaInMessage = true;
      process.stdout.write(part.delta);
    }
    return;
  }

  if (event.type === "message_end") {
    if (!emittedDeltaInMessage) {
      const fallback = extractText(event.message);
      if (fallback) process.stdout.write(fallback);
    }
    process.stdout.write("\n");
    return;
  }

  if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
    process.stdout.write("\n[tool] " + event.toolName + "\n");
    return;
  }

  if (event.type === "error") {
    const msg = typeof event.error === "string" ? event.error : "Unknown error";
    process.stdout.write("\n[error] " + msg + "\n");
  }
});
`;
	writeFileSync(filePath, script, "utf-8");
	return filePath;
}

function truncateWithEllipsis(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 3)}...`;
}

function isSyntheticToolMarkerText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed === "[tool_execution_start]" || trimmed === "[tool_execution_end]";
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function getSafeProcessCwd(): string | undefined {
	try {
		return process.cwd();
	} catch {
		return undefined;
	}
}

function resolveValidWorkingDirectory(...candidates: Array<string | undefined>): string {
	const fallbacks = [getSafeProcessCwd(), process.env.PWD, homedir(), "/tmp", "/"];
	for (const candidate of [...candidates, ...fallbacks]) {
		if (!candidate) continue;
		const trimmed = candidate.trim();
		if (trimmed.length === 0) continue;
		let absolute = trimmed;
		try {
			absolute = resolve(trimmed);
		} catch {
			if (!trimmed.startsWith("/")) continue;
			absolute = trimmed;
		}
		try {
			if (existsSync(absolute) && statSync(absolute).isDirectory()) {
				return absolute;
			}
		} catch {
			// try next candidate
		}
	}
	return "/";
}

function getCurrentTmuxSession(): string | undefined {
	try {
		const session = execSync("tmux display-message -p '#S'", { encoding: "utf-8" }).trim();
		return session.length > 0 ? session : undefined;
	} catch {
		return undefined;
	}
}

function getPreferredDetachedTmuxSessionPrefix(): string {
	const configured = process.env.PI_SUBAGENT_TMUX_SESSION_PREFIX?.trim()
		?? process.env.PI_SUBAGENT_TMUX_SESSION?.trim();
	if (configured && configured.length > 0) return configured;
	return DEFAULT_SUBAGENT_TMUX_SESSION_PREFIX;
}

function sanitizeTmuxName(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return normalized.length > 0 ? normalized : DEFAULT_SUBAGENT_TMUX_SESSION_PREFIX;
}

function buildSubagentTmuxSessionName(state: SubState): string {
	const prefix = sanitizeTmuxName(getPreferredDetachedTmuxSessionPrefix());
	return `${prefix}-${state.id}`;
}

function ensureTmuxAvailable(): boolean {
	try {
		execSync("tmux -V", { encoding: "utf-8" });
		return true;
	} catch {
		return false;
	}
}

function clearExistingTmuxSession(sessionName: string): void {
	try {
		execSync(`tmux has-session -t ${shellQuote(sessionName)}`, { encoding: "utf-8" });
		execSync(`tmux kill-session -t ${shellQuote(sessionName)}`, { encoding: "utf-8" });
	} catch {
		// no existing session
	}
}

function createDetachedTmuxSession(
	sessionName: string,
	windowName: string,
	command: string,
	workingDir: string,
): { created: boolean } {
	try {
		clearExistingTmuxSession(sessionName);
		execSync(
			`tmux new-session -d -s ${shellQuote(sessionName)} -n ${shellQuote(windowName)} -c ${shellQuote(workingDir)} ${shellQuote(command)}`,
			{ encoding: "utf-8" },
		);
		return { created: true };
	} catch {
		return { created: false };
	}
}

function getSubagentTmuxLinkedWindowsEnabled(cwd: string): boolean {
	const envValue = process.env.PI_SUBAGENT_TMUX_LINKED_WINDOWS?.trim().toLowerCase();
	if (envValue === "1" || envValue === "true" || envValue === "yes" || envValue === "on") {
		return true;
	}
	if (envValue === "0" || envValue === "false" || envValue === "no" || envValue === "off") {
		return false;
	}
	try {
		return SettingsManager.create(resolveValidWorkingDirectory(cwd)).getSubagentTmuxLinkedWindows();
	} catch {
		return true;
	}
}

function shouldLinkSubagentTmuxWindow(cwd: string, currentSession?: string): boolean {
	if (currentSession?.trim()) {
		return true;
	}
	return getSubagentTmuxLinkedWindowsEnabled(cwd);
}

function buildTmuxLaunchPlan(
	session: string | undefined,
	currentSession?: string,
	linkIntoCurrentSession = true,
): {
	session?: string;
	linkedSession?: string;
} {
	if (!session) return { session: undefined, linkedSession: undefined };
	const normalizedCurrent = currentSession?.trim();
	return {
		session,
		linkedSession:
			linkIntoCurrentSession && normalizedCurrent && normalizedCurrent !== session ? normalizedCurrent : undefined,
	};
}

function resolveTmuxSessionForSubagent(state: SubState, linkIntoCurrentSession: boolean): {
	session?: string;
	linkedSession?: string;
} {
	if (!ensureTmuxAvailable()) return { session: undefined, linkedSession: undefined };
	return buildTmuxLaunchPlan(buildSubagentTmuxSessionName(state), getCurrentTmuxSession(), linkIntoCurrentSession);
}

function linkTmuxWindowIntoSession(sessionName: string, windowName: string, targetSession: string): boolean {
	try {
		execSync(
			`tmux link-window -d -s ${shellQuote(`${sessionName}:${windowName}`)} -t ${shellQuote(`${targetSession}:`)}`,
			{ encoding: "utf-8" },
		);
		return true;
	} catch {
		return false;
	}
}

function listTmuxWindowTargets(state: Pick<SubState, "tmuxSession" | "tmuxLinkedSession" | "tmuxWindow">): string[] {
	if (!state.tmuxWindow) return [];
	const targets: string[] = [];
	if (state.tmuxLinkedSession) {
		targets.push(`${state.tmuxLinkedSession}:${state.tmuxWindow}`);
	}
	if (state.tmuxSession && state.tmuxSession !== state.tmuxLinkedSession) {
		targets.push(`${state.tmuxSession}:${state.tmuxWindow}`);
	}
	return targets;
}

function clearTmuxTracking(state: SubState): void {
	state.tmuxSession = undefined;
	state.tmuxLinkedSession = undefined;
	state.tmuxWindow = undefined;
}

function closeTrackedTmuxWindow(state: SubState): void {
	for (const target of listTmuxWindowTargets(state)) {
		try {
			execSync(`tmux kill-window -t ${shellQuote(target)}`, {
				encoding: "utf-8",
			});
			clearTmuxTracking(state);
			return;
		} catch {
			// try the next target
		}
	}
	if (state.tmuxSession) {
		try {
			execSync(`tmux kill-session -t ${shellQuote(state.tmuxSession)}`, {
				encoding: "utf-8",
			});
		} catch {
			// ignore
		}
	}
	clearTmuxTracking(state);
}

function resolveTmuxAttachTarget(
	state: Pick<SubState, "tmuxSession" | "tmuxLinkedSession" | "tmuxWindow">,
	currentSession?: string,
): {
	session?: string;
	windowTarget?: string;
	attachSession?: string;
} {
	if (!state.tmuxSession || !state.tmuxWindow) {
		return { session: undefined, windowTarget: undefined, attachSession: undefined };
	}
	const attachSession = state.tmuxSession;
	const preferredSession = currentSession && state.tmuxLinkedSession === currentSession
		? currentSession
		: (state.tmuxLinkedSession ?? state.tmuxSession);
	if (!currentSession) {
		return {
			session: preferredSession,
			windowTarget: `${preferredSession}:${state.tmuxWindow}`,
			attachSession,
		};
	}
	return {
		session: preferredSession,
		windowTarget: `${preferredSession}:${state.tmuxWindow}`,
		attachSession,
	};
}

function focusTmuxTarget(session: string, windowTarget: string, currentSession?: string): void {
	if (currentSession && currentSession !== session) {
		execSync(`tmux switch-client -t ${shellQuote(session)}`, {
			encoding: "utf-8",
		});
	}
	execSync(`tmux select-window -t ${shellQuote(windowTarget)}`, {
		encoding: "utf-8",
	});
}

function textToolResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: Record<string, never>;
} {
	return {
		content: [{ type: "text", text }],
		details: {},
	};
}

export const __testing = {
	buildTmuxLaunchPlan,
	shouldLinkSubagentTmuxWindow,
	listTmuxWindowTargets,
	resolveTmuxAttachTarget,
	summarizeMainAgentSubagentBudget,
	buildMainAgentSubagentCreatePolicy,
	filterLegacySubagentTools,
	buildLegacySubagentToolReason,
	seedAgentStates(states: Array<Pick<SubState, "id" | "status" | "spawnedBy"> & Partial<Pick<SubState, "task" | "runMode" | "turnCount">>>) {
		agents.clear();
		for (const state of states) {
			agents.set(state.id, {
				id: state.id,
				status: state.status,
				task: state.task ?? `Task ${state.id}`,
				spawnedBy: state.spawnedBy,
				runMode: state.runMode ?? "interactive",
				textChunks: [],
				toolCount: 0,
				elapsed: 0,
				sessionFile: `/tmp/subagent-${state.id}.jsonl`,
				turnCount: state.turnCount ?? 1,
				attempt: 0,
				startedThisAttempt: false,
				failureCount: 0,
				workingDir: "/tmp",
			});
		}
		nextId = states.reduce((maxId, state) => Math.max(maxId, state.id), 0) + 1;
	},
	getAgentStates() {
		return Array.from(agents.values()).map((state) => ({
			id: state.id,
			status: state.status,
			spawnedBy: state.spawnedBy,
			task: state.task,
		}));
	},
	resetState() {
		agents.clear();
		nextId = 1;
		pendingMainAgentResults = [];
		pendingLifecycleEvents = [];
		autoIngestTriggerQueued = false;
		defaultMainAgentTools = [];
		dispatchModeRequested = false;
	},
};

interface MainAgentSubagentBudget {
	tracked: number;
	running: number;
	finished: number;
}

interface MainAgentSubagentCreatePolicy {
	block: boolean;
	reason?: string;
	warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingSubagentResult(value: unknown): value is PendingSubagentResult {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "number" &&
		typeof value.turnCount === "number" &&
		typeof value.task === "string" &&
		typeof value.result === "string" &&
		typeof value.completedAt === "number" &&
		(value.agentName === undefined || typeof value.agentName === "string")
	);
}

function isPendingSubagentSnapshot(value: unknown): value is PendingSubagentSnapshot {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		Array.isArray(value.pendingResults) &&
		value.pendingResults.every((result) => isPendingSubagentResult(result))
	);
}

function isSubagentTurnReportEntry(value: unknown): value is SubagentTurnReportEntry {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		(value.kind === "first_activity" || value.kind === "tool_progress" || value.kind === "turn" || value.kind === "agent_end") &&
		typeof value.turnIndex === "number" &&
		typeof value.text === "string" &&
		typeof value.toolCount === "number" &&
		typeof value.timestamp === "number"
	);
}

function hasRenderableReportText(report: SubagentTurnReportEntry): boolean {
	return report.text.trim().length > 0 && !isSyntheticToolMarkerText(report.text);
}

function hasFinalRenderableReportText(report: SubagentTurnReportEntry): boolean {
	if (report.kind !== "turn" && report.kind !== "agent_end") return false;
	return hasRenderableReportText(report);
}

function isPendingSubagentLifecycleEvent(value: unknown): value is PendingSubagentLifecycleEvent {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "number" &&
		typeof value.turnCount === "number" &&
		typeof value.task === "string" &&
		(value.type === "started" || value.type === "retrying" || value.type === "error" || value.type === "recovered") &&
		typeof value.attempt === "number" &&
		typeof value.maxRetries === "number" &&
		typeof value.message === "string" &&
		typeof value.occurredAt === "number" &&
		(value.agentName === undefined || typeof value.agentName === "string") &&
		(value.nextRetrySeconds === undefined || typeof value.nextRetrySeconds === "number")
	);
}

function isPendingLifecycleSnapshot(value: unknown): value is PendingLifecycleSnapshot {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		Array.isArray(value.events) &&
		value.events.every((event) => isPendingSubagentLifecycleEvent(event))
	);
}

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	if (!VALID_THINKING_LEVELS.has(value as ThinkingLevel)) return undefined;
	return value as ThinkingLevel;
}

function splitModelAndThinking(modelSpec: string | undefined): { model?: string; thinking?: ThinkingLevel } {
	if (!modelSpec) return {};
	const match = modelSpec.match(/^(.*):(off|minimal|low|medium|high|xhigh)$/);
	if (!match) return { model: modelSpec };
	const model = match[1].trim();
	const thinking = normalizeThinkingLevel(match[2]);
	return { model: model.length > 0 ? model : undefined, thinking };
}

function resolveSubagentExecutionConfig(
	agentCfg: SubagentConfig | undefined,
	mainModel: string | undefined,
): { model: string | undefined; thinking: ThinkingLevel } {
	const parsedAgentModel = splitModelAndThinking(agentCfg?.model);
	const agentThinking = normalizeThinkingLevel(agentCfg?.thinking);
	const thinking = agentThinking ?? parsedAgentModel.thinking ?? DEFAULT_SUBAGENT_THINKING;
	const model = parsedAgentModel.model ?? mainModel;
	return { model, thinking };
}

function extractTextFromMessage(message: unknown): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!isRecord(part)) return "";
			return typeof part.text === "string" ? part.text : "";
		})
		.filter((text) => text.length > 0)
		.join("\n");
}

function summarizeTmuxOutput(output: string): { text: string; toolCount: number } {
	const lines = output.split("\n");
	const visibleLines: string[] = [];
	let toolCount = 0;
	let streamedText = "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsedEvent: Record<string, unknown> | null = null;
		try {
			parsedEvent = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			parsedEvent = null;
		}

		if (parsedEvent) {
			if (parsedEvent.type === "message_update") {
				const delta = parsedEvent.assistantMessageEvent;
				if (isRecord(delta) && delta.type === "text_delta" && typeof delta.delta === "string") {
					streamedText += delta.delta;
				}
				continue;
			}

			if (parsedEvent.type === "message_end") {
				if (!streamedText.trim()) {
					const fallback = extractTextFromMessage(parsedEvent.message);
					if (fallback) streamedText = fallback;
				}
				continue;
			}

			if (parsedEvent.type === "tool_execution_start") {
				toolCount++;
				const toolName = typeof parsedEvent.toolName === "string" ? parsedEvent.toolName : "unknown";
				visibleLines.push(`[tool] ${toolName}`);
				continue;
			}

			if (parsedEvent.type === "error") {
				const err = typeof parsedEvent.error === "string" ? parsedEvent.error : "Unknown error";
				visibleLines.push(`[error] ${err}`);
				continue;
			}

			continue;
		}

		visibleLines.push(trimmed);
		if (/^\[tool\]\s+/i.test(trimmed)) {
			toolCount++;
		}
	}

	const text = [streamedText.trim(), ...visibleLines].filter((part) => part.length > 0).join("\n");
	return { text, toolCount };
}

function clonePendingResults(results: PendingSubagentResult[]): PendingSubagentResult[] {
	return results.map((result) => ({ ...result }));
}

function clonePendingLifecycleEvents(events: PendingSubagentLifecycleEvent[]): PendingSubagentLifecycleEvent[] {
	return events.map((event) => ({ ...event }));
}

function reconstructPendingResults(ctx: ExtensionContext): void {
	pendingMainAgentResults = [];
	pendingLifecycleEvents = [];
	autoIngestTriggerQueued = false;
	const entries = ctx.sessionManager.getBranch();
	if (!Array.isArray(entries)) return;
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType === PENDING_RESULTS_SNAPSHOT_TYPE && isPendingSubagentSnapshot(entry.data)) {
			pendingMainAgentResults = clonePendingResults(entry.data.pendingResults);
		}
		if (entry.customType === PENDING_LIFECYCLE_SNAPSHOT_TYPE && isPendingLifecycleSnapshot(entry.data)) {
			pendingLifecycleEvents = clonePendingLifecycleEvents(entry.data.events);
		}
	}
}

function persistPendingResults(pi: ExtensionAPI): void {
	pi.appendEntry(PENDING_RESULTS_SNAPSHOT_TYPE, {
		version: 1,
		pendingResults: clonePendingResults(pendingMainAgentResults),
	} satisfies PendingSubagentSnapshot);
}

function persistPendingLifecycleEvents(pi: ExtensionAPI): void {
	pi.appendEntry(PENDING_LIFECYCLE_SNAPSHOT_TYPE, {
		version: 1,
		events: clonePendingLifecycleEvents(pendingLifecycleEvents),
	} satisfies PendingLifecycleSnapshot);
}

function upsertPendingResult(result: PendingSubagentResult): void {
	const existingIdx = pendingMainAgentResults.findIndex(
		(item) => item.id === result.id && item.turnCount === result.turnCount,
	);
	if (existingIdx >= 0) {
		pendingMainAgentResults[existingIdx] = result;
	} else {
		pendingMainAgentResults.push(result);
	}
	pendingMainAgentResults.sort((a, b) => a.completedAt - b.completedAt);
	if (pendingMainAgentResults.length > MAX_PENDING_RESULTS_QUEUE) {
		pendingMainAgentResults = pendingMainAgentResults.slice(-MAX_PENDING_RESULTS_QUEUE);
	}
}

function appendLifecycleEvent(
	pi: ExtensionAPI,
	state: SubState,
	event: Omit<PendingSubagentLifecycleEvent, "id" | "turnCount" | "task" | "agentName" | "maxRetries" | "occurredAt">,
): void {
	if (state.spawnedBy !== "main-agent") return;
	pendingLifecycleEvents.push({
		id: state.id,
		turnCount: state.turnCount,
		task: state.task,
		agentName: state.agentName,
		maxRetries: SUBAGENT_MAX_RETRIES,
		occurredAt: Date.now(),
		...event,
	});
	pendingLifecycleEvents.sort((a, b) => a.occurredAt - b.occurredAt);
	if (pendingLifecycleEvents.length > MAX_PENDING_LIFECYCLE_QUEUE) {
		pendingLifecycleEvents = pendingLifecycleEvents.slice(-MAX_PENDING_LIFECYCLE_QUEUE);
	}
	persistPendingLifecycleEvents(pi);
}

function queueAutoIngest(pi: ExtensionAPI): void {
	if (autoIngestTriggerQueued) return;
	autoIngestTriggerQueued = true;
	pi.sendUserMessage(AUTO_INGEST_TRIGGER_TEXT, { deliverAs: "followUp" });
}

function formatLifecycleEvents(events: PendingSubagentLifecycleEvent[]): string {
	if (events.length === 0) return "";
	return events
		.map((event) => {
			const agentTag = event.agentName ? ` [${event.agentName}]` : "";
			if (event.type === "retrying") {
				return `- [retrying] Subagent #${event.id}${agentTag} turn ${event.turnCount}, attempt ${event.attempt}/${event.maxRetries}: ${event.message} (next retry in ${event.nextRetrySeconds ?? 0}s)`;
			}
			return `- [${event.type}] Subagent #${event.id}${agentTag} turn ${event.turnCount}, attempt ${event.attempt}: ${event.message}`;
		})
		.join("\n");
}

interface InjectedPromptOptions {
	remainingResults?: number;
	remainingLifecycleEvents?: number;
}

function buildInjectedPrompt(
	userText: string,
	results: PendingSubagentResult[] = pendingMainAgentResults,
	lifecycleEvents: PendingSubagentLifecycleEvent[] = pendingLifecycleEvents,
	options: InjectedPromptOptions = {},
): string {
	const sections = results.map((result) => {
		const agentTag = result.agentName ? ` [${result.agentName}]` : "";
		const body = truncateWithEllipsis(result.result, MAX_INJECTED_RESULT_CHARS);
		return [
			`Subagent #${result.id} (turn ${result.turnCount})${agentTag}`,
			`Task: ${result.task}`,
			"Result:",
			body,
		].join("\n");
	});

	const lifecycleSection = formatLifecycleEvents(lifecycleEvents);
	const remainingResults = options.remainingResults ?? 0;
	const remainingLifecycleEvents = options.remainingLifecycleEvents ?? 0;
	const hasRemaining = remainingResults > 0 || remainingLifecycleEvents > 0;

	return [
		...(lifecycleSection
			? [
				"Subagent lifecycle hooks (start/retry/error/recovered):",
				lifecycleSection,
				"",
				"Use these hooks to coordinate batch pacing, retries, and failure handling.",
				"",
			]
			: []),
		...(sections.length > 0
			? [
				"Completed subagent results to process now:",
				"",
				sections.join("\n\n"),
				"",
				"First, evaluate whether each result is clear and sufficient.",
				"If any result is unclear or incomplete, ask one concise clarification question before further tool calls.",
				"",
			]
			: ["No completed subagent result bodies are pending in this sync batch.", ""]),
		...(hasRemaining
			? [
				`Remaining queued after this batch: ${remainingResults} result${remainingResults === 1 ? "" : "s"}, ${remainingLifecycleEvents} lifecycle event${remainingLifecycleEvents === 1 ? "" : "s"}.`,
				"Process this batch now; remaining entries will be auto-injected in subsequent turns.",
				"",
			]
			: []),
		`User prompt: ${userText}`,
	].join("\n");
}

function dequeuePendingBatch(
	maxResults = MAX_AUTO_INGEST_RESULTS_PER_TURN,
	maxLifecycleEvents = MAX_AUTO_INGEST_LIFECYCLE_EVENTS_PER_TURN,
): {
	results: PendingSubagentResult[];
	lifecycleEvents: PendingSubagentLifecycleEvent[];
	remainingResults: number;
	remainingLifecycleEvents: number;
} {
	const results = pendingMainAgentResults.slice(0, maxResults);
	const lifecycleEvents = pendingLifecycleEvents.slice(0, maxLifecycleEvents);
	pendingMainAgentResults = pendingMainAgentResults.slice(results.length);
	pendingLifecycleEvents = pendingLifecycleEvents.slice(lifecycleEvents.length);
	return {
		results,
		lifecycleEvents,
		remainingResults: pendingMainAgentResults.length,
		remainingLifecycleEvents: pendingLifecycleEvents.length,
	};
}

function pullPendingResults(targetId?: number): PendingSubagentResult[] {
	if (targetId === undefined) {
		const results = pendingMainAgentResults;
		pendingMainAgentResults = [];
		return results;
	}

	const selected: PendingSubagentResult[] = [];
	const remaining: PendingSubagentResult[] = [];
	for (const result of pendingMainAgentResults) {
		if (result.id === targetId) selected.push(result);
		else remaining.push(result);
	}
	pendingMainAgentResults = remaining;
	return selected;
}

function pullPendingLifecycleEvents(targetId?: number): PendingSubagentLifecycleEvent[] {
	if (targetId === undefined) {
		const events = pendingLifecycleEvents;
		pendingLifecycleEvents = [];
		return events;
	}

	const selected: PendingSubagentLifecycleEvent[] = [];
	const remaining: PendingSubagentLifecycleEvent[] = [];
	for (const event of pendingLifecycleEvents) {
		if (event.id === targetId) selected.push(event);
		else remaining.push(event);
	}
	pendingLifecycleEvents = remaining;
	return selected;
}

function summarizeMainAgentSubagentBudget(states: Iterable<Pick<SubState, "spawnedBy" | "status">>): MainAgentSubagentBudget {
	let tracked = 0;
	let running = 0;
	let finished = 0;
	for (const state of states) {
		if (state.spawnedBy !== "main-agent") continue;
		tracked += 1;
		if (state.status === "running") {
			running += 1;
		} else {
			finished += 1;
		}
	}
	return { tracked, running, finished };
}

function buildMainAgentSubagentCreatePolicy(budget: MainAgentSubagentBudget): MainAgentSubagentCreatePolicy {
	if (budget.tracked < SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS) {
		return { block: false };
	}
	if (budget.finished > 0) {
		return {
			block: true,
			reason: [
				`Subagent soft limit reached: ${budget.tracked} tracked main-agent subagents (preferred max ${SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS}).`,
				"Reuse an existing finished thread with subagent_continue when possible.",
				"Otherwise call subagent_clear_finished to remove completed or errored main-agent subagents before spawning more.",
			].join(" "),
		};
	}
	const projectedTracked = budget.tracked + 1;
	return {
		block: false,
		warning: [
			`Soft-limit warning: this spawn increases tracked main-agent subagents to ${projectedTracked} (preferred max ${SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS}).`,
			"All tracked main-agent subagents are still running, so no finished threads are available to clear or reuse yet.",
			"Allowed anyway, but prefer waiting for current subagents to finish before expanding the team further.",
		].join(" "),
	};
}

function clearFinishedMainAgentSubagents(ctx: ExtensionContext): number {
	let removed = 0;
	for (const [id, state] of agents.entries()) {
		if (state.spawnedBy !== "main-agent" || state.status === "running") continue;
		ctx.ui.setWidget(`sub-${id}`, undefined);
		agents.delete(id);
		removed += 1;
	}
	if (removed > 0) {
		updateWidgets();
	}
	return removed;
}

function listSubagentLines(): string[] {
	return Array.from(agents.values()).map((a) => {
		const reusableLabel = a.status === "running" ? "" : " | reusable";
		return `#${a.id} [${a.status}] owner=${a.spawnedBy} Turn ${a.turnCount} | ${Math.round(a.elapsed / 1000)}s | Tools: ${a.toolCount}${reusableLabel}\n  Task: ${a.task}`;
	});
}

function pruneTrackedSubagents(ctx: ExtensionContext): void {
	if (agents.size <= MAX_TRACKED_SUBAGENTS) return;
	for (const [id, state] of agents.entries()) {
		if (agents.size <= MAX_TRACKED_SUBAGENTS) break;
		if (state.status === "running") continue;
		ctx.ui.setWidget(`sub-${id}`, undefined);
		agents.delete(id);
	}
}

// ── Widget rendering ──────────────────────────────────────────────────────────

function updateWidgets(): void {
	if (!widgetCtx) return;
	const ctx = widgetCtx;

	for (const [id, state] of agents.entries()) {
		const key = `sub-${id}`;
		ctx.ui.setWidget(key, (_tui, theme) => {
			const container = new Container();
			const borderFn = (s: string) => theme.fg("dim", s);
			container.addChild(new Text("", 0, 0)); // top margin
			container.addChild(new DynamicBorder(borderFn));
			const content = new Text("", 1, 0);
			container.addChild(content);
			container.addChild(new DynamicBorder(borderFn));

			return {
				render(width: number): string[] {
					const statusColor =
						state.status === "running" ? "accent" : state.status === "done" ? "success" : "error";
					const statusIcon =
						state.status === "running" ? "●" : state.status === "done" ? "✓" : "✗";

					const taskPreview =
						state.task.length > 45 ? `${state.task.slice(0, 42)}...` : state.task;

					const turnLabel =
						state.turnCount > 1 ? theme.fg("dim", ` · Turn ${state.turnCount}`) : "";

					const modeLabel = state.runMode === "interactive" ? "interactive" : "batch";
					const header =
						theme.fg(statusColor, `${statusIcon} Subagent #${state.id}`) +
						turnLabel +
						theme.fg("dim", ` [${modeLabel}]`) +
						theme.fg("dim", `  ${taskPreview}`) +
						theme.fg("dim", `  (${Math.round(state.elapsed / 1000)}s)`) +
						theme.fg("dim", ` | Tools: ${state.toolCount}`);

					// In tmux mode show window name; otherwise show last streamed line
					const preview = (() => {
						const fullText = state.textChunks.join("");
						const lastLine = fullText.split("\n").filter((l) => l.trim()).pop() ?? "";
						if (state.tmuxWindow) {
							const tmuxSession = state.tmuxLinkedSession ?? state.tmuxSession;
							const tmuxTarget = tmuxSession
								? `${tmuxSession}:${state.tmuxWindow}`
								: state.tmuxWindow;
							if (!lastLine) return `tmux: ${tmuxTarget} — /sub-attach ${state.id} to jump in`;
							const line = lastLine.length > width - 36
								? `${lastLine.slice(0, Math.max(0, width - 39))}...`
								: lastLine;
							return `tmux: ${tmuxTarget} | ${line}`;
						}
						return lastLine.length > width - 10
							? `${lastLine.slice(0, width - 13)}...`
							: lastLine;
					})();

					const lines = preview
						? [header, theme.fg("muted", `  ${preview}`)]
						: [header];

					content.setText(lines.join("\n"));
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
			};
		});
	}

	// Update footer status
	const running = Array.from(agents.values()).filter((a) => a.status === "running");
	if (running.length > 0) {
		ctx.ui.setStatus("subagents", `${running.length} subagent${running.length > 1 ? "s" : ""} running`);
	} else {
		ctx.ui.setStatus("subagents", undefined);
	}
}

// ── NDJSON streaming ──────────────────────────────────────────────────────────

function processLine(state: SubState, line: string, onFirstActivity: () => void): void {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line) as Record<string, unknown>;
		if (event.type === "message_update") {
			const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta") {
				state.textChunks.push((delta.delta as string) ?? "");
				onFirstActivity();
				updateWidgets();
			}
		} else if (event.type === "tool_execution_start") {
			state.toolCount++;
			onFirstActivity();
			updateWidgets();
		} else if (event.type === "message_end") {
			const text = extractTextFromMessage(event.message);
			if (text.trim().length > 0) {
				onFirstActivity();
			}
			updateWidgets();
		}
	} catch {
		// ignore non-JSON lines
	}
}

// ── Process spawning ──────────────────────────────────────────────────────────

/**
 * Resolve the pi CLI entry point.
 * Prefers running from source (tsx + cli.ts) when available,
 * so subagents use the current development code, not a stale global binary.
 */
const extensionFilePath = fileURLToPath(import.meta.url);
const extensionDirPath = dirname(extensionFilePath);

function resolvePiCommand(): { cmd: string; baseArgs: string[] } {
	// addons-extensions/subagent.ts → repo root is 2 levels up
	const repoRoot = resolve(extensionDirPath, "..", "..");
	const cliTs = join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
	if (existsSync(cliTs)) {
		return { cmd: "npx", baseArgs: ["tsx", cliTs] };
	}
	return { cmd: "pi", baseArgs: [] };
}

function resolveSubagentReporterExtensionPath(): string | undefined {
	const candidates = [
		join(extensionDirPath, "subagent-reporter.ts"),
		join(extensionDirPath, "subagent-reporter.js"),
	];
	return candidates.find((candidate) => existsSync(candidate));
}

const { cmd: piCmd, baseArgs: piBaseArgs } = resolvePiCommand();
const subagentReporterExtensionPath = resolveSubagentReporterExtensionPath();

/**
 * Read the last assistant message from a session JSONL file.
 */
function readLastOutput(sessionFile: string): string {
	if (!existsSync(sessionFile)) return "(no output)";
	try {
		const content = readFileSync(sessionFile, "utf-8");
		const entries = parseSessionEntries(content);
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message") {
				const msg = entry.message;
				if (msg.role === "assistant") {
					// Extract text content
					if (typeof msg.content === "string") return msg.content;
					if (Array.isArray(msg.content)) {
						return msg.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n");
					}
				}
			}
		}
	} catch {
		// ignore
	}
	return "(no output)";
}

function readSubagentTurnReports(sessionFile: string): SubagentTurnReportEntry[] {
	if (!existsSync(sessionFile)) return [];
	try {
		const content = readFileSync(sessionFile, "utf-8");
		const entries = parseSessionEntries(content);
		const reports: SubagentTurnReportEntry[] = [];
		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			if (entry.customType !== SUBAGENT_TURN_REPORT_TYPE) continue;
			if (isSubagentTurnReportEntry(entry.data)) {
				reports.push(entry.data);
			}
		}
		reports.sort((a, b) => a.timestamp - b.timestamp);
		return reports;
	} catch {
		// ignore
	}
	return [];
}

function readLatestSubagentTurnReport(sessionFile: string): SubagentTurnReportEntry | null {
	const reports = readSubagentTurnReports(sessionFile);
	return reports.length > 0 ? reports[reports.length - 1] : null;
}

function readSubagentTurnReportsSince(sessionFile: string, sinceTimestamp: number | undefined): SubagentTurnReportEntry[] {
	const reports = readSubagentTurnReports(sessionFile);
	if (sinceTimestamp === undefined) return reports;
	return reports.filter((report) => report.timestamp > sinceTimestamp);
}

/**
 * Spawn a subagent in a tmux window so the user can see live TUI output
 * and jump in to give manual instructions at any time.
 * Polls for tmux window exit, then reads session file for the result.
 */
function spawnAgent(pi: ExtensionAPI, state: SubState, prompt: string, ctx: ExtensionContext): void {
	const mainModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const windowName = `sub-${state.id}`;
	const shouldRunInteractive = state.runMode === "interactive";
	const agentCfg = state.agentName ? agentConfigs.get(state.agentName) : undefined;
	const executionConfig = resolveSubagentExecutionConfig(agentCfg, mainModel);
	const workingDir = resolveValidWorkingDirectory(state.workingDir, ctx.cwd);
	const currentTmuxSession = getCurrentTmuxSession();
	const linkTmuxWindows = shouldLinkSubagentTmuxWindow(workingDir, currentTmuxSession);
	state.workingDir = workingDir;

	state.attempt += 1;
	state.startedThisAttempt = false;
	if (state.attempt === 1) {
		state.failureCount = 0;
	}
	state.lastError = undefined;
	state.elapsed = 0;
	state.status = "running";
	state.toolCount = 0;
	state.textChunks = [];
	state.tmuxSession = undefined;
	state.tmuxLinkedSession = undefined;
	state.tmuxWindow = undefined;
	if (state.retryTimer) {
		clearTimeout(state.retryTimer);
		state.retryTimer = undefined;
	}

	const attempt = state.attempt;
	const startTime = Date.now();
	const initialReport = readLatestSubagentTurnReport(state.sessionFile);
	state.lastReportTimestamp = initialReport?.timestamp;
	let finalized = false;
	let startupTimer: ReturnType<typeof setTimeout> | undefined;
	let tmuxSession: string | null = null;
	let tmuxLinkedSession: string | null = null;

	const cleanupAttempt = (): void => {
		if (startupTimer) {
			clearTimeout(startupTimer);
			startupTimer = undefined;
		}
		if (state.pollTimer) {
			clearInterval(state.pollTimer);
			state.pollTimer = undefined;
		}
	};

	const markFirstActivity = (source: string): void => {
		if (state.attempt !== attempt) return;
		if (state.startedThisAttempt) return;
		state.startedThisAttempt = true;
		if (startupTimer) {
			clearTimeout(startupTimer);
			startupTimer = undefined;
		}
		if (state.spawnedBy === "main-agent") {
			appendLifecycleEvent(pi, state, {
				type: "started",
				attempt,
				message: `First activity observed (${source})`,
			});
			queueAutoIngest(pi);
		}
	};

	const scheduleRetry = (reason: string): boolean => {
		if (state.spawnedBy !== "main-agent") return false;
		const retryCount = attempt;
		if (retryCount > SUBAGENT_MAX_RETRIES) return false;
		const delaySeconds = SUBAGENT_RETRY_DELAYS_SECONDS[retryCount - 1];
		appendLifecycleEvent(pi, state, {
			type: "retrying",
			attempt,
			message: reason,
			nextRetrySeconds: delaySeconds,
		});
		queueAutoIngest(pi);
		state.textChunks = [`Retry ${retryCount}/${SUBAGENT_MAX_RETRIES} scheduled in ${delaySeconds}s: ${reason}`];
		updateWidgets();
		state.retryTimer = setTimeout(() => {
			state.retryTimer = undefined;
			if (state.attempt !== attempt) return;
			spawnAgent(pi, state, prompt, ctx);
		}, delaySeconds * 1000);
		return true;
	};

	const finalizeFailure = (reason: string): void => {
		if (finalized || state.attempt !== attempt) return;
		finalized = true;
		cleanupAttempt();
		state.elapsed = Date.now() - startTime;
		state.lastError = reason;
		state.failureCount += 1;
		if (state.tmuxWindow) {
			closeTrackedTmuxWindow(state);
		}
		if (state.proc) {
			try {
				state.proc.kill("SIGTERM");
			} catch {
				// ignore
			}
			state.proc = undefined;
		}

		if (scheduleRetry(reason)) {
			return;
		}

		state.status = "error";
		if (state.spawnedBy === "main-agent") {
			appendLifecycleEvent(pi, state, {
				type: "error",
				attempt,
				message: reason,
			});
			queueAutoIngest(pi);
		}
		updateWidgets();
		ctx.ui.notify(`Subagent #${state.id} failed: ${reason}`, "error");
	};

	const finalizeSuccess = (): void => {
		if (finalized || state.attempt !== attempt) return;
		finalized = true;
		cleanupAttempt();
		state.elapsed = Date.now() - startTime;
		state.proc = undefined;
		if (state.failureCount > 0 && state.spawnedBy === "main-agent" && attempt > 1) {
			appendLifecycleEvent(pi, state, {
				type: "recovered",
				attempt,
				message: `Recovered after ${attempt - 1} retry${attempt - 1 === 1 ? "" : "ies"}`,
			});
			queueAutoIngest(pi);
		}
		state.status = "done";
		clearTmuxTracking(state);
		updateWidgets();
		onAgentComplete(pi, state, ctx);
	};

	startupTimer = setTimeout(() => {
		if (finalized || state.attempt !== attempt) return;
		if (state.startedThisAttempt) return;
		finalizeFailure(`No activity observed within ${Math.round(START_ACTIVITY_TIMEOUT_MS / 1000)}s`);
	}, START_ACTIVITY_TIMEOUT_MS);

	const promptFile = shouldRunInteractive ? undefined : makePromptFile(state.id, state.turnCount, prompt);
	const systemPromptFile = agentCfg?.systemPrompt
		? makeSystemPromptFile(state.id, state.turnCount, agentCfg.systemPrompt)
		: undefined;
	const jsonRendererFile = shouldRunInteractive ? undefined : makeJsonStreamRendererFile(state.id, state.turnCount);
	const reporterArgs = subagentReporterExtensionPath ? ["-e", subagentReporterExtensionPath] : [];

	const piArgsList = shouldRunInteractive
		? [
			...piBaseArgs,
			"--session", state.sessionFile,
			...(state.turnCount > 1 ? ["-c"] : []),
			"--no-extensions",
			...reporterArgs,
			...(executionConfig.model ? ["--model", executionConfig.model] : []),
			...(agentCfg?.tools ? ["--tools", agentCfg.tools.join(",")] : []),
			...(systemPromptFile ? ["--append-system-prompt", systemPromptFile] : []),
			"--thinking", executionConfig.thinking,
			prompt,
		]
		: [
			...piBaseArgs,
			"--mode", "json",
			"-p",
			"--session", state.sessionFile,
			...(state.turnCount > 1 ? ["-c"] : []),
			"--no-extensions",
			...reporterArgs,
			...(executionConfig.model ? ["--model", executionConfig.model] : []),
			...(agentCfg?.tools ? ["--tools", agentCfg.tools.join(",")] : []),
			...(systemPromptFile ? ["--append-system-prompt", systemPromptFile] : []),
			"--thinking", executionConfig.thinking,
		];

	const piArgs = piArgsList.map(shellQuote).join(" ");
	const piInvocation = shouldRunInteractive
		? `${shellQuote(piCmd)} ${piArgs}`
		: `cat ${shellQuote(promptFile ?? "")} | ${shellQuote(piCmd)} ${piArgs} | node ${shellQuote(jsonRendererFile ?? "")}`;

	{
		const tmuxResolution = buildTmuxLaunchPlan(buildSubagentTmuxSessionName(state), currentTmuxSession, linkTmuxWindows);
		tmuxSession = tmuxResolution.session ?? null;
		tmuxLinkedSession = tmuxResolution.linkedSession ?? null;
	}

	if (tmuxSession) {
		const started = createDetachedTmuxSession(tmuxSession, windowName, piInvocation, workingDir);
		if (!started.created) {
			finalizeFailure("Failed to create detached tmux session for subagent.");
			return;
		}
		state.tmuxSession = tmuxSession;
		if (tmuxLinkedSession && linkTmuxWindowIntoSession(tmuxSession, windowName, tmuxLinkedSession)) {
			state.tmuxLinkedSession = tmuxLinkedSession;
		}
		state.tmuxWindow = windowName;

		const timer = setInterval(() => {
			if (state.attempt !== attempt || finalized) return;
			state.elapsed = Date.now() - startTime;
			try {
				try {
					execSync(`tmux has-session -t ${shellQuote(tmuxSession)}`, { encoding: "utf-8" });
				} catch {
					finalizeSuccess();
					return;
				}

				const windows = execSync(`tmux list-windows -t ${shellQuote(tmuxSession)} -F "#W"`, { encoding: "utf-8" })
					.split("\n")
					.map((window) => window.trim());

				if (!windows.includes(windowName)) {
					finalizeSuccess();
					return;
				}

				const paneOutput = execSync(
					`tmux capture-pane -t ${shellQuote(`${tmuxSession}:${windowName}`)} -p -S -120`,
					{ encoding: "utf-8" },
				);
				if (paneOutput.trim()) {
					const summary = summarizeTmuxOutput(paneOutput);
					state.textChunks = [(summary.text || paneOutput).slice(-12_000)];
					if (summary.toolCount > 0) {
						state.toolCount = Math.max(state.toolCount, summary.toolCount);
					}
					if (summary.text.trim().length > 0 || summary.toolCount > 0) {
						markFirstActivity("tmux output");
					}
				}

				const reports = readSubagentTurnReportsSince(state.sessionFile, state.lastReportTimestamp);
				for (const report of reports) {
					state.lastReportTimestamp = report.timestamp;
					state.toolCount = Math.max(state.toolCount, report.toolCount);
					if (report.kind === "first_activity" || report.kind === "tool_progress") {
						markFirstActivity("report first_activity");
					}
					if (hasFinalRenderableReportText(report)) {
						state.textChunks = [truncateWithEllipsis(report.text, 12_000)];
						markFirstActivity("report text");
					}
					if (shouldRunInteractive && state.spawnedBy === "main-agent" && report.kind === "agent_end") {
						closeTrackedTmuxWindow(state);
						finalizeSuccess();
						return;
					}
				}
				updateWidgets();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				finalizeFailure(`tmux monitoring error: ${message}`);
			}
		}, 1000);

		state.pollTimer = timer;
		updateWidgets();
		const modeLabel = shouldRunInteractive ? "interactive" : "batch";
		const linkedNotice = state.tmuxLinkedSession
			? ` Linked into current tmux session "${state.tmuxLinkedSession}" as window "${windowName}".`
			: "";
		ctx.ui.notify(
			`Subagent #${state.id} running in dedicated tmux session "${tmuxSession}" (${modeLabel}).${linkedNotice} Attach with: tmux attach -t ${tmuxSession}`,
			"info",
		);
		return;
	}

	if (shouldRunInteractive) {
		state.textChunks.push("Interactive mode requested but tmux is unavailable; falling back to batch mode.");
	}

	const args = [
		...piBaseArgs,
		"--mode", "json",
		"-p",
		"--session", state.sessionFile,
		...(state.turnCount > 1 ? ["-c"] : []),
		"--no-extensions",
		...reporterArgs,
		...(executionConfig.model ? ["--model", executionConfig.model] : []),
		...(agentCfg?.tools ? ["--tools", agentCfg.tools.join(",")] : []),
		...(systemPromptFile ? ["--append-system-prompt", systemPromptFile] : []),
		"--thinking", executionConfig.thinking,
		prompt,
	];

	const proc = spawn(piCmd, args, {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, PWD: workingDir },
		cwd: workingDir,
	});

	state.proc = proc;
	const timer = setInterval(() => {
		if (state.attempt !== attempt || finalized) return;
		state.elapsed = Date.now() - startTime;
		updateWidgets();
	}, 1000);
	state.pollTimer = timer;

	let buffer = "";

	proc.stdout?.setEncoding("utf-8");
	proc.stdout?.on("data", (chunk: string) => {
		if (state.attempt !== attempt || finalized) return;
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			processLine(state, line, () => markFirstActivity("stream activity"));
		}
	});

	proc.stderr?.setEncoding("utf-8");
	proc.stderr?.on("data", (chunk: string) => {
		if (state.attempt !== attempt || finalized) return;
		if (chunk.trim()) {
			state.textChunks.push(chunk);
			updateWidgets();
		}
	});

	proc.on("close", (code) => {
		if (state.attempt !== attempt || finalized) return;
		if (buffer.trim()) {
			processLine(state, buffer, () => markFirstActivity("stream activity"));
		}
		if (code === 0) {
			finalizeSuccess();
		} else {
			finalizeFailure(`Subagent process exited with code ${code ?? -1}`);
		}
	});

	proc.on("error", (err) => {
		if (state.attempt !== attempt || finalized) return;
		finalizeFailure(`Subagent process error: ${err.message}`);
	});
}

/**
 * Called when a subagent finishes (tmux window closed or process exited).
 * Reads the session file for the last assistant output and delivers it back.
 */
function onAgentComplete(pi: ExtensionAPI, state: SubState, ctx: ExtensionContext): void {
	const reports = readSubagentTurnReports(state.sessionFile);
	const latestReport = reports.length > 0 ? reports[reports.length - 1] : null;
	let latestRenderableReport: SubagentTurnReportEntry | null = null;
	for (let i = reports.length - 1; i >= 0; i--) {
		if (hasFinalRenderableReportText(reports[i])) {
			latestRenderableReport = reports[i];
			break;
		}
	}
	const result = latestRenderableReport?.text ?? readLastOutput(state.sessionFile);
	if (latestReport !== null) {
		state.toolCount = Math.max(state.toolCount, latestReport.toolCount);
		state.lastReportTimestamp = latestReport.timestamp;
	}
	const normalizedResult = truncateWithEllipsis(result, MAX_PENDING_RESULT_CHARS);
	const turnLabel = state.turnCount > 1 ? ` (Turn ${state.turnCount})` : "";

	ctx.ui.notify(
		`Subagent #${state.id} finished in ${Math.round(state.elapsed / 1000)}s`,
		"info",
	);

	if (state.spawnedBy === "main-agent") {
		upsertPendingResult({
			id: state.id,
			turnCount: state.turnCount,
			task: state.task,
			result: normalizedResult,
			completedAt: Date.now(),
			agentName: state.agentName,
		});
		persistPendingResults(pi);
		queueAutoIngest(pi);
		ctx.ui.notify(
			`Subagent #${state.id} result queued and scheduled for main-agent processing.`,
			"info",
		);
	}

	pruneTrackedSubagents(ctx);
	const normalizedPreview = truncateWithEllipsis(
		normalizedResult.replace(/\s+/g, " ").trim(),
		SUBAGENT_RESULT_CHAT_PREVIEW_CHARS,
	);
	const completionContent = state.spawnedBy === "main-agent"
		? `Subagent #${state.id}${turnLabel} finished "${state.task}" in ${Math.round(state.elapsed / 1000)}s.\nResult queued for orchestration.${normalizedPreview ? ` Preview: ${normalizedPreview}` : ""}`
		: `Subagent #${state.id}${turnLabel} finished "${state.task}" in ${Math.round(state.elapsed / 1000)}s.\n\nResult:\n${normalizedResult}`;

	// Always show completion in chat history (lightweight for main-agent-spawned subagents).
	pi.sendMessage(
		{
			customType: "subagent_result",
			content: completionContent,
			display: true,
			details: {
				id: state.id,
				spawnedBy: state.spawnedBy,
				turnCount: state.turnCount,
				agentName: state.agentName,
			},
		},
		{ deliverAs: "followUp", triggerTurn: false },
	);
}

// ── Kill helper ───────────────────────────────────────────────────────────────

function killAgent(state: SubState): void {
	if (state.pollTimer) {
		clearInterval(state.pollTimer);
		state.pollTimer = undefined;
	}
	if (state.retryTimer) {
		clearTimeout(state.retryTimer);
		state.retryTimer = undefined;
	}
	if (state.proc) {
		state.proc.kill("SIGTERM");
		state.proc = undefined;
	}
	if (state.tmuxWindow) {
		closeTrackedTmuxWindow(state);
	}
	state.status = "error";
	state.startedThisAttempt = false;
}

function buildDispatcherPrompt(catalog: string): string {
	return `
## Dispatcher Mode

You are an orchestrator. You have FIVE tools: \`todo_write\`, \`subagent_create\`, \`subagent_continue\`, \`subagent_list\`, and \`subagent_clear_finished\`. No file access. No shell. No search.

### Agent roster
${catalog}

### Dispatching (when user gives you a task)
1. Identify independent sub-tasks
2. Before each dispatch, ensure todo tracking is up to date via \`todo_write\`:
   - If needed, add a todo item
   - Ensure the dispatched item is marked \`in_progress\`
3. Treat ${SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS} tracked main-agent subagents as a soft orchestration budget
4. If you are near or above that budget, inspect current agents with \`subagent_list\`
5. Prefer \`subagent_continue\` for follow-up on existing finished threads instead of creating replacements
6. If finished or errored main-agent subagents are cluttering the board, call \`subagent_clear_finished\` before dispatching a fresh batch
7. Call \`subagent_create\` once per genuinely new sub-task — all in the SAME response, they run in parallel
8. Each brief must be 100% self-contained: goal, file paths, context, constraints, output format
9. Every brief must require the subagent to return the minimum useful result only: no progress chatter, no repeated plan restatements, no long file inventories unless needed
10. After ALL tool calls, write ONLY this — nothing more:

Dispatched N agent(s):
- [agent-type] brief summary of mission
- [agent-type] brief summary of mission

Then STOP. No filler. No "I'll wait". No follow-up tool calls.

### When results arrive
- Update todo status via \`todo_write\` (for example, mark work \`completed\` or \`abandoned\`)
- Synthesize all results and respond directly to the user
- If a result is insufficient, prefer \`subagent_continue\` on the same subagent for follow-up; only create a new subagent for truly independent workstreams
- If a subagent returns repetitive planning chatter or obvious no-progress output, send a short corrective follow-up with \`subagent_continue\` instead of echoing the chatter

### Hard rules
- Your response after dispatching must be < 5 lines
- NEVER make tool calls after the dispatch summary
- NEVER attempt direct file/shell access
- ALWAYS write self-contained briefs
- NEVER ask subagents for ongoing progress reports
- ALWAYS keep todo state synchronized with dispatches/results using \`todo_write\`
- ALWAYS dispatch independent tasks in parallel (same response, multiple tool calls)
- Going beyond ${SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS} tracked main-agent subagents is bad practice; only do it when every tracked subagent is still actively running and nothing can be reused or cleared first`;
}

// ── Extension entry point ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Tools ──────────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "subagent_create",
		label: "Dispatch Agent",
		description: [
			"Dispatch a fully autonomous background agent to complete a task.",
			"Returns immediately — call this multiple times in parallel for concurrent work.",
			"The task description must be entirely self-contained: include all relevant file paths,",
			"context, goals, constraints, and expected output format.",
			"The agent has no access to this conversation — write as if briefing a colleague cold.",
			"Results are delivered automatically when the agent finishes. Do not poll or follow up.",
			"Use the 'agent' parameter to pick a specialist from the available agent roster.",
			`Prefer staying within ${SOFT_MAX_MAIN_AGENT_TRACKED_SUBAGENTS} tracked main-agent subagents; reuse or clear finished threads before expanding further.`,
		].join(" "),
		parameters: Type.Object({
			task: Type.String({
				description: [
					"Complete, self-contained task brief for the agent.",
					"Include: goal, relevant file paths, context, constraints, expected output.",
					"The agent has zero access to this conversation — write a full cold brief.",
				].join(" "),
			}),
			agent: Type.Optional(Type.String({
				description: "Specialist agent to use (e.g. 'scout', 'worker', 'planner', 'reviewer', 'tester', 'coder'). Omit for general-purpose worker.",
			})),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx = ctx;

			// Validate agent name if provided
			if (args.agent && !agentConfigs.has(args.agent)) {
				const available = Array.from(agentConfigs.keys()).join(", ") || "none";
				return textToolResult(`Unknown agent "${args.agent}". Available: ${available}`);
			}
			pruneTrackedSubagents(ctx);
			if (agents.size >= MAX_TRACKED_SUBAGENTS) {
				return textToolResult(
					`Subagent capacity reached (${MAX_TRACKED_SUBAGENTS} tracked entries). Remove old entries with /subrm or /subclear before spawning more.`,
				);
			}
			const budget = summarizeMainAgentSubagentBudget(agents.values());
			const createPolicy = buildMainAgentSubagentCreatePolicy(budget);
			if (createPolicy.block) {
				return textToolResult(createPolicy.reason ?? "Subagent creation blocked.");
			}

			const id = nextId++;
			const agentName = args.agent ?? "worker";
			const state: SubState = {
				id,
				status: "running",
				task: args.task,
				spawnedBy: "main-agent",
				runMode: "interactive",
				agentName,
				textChunks: [],
				toolCount: 0,
				elapsed: 0,
				sessionFile: makeSessionFile(id),
				turnCount: 1,
				attempt: 0,
				startedThisAttempt: false,
				failureCount: 0,
				workingDir: resolveValidWorkingDirectory(ctx.cwd),
			};
			agents.set(id, state);
			updateWidgets();

			// Fire-and-forget — main agent is free immediately
			spawnAgent(pi, state, args.task, ctx);

			const agentLabel = agentConfigs.get(agentName)?.description
				? `${agentName} (${agentConfigs.get(agentName)?.description})`
				: agentName;
			if (createPolicy.warning) {
				ctx.ui.notify(createPolicy.warning, "warning");
			}

			return textToolResult(
				[
					`Subagent #${id} [${agentLabel}] spawned and running in background. Results will appear when done.`,
					...(createPolicy.warning ? [createPolicy.warning] : []),
				].join(" "),
			);
		},
	});

	pi.registerTool({
		name: "subagent_continue",
		label: "Continue Subagent",
		description:
			"Send a follow-up message to a finished subagent, continuing its conversation history. Returns immediately while it runs in the background.",
		parameters: Type.Object({
			id: Type.Number({ description: "ID of the subagent to continue" }),
			prompt: Type.String({ description: "Follow-up instructions or message" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx = ctx;
			const state = agents.get(args.id);
			if (!state) {
				return textToolResult(`Error: No subagent #${args.id} found.`);
			}
			if (state.status === "running") {
				return textToolResult(`Error: Subagent #${args.id} is still running.`);
			}

			state.status = "running";
			state.task = args.prompt;
			state.spawnedBy = "main-agent";
			state.runMode = "interactive";
			state.textChunks = [];
			state.elapsed = 0;
			state.turnCount++;
			state.attempt = 0;
			state.startedThisAttempt = false;
			state.failureCount = 0;
			state.lastReportTimestamp = undefined;
			state.workingDir = resolveValidWorkingDirectory(ctx.cwd, state.workingDir);
			updateWidgets();

			spawnAgent(pi, state, args.prompt, ctx);

			return textToolResult(`Subagent #${args.id} continuing (Turn ${state.turnCount}). Results will appear when done.`);
		},
	});

	pi.registerTool({
		name: "subagent_list",
		label: "List Subagents",
		description: "List all subagents and their current status.",
		parameters: Type.Object({}),
		execute: async (_callId, _args, _signal, _onUpdate, _ctx) => {
			if (agents.size === 0) {
				return textToolResult("No subagents.");
			}
			return textToolResult(listSubagentLines().join("\n\n"));
		},
	});

	pi.registerTool({
		name: "subagent_clear_finished",
		label: "Clear Finished Subagents",
		description: "Remove completed or errored main-agent subagents from the tracked board. Running subagents are preserved.",
		parameters: Type.Object({}),
		execute: async (_callId, _args, _signal, _onUpdate, ctx) => {
			widgetCtx = ctx;
			const removed = clearFinishedMainAgentSubagents(ctx);
			if (removed === 0) {
				return textToolResult("No completed or errored main-agent subagents to clear.");
			}
			return textToolResult(`Cleared ${removed} completed or errored main-agent subagent${removed === 1 ? "" : "s"}.`);
		},
	});

	pi.registerTool({
		name: "subagent_kill",
		label: "Kill Subagent",
		description: "Stop a running subagent.",
		parameters: Type.Object({
			id: Type.Number({ description: "ID of the subagent to stop" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, _ctx) => {
			const state = agents.get(args.id);
			if (!state) {
				return textToolResult(`No subagent #${args.id} found.`);
			}
			killAgent(state);
			updateWidgets();
			return textToolResult(`Subagent #${args.id} stopped.`);
		},
	});

	// ── Dispatcher system prompt ───────────────────────────────────────────────

	pi.on("before_agent_start", async (event) => {
		if (!dispatchModeRequested) return;
		const catalog = getAgentCatalog();

		return {
			systemPrompt: `${event.systemPrompt}\n${buildDispatcherPrompt(catalog)}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (LEGACY_SUBAGENT_TOOL_SET.has(event.toolName)) {
			return {
				block: true,
				reason: buildLegacySubagentToolReason(event.toolName),
			};
		}
		if (event.toolName !== "subagent_create") return undefined;
		pruneTrackedSubagents(ctx);
		if (agents.size >= MAX_TRACKED_SUBAGENTS) {
			return {
				block: true,
				reason: `Subagent capacity reached (${MAX_TRACKED_SUBAGENTS} tracked entries). Remove old entries with /subrm or /subclear before spawning more.`,
			};
		}
		const createPolicy = buildMainAgentSubagentCreatePolicy(summarizeMainAgentSubagentBudget(agents.values()));
		if (!createPolicy.block) return undefined;
		return {
			block: true,
			reason: createPolicy.reason,
		};
	});

	pi.on("input", async (event) => {
		const trimmed = event.text.trim();
		const isAutoIngestTrigger = event.source === "extension" && trimmed === AUTO_INGEST_TRIGGER_TEXT;
		const hasPendingResults = pendingMainAgentResults.length > 0;
		const hasPendingLifecycleEvents = pendingLifecycleEvents.length > 0;
		if (!hasPendingResults && !hasPendingLifecycleEvents) {
			if (isAutoIngestTrigger) {
				autoIngestTriggerQueued = false;
				dispatchModeRequested = false;
				setMainAgentToolMode(pi, "regular");
				return { action: "handled" };
			}
			if (event.source !== "extension" && !trimmed.startsWith("/")) {
				dispatchModeRequested = hasExplicitSubagentRequest(trimmed);
				setMainAgentToolMode(pi, dispatchModeRequested ? "dispatch" : "regular");
			}
			return { action: "continue" };
		}
		if (!trimmed) return { action: "continue" };
		if (trimmed.startsWith("/")) return { action: "continue" };
		if (event.source === "extension" && !isAutoIngestTrigger) return { action: "continue" };
		dispatchModeRequested = true;
		setMainAgentToolMode(pi, "dispatch");
		const {
			results: selectedResults,
			lifecycleEvents: selectedLifecycleEvents,
			remainingResults,
			remainingLifecycleEvents,
		} = dequeuePendingBatch();

		const transformedText = buildInjectedPrompt(
			isAutoIngestTrigger ? "Process completed subagent results now." : event.text,
			selectedResults,
			selectedLifecycleEvents,
			{
				remainingResults,
				remainingLifecycleEvents,
			},
		);
		autoIngestTriggerQueued = false;
		persistPendingResults(pi);
		persistPendingLifecycleEvents(pi);
		return {
			action: "transform",
			text: transformedText,
			images: event.images,
		};
	});

	pi.on("agent_end", async () => {
		if (dispatchModeRequested) {
			dispatchModeRequested = false;
			setMainAgentToolMode(pi, "regular");
		}
		if ((pendingMainAgentResults.length > 0 || pendingLifecycleEvents.length > 0) && !autoIngestTriggerQueued) {
			queueAutoIngest(pi);
		}
	});

	// Initialize baseline tool mode for main-agent turns.
	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx;
		reconstructPendingResults(ctx);

		// Load agent configs from ~/.pi/agent/agents/ and builtins
		loadAgentConfigs(resolveValidWorkingDirectory(ctx.cwd));
		if (!subagentReporterExtensionPath) {
			ctx.ui.notify(
				"subagent-reporter extension file not found; subagent previews/tool counts may be limited.",
				"warning",
			);
		}

		// Clean up from previous session
		for (const [id, state] of agents.entries()) {
			killAgent(state);
			ctx.ui.setWidget(`sub-${id}`, undefined);
		}
		agents.clear();
		nextId = 1;
		defaultMainAgentTools = filterLegacySubagentTools(pi.getActiveTools());
		dispatchModeRequested = false;
		setMainAgentToolMode(pi, "regular");
	});

	pi.on("session_switch", async (_event, ctx) => {
		reconstructPendingResults(ctx);
		dispatchModeRequested = false;
		setMainAgentToolMode(pi, "regular");
	});

	pi.on("session_fork", async (_event, ctx) => {
		reconstructPendingResults(ctx);
		dispatchModeRequested = false;
		setMainAgentToolMode(pi, "regular");
	});

	pi.on("session_tree", async (_event, ctx) => {
		reconstructPendingResults(ctx);
		dispatchModeRequested = false;
		setMainAgentToolMode(pi, "regular");
	});

	// ── Slash commands ─────────────────────────────────────────────────────────

	pi.registerCommand("sub", {
		description: "Spawn a background subagent: /sub <task>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /sub <task>", "warning");
				return;
			}
			pruneTrackedSubagents(ctx);
			if (agents.size >= MAX_TRACKED_SUBAGENTS) {
				ctx.ui.notify(
					`Subagent capacity reached (${MAX_TRACKED_SUBAGENTS} tracked entries). Remove old entries with /subrm or /subclear first.`,
					"warning",
				);
				return;
			}
			const id = nextId++;
			const state: SubState = {
				id,
				status: "running",
				task,
				spawnedBy: "user",
				runMode: "interactive",
				textChunks: [],
				toolCount: 0,
				elapsed: 0,
				sessionFile: makeSessionFile(id),
				turnCount: 1,
				attempt: 0,
				startedThisAttempt: false,
				failureCount: 0,
				workingDir: resolveValidWorkingDirectory(ctx.cwd),
			};
			agents.set(id, state);
			updateWidgets();
			spawnAgent(pi, state, task, ctx);
			ctx.ui.notify(`Subagent #${id} spawned.`, "info");
		},
	});

	pi.registerCommand("subcont", {
		description: "Continue a subagent conversation: /subcont <id> <message>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const match = args.trim().match(/^(\d+)\s+(.+)$/s);
			if (!match) {
				ctx.ui.notify("Usage: /subcont <id> <message>", "warning");
				return;
			}
			const num = parseInt(match[1], 10);
			const prompt = match[2].trim();
			const state = agents.get(num);
			if (!state) {
				ctx.ui.notify(`No subagent #${num} found.`, "error");
				return;
			}
			if (state.status === "running") {
				ctx.ui.notify(`Subagent #${num} is still running.`, "warning");
				return;
			}
			state.status = "running";
			state.task = prompt;
			state.spawnedBy = "user";
			state.runMode = "interactive";
			state.textChunks = [];
			state.elapsed = 0;
			state.turnCount++;
			state.attempt = 0;
			state.startedThisAttempt = false;
			state.failureCount = 0;
			state.lastReportTimestamp = undefined;
			state.workingDir = resolveValidWorkingDirectory(ctx.cwd, state.workingDir);
			updateWidgets();
			ctx.ui.notify(`Continuing Subagent #${num} (Turn ${state.turnCount})…`, "info");
			spawnAgent(pi, state, prompt, ctx);
		},
	});

	pi.registerCommand("sub-sync", {
		description: "Inject completed main-agent subagent results now: /sub-sync [id]",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const raw = args.trim();
			let targetId: number | undefined;
			if (raw.length > 0) {
				targetId = parseInt(raw, 10);
				if (isNaN(targetId)) {
					ctx.ui.notify("Usage: /sub-sync [id]", "warning");
					return;
				}
			}

			let selectedResults: PendingSubagentResult[] = [];
			let selectedLifecycleEvents: PendingSubagentLifecycleEvent[] = [];
			let remainingResults = pendingMainAgentResults.length;
			let remainingLifecycleEvents = pendingLifecycleEvents.length;
			if (targetId === undefined) {
				const batch = dequeuePendingBatch();
				selectedResults = batch.results;
				selectedLifecycleEvents = batch.lifecycleEvents;
				remainingResults = batch.remainingResults;
				remainingLifecycleEvents = batch.remainingLifecycleEvents;
			} else {
				selectedResults = pullPendingResults(targetId);
				selectedLifecycleEvents = pullPendingLifecycleEvents(targetId);
				remainingResults = pendingMainAgentResults.length;
				remainingLifecycleEvents = pendingLifecycleEvents.length;
			}
			if (selectedResults.length === 0 && selectedLifecycleEvents.length === 0) {
				ctx.ui.notify(
					targetId === undefined
						? "No pending main-agent subagent results or lifecycle events."
						: `No pending entries found for subagent #${targetId}.`,
					"info",
				);
				return;
			}

			persistPendingResults(pi);
			persistPendingLifecycleEvents(pi);
			autoIngestTriggerQueued = false;
			dispatchModeRequested = true;
			setMainAgentToolMode(pi, "dispatch");

			const promptText = buildInjectedPrompt(
				"Process completed subagent results now.",
				selectedResults,
				selectedLifecycleEvents,
				{
					remainingResults,
					remainingLifecycleEvents,
				},
			);
			pi.sendUserMessage(promptText, { deliverAs: "followUp" });
			if ((remainingResults > 0 || remainingLifecycleEvents > 0) && !autoIngestTriggerQueued) {
				queueAutoIngest(pi);
			}
			ctx.ui.notify(
				targetId === undefined
					? `Sent ${selectedResults.length} result${selectedResults.length === 1 ? "" : "s"} and ${selectedLifecycleEvents.length} lifecycle event${selectedLifecycleEvents.length === 1 ? "" : "s"} to main agent.${remainingResults > 0 || remainingLifecycleEvents > 0 ? ` Remaining queued: ${remainingResults} result${remainingResults === 1 ? "" : "s"}, ${remainingLifecycleEvents} lifecycle event${remainingLifecycleEvents === 1 ? "" : "s"}.` : ""}`
					: `Sent pending entries from subagent #${targetId} to main agent.`,
				"info",
			);
		},
	});

	pi.registerCommand("sub-status", {
		description: "Show running subagents and pending result/lifecycle queues",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			const running = Array.from(agents.values()).filter((state) => state.status === "running").length;
			const done = Array.from(agents.values()).filter((state) => state.status === "done").length;
			const errored = Array.from(agents.values()).filter((state) => state.status === "error").length;
			const pendingResultCount = pendingMainAgentResults.length;
			const pendingLifecycleCount = pendingLifecycleEvents.length;
			const pendingResultIds = pendingMainAgentResults.map((result) => `#${result.id}`).join(", ");
			const details = pendingResultIds ? ` (${pendingResultIds})` : "";
			ctx.ui.notify(
				`Subagents: running=${running}, done=${done}, error=${errored}. Pending results=${pendingResultCount}${details}, lifecycle events=${pendingLifecycleCount}.`,
				"info",
			);
		},
	});

	pi.registerCommand("sub-events", {
		description: "Show pending lifecycle events from main-agent subagents",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (pendingLifecycleEvents.length === 0) {
				ctx.ui.notify("No pending lifecycle events.", "info");
				return;
			}
			const eventLines = pendingLifecycleEvents.map((event) => {
				const retrySuffix = event.nextRetrySeconds !== undefined ? ` next=${event.nextRetrySeconds}s` : "";
				return `#${event.id} turn=${event.turnCount} type=${event.type} attempt=${event.attempt} ${event.message}${retrySuffix}`;
			});
			ctx.ui.notify(`Pending lifecycle events:\n${eventLines.join("\n")}`, "info");
		},
	});

	pi.registerCommand("sub-attach", {
		description: "Switch to a subagent's tmux window: /sub-attach <id>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const num = parseInt(args.trim(), 10);
			if (isNaN(num)) {
				ctx.ui.notify("Usage: /sub-attach <id>", "warning");
				return;
			}
			const state = agents.get(num);
			if (!state) {
				ctx.ui.notify(`No subagent #${num} found.`, "error");
				return;
			}
			if (state.status !== "running") {
				ctx.ui.notify(
					`Subagent #${num} is not running (status: ${state.status}).`,
					state.status === "done" ? "info" : "warning",
				);
				return;
			}
			if (!state.tmuxSession || !state.tmuxWindow) {
				ctx.ui.notify(`Subagent #${num} is not running in a tmux window.`, "warning");
				return;
			}
			try {
				const currentSession = getCurrentTmuxSession();
				const attachTarget = resolveTmuxAttachTarget(state, currentSession);
				if (!currentSession) {
					ctx.ui.notify(
						`Subagent #${num} is running in tmux target "${state.tmuxSession}:${state.tmuxWindow}". Attach first with: tmux attach -t ${attachTarget.attachSession ?? state.tmuxSession}`,
						"info",
					);
					return;
				}
				if (!attachTarget.session || !attachTarget.windowTarget) {
					ctx.ui.notify(`Subagent #${num} is not running in a tmux window.`, "warning");
					return;
				}
				try {
					focusTmuxTarget(attachTarget.session, attachTarget.windowTarget, currentSession);
				} catch (attachErr) {
					const canFallbackToDedicated = Boolean(
						state.tmuxLinkedSession &&
						state.tmuxSession &&
						state.tmuxLinkedSession !== state.tmuxSession &&
						attachTarget.session === state.tmuxLinkedSession,
					);
					if (!canFallbackToDedicated) {
						throw attachErr;
					}
					state.tmuxLinkedSession = undefined;
					const fallbackSession = state.tmuxSession;
					const fallbackWindow = state.tmuxWindow;
					if (!fallbackSession || !fallbackWindow) {
						throw attachErr;
					}
					focusTmuxTarget(fallbackSession, `${fallbackSession}:${fallbackWindow}`, currentSession);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("can't find window")) {
					if (state.pollTimer) {
						clearInterval(state.pollTimer);
						state.pollTimer = undefined;
					}
					clearTmuxTracking(state);
					if (state.status === "running") {
						state.status = "done";
						updateWidgets();
						onAgentComplete(pi, state, ctx);
					}
					ctx.ui.notify(
						`Subagent #${num} tmux window is gone. It was likely closed; result was imported if available.`,
						"warning",
					);
				} else {
					ctx.ui.notify(`Failed to attach: ${message}`, "error");
				}
			}
		},
	});

	pi.registerCommand("subrm", {
		description: "Remove a subagent widget: /subrm <id>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const num = parseInt(args.trim(), 10);
			if (isNaN(num)) {
				ctx.ui.notify("Usage: /subrm <id>", "error");
				return;
			}
			const state = agents.get(num);
			if (!state) {
				ctx.ui.notify(`No subagent #${num} found.`, "error");
				return;
			}
			const wasRunning = state.status === "running";
			killAgent(state);
			ctx.ui.setWidget(`sub-${num}`, undefined);
			agents.delete(num);
			ctx.ui.notify(
				wasRunning ? `Subagent #${num} killed and removed.` : `Subagent #${num} removed.`,
				wasRunning ? "warning" : "info",
			);
			updateWidgets();
		},
	});

	pi.registerCommand("subclear", {
		description: "Clear all subagent widgets",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			let killed = 0;
			for (const [id, state] of agents.entries()) {
				if (state.status === "running") {
					killAgent(state);
					killed++;
				}
				ctx.ui.setWidget(`sub-${id}`, undefined);
			}
			const total = agents.size;
			agents.clear();
			nextId = 1;
			const msg =
				total === 0
					? "No subagents to clear."
					: `Cleared ${total} subagent${total !== 1 ? "s" : ""}${killed > 0 ? ` (${killed} killed)` : ""}.`;
			ctx.ui.notify(msg, "info");
			updateWidgets();
		},
	});
}
