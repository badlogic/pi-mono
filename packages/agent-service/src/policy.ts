import type { BashSpawnContext, BashSpawnHook } from "@mariozechner/pi-coding-agent";
import type { BashPolicyConfig } from "./types.js";

const DEFAULT_ALLOWED_PREFIXES = [
	"ls",
	"pwd",
	"cat",
	"head",
	"tail",
	"sed",
	"awk",
	"rg",
	"grep",
	"find",
	"git status",
	"git diff",
	"npm test",
	"npm run",
	"pnpm test",
	"pnpm run",
	"yarn test",
	"yarn run",
	"node",
	"tsx",
	"tsgo",
];

export function normalizePolicyConfig(policy?: BashPolicyConfig): BashPolicyConfig {
	if (!policy || policy.allowedPrefixes.length === 0) {
		return { allowedPrefixes: [...DEFAULT_ALLOWED_PREFIXES] };
	}
	return {
		allowedPrefixes: [...policy.allowedPrefixes],
	};
}

export function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

export function isCommandAllowed(command: string, allowedPrefixes: readonly string[]): boolean {
	const normalized = normalizeCommand(command);
	if (normalized.length === 0) return false;
	return allowedPrefixes.some((prefix) => {
		const normalizedPrefix = normalizeCommand(prefix);
		return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix} `);
	});
}

export function createPolicyBashSpawnHook(policy: BashPolicyConfig): BashSpawnHook {
	return (context: BashSpawnContext): BashSpawnContext => {
		if (!isCommandAllowed(context.command, policy.allowedPrefixes)) {
			throw new Error(`POLICY_DENIED: command blocked by allowlist: ${context.command}`);
		}
		return context;
	};
}
