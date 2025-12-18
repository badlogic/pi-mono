/**
 * Fabric Pattern Executor
 * Executes fabric patterns using the lightweight agent
 * Supports pattern chaining and custom models
 */

import { type AgentOptions, type AgentResult, runAgent } from "../lightweight-agent.js";
import { getPattern, hasPattern, type PatternInfo } from "./fabric-sync.js";

export interface PatternExecuteOptions {
	/** Pattern name from fabric repository */
	pattern: string;
	/** User input to process with the pattern */
	input: string;
	/** Optional model to use (defaults to GLM-4.6) */
	model?: string;
	/** Maximum tokens for response */
	maxTokens?: number;
	/** Request timeout in ms */
	timeout?: number;
	/** Additional context to include */
	context?: string;
}

export interface PatternExecuteResult extends AgentResult {
	/** Pattern name that was executed */
	pattern: string;
	/** Pattern info (system prompt, etc) */
	patternInfo: PatternInfo;
}

export interface PatternChainOptions {
	/** Array of pattern names to execute in sequence */
	patterns: string[];
	/** Initial input to first pattern */
	input: string;
	/** Optional model to use for all patterns */
	model?: string;
	/** Maximum tokens per pattern */
	maxTokens?: number;
	/** Timeout per pattern in ms */
	timeout?: number;
	/** Transform function between patterns (optional) */
	transform?: (output: string, patternIndex: number) => string;
}

export interface PatternChainResult {
	/** Whether the entire chain succeeded */
	success: boolean;
	/** Final output from the last pattern */
	output: string;
	/** Results from each pattern in the chain */
	steps: PatternExecuteResult[];
	/** Total duration for entire chain */
	duration: number;
	/** Any error that occurred */
	error?: string;
}

/**
 * Execute a single fabric pattern
 */
export async function executePattern(options: PatternExecuteOptions): Promise<PatternExecuteResult> {
	const { pattern: patternName, input, model, maxTokens = 8000, timeout = 90000, context } = options;

	// Get pattern info
	const patternInfo = await getPattern(patternName);
	if (!patternInfo) {
		throw new Error(`Pattern '${patternName}' not found. Run syncFabricPatterns() first.`);
	}

	// Build full prompt (pattern system prompt + user input)
	const fullPrompt = context ? `${input}\n\nContext: ${context}` : input;

	// Execute with lightweight agent
	const agentOptions: AgentOptions = {
		prompt: fullPrompt,
		systemPrompt: patternInfo.systemPrompt,
		model,
		maxTokens,
		timeout,
	};

	const result = await runAgent(agentOptions);

	return {
		...result,
		pattern: patternName,
		patternInfo,
	};
}

/**
 * Execute multiple patterns in sequence (chain)
 * Output from each pattern becomes input to the next
 */
export async function executePatternChain(options: PatternChainOptions): Promise<PatternChainResult> {
	const { patterns, input, model, maxTokens, timeout, transform } = options;

	const startTime = Date.now();
	const steps: PatternExecuteResult[] = [];
	let currentInput = input;

	try {
		for (let i = 0; i < patterns.length; i++) {
			const patternName = patterns[i];

			// Execute pattern
			const result = await executePattern({
				pattern: patternName,
				input: currentInput,
				model,
				maxTokens,
				timeout,
			});

			steps.push(result);

			// Check for errors
			if (!result.success) {
				return {
					success: false,
					output: result.output,
					steps,
					duration: Date.now() - startTime,
					error: result.error || `Pattern '${patternName}' failed`,
				};
			}

			// Transform output for next pattern (if provided)
			currentInput = transform ? transform(result.output, i) : result.output;
		}

		return {
			success: true,
			output: currentInput,
			steps,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: "",
			steps,
			duration: Date.now() - startTime,
			error: errorMsg,
		};
	}
}

/**
 * Common pattern chain presets
 */
export const PatternChainPresets = {
	/**
	 * Deep analysis: extract_wisdom → analyze_claims → summarize
	 */
	deepAnalysis: (text: string, model?: string): PatternChainOptions => ({
		patterns: ["extract_wisdom", "analyze_claims", "summarize"],
		input: text,
		model,
		maxTokens: 8000,
		timeout: 120000,
	}),

	/**
	 * Content creation: extract_insights → improve_prompt → write_essay
	 */
	contentCreation: (topic: string, model?: string): PatternChainOptions => ({
		patterns: ["extract_insights", "improve_prompt", "write_essay"],
		input: topic,
		model,
		maxTokens: 12000,
		timeout: 180000,
	}),

	/**
	 * Code workflow: explain_code → review_code → improve_prompt
	 */
	codeReview: (code: string, model?: string): PatternChainOptions => ({
		patterns: ["explain_code", "review_code", "improve_prompt"],
		input: code,
		model,
		maxTokens: 8000,
		timeout: 120000,
	}),

	/**
	 * Research: extract_article_wisdom → analyze_paper → create_summary
	 */
	research: (article: string, model?: string): PatternChainOptions => ({
		patterns: ["extract_article_wisdom", "analyze_paper", "create_summary"],
		input: article,
		model,
		maxTokens: 10000,
		timeout: 150000,
	}),

	/**
	 * Learning: extract_wisdom → create_quiz → summarize
	 */
	learning: (content: string, model?: string): PatternChainOptions => ({
		patterns: ["extract_wisdom", "create_quiz", "summarize"],
		input: content,
		model,
		maxTokens: 8000,
		timeout: 120000,
	}),

	/**
	 * Security: create_threat_model → analyze_claims → create_security_update
	 */
	securityAudit: (system: string, model?: string): PatternChainOptions => ({
		patterns: ["create_threat_model", "analyze_claims", "create_security_update"],
		input: system,
		model,
		maxTokens: 10000,
		timeout: 150000,
	}),
};

/**
 * Execute a pattern preset by name
 */
export async function executePreset(
	preset: keyof typeof PatternChainPresets,
	input: string,
	model?: string,
): Promise<PatternChainResult> {
	const presetFn = PatternChainPresets[preset];
	if (!presetFn) {
		throw new Error(`Unknown preset: ${preset}`);
	}

	const options = presetFn(input, model);
	return executePatternChain(options);
}

/**
 * Batch execute multiple patterns in parallel (not chained)
 */
export async function executePatternBatch(
	patterns: string[],
	input: string,
	model?: string,
): Promise<{
	results: PatternExecuteResult[];
	success: boolean;
	duration: number;
}> {
	const startTime = Date.now();

	const promises = patterns.map((pattern) =>
		executePattern({
			pattern,
			input,
			model,
		}),
	);

	const results = await Promise.all(promises);
	const success = results.every((r) => r.success);

	return {
		results,
		success,
		duration: Date.now() - startTime,
	};
}

/**
 * Quick pattern execution helpers
 */
export const QuickPatterns = {
	/** Extract wisdom from text */
	extractWisdom: async (text: string, model?: string) =>
		executePattern({ pattern: "extract_wisdom", input: text, model }),

	/** Summarize content */
	summarize: async (text: string, model?: string) => executePattern({ pattern: "summarize", input: text, model }),

	/** Analyze claims */
	analyzeClaims: async (text: string, model?: string) =>
		executePattern({ pattern: "analyze_claims", input: text, model }),

	/** Improve a prompt */
	improvePrompt: async (prompt: string, model?: string) =>
		executePattern({ pattern: "improve_prompt", input: prompt, model }),

	/** Review code */
	reviewCode: async (code: string, model?: string) => executePattern({ pattern: "review_code", input: code, model }),

	/** Explain code */
	explainCode: async (code: string, model?: string) => executePattern({ pattern: "explain_code", input: code, model }),

	/** Write essay */
	writeEssay: async (topic: string, model?: string) => executePattern({ pattern: "write_essay", input: topic, model }),

	/** Create coding project */
	createCodingProject: async (description: string, model?: string) =>
		executePattern({ pattern: "create_coding_project", input: description, model }),

	/** Create micro summary */
	microSummary: async (text: string, model?: string) =>
		executePattern({ pattern: "create_micro_summary", input: text, model }),

	/** Extract insights */
	extractInsights: async (text: string, model?: string) =>
		executePattern({ pattern: "extract_insights", input: text, model }),

	/** Analyze prose */
	analyzeProse: async (text: string, model?: string) =>
		executePattern({ pattern: "analyze_prose", input: text, model }),

	/** Create quiz */
	createQuiz: async (content: string, model?: string) =>
		executePattern({ pattern: "create_quiz", input: content, model }),

	/** Create threat model */
	createThreatModel: async (system: string, model?: string) =>
		executePattern({ pattern: "create_threat_model", input: system, model }),
};

/**
 * Validate pattern exists before execution
 */
export async function validatePattern(patternName: string): Promise<boolean> {
	return hasPattern(patternName);
}

/**
 * Get suggested patterns based on use case
 */
export function getSuggestedPatterns(useCase: string): string[] {
	const lowerCase = useCase.toLowerCase();

	if (lowerCase.includes("code") || lowerCase.includes("programming")) {
		return ["explain_code", "review_code", "create_coding_project"];
	}

	if (lowerCase.includes("summary") || lowerCase.includes("summarize")) {
		return ["summarize", "create_summary", "create_micro_summary"];
	}

	if (lowerCase.includes("wisdom") || lowerCase.includes("insight")) {
		return ["extract_wisdom", "extract_insights", "extract_article_wisdom"];
	}

	if (lowerCase.includes("security") || lowerCase.includes("threat")) {
		return ["create_threat_model", "create_security_update", "analyze_claims"];
	}

	if (lowerCase.includes("essay") || lowerCase.includes("write")) {
		return ["write_essay", "improve_prompt", "analyze_prose"];
	}

	if (lowerCase.includes("learn") || lowerCase.includes("quiz")) {
		return ["create_quiz", "extract_wisdom", "summarize"];
	}

	if (lowerCase.includes("analysis") || lowerCase.includes("analyze")) {
		return ["analyze_claims", "analyze_paper", "analyze_prose"];
	}

	// Default suggestions
	return ["extract_wisdom", "summarize", "analyze_claims"];
}
