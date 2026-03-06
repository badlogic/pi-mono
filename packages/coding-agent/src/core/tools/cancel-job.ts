import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { AsyncJobManager } from "./async-jobs.js";

const cancelJobSchema = Type.Object({
	job_id: Type.String({ description: "Background job ID" }),
});

export type CancelJobToolInput = Static<typeof cancelJobSchema>;

export interface CancelJobToolDetails {
	status: "cancelled" | "not_found" | "already_completed";
	jobId: string;
}

export interface CancelJobToolOptions {
	asyncEnabled?: boolean;
	asyncJobManager?: AsyncJobManager;
}

export function createCancelJobTool(options?: CancelJobToolOptions): AgentTool<typeof cancelJobSchema> {
	const asyncEnabled = options?.asyncEnabled ?? false;
	const asyncJobManager = options?.asyncJobManager;

	return {
		name: "cancel_job",
		label: "cancel_job",
		description: "Cancel a running background job by ID.",
		parameters: cancelJobSchema,
		execute: async (_toolCallId: string, { job_id }: CancelJobToolInput) => {
			if (!asyncEnabled || !asyncJobManager) {
				return {
					content: [{ type: "text", text: "Async execution is disabled; no background jobs are available." }],
					details: {
						status: "not_found",
						jobId: job_id,
					},
				};
			}

			const existing = asyncJobManager.getJob(job_id);
			if (!existing) {
				return {
					content: [{ type: "text", text: `Background job not found: ${job_id}` }],
					details: {
						status: "not_found",
						jobId: job_id,
					},
				};
			}

			if (existing.status !== "running") {
				return {
					content: [{ type: "text", text: `Background job ${job_id} is already ${existing.status}.` }],
					details: {
						status: "already_completed",
						jobId: job_id,
					},
				};
			}

			const cancelled = asyncJobManager.cancel(job_id);
			if (!cancelled) {
				return {
					content: [{ type: "text", text: `Background job ${job_id} is already completed.` }],
					details: {
						status: "already_completed",
						jobId: job_id,
					},
				};
			}

			return {
				content: [{ type: "text", text: `Cancelled background job ${job_id}.` }],
				details: {
					status: "cancelled",
					jobId: job_id,
				},
			};
		},
	};
}
