/**
 * PAI 13 Founding Principles - Applied to Pi-Mono Discord Bot
 *
 * Based on TAC Lesson 14: Personal AI Infrastructure
 *
 * 1. Clear thinking first - Quality outcomes depend on prompt quality
 * 2. Determinism over flexibility - Same input = predictable output
 * 3. Code before prompts - Use code to solve; prompts orchestrate
 * 4. Specification-driven - Define expected behavior first
 * 5. UNIX philosophy - Small, focused tools that compose
 * 6. Skills as capabilities - Self-contained AI modules
 * 7. Agents as personalities - Specialized for different tasks
 * 8. Hooks for automation - Event-driven state management
 * 9. History preserves work - Compound learning over time
 * 10. Architecture > Model - Structure beats raw power
 * 11. Fail gracefully - Handle errors without losing work
 * 12. Observable systems - Know what's happening
 * 13. Composable design - Build complex from simple
 */

/**
 * Principle 1: Clear Thinking First
 *
 * Quality outcomes depend on prompt quality. Invest in clarity.
 *
 * Anti-pattern: Vague prompts hoping the model will figure it out
 * Pattern: Structured inputs with context, constraints, and examples
 */
export const CLEAR_THINKING = {
	principle: "Quality outcomes depend on prompt quality",

	// Template for structured prompts
	structuredPrompt: (params: {
		task: string;
		context?: string;
		constraints?: string[];
		examples?: string[];
		outputFormat?: string;
	}): string => {
		const parts: string[] = [`## Task\n${params.task}`];

		if (params.context) {
			parts.push(`## Context\n${params.context}`);
		}

		if (params.constraints?.length) {
			parts.push(`## Constraints\n${params.constraints.map((c) => `- ${c}`).join("\n")}`);
		}

		if (params.examples?.length) {
			parts.push(`## Examples\n${params.examples.join("\n\n")}`);
		}

		if (params.outputFormat) {
			parts.push(`## Expected Output Format\n${params.outputFormat}`);
		}

		return parts.join("\n\n");
	},

	// Validate prompt quality
	validatePrompt: (prompt: string): { valid: boolean; issues: string[] } => {
		const issues: string[] = [];

		if (prompt.length < 10) {
			issues.push("Prompt too short - needs more context");
		}

		if (!prompt.includes("?") && !prompt.match(/\b(create|generate|analyze|review)\b/i)) {
			issues.push("Unclear intent - no clear action or question");
		}

		if (prompt.split(" ").length > 500) {
			issues.push("Prompt too long - consider breaking into steps");
		}

		return {
			valid: issues.length === 0,
			issues,
		};
	},
};

/**
 * Principle 2: Determinism Over Flexibility
 *
 * Same input should produce predictable output.
 * Use temperature=0 for deterministic tasks.
 */
export const DETERMINISM = {
	principle: "Same input = predictable output",

	// Deterministic execution config
	deterministicConfig: {
		temperature: 0,
		topP: 1,
		seed: 42, // Fixed seed for reproducibility
	},

	// Creative execution config
	creativeConfig: {
		temperature: 0.7,
		topP: 0.9,
	},

	// Classify task type
	classifyTask: (task: string): "deterministic" | "creative" => {
		const creativeTriggers = [
			/\b(generate|create|write|compose|brainstorm|imagine)\b/i,
			/\b(story|poem|creative|original|unique)\b/i,
		];

		const isDeterministic = !creativeTriggers.some((pattern) => pattern.test(task));
		return isDeterministic ? "deterministic" : "creative";
	},
};

/**
 * Principle 3: Code Before Prompts
 *
 * Use code for logic, data processing, and deterministic operations.
 * Use prompts only for tasks requiring language understanding.
 */
export const CODE_BEFORE_PROMPTS = {
	principle: "Use code to solve; prompts orchestrate",

	// Check if task should use code
	shouldUseCode: (task: string): boolean => {
		const codePatterns = [
			/\b(calculate|compute|parse|validate|transform|filter|sort)\b/i,
			/\b(data|json|csv|api|database)\b/i,
			/\b(file|directory|path|system)\b/i,
		];

		return codePatterns.some((pattern) => pattern.test(task));
	},

	// Example: Don't ask LLM to parse JSON - use code
	exampleAntiPattern: "Use LLM to extract field from JSON response",
	examplePattern: "Parse JSON with code, only use LLM for interpretation",
};

/**
 * Principle 4: Specification-Driven
 *
 * Define expected behavior before implementation.
 */
export interface TaskSpecification {
	name: string;
	description: string;
	inputs: { name: string; type: string; description: string }[];
	outputs: { name: string; type: string; description: string }[];
	constraints?: string[];
	examples?: { input: unknown; output: unknown }[];
	successCriteria?: string[];
}

export const SPECIFICATION_DRIVEN = {
	principle: "Define expected behavior first",

	// Validate specification completeness
	validateSpec: (spec: TaskSpecification): { valid: boolean; issues: string[] } => {
		const issues: string[] = [];

		if (!spec.name) issues.push("Missing name");
		if (!spec.description) issues.push("Missing description");
		if (!spec.inputs?.length) issues.push("No inputs defined");
		if (!spec.outputs?.length) issues.push("No outputs defined");

		return {
			valid: issues.length === 0,
			issues,
		};
	},

	// Generate spec from natural language
	generateSpec: (description: string): Partial<TaskSpecification> => {
		// Extract action words for name
		const actionMatch = description.match(/\b(analyze|generate|create|review|validate)\b/i);
		const name = (actionMatch?.[0] || "task").toLowerCase();

		return {
			name,
			description,
			inputs: [],
			outputs: [],
			constraints: [],
		};
	},
};

/**
 * Principle 5: UNIX Philosophy
 *
 * Small, focused tools that do one thing well and compose.
 */
export const UNIX_PHILOSOPHY = {
	principle: "Small, focused tools that compose",

	// Tool quality criteria
	toolQuality: {
		singleResponsibility: "Tool should do ONE thing well",
		composable: "Output should be usable by other tools",
		minimal: "Minimal dependencies and complexity",
		predictable: "Clear input/output contract",
	},

	// Validate tool follows UNIX philosophy
	validateTool: (tool: {
		name: string;
		description: string;
		execute: (...args: any[]) => any;
	}): { valid: boolean; violations: string[] } => {
		const violations: string[] = [];

		// Check for "and" in description (multiple responsibilities)
		const andMatches = tool.description.match(/\band\b/g);
		if (andMatches && andMatches.length > 1) {
			violations.push("Description suggests multiple responsibilities");
		}

		// Check for overly complex names
		if (tool.name.split("_").length > 3) {
			violations.push("Name too complex - consider breaking into multiple tools");
		}

		return {
			valid: violations.length === 0,
			violations,
		};
	},
};

/**
 * Principle 10: Architecture > Model
 *
 * Structure beats raw power. A well-architected system with
 * smaller models often outperforms a monolithic large model.
 */
export const ARCHITECTURE_OVER_MODEL = {
	principle: "Structure beats raw power",

	// Architecture patterns
	patterns: {
		pipeline: "Chain specialized steps (preprocessing → analysis → synthesis)",
		multiAgent: "Parallel specialized agents with consensus",
		hierarchy: "Router → Specialized workers → Aggregator",
		iterative: "Execute → Evaluate → Refine loop",
	},

	// When to use which pattern
	selectPattern: (task: string): "pipeline" | "multiAgent" | "hierarchy" | "iterative" => {
		if (task.match(/\b(steps|pipeline|sequential|workflow)\b/i)) {
			return "pipeline";
		}
		if (task.match(/\b(multiple|parallel|consensus|voting)\b/i)) {
			return "multiAgent";
		}
		if (task.match(/\b(route|classify|delegate|triage)\b/i)) {
			return "hierarchy";
		}
		if (task.match(/\b(refine|improve|iterate|optimize)\b/i)) {
			return "iterative";
		}
		return "pipeline"; // Default
	},
};

/**
 * Principle 11: Fail Gracefully
 *
 * Handle errors without losing work. Preserve partial progress.
 */
export const FAIL_GRACEFULLY = {
	principle: "Handle errors without losing work",

	// Error recovery strategies
	recoveryStrategies: {
		retry: "Retry with exponential backoff",
		fallback: "Use simpler alternative approach",
		partial: "Return partial results with error context",
		checkpoint: "Save progress before risky operations",
	},

	// Wrap execution with error handling
	withRecovery: async <T>(
		operation: () => Promise<T>,
		options: {
			maxRetries?: number;
			fallback?: () => Promise<T>;
			onError?: (error: Error) => void;
		} = {},
	): Promise<{ success: boolean; result?: T; error?: Error }> => {
		const { maxRetries = 3, fallback, onError } = options;

		let lastError: Error | undefined;

		// Try main operation with retries
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const result = await operation();
				return { success: true, result };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				onError?.(lastError);

				// Exponential backoff
				if (attempt < maxRetries) {
					await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
				}
			}
		}

		// Try fallback if available
		if (fallback) {
			try {
				const result = await fallback();
				return { success: true, result };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}

		return { success: false, error: lastError || new Error("Unknown error") };
	},
};

/**
 * Principle 12: Observable Systems
 *
 * Know what's happening. Emit events, log decisions, track metrics.
 */
export interface ObservabilityEvent {
	timestamp: string;
	level: "debug" | "info" | "warn" | "error";
	component: string;
	event: string;
	data?: unknown;
}

export const OBSERVABLE_SYSTEMS = {
	principle: "Know what's happening",

	// Event emitter
	emit: (event: ObservabilityEvent): void => {
		const formatted = `[${event.timestamp}] [${event.level.toUpperCase()}] [${event.component}] ${event.event}`;

		switch (event.level) {
			case "error":
				console.error(formatted, event.data);
				break;
			case "warn":
				console.warn(formatted, event.data);
				break;
			case "info":
				console.info(formatted, event.data);
				break;
			case "debug":
				console.debug(formatted, event.data);
				break;
		}
	},

	// Create observable wrapper
	observable: <T extends (...args: any[]) => any>(fn: T, component: string): T => {
		return (async (...args: any[]) => {
			const startTime = Date.now();

			OBSERVABLE_SYSTEMS.emit({
				timestamp: new Date().toISOString(),
				level: "info",
				component,
				event: `${fn.name} started`,
				data: { args },
			});

			try {
				const result = await fn(...args);
				const duration = Date.now() - startTime;

				OBSERVABLE_SYSTEMS.emit({
					timestamp: new Date().toISOString(),
					level: "info",
					component,
					event: `${fn.name} completed`,
					data: { duration, success: true },
				});

				return result;
			} catch (error) {
				const duration = Date.now() - startTime;

				OBSERVABLE_SYSTEMS.emit({
					timestamp: new Date().toISOString(),
					level: "error",
					component,
					event: `${fn.name} failed`,
					data: { duration, error: error instanceof Error ? error.message : String(error) },
				});

				throw error;
			}
		}) as T;
	},
};

/**
 * Principle 13: Composable Design
 *
 * Build complex from simple. Every component should be independently useful.
 */
export const COMPOSABLE_DESIGN = {
	principle: "Build complex from simple",

	// Composition patterns
	compose: {
		// Sequential composition: f(g(x))
		pipe: <T>(...fns: Array<(arg: T) => T>): ((arg: T) => T) => {
			return (arg: T) => fns.reduce((result, fn) => fn(result), arg);
		},

		// Parallel composition: [f(x), g(x)]
		parallel: async <T, R>(fns: Array<(arg: T) => Promise<R>>, arg: T): Promise<R[]> => {
			return Promise.all(fns.map((fn) => fn(arg)));
		},

		// Conditional composition: condition(x) ? f(x) : g(x)
		branch: <T>(condition: (arg: T) => boolean, ifTrue: (arg: T) => T, ifFalse: (arg: T) => T): ((arg: T) => T) => {
			return (arg: T) => (condition(arg) ? ifTrue(arg) : ifFalse(arg));
		},
	},

	// Validate composability
	isComposable: (fn: (...args: any[]) => any): boolean => {
		// Pure function checks
		return (
			fn.length > 0 && // Has inputs
			!fn.toString().includes("global") && // No global state
			!fn.toString().includes("process.") // No process dependencies
		);
	},
};

/**
 * Export all principles as a unified collection
 */
export const PAI_PRINCIPLES = {
	1: CLEAR_THINKING,
	2: DETERMINISM,
	3: CODE_BEFORE_PROMPTS,
	4: SPECIFICATION_DRIVEN,
	5: UNIX_PHILOSOPHY,
	10: ARCHITECTURE_OVER_MODEL,
	11: FAIL_GRACEFULLY,
	12: OBSERVABLE_SYSTEMS,
	13: COMPOSABLE_DESIGN,
} as const;

/**
 * Apply principles to validate an agent design
 */
export function validateAgentDesign(design: {
	name: string;
	description: string;
	tools: Array<{ name: string; description: string }>;
	workflow: string;
}): { valid: boolean; feedback: string[] } {
	const feedback: string[] = [];

	// Principle 1: Clear thinking
	const promptCheck = CLEAR_THINKING.validatePrompt(design.description);
	if (!promptCheck.valid) {
		feedback.push(...promptCheck.issues.map((i) => `[Principle 1] ${i}`));
	}

	// Principle 5: UNIX philosophy
	for (const tool of design.tools) {
		const toolCheck = UNIX_PHILOSOPHY.validateTool({ ...tool, execute: () => {} });
		if (!toolCheck.valid) {
			feedback.push(...toolCheck.violations.map((v) => `[Principle 5] Tool "${tool.name}": ${v}`));
		}
	}

	// Principle 10: Architecture
	const pattern = ARCHITECTURE_OVER_MODEL.selectPattern(design.workflow);
	feedback.push(`[Principle 10] Recommended pattern: ${pattern}`);

	return {
		valid: feedback.filter((f) => !f.includes("Recommended")).length === 0,
		feedback,
	};
}
