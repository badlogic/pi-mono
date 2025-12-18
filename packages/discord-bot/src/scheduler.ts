/**
 * TaskScheduler - User-configurable scheduled tasks system
 * Allows users to create, manage, and execute custom scheduled tasks
 */

import { existsSync, mkdirSync } from "fs";
import cron from "node-cron";
import { dirname } from "path";
import type { BotDatabase } from "./database.js";

export interface ScheduledTask {
	id: string;
	name: string;
	cron: string;
	action: string;
	channelId: string;
	userId: string;
	enabled: boolean;
	lastRun: string | null;
	createdAt: string;
}

export interface TaskExecutionContext {
	sendMessage: (channelId: string, content: string) => Promise<void>;
	executeAction: (action: string, userId: string, channelId: string) => Promise<string>;
	logInfo: (message: string) => void;
	logError: (message: string, error: string) => void;
}

export class TaskScheduler {
	private tasks: Map<string, ScheduledTask> = new Map();
	private cronJobs: Map<string, cron.ScheduledTask> = new Map();
	private context: TaskExecutionContext;
	private db: BotDatabase;

	constructor(tasksFilePath: string, context: TaskExecutionContext, db: BotDatabase) {
		this.context = context;
		this.db = db;

		// Ensure tasks directory exists
		const dir = dirname(tasksFilePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.loadTasks();
	}

	/**
	 * Load tasks from database
	 */
	loadTasks(): void {
		try {
			const dbTasks = this.db.getAllScheduledTasks();
			this.tasks.clear();

			for (const task of dbTasks) {
				const scheduledTask: ScheduledTask = {
					id: task.id,
					name: task.name,
					cron: task.cron_expression,
					action: task.action,
					channelId: task.channel_id,
					userId: task.user_id,
					enabled: task.enabled === 1,
					lastRun: task.last_run,
					createdAt: task.created_at,
				};
				this.tasks.set(task.id, scheduledTask);

				// Schedule enabled tasks
				if (scheduledTask.enabled) {
					this.scheduleTask(scheduledTask);
				}
			}

			this.context.logInfo(`[SCHEDULER] Loaded ${this.tasks.size} tasks from database`);
		} catch (error) {
			this.context.logError(
				"[SCHEDULER] Failed to load tasks",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/**
	 * Save a single task to database
	 */
	private saveTask(task: ScheduledTask): void {
		try {
			this.db.upsertScheduledTask({
				id: task.id,
				name: task.name,
				cron_expression: task.cron,
				action: task.action,
				channel_id: task.channelId,
				user_id: task.userId,
				enabled: task.enabled ? 1 : 0,
				last_run: task.lastRun,
				created_at: task.createdAt,
			});
		} catch (error) {
			this.context.logError(
				"[SCHEDULER] Failed to save task",
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		}
	}

	/**
	 * Add a new scheduled task
	 */
	addTask(task: Omit<ScheduledTask, "id" | "lastRun" | "createdAt">): ScheduledTask {
		// Validate cron expression
		if (!cron.validate(task.cron)) {
			throw new Error(`Invalid cron expression: ${task.cron}`);
		}

		const newTask: ScheduledTask = {
			...task,
			id: this.generateTaskId(),
			lastRun: null,
			createdAt: new Date().toISOString(),
		};

		this.tasks.set(newTask.id, newTask);
		this.saveTask(newTask);

		if (newTask.enabled) {
			this.scheduleTask(newTask);
		}

		this.context.logInfo(`[SCHEDULER] Added task: ${newTask.name} (${newTask.id})`);
		return newTask;
	}

	/**
	 * Remove a scheduled task
	 */
	removeTask(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task) {
			return false;
		}

		// Stop the cron job
		this.unscheduleTask(taskId);

		// Remove from memory and database
		this.tasks.delete(taskId);
		this.db.deleteScheduledTask(taskId);

		this.context.logInfo(`[SCHEDULER] Removed task: ${task.name} (${taskId})`);
		return true;
	}

	/**
	 * Toggle task enabled/disabled
	 */
	toggleTask(taskId: string): ScheduledTask | null {
		const task = this.tasks.get(taskId);
		if (!task) {
			return null;
		}

		task.enabled = !task.enabled;
		this.saveTask(task);

		if (task.enabled) {
			this.scheduleTask(task);
			this.context.logInfo(`[SCHEDULER] Enabled task: ${task.name} (${taskId})`);
		} else {
			this.unscheduleTask(taskId);
			this.context.logInfo(`[SCHEDULER] Disabled task: ${task.name} (${taskId})`);
		}

		return task;
	}

	/**
	 * Get all tasks for a specific user
	 */
	listTasks(userId?: string): ScheduledTask[] {
		const allTasks = Array.from(this.tasks.values());
		if (userId) {
			return allTasks.filter((task) => task.userId === userId);
		}
		return allTasks;
	}

	/**
	 * Get a specific task by ID
	 */
	getTask(taskId: string): ScheduledTask | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * Schedule a task with node-cron
	 */
	private scheduleTask(task: ScheduledTask): void {
		// Remove existing job if any
		this.unscheduleTask(task.id);

		try {
			const cronJob = cron.schedule(task.cron, async () => {
				await this.executeTask(task);
			});

			this.cronJobs.set(task.id, cronJob);
			this.context.logInfo(`[SCHEDULER] Scheduled task: ${task.name} with cron: ${task.cron}`);
		} catch (error) {
			this.context.logError(
				`[SCHEDULER] Failed to schedule task ${task.name}`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/**
	 * Unschedule a task
	 */
	private unscheduleTask(taskId: string): void {
		const cronJob = this.cronJobs.get(taskId);
		if (cronJob) {
			cronJob.stop();
			this.cronJobs.delete(taskId);
		}
	}

	/**
	 * Execute a task
	 */
	private async executeTask(task: ScheduledTask): Promise<void> {
		this.context.logInfo(`[SCHEDULER] Executing task: ${task.name} (${task.id})`);

		try {
			// Update last run time
			task.lastRun = new Date().toISOString();
			this.saveTask(task);

			// Execute the action
			const result = await this.context.executeAction(task.action, task.userId, task.channelId);

			// Send result to the configured channel
			await this.context.sendMessage(task.channelId, `**Scheduled Task: ${task.name}**\n\n${result}`);

			this.context.logInfo(`[SCHEDULER] Task completed: ${task.name}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.context.logError(`[SCHEDULER] Task failed: ${task.name}`, errorMessage);

			// Send error notification to channel
			try {
				await this.context.sendMessage(
					task.channelId,
					`**Scheduled Task Failed: ${task.name}**\n\nError: ${errorMessage}`,
				);
			} catch (sendError) {
				this.context.logError("[SCHEDULER] Failed to send error notification", String(sendError));
			}
		}
	}

	/**
	 * Generate a unique task ID
	 */
	private generateTaskId(): string {
		return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Stop all scheduled tasks (cleanup)
	 */
	shutdown(): void {
		for (const [taskId, cronJob] of this.cronJobs) {
			cronJob.stop();
		}
		this.cronJobs.clear();
		this.context.logInfo("[SCHEDULER] All scheduled tasks stopped");
	}

	/**
	 * Validate cron expression
	 */
	static validateCron(expression: string): boolean {
		return cron.validate(expression);
	}

	/**
	 * Get human-readable description of a cron expression
	 */
	static describeCron(expression: string): string {
		const parts = expression.split(" ");
		if (parts.length < 5) {
			return "Invalid cron expression";
		}

		const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

		let description = "Runs ";

		// Day of week
		if (dayOfWeek !== "*") {
			const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
			const dayNums = dayOfWeek.split(",").map((d) => parseInt(d, 10));
			description += `on ${dayNums.map((d) => days[d]).join(", ")} `;
		} else if (dayOfMonth !== "*") {
			description += `on day ${dayOfMonth} of the month `;
		} else {
			description += "daily ";
		}

		// Time
		if (hour === "*" && minute === "*") {
			description += "every minute";
		} else if (hour === "*") {
			description += `every hour at minute ${minute}`;
		} else if (minute === "0") {
			description += `at ${hour}:00`;
		} else {
			description += `at ${hour}:${minute.padStart(2, "0")}`;
		}

		return description;
	}
}
