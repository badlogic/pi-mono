/**
 * Idle Compaction Extension
 *
 * Compacts conversation context during idle periods instead of waiting until the
 * context window is nearly full. This saves tokens by keeping context small when
 * the session isn't actively working.
 *
 * The default auto-compaction triggers at ~95% context capacity (contextWindow -
 * reserveTokens). By that point, every turn has been shipping a massive context
 * for a while — expensive for long-running agent sessions that receive periodic
 * messages (heartbeats, webhooks, chat).
 *
 * This extension compacts much earlier (default 40% capacity), but only when the
 * session is truly idle:
 *
 *   1. No turns for IDLE_DELAY_MS (default 5 minutes)
 *   2. No pending messages queued for delivery
 *   3. Context usage exceeds COMPACT_THRESHOLD_PCT of the context window
 *
 * During active conversation or tool execution, the timer resets on every turn —
 * no risk of compacting mid-task.
 *
 * For agent orchestration setups (control agent + worker agents), extend the
 * idle check by providing a custom `isSessionBusy` function that inspects
 * external state (e.g., active child sessions, pending task queues).
 *
 * Configuration (env vars):
 *   IDLE_COMPACT_DELAY_MS       — idle time before compacting (default: 300000 = 5 min)
 *   IDLE_COMPACT_THRESHOLD_PCT  — context % to trigger (default: 40, range: 10–90)
 *   IDLE_COMPACT_ENABLED        — set to "0" or "false" to disable
 *
 * Usage:
 *   pi --extension examples/extensions/idle-compact.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_IDLE_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_THRESHOLD_PCT = 40;
const MIN_IDLE_DELAY_MS = 60 * 1000; // 1 minute floor

function getConfig() {
	const envDelay = parseInt(process.env.IDLE_COMPACT_DELAY_MS || "", 10);
	const idleDelayMs = Math.max(MIN_IDLE_DELAY_MS, Number.isFinite(envDelay) ? envDelay : DEFAULT_IDLE_DELAY_MS);

	const envThreshold = parseInt(process.env.IDLE_COMPACT_THRESHOLD_PCT || "", 10);
	const thresholdPct = Number.isFinite(envThreshold) ? Math.max(10, Math.min(90, envThreshold)) : DEFAULT_THRESHOLD_PCT;

	const envEnabled = process.env.IDLE_COMPACT_ENABLED?.trim().toLowerCase();
	const enabled = envEnabled !== "0" && envEnabled !== "false" && envEnabled !== "no";

	return { idleDelayMs, thresholdPct, enabled };
}

export default function idleCompactExtension(pi: ExtensionAPI): void {
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let lastCtx: ExtensionContext | null = null;
	let compacting = false;
	let enabled = true;
	let idleDelayMs = DEFAULT_IDLE_DELAY_MS;
	let thresholdPct = DEFAULT_THRESHOLD_PCT;

	function cancelTimer() {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	}

	function armTimer() {
		cancelTimer();
		if (!enabled || !lastCtx) return;

		idleTimer = setTimeout(() => {
			idleTimer = null;
			void checkAndCompact();
		}, idleDelayMs);
	}

	async function checkAndCompact() {
		if (!lastCtx || compacting) return;

		// Check 1: context usage above threshold?
		const usage = lastCtx.getContextUsage();
		if (!usage || usage.tokens === null || usage.contextWindow === null) return;

		const pctUsed = (usage.tokens / usage.contextWindow) * 100;
		if (pctUsed < thresholdPct) {
			return; // Not worth compacting yet
		}

		// Check 2: any pending messages queued for delivery?
		if (lastCtx.hasPendingMessages()) {
			// Messages waiting — re-arm and check again after they're processed
			armTimer();
			return;
		}

		// All clear — compact
		compacting = true;
		lastCtx.compact({
			onComplete: () => {
				compacting = false;
			},
			onError: () => {
				compacting = false;
				// Re-arm to try again later
				armTimer();
			},
		});
	}

	// ── Events ──────────────────────────────────────────────────────────────

	pi.on("session_start", async () => {
		const config = getConfig();
		enabled = config.enabled;
		idleDelayMs = config.idleDelayMs;
		thresholdPct = config.thresholdPct;
	});

	// Activity detected — cancel any pending idle compaction
	pi.on("turn_start", async () => {
		cancelTimer();
	});

	// Turn finished — start the idle countdown
	pi.on("turn_end", async (_event, ctx) => {
		lastCtx = ctx;
		if (enabled) {
			armTimer();
		}
	});

	pi.on("session_shutdown", async () => {
		cancelTimer();
	});
}
