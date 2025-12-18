/**
 * PAI Hooks System - Principle 8: Hooks for Automation
 *
 * Event-driven state management for agents and skills.
 * Enables automation, validation, logging, and orchestration.
 *
 * Based on TAC Lesson 14: Personal AI Infrastructure
 */

/**
 * Hook types for different lifecycle stages
 */
export type HookType =
	| "pre-execute" // Before task execution
	| "post-execute" // After successful execution
	| "pre-validate" // Before input validation
	| "post-validate" // After input validation
	| "error" // On error
	| "cleanup" // Cleanup operations
	| "context-load" // Load context/memory
	| "context-save" // Save context/memory
	| "learn" // Extract learnings
	| "observe"; // Observability/metrics

/**
 * Hook execution priority (lower = earlier)
 */
export type HookPriority = "highest" | "high" | "normal" | "low" | "lowest";

const PRIORITY_VALUES: Record<HookPriority, number> = {
	highest: 0,
	high: 25,
	normal: 50,
	low: 75,
	lowest: 100,
};

/**
 * Hook function signature
 */
export type HookFunction<T = any> = (context: HookContext, data: T) => Promise<HookResult> | HookResult;

/**
 * Hook context passed to all hooks
 */
export interface HookContext {
	hookType: HookType;
	timestamp: string;
	component: string; // Which component triggered the hook
	userId?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Hook execution result
 */
export interface HookResult {
	success: boolean;
	data?: any; // Modified data to pass to next hook
	error?: string;
	halt?: boolean; // If true, stop executing remaining hooks
	metadata?: Record<string, unknown>;
}

/**
 * Registered hook definition
 */
interface RegisteredHook {
	id: string;
	type: HookType;
	priority: HookPriority;
	name: string;
	description?: string;
	fn: HookFunction;
	enabled: boolean;
}

/**
 * Hook Registry - Manages all lifecycle hooks
 */
export class HookRegistry {
	private hooks: Map<HookType, RegisteredHook[]> = new Map();
	private hookCounter = 0;

	/**
	 * Register a hook
	 */
	register(
		type: HookType,
		fn: HookFunction,
		options: {
			priority?: HookPriority;
			name?: string;
			description?: string;
			enabled?: boolean;
		} = {},
	): string {
		const id = `hook-${++this.hookCounter}`;
		const { priority = "normal", name = id, description, enabled = true } = options;

		const hook: RegisteredHook = {
			id,
			type,
			priority,
			name,
			description,
			fn,
			enabled,
		};

		// Get or create hook list for this type
		const hookList = this.hooks.get(type) || [];
		hookList.push(hook);

		// Sort by priority
		hookList.sort((a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]);

		this.hooks.set(type, hookList);

		return id;
	}

	/**
	 * Unregister a hook by ID
	 */
	unregister(id: string): boolean {
		for (const [type, hookList] of this.hooks.entries()) {
			const index = hookList.findIndex((h) => h.id === id);
			if (index >= 0) {
				hookList.splice(index, 1);
				return true;
			}
		}
		return false;
	}

	/**
	 * Enable/disable a hook
	 */
	setEnabled(id: string, enabled: boolean): boolean {
		for (const hookList of this.hooks.values()) {
			const hook = hookList.find((h) => h.id === id);
			if (hook) {
				hook.enabled = enabled;
				return true;
			}
		}
		return false;
	}

	/**
	 * Execute all hooks of a type
	 */
	async execute<T = any>(
		type: HookType,
		context: Partial<HookContext>,
		data: T,
	): Promise<{ success: boolean; data: T; errors: string[] }> {
		const hookList = this.hooks.get(type) || [];
		const errors: string[] = [];

		// Build full context
		const fullContext: HookContext = {
			hookType: type,
			timestamp: new Date().toISOString(),
			component: context.component || "unknown",
			...context,
		};

		let currentData = data;

		// Execute hooks in priority order
		for (const hook of hookList) {
			if (!hook.enabled) continue;

			try {
				const result = await hook.fn(fullContext, currentData);

				if (!result.success) {
					errors.push(`Hook "${hook.name}" failed: ${result.error}`);

					// If hook halts, stop execution
					if (result.halt) {
						return { success: false, data: currentData, errors };
					}
				}

				// Update data for next hook (if provided)
				if (result.data !== undefined) {
					currentData = result.data;
				}

				// If hook requests halt, stop
				if (result.halt) {
					break;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				errors.push(`Hook "${hook.name}" threw error: ${errorMsg}`);
			}
		}

		return {
			success: errors.length === 0,
			data: currentData,
			errors,
		};
	}

	/**
	 * List all hooks of a type
	 */
	list(type?: HookType): RegisteredHook[] {
		if (type) {
			return this.hooks.get(type) || [];
		}

		// Return all hooks
		const allHooks: RegisteredHook[] = [];
		for (const hookList of this.hooks.values()) {
			allHooks.push(...hookList);
		}
		return allHooks;
	}

	/**
	 * Get statistics
	 */
	getStats(): {
		total: number;
		byType: Record<HookType, number>;
		enabled: number;
		disabled: number;
	} {
		const allHooks = this.list();

		const byType: Record<string, number> = {};
		let enabled = 0;
		let disabled = 0;

		for (const hook of allHooks) {
			byType[hook.type] = (byType[hook.type] || 0) + 1;
			if (hook.enabled) {
				enabled++;
			} else {
				disabled++;
			}
		}

		return {
			total: allHooks.length,
			byType: byType as Record<HookType, number>,
			enabled,
			disabled,
		};
	}

	/**
	 * Clear all hooks (useful for testing)
	 */
	clear(): void {
		this.hooks.clear();
		this.hookCounter = 0;
	}
}

/**
 * Global hook registry instance
 */
export const globalHooks = new HookRegistry();

/**
 * Convenience functions for common hooks
 */
export const Hooks = {
	/**
	 * Register a pre-execution hook (validation, context loading)
	 */
	beforeExecute: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("pre-execute", fn, options);
	},

	/**
	 * Register a post-execution hook (learning, cleanup)
	 */
	afterExecute: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("post-execute", fn, options);
	},

	/**
	 * Register an error hook
	 */
	onError: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("error", fn, options);
	},

	/**
	 * Register a cleanup hook
	 */
	onCleanup: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("cleanup", fn, options);
	},

	/**
	 * Register a learning hook (extract insights)
	 */
	onLearn: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("learn", fn, options);
	},

	/**
	 * Register an observability hook (metrics, logging)
	 */
	onObserve: (fn: HookFunction, options?: { priority?: HookPriority; name?: string }): string => {
		return globalHooks.register("observe", fn, options);
	},
};

/**
 * Built-in hooks for common tasks
 */
export const BuiltInHooks = {
	/**
	 * Logging hook - logs all executions
	 */
	logger: (component: string): HookFunction => {
		return async (context, data) => {
			console.log(
				`[${context.timestamp}] [${context.hookType}] [${component}]`,
				JSON.stringify(data, null, 2).substring(0, 200),
			);
			return { success: true };
		};
	},

	/**
	 * Timing hook - tracks execution duration
	 */
	timer: (): HookFunction => {
		const timers = new Map<string, number>();

		return async (context, _data) => {
			const key = `${context.component}-${context.sessionId}`;

			if (context.hookType === "pre-execute") {
				timers.set(key, Date.now());
			} else if (context.hookType === "post-execute") {
				const startTime = timers.get(key);
				if (startTime) {
					const duration = Date.now() - startTime;
					console.log(`[Timer] ${context.component} completed in ${duration}ms`);
					timers.delete(key);
				}
			}

			return { success: true };
		};
	},

	/**
	 * Validation hook - checks input schema
	 */
	validator: (schema: Record<string, string>): HookFunction => {
		return async (_context, data) => {
			const errors: string[] = [];

			for (const [field, expectedType] of Object.entries(schema)) {
				const value = (data as any)?.[field];
				const actualType = typeof value;

				if (expectedType === "required" && value === undefined) {
					errors.push(`Missing required field: ${field}`);
				} else if (value !== undefined && actualType !== expectedType) {
					errors.push(`Invalid type for ${field}: expected ${expectedType}, got ${actualType}`);
				}
			}

			if (errors.length > 0) {
				return {
					success: false,
					error: errors.join("; "),
					halt: true, // Stop execution
				};
			}

			return { success: true };
		};
	},

	/**
	 * Rate limiting hook
	 */
	rateLimiter: (maxRequestsPerMinute: number): HookFunction => {
		const requests = new Map<string, number[]>();

		return async (context, _data) => {
			const key = context.userId || "global";
			const now = Date.now();
			const oneMinuteAgo = now - 60000;

			// Get recent requests
			const userRequests = requests.get(key) || [];
			const recentRequests = userRequests.filter((time) => time > oneMinuteAgo);

			// Check limit
			if (recentRequests.length >= maxRequestsPerMinute) {
				return {
					success: false,
					error: `Rate limit exceeded: ${maxRequestsPerMinute} requests per minute`,
					halt: true,
				};
			}

			// Add current request
			recentRequests.push(now);
			requests.set(key, recentRequests);

			return { success: true };
		};
	},

	/**
	 * Error recovery hook
	 */
	errorRecovery: (fallback: (context: HookContext, error: string) => Promise<any>): HookFunction => {
		return async (context, data) => {
			try {
				const errorData = data as { error?: string };
				if (errorData.error) {
					const recoveryData = await fallback(context, errorData.error);
					return {
						success: true,
						data: recoveryData,
					};
				}
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		};
	},

	/**
	 * Caching hook - caches results
	 */
	cache: (ttlSeconds: number = 300): HookFunction => {
		const cache = new Map<
			string,
			{
				data: any;
				expires: number;
			}
		>();

		return async (context, data) => {
			const key = JSON.stringify(data);

			if (context.hookType === "pre-execute") {
				// Check cache
				const cached = cache.get(key);
				if (cached && cached.expires > Date.now()) {
					return {
						success: true,
						data: cached.data,
						halt: true, // Return cached result, skip execution
					};
				}
			} else if (context.hookType === "post-execute") {
				// Store result
				cache.set(key, {
					data,
					expires: Date.now() + ttlSeconds * 1000,
				});
			}

			return { success: true };
		};
	},
};

/**
 * Create a hook pipeline for complex workflows
 */
export class HookPipeline {
	private hooks: Array<{ type: HookType; fn: HookFunction }> = [];

	add(type: HookType, fn: HookFunction): this {
		this.hooks.push({ type, fn });
		return this;
	}

	async execute(context: Partial<HookContext>, data: any): Promise<{ success: boolean; data: any; errors: string[] }> {
		const errors: string[] = [];
		let currentData = data;

		const fullContext: HookContext = {
			hookType: "pre-execute",
			timestamp: new Date().toISOString(),
			component: "pipeline",
			...context,
		};

		for (const hook of this.hooks) {
			fullContext.hookType = hook.type;

			try {
				const result = await hook.fn(fullContext, currentData);

				if (!result.success) {
					errors.push(result.error || "Hook failed");
					if (result.halt) break;
				}

				if (result.data !== undefined) {
					currentData = result.data;
				}

				if (result.halt) break;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				errors.push(`Hook error: ${errorMsg}`);
			}
		}

		return {
			success: errors.length === 0,
			data: currentData,
			errors,
		};
	}
}

/**
 * Example: Setup common hooks for an agent
 */
export function setupAgentHooks(): void {
	// Logging
	globalHooks.register("pre-execute", BuiltInHooks.logger("agent"), {
		priority: "highest",
		name: "pre-execute-logger",
	});

	// Timing
	globalHooks.register("pre-execute", BuiltInHooks.timer(), {
		priority: "high",
		name: "timer-start",
	});

	globalHooks.register("post-execute", BuiltInHooks.timer(), {
		priority: "low",
		name: "timer-end",
	});

	// Rate limiting
	globalHooks.register("pre-execute", BuiltInHooks.rateLimiter(60), {
		priority: "highest",
		name: "rate-limiter",
	});
}
