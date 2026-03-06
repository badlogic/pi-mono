import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { AsyncJob, AsyncJobManager } from "./async-jobs.js";

const awaitSchema = Type.Object({
	jobs: Type.Optional(
		Type.Array(Type.String(), {
			description: "Specific job IDs to wait for. If omitted, waits for any running job.",
		}),
	),
});

export type AwaitToolInput = Static<typeof awaitSchema>;

export interface AwaitJobResult {
	id: string;
	type: "bash";
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	durationMs: number;
	resultText?: string;
	errorText?: string;
}

export interface AwaitToolDetails {
	jobs: AwaitJobResult[];
}

export interface AwaitToolOptions {
	asyncEnabled?: boolean;
	asyncJobManager?: AsyncJobManager;
}

export function createAwaitTool(options?: AwaitToolOptions): AgentTool<typeof awaitSchema> {
	const asyncEnabled = options?.asyncEnabled ?? false;
	const asyncJobManager = options?.asyncJobManager;

	return {
		name: "await",
		label: "await",
		description: "Wait for background jobs to finish. Use this instead of repeatedly polling job status in a loop.",
		parameters: awaitSchema,
		execute: async (_toolCallId: string, { jobs }: AwaitToolInput, signal?: AbortSignal) => {
			if (!asyncEnabled || !asyncJobManager) {
				return {
					content: [{ type: "text", text: "Async execution is disabled; no background jobs to wait for." }],
					details: { jobs: [] },
				};
			}

			const requestedIds = jobs;
			const selectedJobs = requestedIds?.length
				? requestedIds.map((id) => asyncJobManager.getJob(id)).filter((job): job is AsyncJob => job !== undefined)
				: asyncJobManager.getRunningJobs();

			if (selectedJobs.length === 0) {
				const message = requestedIds?.length
					? `No matching jobs found for IDs: ${requestedIds.join(", ")}`
					: "No running background jobs to wait for.";
				return {
					content: [{ type: "text", text: message }],
					details: { jobs: [] },
				};
			}

			const watchedJobIds = selectedJobs.map((job) => job.id);
			const results = await asyncJobManager.waitForAny(watchedJobIds, signal);
			const completedIds = results.filter((job) => job.status !== "running").map((job) => job.id);
			if (completedIds.length > 0) {
				asyncJobManager.acknowledgeDeliveries(completedIds);
			}

			return {
				content: [{ type: "text", text: formatAwaitResult(results) }],
				details: {
					jobs: results.map((job) => ({
						id: job.id,
						type: job.type,
						status: job.status,
						label: job.label,
						durationMs: Math.max(0, Date.now() - job.startTime),
						...(job.resultText ? { resultText: job.resultText } : {}),
						...(job.errorText ? { errorText: job.errorText } : {}),
					})),
				},
			};
		},
	};
}

function formatAwaitResult(jobs: AsyncJob[]): string {
	if (jobs.length === 0) {
		return "No jobs found.";
	}

	const completed = jobs.filter((job) => job.status !== "running");
	const running = jobs.filter((job) => job.status === "running");
	const lines: string[] = [];

	if (completed.length > 0) {
		lines.push(`## Completed (${completed.length})`, "");
		for (const job of completed) {
			lines.push(`### ${job.id} [${job.type}] — ${job.status}`);
			lines.push(`Label: ${job.label}`);
			if (job.resultText) {
				lines.push("```", job.resultText, "```");
			}
			if (job.errorText) {
				lines.push(`Error: ${job.errorText}`);
			}
			lines.push("");
		}
	}

	if (running.length > 0) {
		lines.push(`## Still Running (${running.length})`, "");
		for (const job of running) {
			lines.push(`- \`${job.id}\` [${job.type}] — ${job.label}`);
		}
	}

	return lines.join("\n");
}
