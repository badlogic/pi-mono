import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExecOptions, ExecResult, Executor } from "./sandbox.js";

export interface RequesterContext {
	userId: string;
	userName?: string;
}

interface GuardrailConfigFile {
	sensitiveCommandGuard?: {
		enabled?: boolean;
		approvers?: string[];
	};
}

interface SensitiveCommandGuardConfig {
	enabled: boolean;
	approvers: string[];
}

export interface ApprovalRequest {
	id: string;
	command: string;
	reason: string;
	label?: string;
	requesterId: string;
	requesterUserName?: string;
	status: "pending" | "approved" | "denied" | "consumed";
	createdAt: string;
	updatedAt: string;
	approverId?: string;
	approverUserName?: string;
	consumedAt?: string;
}

interface ApprovalStore {
	approvals: ApprovalRequest[];
}

interface SensitiveCommandMatch {
	reason: string;
}

const GUARDRails_FILENAME = "guardrails.json";
const APPROVALS_FILENAME = "sensitive-command-approvals.json";

const COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bsudo\b/i, reason: "uses sudo" },
	{ pattern: /\b(?:rm|shred)\b/i, reason: "deletes files" },
	{
		pattern: /\b(?:systemctl|service)\s+(?:start|stop|restart|reload|enable|disable)\b/i,
		reason: "changes system services",
	},
	{ pattern: /\bdocker\s+(?:rm|stop|restart|kill|exec)\b/i, reason: "changes Docker state" },
	{ pattern: /\bdocker\s+compose\s+(?:up|down|restart|stop|rm)\b/i, reason: "changes Docker Compose state" },
	{ pattern: /\bkubectl\s+(?:apply|delete|edit|patch|scale)\b/i, reason: "changes Kubernetes resources" },
	{ pattern: /\bkubectl\s+rollout\s+restart\b/i, reason: "restarts Kubernetes workloads" },
	{
		pattern:
			/\b(?:apt|apt-get|yum|dnf|apk|brew|pip|pip3|npm|pnpm|yarn|bun|cargo)\s+(?:install|add|remove|uninstall|upgrade|update)\b/i,
		reason: "installs or removes software",
	},
	{ pattern: /\bcrontab\b/i, reason: "changes scheduled tasks" },
	{ pattern: /\b(?:user|group)(?:add|del|mod)\b|\bpasswd\b/i, reason: "changes user or group accounts" },
	{ pattern: /\b(?:chmod|chown)\b/i, reason: "changes file permissions or ownership" },
	{
		pattern:
			/\bgit\s+(?:add|commit|push|pull|merge|rebase|reset|clean|checkout|switch|stash|tag|cherry-pick|revert|am)\b/i,
		reason: "changes git state",
	},
	{ pattern: /\bgh\s+issue\s+(?:create|edit|close|reopen|comment)\b/i, reason: "changes GitHub issues" },
	{ pattern: /\bgh\s+pr\s+(?:create|edit|merge|close|comment|review)\b/i, reason: "changes GitHub pull requests" },
	{ pattern: /\bgh\s+repo\s+(?:create|delete|edit)\b/i, reason: "changes GitHub repositories" },
	{ pattern: /\bgh\s+release\s+(?:create|delete|edit)\b/i, reason: "changes GitHub releases" },
	{ pattern: /\bgh\s+(?:secret|variable)\s+(?:set|delete)\b/i, reason: "changes GitHub secrets or variables" },
	{ pattern: /\bgh\s+workflow\s+run\b/i, reason: "triggers GitHub workflows" },
];

function getGuardrailsPath(workspaceDir: string): string {
	return join(workspaceDir, GUARDRails_FILENAME);
}

function getApprovalsPath(channelDir: string): string {
	return join(channelDir, APPROVALS_FILENAME);
}

function readGuardrailConfig(workspaceDir: string): SensitiveCommandGuardConfig {
	const path = getGuardrailsPath(workspaceDir);
	if (!existsSync(path)) {
		return { enabled: false, approvers: [] };
	}

	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as GuardrailConfigFile;
		const config = parsed.sensitiveCommandGuard;
		return {
			enabled: config?.enabled !== false && Array.isArray(config?.approvers) && config.approvers.length > 0,
			approvers: Array.isArray(config?.approvers) ? config.approvers.filter(Boolean) : [],
		};
	} catch {
		return { enabled: false, approvers: [] };
	}
}

function readApprovalStore(channelDir: string): ApprovalStore {
	const path = getApprovalsPath(channelDir);
	if (!existsSync(path)) {
		return { approvals: [] };
	}

	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as ApprovalStore;
		if (!Array.isArray(parsed.approvals)) {
			return { approvals: [] };
		}
		return { approvals: parsed.approvals };
	} catch {
		return { approvals: [] };
	}
}

function writeApprovalStore(channelDir: string, store: ApprovalStore): void {
	mkdirSync(channelDir, { recursive: true });
	writeFileSync(getApprovalsPath(channelDir), `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

function decodeShellToken(token: string): string {
	const trimmed = token.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/'\\''/g, "'");
	}
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function extractRedirectTarget(command: string): string | null {
	const match = command.match(/(?:^|[^<>])>>?\s*('(?:[^']|'\\'')*'|"[^"]*"|\S+)/);
	return match ? decodeShellToken(match[1]) : null;
}

function isPathOutsideWorkspace(targetPath: string, workspaceDir: string): boolean {
	const resolvedTarget = resolve(process.cwd(), targetPath);
	const resolvedWorkspace = resolve(workspaceDir);
	return resolvedTarget !== resolvedWorkspace && !resolvedTarget.startsWith(`${resolvedWorkspace}/`);
}

function detectSensitiveCommand(command: string, workspaceDir: string): SensitiveCommandMatch | null {
	for (const matcher of COMMAND_PATTERNS) {
		if (matcher.pattern.test(command)) {
			return { reason: matcher.reason };
		}
	}

	const redirectTarget = extractRedirectTarget(command);
	if (redirectTarget && isPathOutsideWorkspace(redirectTarget, workspaceDir)) {
		return { reason: `writes to ${redirectTarget} outside the Mom workspace` };
	}

	return null;
}

function formatApproverMentions(approverIds: string[]): string {
	return approverIds.map((id) => `<@${id}>`).join(", ");
}

function createApprovalId(): string {
	return `apr-${randomUUID().slice(0, 8)}`;
}

function findReusableApproval(store: ApprovalStore, requesterId: string, command: string): ApprovalRequest | undefined {
	const normalized = normalizeCommand(command);
	return store.approvals.find(
		(approval) =>
			approval.requesterId === requesterId &&
			normalizeCommand(approval.command) === normalized &&
			(approval.status === "pending" || approval.status === "approved"),
	);
}

function requestApproval(
	channelDir: string,
	requester: RequesterContext,
	command: string,
	label: string | undefined,
	reason: string,
): ApprovalRequest {
	const store = readApprovalStore(channelDir);
	const existing = findReusableApproval(store, requester.userId, command);
	if (existing) {
		return existing;
	}

	const timestamp = new Date().toISOString();
	const approval: ApprovalRequest = {
		id: createApprovalId(),
		command,
		reason,
		label,
		requesterId: requester.userId,
		requesterUserName: requester.userName,
		status: "pending",
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	store.approvals.push(approval);
	writeApprovalStore(channelDir, store);
	return approval;
}

function consumeApprovedRequest(channelDir: string, requesterId: string, command: string): ApprovalRequest | null {
	const store = readApprovalStore(channelDir);
	const normalized = normalizeCommand(command);
	const approval = store.approvals.find(
		(entry) =>
			entry.requesterId === requesterId &&
			normalizeCommand(entry.command) === normalized &&
			entry.status === "approved",
	);
	if (!approval) {
		return null;
	}

	const now = new Date().toISOString();
	approval.status = "consumed";
	approval.updatedAt = now;
	approval.consumedAt = now;
	writeApprovalStore(channelDir, store);
	return approval;
}

export function isSensitiveCommandApprover(workspaceDir: string, userId: string): boolean {
	const config = readGuardrailConfig(workspaceDir);
	return config.enabled && config.approvers.includes(userId);
}

export function approveSensitiveCommandRequest(
	workspaceDir: string,
	channelDir: string,
	requestId: string,
	approverId: string,
	approverUserName?: string,
): ApprovalRequest | null {
	if (!isSensitiveCommandApprover(workspaceDir, approverId)) {
		return null;
	}

	const store = readApprovalStore(channelDir);
	const approval = store.approvals.find((entry) => entry.id === requestId);
	if (!approval) {
		return null;
	}

	const now = new Date().toISOString();
	approval.status = "approved";
	approval.updatedAt = now;
	approval.approverId = approverId;
	approval.approverUserName = approverUserName;
	writeApprovalStore(channelDir, store);
	return approval;
}

export function denySensitiveCommandRequest(
	workspaceDir: string,
	channelDir: string,
	requestId: string,
	approverId: string,
	approverUserName?: string,
): ApprovalRequest | null {
	if (!isSensitiveCommandApprover(workspaceDir, approverId)) {
		return null;
	}

	const store = readApprovalStore(channelDir);
	const approval = store.approvals.find((entry) => entry.id === requestId);
	if (!approval) {
		return null;
	}

	const now = new Date().toISOString();
	approval.status = "denied";
	approval.updatedAt = now;
	approval.approverId = approverId;
	approval.approverUserName = approverUserName;
	writeApprovalStore(channelDir, store);
	return approval;
}

export function createGuardedExecutor(
	baseExecutor: Executor,
	options: {
		workspaceDir: string;
		channelDir: string;
		getRequester: () => RequesterContext | null;
	},
): Executor {
	return {
		async exec(command: string, execOptions?: ExecOptions): Promise<ExecResult> {
			const config = readGuardrailConfig(options.workspaceDir);
			const requester = options.getRequester();
			if (config.enabled) {
				const match = detectSensitiveCommand(command, options.workspaceDir);
				if (match && requester && !config.approvers.includes(requester.userId)) {
					const approved = consumeApprovedRequest(options.channelDir, requester.userId, command);
					if (!approved) {
						const approval = requestApproval(options.channelDir, requester, command, undefined, match.reason);
						const approvers = formatApproverMentions(config.approvers);
						throw new Error(
							[
								`Sensitive command blocked because it ${match.reason}.`,
								`Approval required from ${approvers}.`,
								`Request ID: ${approval.id}`,
								`Approver command: approve ${approval.id}`,
							].join("\n"),
						);
					}
				}
			}

			return baseExecutor.exec(command, execOptions);
		},

		getWorkspacePath(hostPath: string): string {
			return baseExecutor.getWorkspacePath(hostPath);
		},
	};
}
