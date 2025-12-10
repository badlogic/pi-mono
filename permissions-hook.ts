import type { HookAPI } from "./packages/coding-agent/src/index.js";

const dangerousPatterns = [
	{ pattern: /\brm\s+(-[rf]+\s+)*\//, reason: "Deleting from root" },
	{ pattern: /\brm\s+-rf?\s/, reason: "Recursive delete" },
	{ pattern: /\bsudo\b/, reason: "Elevated privileges" },
	{ pattern: /\bchmod\s+777\b/, reason: "World-writable permissions" },
	{ pattern: /\b(mkfs|dd\s+if=)/, reason: "Disk operations" },
	{ pattern: />\s*\/dev\//, reason: "Writing to device" },
	{ pattern: /\bcurl\b.*\|\s*(ba)?sh/, reason: "Pipe to shell" },
	{ pattern: /\bwget\b.*\|\s*(ba)?sh/, reason: "Pipe to shell" },
];

const alwaysAllow = [
	/^(ls|cat|head|tail|grep|find|pwd|echo|date|whoami)\b/,
	/^git\s+(status|log|diff|branch|show)\b/,
	/^npm\s+(run|test|install|ci)\b/,
];

export default function (pi: HookAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const cmd = (event.input.command as string).trim();

		// Always allow safe commands
		if (alwaysAllow.some((p) => p.test(cmd))) return;

		// Check for dangerous patterns
		for (const { pattern, reason } of dangerousPatterns) {
			if (pattern.test(cmd)) {
				const ok = await ctx.ui.confirm(`⚠️ ${reason}`, cmd);
				if (!ok) return { block: true, reason: `Blocked: ${reason}` };
				return; // User approved
			}
		}

		return;
	});
}
