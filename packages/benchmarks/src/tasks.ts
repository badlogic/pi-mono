/**
 * Benchmark task suite — 10 deterministic tasks for energy-aware vs baseline comparison.
 *
 * Categories:
 * - Simple Q&A (2): baseline quality checks with minimal turns
 * - Code generation (3): multi-step tasks simulating tool use
 * - Reasoning (2): math and logic tasks requiring reasoning tokens
 * - Summarization (2): long input, concise output
 * - Multi-tool orchestration (1): complex agent workflow
 */

import type { BenchmarkTask, MockTurnUsage } from "./types.js";

/** Default mock usage for a single-turn Q&A task. */
const QA_USAGE: MockTurnUsage = {
	input: 200,
	output: 100,
	totalTokens: 300,
	cost: { total: 0.0003 },
	energy_joules: 0.2,
	energy_kwh: 0.2 / 3_600_000,
	latency_ms: 80,
};

/** Mock usage for a code generation turn. */
const CODE_GEN_USAGE: MockTurnUsage = {
	input: 800,
	output: 400,
	totalTokens: 1200,
	cost: { total: 0.0018 },
	energy_joules: 0.8,
	energy_kwh: 0.8 / 3_600_000,
	latency_ms: 200,
};

/** Mock usage for a reasoning-heavy turn. */
const REASONING_USAGE: MockTurnUsage = {
	input: 600,
	output: 500,
	totalTokens: 1100,
	cost: { total: 0.002 },
	energy_joules: 1.2,
	energy_kwh: 1.2 / 3_600_000,
	latency_ms: 350,
};

/** Mock usage for a summarization turn. */
const SUMMARY_USAGE: MockTurnUsage = {
	input: 2000,
	output: 200,
	totalTokens: 2200,
	cost: { total: 0.003 },
	energy_joules: 0.6,
	energy_kwh: 0.6 / 3_600_000,
	latency_ms: 150,
};

/** Mock usage for a multi-tool orchestration turn. */
const ORCHESTRATION_USAGE: MockTurnUsage = {
	input: 1000,
	output: 600,
	totalTokens: 1600,
	cost: { total: 0.003 },
	energy_joules: 1.0,
	energy_kwh: 1.0 / 3_600_000,
	latency_ms: 300,
};

export const BENCHMARK_TASKS: BenchmarkTask[] = [
	// --- Simple Q&A (2 tasks) ---
	{
		id: "qa-factual",
		name: "Factual Q&A",
		description: "Answer a simple factual question in one turn",
		prompt: "What is the capital of France?",
		maxTurns: 1,
		mockTurnUsage: [QA_USAGE],
		validator: (records) => ({
			passed: records.length === 1,
			score: records.length === 1 ? 1.0 : 0,
			reason: records.length === 1 ? "single-turn completion" : `expected 1 record, got ${records.length}`,
		}),
	},
	{
		id: "qa-definition",
		name: "Definition Q&A",
		description: "Define a technical term concisely",
		prompt: "Define 'energy efficiency' in the context of machine learning inference.",
		maxTurns: 1,
		mockTurnUsage: [{ ...QA_USAGE, output: 150, totalTokens: 350 }],
		validator: (records) => ({
			passed: records.length === 1,
			score: records.length === 1 ? 1.0 : 0,
			reason: records.length === 1 ? "single-turn completion" : `expected 1 record, got ${records.length}`,
		}),
	},

	// --- Code Generation (3 tasks) ---
	{
		id: "code-fizzbuzz",
		name: "FizzBuzz Implementation",
		description: "Write a FizzBuzz function with edge case handling",
		prompt: "Write a TypeScript function that prints FizzBuzz for numbers 1 to 100.",
		maxTurns: 2,
		mockTurnUsage: [CODE_GEN_USAGE, { ...CODE_GEN_USAGE, input: 1000, output: 200, totalTokens: 1200 }],
		validator: (records) => ({
			passed: records.length >= 1 && records.length <= 2,
			score: records.length >= 1 ? 0.9 : 0,
			reason: records.length >= 1 ? "code generated" : "no code output",
		}),
	},
	{
		id: "code-sort",
		name: "Sorting Algorithm",
		description: "Implement a merge sort with tests",
		prompt: "Implement merge sort in TypeScript with a test that verifies correctness on [3,1,4,1,5,9,2,6].",
		maxTurns: 3,
		mockTurnUsage: [
			CODE_GEN_USAGE,
			{ ...CODE_GEN_USAGE, input: 1200, output: 300, totalTokens: 1500 },
			{ ...CODE_GEN_USAGE, input: 1500, output: 200, totalTokens: 1700, energy_joules: 0.6 },
		],
		validator: (records) => {
			const totalTokens = records.reduce((sum, r) => sum + r.tokens.total, 0);
			return {
				passed: records.length >= 2,
				score: Math.min(1.0, totalTokens / 3000),
				reason: records.length >= 2 ? "multi-step code generation" : "insufficient turns",
			};
		},
	},
	{
		id: "code-api-client",
		name: "API Client Generator",
		description: "Generate a typed HTTP client for a REST API",
		prompt:
			"Create a TypeScript API client class for a REST API with GET /users, POST /users, and DELETE /users/:id endpoints.",
		maxTurns: 4,
		mockTurnUsage: [
			CODE_GEN_USAGE,
			{ ...CODE_GEN_USAGE, input: 1400, output: 500, totalTokens: 1900 },
			{ ...CODE_GEN_USAGE, input: 1800, output: 300, totalTokens: 2100 },
			{ ...CODE_GEN_USAGE, input: 2000, output: 200, totalTokens: 2200, energy_joules: 0.5 },
		],
		validator: (records) => {
			const totalEnergy = records.reduce((sum, r) => sum + r.energy_joules, 0);
			return {
				passed: records.length >= 3,
				score: records.length >= 3 ? 0.85 : 0.3,
				reason:
					records.length >= 3
						? `multi-step generation complete (${totalEnergy.toFixed(2)}J)`
						: "insufficient turns for full implementation",
			};
		},
	},

	// --- Reasoning (2 tasks) ---
	{
		id: "reason-math",
		name: "Math Word Problem",
		description: "Solve a multi-step math problem requiring chain-of-thought",
		prompt:
			"A train travels 120 km in 2 hours. It then speeds up by 20 km/h for the next 3 hours. What is the total distance traveled?",
		maxTurns: 2,
		mockTurnUsage: [REASONING_USAGE, { ...REASONING_USAGE, input: 800, output: 300, totalTokens: 1100 }],
		validator: (records) => ({
			passed: records.length >= 1,
			score: records.length >= 1 ? 1.0 : 0,
			reason: records.length >= 1 ? "reasoning completed" : "no reasoning output",
		}),
	},
	{
		id: "reason-logic",
		name: "Logic Puzzle",
		description: "Solve a deductive reasoning puzzle",
		prompt:
			"Alice, Bob, and Carol each have a different pet: cat, dog, fish. Alice does not have the dog. Bob does not have the cat. Carol has the fish. Who has each pet?",
		maxTurns: 2,
		mockTurnUsage: [REASONING_USAGE, { ...REASONING_USAGE, output: 200, totalTokens: 800 }],
		validator: (records) => ({
			passed: records.length >= 1,
			score: records.length >= 1 ? 1.0 : 0,
			reason: records.length >= 1 ? "logic puzzle solved" : "no solution produced",
		}),
	},

	// --- Summarization (2 tasks) ---
	{
		id: "summary-article",
		name: "Article Summarization",
		description: "Summarize a long article into 3 bullet points",
		prompt:
			"Summarize the following article about renewable energy trends into 3 concise bullet points: [article text about solar panel efficiency improvements, wind farm expansion, and battery storage breakthroughs spanning 2000 tokens]",
		maxTurns: 1,
		mockTurnUsage: [SUMMARY_USAGE],
		validator: (records) => ({
			passed: records.length === 1,
			score: records.length === 1 ? 1.0 : 0,
			reason: records.length === 1 ? "summary produced" : "no summary output",
		}),
	},
	{
		id: "summary-code-review",
		name: "Code Review Summary",
		description: "Summarize issues found in a code review",
		prompt:
			"Review the following 500-line TypeScript file and summarize the top 5 issues: [large code block with intentional bugs including null pointer risks, missing error handling, and performance issues]",
		maxTurns: 2,
		mockTurnUsage: [
			{ ...SUMMARY_USAGE, input: 3000, totalTokens: 3200 },
			{ ...SUMMARY_USAGE, input: 1000, output: 300, totalTokens: 1300, energy_joules: 0.4 },
		],
		validator: (records) => {
			const totalTokens = records.reduce((sum, r) => sum + r.tokens.total, 0);
			return {
				passed: records.length >= 1,
				score: Math.min(1.0, totalTokens / 3000),
				reason: records.length >= 1 ? "code review summary produced" : "no review output",
			};
		},
	},

	// --- Multi-tool Orchestration (1 task) ---
	{
		id: "orchestration-research",
		name: "Research Orchestration",
		description: "Multi-step research task requiring tool use and synthesis",
		prompt:
			"Research the current state of energy-efficient AI inference. Search for recent papers, summarize findings, and produce a structured report with recommendations.",
		maxTurns: 5,
		mockTurnUsage: [
			ORCHESTRATION_USAGE,
			{ ...ORCHESTRATION_USAGE, input: 1500, output: 400, totalTokens: 1900 },
			{ ...ORCHESTRATION_USAGE, input: 2000, output: 500, totalTokens: 2500, energy_joules: 1.2 },
			{ ...ORCHESTRATION_USAGE, input: 2500, output: 600, totalTokens: 3100, energy_joules: 1.4 },
			{ ...ORCHESTRATION_USAGE, input: 3000, output: 800, totalTokens: 3800, energy_joules: 1.5 },
		],
		validator: (records) => {
			const totalEnergy = records.reduce((sum, r) => sum + r.energy_joules, 0);
			const totalTokens = records.reduce((sum, r) => sum + r.tokens.total, 0);
			return {
				passed: records.length >= 4,
				score: records.length >= 4 ? 0.9 : records.length / 5,
				reason:
					records.length >= 4
						? `research complete: ${records.length} turns, ${totalTokens} tokens, ${totalEnergy.toFixed(2)}J`
						: `incomplete: only ${records.length}/5 turns`,
			};
		},
	},
];

/**
 * Get tasks matching a glob pattern.
 * If no pattern is provided, returns all tasks.
 */
export function getTasksByGlob(pattern?: string): BenchmarkTask[] {
	if (!pattern) return BENCHMARK_TASKS;
	const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
	return BENCHMARK_TASKS.filter((t) => regex.test(t.id));
}
