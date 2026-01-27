/**
 * Demo: /resume access control.
 * Blocks sessions with "blocked" in the filename.
 */

import { appendFileSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const blockedSessionName = "this-is-demo-blocked";

	const ensureBlockedSession = async (ctx: ExtensionContext): Promise<void> => {
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			return;
		}

		if (!existsSync(sessionFile)) {
			const header = ctx.sessionManager.getHeader();
			if (!header) {
				return;
			}
			const entries = ctx.sessionManager.getEntries();
			const lines = [JSON.stringify(header), ...entries.map((entry) => JSON.stringify(entry))];
			writeFileSync(sessionFile, `${lines.join("\n")}\n`);
		}

		const dir = dirname(sessionFile);
		const ext = extname(sessionFile) || ".jsonl";
		const base = basename(sessionFile, ext);
		const blockedPath = join(dir, `${base}-blocked${ext}`);

		if (!existsSync(blockedPath)) {
			copyFileSync(sessionFile, blockedPath);
		}

		const blockedSession = SessionManager.open(blockedPath);
		const existingName = blockedSession.getSessionName();
		if (!existingName) {
			const hasAssistant = blockedSession
				.getEntries()
				.some((entry) => entry.type === "message" && entry.message.role === "assistant");
			blockedSession.appendSessionInfo(blockedSessionName);
			if (!hasAssistant) {
				const entries = blockedSession.getEntries();
				const lastEntry = entries[entries.length - 1];
				if (lastEntry) {
					appendFileSync(blockedPath, `${JSON.stringify(lastEntry)}\n`);
				}
			}
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		try {
			await ensureBlockedSession(ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) {
				ctx.ui.notify(`Failed to prepare blocked session: ${message}`, "error");
			} else {
				console.error(`Failed to prepare blocked session: ${message}`);
			}
		}
	});

	pi.beforeCommand("resume", { id: "session-access", label: "Session Access" }, async (data, ctx) => {
		if (data.targetSession.includes("blocked")) {
			if (ctx.hasUI) ctx.ui.notify("Access denied for this session.", "error");
			return { cancel: true };
		}
	});
}
