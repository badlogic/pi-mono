import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Bounded Concurrency Extension (inspired by oh-my-pi mapWithConcurrencyLimit).
 *
 * 1. MONITORING: Intercepts bash tool_call events to detect mass process spawning
 *    and warns the agent via steer message.
 *
 * 2. UTILITY: Registers a "batch_exec" LLM-callable tool that runs commands with
 *    bounded concurrency (default 4, max 8). Prevents the 44+ concurrent infer.py
 *    CPU-thrash problem from gold-tier batch.
 */

import { Type } from "@sinclair/typebox";

// Patterns that suggest unbounded parallelism.
// Each requires command-start context to avoid false positives on prose.
const DANGER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
	{
		pattern: /^\s*for\s+\w+\s+in.*;\s*do.*&\s*(done|;)/m,
		description: "for loop with background jobs",
	},
	{
		pattern: /\bxargs\b.*-P\s*(0|[1-9]\d)/,
		description: "xargs with high parallelism (-P >= 10 or unlimited)",
	},
	{
		pattern: /^\s*parallel\s+(?!.*-j\s*[1-8]\b)/m,
		description: "GNU parallel without bounded -j",
	},
	{
		pattern: /\bPool\(\s*(?:processes=)?(\d{2,})/,
		description: "Python multiprocessing Pool with 10+ processes",
	},
	{
		pattern: /^\s*while\b.*;\s*do.*&\s*done/m,
		description: "while loop with background jobs",
	},
];

function detectUnboundedSpawn(command: string): string | null {
	for (const { pattern, description } of DANGER_PATTERNS) {
		if (pattern.test(command)) {
			return `Detected potentially unbounded parallelism: ${description}`;
		}
	}

	// Count background jobs (&) — but only standalone & not &&
	const bgJobs = (command.match(/[^&]&(?!&)/g) || []).length;
	if (bgJobs > 8) {
		return `Detected ${bgJobs} background jobs in a single command (max recommended: 8)`;
	}

	return null;
}

export default function boundedConcurrency(pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;

		const input = event.input as { command?: string };
		if (!input.command) return;

		const warning = detectUnboundedSpawn(input.command);
		if (warning) {
			pi.sendMessage(
				{
					customType: "concurrency-warning",
					content: `[bounded-concurrency] ${warning}. Use the batch_exec tool or limit parallelism (xargs -P 4, parallel -j 4, Pool(4)).`,
					display: false,
				},
				{ triggerTurn: false, deliverAs: "steer" },
			);
		}
	});

	pi.registerTool({
		name: "batch_exec",
		label: "Batch Execute",
		description:
			"Execute multiple bash commands in parallel with bounded concurrency. " +
			"Commands run concurrently up to the specified limit (default 4, max 8). " +
			"Returns results in original order. Fails fast on first error unless continue_on_error is set.",
		parameters: Type.Object({
			commands: Type.Array(Type.String(), {
				description: "List of bash commands to execute in parallel",
				minItems: 1,
				maxItems: 100,
			}),
			concurrency: Type.Optional(
				Type.Number({
					description: "Max concurrent commands (default 4, max 8)",
					minimum: 1,
					maximum: 8,
					default: 4,
				}),
			),
			timeout_ms: Type.Optional(
				Type.Number({
					description: "Per-command timeout in milliseconds (default 120000)",
					minimum: 1000,
					maximum: 600000,
					default: 120000,
				}),
			),
			continue_on_error: Type.Optional(
				Type.Boolean({
					description: "Continue executing remaining commands if one fails (default false)",
					default: false,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const concurrency = Math.min(params.concurrency ?? 4, 8);
			const timeoutMs = params.timeout_ms ?? 120000;
			const continueOnError = params.continue_on_error ?? false;
			const commands = params.commands;
			const wallStart = Date.now();

			interface CommandResult {
				index: number;
				command: string;
				stdout: string;
				stderr: string;
				exitCode: number;
				durationMs: number;
			}

			const results = new Map<number, CommandResult>();
			let nextIndex = 0;
			let aborted = false;
			let firstError: string | null = null;

			// Worker pool pattern. nextIndex++ is safe: JS increments synchronously
			// before the await yield, so no two workers read the same index.
			const worker = async (): Promise<void> => {
				while (!aborted && !signal?.aborted) {
					const index = nextIndex++;
					if (index >= commands.length) return;

					const command = commands[index];
					const start = Date.now();

					try {
						const result = await pi.exec("bash", ["-c", command], {
							timeout: timeoutMs,
							signal,
						});

						results.set(index, {
							index,
							command: command.substring(0, 100),
							stdout: (result.stdout ?? "").substring(0, 2000),
							stderr: (result.stderr ?? "").substring(0, 500),
							exitCode: result.code ?? 0,
							durationMs: Date.now() - start,
						});

						if (result.code !== 0 && !continueOnError) {
							aborted = true;
							firstError = `Command ${index} failed (exit ${result.code}): ${command.substring(0, 80)}`;
						}
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						results.set(index, {
							index,
							command: command.substring(0, 100),
							stdout: "",
							stderr: message,
							exitCode: 1,
							durationMs: Date.now() - start,
						});

						if (!continueOnError) {
							aborted = true;
							firstError = `Command ${index} threw: ${message}`;
						}
					}
				}
			};

			const workers = Array.from({ length: Math.min(concurrency, commands.length) }, () => worker());
			await Promise.allSettled(workers);

			const wallMs = Date.now() - wallStart;
			const completed = Array.from(results.values()).sort((a, b) => a.index - b.index);
			const failed = completed.filter((r) => r.exitCode !== 0);

			const summary = [
				`Completed: ${completed.length}/${commands.length} (${failed.length} failed)`,
				`Wall clock: ${wallMs}ms, concurrency: ${concurrency}`,
				firstError ? `First error: ${firstError}` : null,
				"",
				...completed.map((r) => {
					const status = r.exitCode === 0 ? "OK" : `FAIL(${r.exitCode})`;
					const output = r.stdout.trim() || r.stderr.trim() || "(no output)";
					return `[${r.index}] ${status} (${r.durationMs}ms) ${r.command}\n  ${output.split("\n").slice(0, 3).join("\n  ")}`;
				}),
			]
				.filter(Boolean)
				.join("\n");

			return {
				type: "text" as const,
				text: summary,
				isError: failed.length > 0 && !continueOnError,
			};
		},
	});
}
