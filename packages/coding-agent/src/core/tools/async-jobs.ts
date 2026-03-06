import { randomUUID } from "node:crypto";

const DELIVERY_RETRY_BASE_MS = 500;
const DELIVERY_RETRY_MAX_MS = 30_000;
const DELIVERY_RETRY_JITTER_MS = 200;
const DEFAULT_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RUNNING_JOBS = 100;

export type AsyncJobType = "bash";
export type AsyncJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface AsyncJob {
	id: string;
	type: AsyncJobType;
	status: AsyncJobStatus;
	startTime: number;
	label: string;
	abortController: AbortController;
	promise: Promise<void>;
	resultText?: string;
	errorText?: string;
}

export interface AsyncJobManagerOptions {
	maxRunningJobs?: number;
	retentionMs?: number;
	onJobComplete?: (jobId: string, text: string, job?: AsyncJob) => void | Promise<void>;
}

interface AsyncJobDelivery {
	jobId: string;
	text: string;
	attempt: number;
	nextAttemptAt: number;
	lastError?: string;
}

export interface AsyncJobDeliveryState {
	queued: number;
	delivering: boolean;
	nextRetryAt?: number;
	pendingJobIds: string[];
}

export interface AsyncJobRegisterOptions {
	id?: string;
	onProgress?: (text: string, details?: Record<string, unknown>) => void | Promise<void>;
}

interface AsyncJobContext {
	jobId: string;
	signal: AbortSignal;
	reportProgress: (text: string, details?: Record<string, unknown>) => Promise<void>;
}

export class AsyncJobManager {
	readonly #jobs = new Map<string, AsyncJob>();
	readonly #deliveries: AsyncJobDelivery[] = [];
	readonly #suppressedDeliveries = new Set<string>();
	readonly #evictionTimers = new Map<string, NodeJS.Timeout>();
	#maxRunningJobs: number;
	readonly #retentionMs: number;
	#onJobComplete?: (jobId: string, text: string, job?: AsyncJob) => void | Promise<void>;
	#deliveryLoop: Promise<void> | undefined;
	#disposed = false;

	constructor(options?: AsyncJobManagerOptions) {
		this.#maxRunningJobs = Math.max(1, Math.floor(options?.maxRunningJobs ?? DEFAULT_MAX_RUNNING_JOBS));
		this.#retentionMs = Math.max(0, Math.floor(options?.retentionMs ?? DEFAULT_RETENTION_MS));
		this.#onJobComplete = options?.onJobComplete;
	}

	setMaxRunningJobs(maxRunningJobs: number): void {
		this.#maxRunningJobs = Math.max(1, Math.floor(maxRunningJobs));
	}

	setCompletionHandler(
		handler: ((jobId: string, text: string, job?: AsyncJob) => void | Promise<void>) | undefined,
	): void {
		this.#onJobComplete = handler;
		if (this.#onJobComplete && this.#deliveries.length > 0) {
			this.#ensureDeliveryLoop();
		}
	}

	register(
		type: AsyncJobType,
		label: string,
		run: (ctx: AsyncJobContext) => Promise<string>,
		options?: AsyncJobRegisterOptions,
	): string {
		if (this.#disposed) {
			throw new Error("Async job manager is disposed");
		}

		const runningCount = this.getRunningJobs().length;
		if (runningCount >= this.#maxRunningJobs) {
			throw new Error(
				`Background job limit reached (${this.#maxRunningJobs}). Wait for running jobs to finish or cancel one.`,
			);
		}

		const id = this.#resolveJobId(options?.id);
		this.#suppressedDeliveries.delete(id);

		const abortController = new AbortController();
		const job: AsyncJob = {
			id,
			type,
			status: "running",
			startTime: Date.now(),
			label,
			abortController,
			promise: Promise.resolve(),
		};

		const reportProgress = async (text: string, details?: Record<string, unknown>): Promise<void> => {
			if (!options?.onProgress) return;
			try {
				await options.onProgress(text, details);
			} catch {
				// Ignore progress callback failures to avoid breaking the background job.
			}
		};

		job.promise = (async () => {
			try {
				const text = await run({ jobId: id, signal: abortController.signal, reportProgress });
				if (job.status === "cancelled") {
					job.resultText = text;
					this.#scheduleEviction(id);
					return;
				}
				job.status = "completed";
				job.resultText = text;
				this.#enqueueDelivery(id, text);
				this.#scheduleEviction(id);
			} catch (error) {
				const errorText = error instanceof Error ? error.message : String(error);
				if (job.status === "cancelled") {
					job.errorText = errorText;
					this.#scheduleEviction(id);
					return;
				}
				job.status = "failed";
				job.errorText = errorText;
				this.#enqueueDelivery(id, errorText);
				this.#scheduleEviction(id);
			}
		})();

		this.#jobs.set(id, job);
		return id;
	}

	cancel(id: string): boolean {
		const job = this.#jobs.get(id);
		if (!job) return false;
		if (job.status !== "running") return false;
		job.status = "cancelled";
		job.abortController.abort();
		this.#scheduleEviction(id);
		return true;
	}

	cancelAll(): void {
		for (const job of this.getRunningJobs()) {
			job.status = "cancelled";
			job.abortController.abort();
			this.#scheduleEviction(job.id);
		}
	}

	getJob(id: string): AsyncJob | undefined {
		return this.#jobs.get(id);
	}

	getRunningJobs(): AsyncJob[] {
		return Array.from(this.#jobs.values()).filter((job) => job.status === "running");
	}

	getRecentJobs(limit = 10): AsyncJob[] {
		return Array.from(this.#jobs.values())
			.filter((job) => job.status !== "running")
			.sort((a, b) => b.startTime - a.startTime)
			.slice(0, Math.max(0, Math.floor(limit)));
	}

	getAllJobs(): AsyncJob[] {
		return Array.from(this.#jobs.values());
	}

	getDeliveryState(): AsyncJobDeliveryState {
		const nextRetryAt = this.#deliveries.reduce<number | undefined>((next, delivery) => {
			if (next === undefined) return delivery.nextAttemptAt;
			return Math.min(next, delivery.nextAttemptAt);
		}, undefined);

		return {
			queued: this.#deliveries.length,
			delivering: this.#deliveryLoop !== undefined,
			nextRetryAt,
			pendingJobIds: this.#deliveries.map((delivery) => delivery.jobId),
		};
	}

	hasPendingDeliveries(): boolean {
		return this.#deliveries.length > 0;
	}

	acknowledgeDeliveries(jobIds: string[]): number {
		const uniqueJobIds = Array.from(new Set(jobIds.map((id) => id.trim()).filter((id) => id.length > 0)));
		if (uniqueJobIds.length === 0) {
			return 0;
		}

		for (const jobId of uniqueJobIds) {
			this.#suppressedDeliveries.add(jobId);
		}

		const before = this.#deliveries.length;
		const remaining = this.#deliveries.filter((delivery) => !this.#suppressedDeliveries.has(delivery.jobId));
		this.#deliveries.splice(0, this.#deliveries.length, ...remaining);
		return before - this.#deliveries.length;
	}

	async waitForAny(jobIds?: string[], signal?: AbortSignal): Promise<AsyncJob[]> {
		const jobs = this.#resolveJobs(jobIds);
		if (jobs.length === 0) {
			return [];
		}

		const runningJobs = jobs.filter((job) => job.status === "running");
		if (runningJobs.length === 0) {
			return jobs;
		}

		const racePromises: Promise<unknown>[] = runningJobs.map((job) => job.promise);
		if (signal) {
			let resolveAbort!: () => void;
			const promise = new Promise<void>((resolve) => {
				resolveAbort = resolve;
			});
			const onAbort = () => resolveAbort();
			signal.addEventListener("abort", onAbort, { once: true });
			racePromises.push(promise);
			try {
				await Promise.race(racePromises);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		} else {
			await Promise.race(racePromises);
		}

		return this.#resolveJobs(jobIds);
	}

	async waitForAll(): Promise<void> {
		await Promise.all(Array.from(this.#jobs.values()).map((job) => job.promise));
	}

	async drainDeliveries(options?: { timeoutMs?: number }): Promise<boolean> {
		const timeoutMs = options?.timeoutMs;
		const hasDeadline = timeoutMs !== undefined;
		const deadline = hasDeadline ? Date.now() + Math.max(timeoutMs, 0) : Number.POSITIVE_INFINITY;

		while (this.hasPendingDeliveries()) {
			this.#ensureDeliveryLoop();
			const loop = this.#deliveryLoop;
			if (!loop) {
				continue;
			}

			if (!hasDeadline) {
				await loop;
				continue;
			}

			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				return false;
			}

			await Promise.race([loop, new Promise((resolve) => setTimeout(resolve, remainingMs))]);
			if (Date.now() >= deadline && this.hasPendingDeliveries()) {
				return false;
			}
		}

		return true;
	}

	async dispose(options?: { timeoutMs?: number }): Promise<boolean> {
		this.#disposed = true;
		this.#clearEvictionTimers();
		this.cancelAll();
		await this.waitForAll();
		const drained = await this.drainDeliveries({ timeoutMs: options?.timeoutMs ?? 3_000 });
		this.#clearEvictionTimers();
		this.#jobs.clear();
		this.#deliveries.length = 0;
		this.#suppressedDeliveries.clear();
		return drained;
	}

	formatJobsListMarkdown(): string {
		const jobs = this.getAllJobs();
		if (jobs.length === 0) {
			return "# Jobs\n\nNo background jobs found.";
		}

		const running = jobs.filter((job) => job.status === "running").sort((a, b) => a.startTime - b.startTime);
		const done = jobs.filter((job) => job.status !== "running").sort((a, b) => b.startTime - a.startTime);
		const ordered = [...running, ...done];

		const lines = ordered.map((job) => {
			return `- \`${job.id}\` [${job.type}] **${job.status}** — ${job.label}  \n  started: ${new Date(job.startTime).toISOString()} · duration: ${formatDuration(Date.now() - job.startTime)}`;
		});

		return `# Jobs\n\n${ordered.length} job${ordered.length === 1 ? "" : "s"}\n\n${lines.join("\n")}`;
	}

	formatJobMarkdown(id: string): string {
		const job = this.getJob(id);
		if (!job) {
			return `# Job Not Found\n\n404: No async job found with id \`${id}\`.`;
		}

		const sections = [
			`# Job ${job.id}`,
			"",
			`- type: ${job.type}`,
			`- status: ${job.status}`,
			`- label: ${job.label}`,
			`- start: ${new Date(job.startTime).toISOString()}`,
			`- duration: ${formatDuration(Date.now() - job.startTime)}`,
		];

		if (job.resultText) {
			sections.push("", "## Result", "", "```", job.resultText, "```");
		}
		if (job.errorText) {
			sections.push("", "## Error", "", "```", job.errorText, "```");
		}

		return sections.join("\n");
	}

	#resolveJobs(jobIds?: string[]): AsyncJob[] {
		if (!jobIds || jobIds.length === 0) {
			return this.getAllJobs();
		}
		const uniqueIds = Array.from(new Set(jobIds.map((id) => id.trim()).filter((id) => id.length > 0)));
		return uniqueIds.map((id) => this.#jobs.get(id)).filter((job): job is AsyncJob => job !== undefined);
	}

	#resolveJobId(preferredId?: string): string {
		if (!preferredId || preferredId.trim().length === 0) {
			return `bg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
		}

		const base = preferredId.trim();
		if (!this.#jobs.has(base)) return base;

		let suffix = 2;
		let candidate = `${base}-${suffix}`;
		while (this.#jobs.has(candidate)) {
			suffix += 1;
			candidate = `${base}-${suffix}`;
		}
		return candidate;
	}

	#enqueueDelivery(jobId: string, text: string): void {
		if (!this.#onJobComplete || this.#suppressedDeliveries.has(jobId)) {
			return;
		}

		this.#deliveries.push({
			jobId,
			text,
			attempt: 0,
			nextAttemptAt: Date.now(),
		});
		this.#ensureDeliveryLoop();
	}

	#ensureDeliveryLoop(): void {
		if (!this.#onJobComplete || this.#deliveryLoop) {
			return;
		}

		this.#deliveryLoop = this.#runDeliveryLoop()
			.catch(() => {
				// Restart logic below handles transient failures.
			})
			.finally(() => {
				this.#deliveryLoop = undefined;
				if (this.#deliveries.length > 0) {
					this.#ensureDeliveryLoop();
				}
			});
	}

	async #runDeliveryLoop(): Promise<void> {
		while (this.#deliveries.length > 0 && this.#onJobComplete) {
			const delivery = this.#deliveries[0];
			if (this.#suppressedDeliveries.has(delivery.jobId)) {
				this.#deliveries.shift();
				continue;
			}

			const waitMs = delivery.nextAttemptAt - Date.now();
			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}

			if (this.#deliveries[0] !== delivery) {
				continue;
			}
			if (this.#suppressedDeliveries.has(delivery.jobId)) {
				this.#deliveries.shift();
				continue;
			}

			try {
				await this.#onJobComplete(delivery.jobId, delivery.text, this.#jobs.get(delivery.jobId));
				this.#deliveries.shift();
			} catch (error) {
				delivery.attempt += 1;
				delivery.lastError = error instanceof Error ? error.message : String(error);
				delivery.nextAttemptAt = Date.now() + this.#getRetryDelay(delivery.attempt);
				this.#deliveries.shift();
				if (!this.#suppressedDeliveries.has(delivery.jobId)) {
					this.#deliveries.push(delivery);
				}
			}
		}
	}

	#getRetryDelay(attempt: number): number {
		const exp = Math.min(Math.max(attempt - 1, 0), 8);
		const backoffMs = DELIVERY_RETRY_BASE_MS * 2 ** exp;
		const jitterMs = Math.floor(Math.random() * DELIVERY_RETRY_JITTER_MS);
		return Math.min(DELIVERY_RETRY_MAX_MS, backoffMs + jitterMs);
	}

	#scheduleEviction(jobId: string): void {
		const existing = this.#evictionTimers.get(jobId);
		if (existing) {
			clearTimeout(existing);
		}
		if (this.#retentionMs <= 0) {
			this.#jobs.delete(jobId);
			this.#suppressedDeliveries.delete(jobId);
			return;
		}

		const timer = setTimeout(() => {
			this.#jobs.delete(jobId);
			this.#suppressedDeliveries.delete(jobId);
			this.#evictionTimers.delete(jobId);
		}, this.#retentionMs);
		timer.unref?.();
		this.#evictionTimers.set(jobId, timer);
	}

	#clearEvictionTimers(): void {
		for (const timer of this.#evictionTimers.values()) {
			clearTimeout(timer);
		}
		this.#evictionTimers.clear();
	}
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${remainingSeconds}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}
