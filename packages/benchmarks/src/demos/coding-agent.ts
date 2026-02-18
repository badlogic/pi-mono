/**
 * Demo 1: Coding Agent Energy Challenge
 *
 * Runs a coding task under BaselinePolicy and EnergyAwarePolicy to completion —
 * BOTH runs finish the task; the comparison shows energy/cost/turns differences.
 *
 * Structure (3 phases):
 *   Phase 1: Incremental build turns (configurable, default: 4 rate-limiter turns)
 *   Phase 2: Consolidate into a single impl.ts file
 *   Phase 3: Acceptance-test loop — run tests, request corrections, repeat until PASS
 *
 * Budget is informational and drives policy interventions (routing, token limits)
 * but never aborts the run. Both modes always reach a verdict.
 *
 * Energy benchmarks from portal.neuralwatt.com:
 *   Devstral-Small: 0.809 tokens/J  ($0.12/$0.12 per 1M)
 *   GPT-OSS-20B:    1.371 tokens/J  ($0.10/$0.10 per 1M)  <- 1.7x more efficient
 *
 * Usage:
 *   npx tsx src/demos/coding-agent.ts
 *   npx tsx src/demos/coding-agent.ts --budget 15000
 *   npx tsx src/demos/coding-agent.ts --task "implement X" --acceptance ./my-test.ts
 *   npx tsx src/demos/coding-agent.ts --clear-memory
 *
 * Requires NEURALWATT_API_KEY in the environment.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { EnergyBudget, PolicyContext, RuntimePolicy, UsageWithEnergy } from "@mariozechner/pi-agent-core";
import { BaselinePolicy, EnergyAwarePolicy } from "@mariozechner/pi-agent-core";
import {
	type AssistantMessage,
	completeSimple,
	type Message,
	type Model,
	registerBuiltInApiProviders,
} from "@mariozechner/pi-ai";
import { type CodingMemory, clearMemory, formatCodingMemory, loadMemory, saveMemory } from "./demo-memory.js";

// -- Models -------------------------------------------------------------------

const TOKENS_PER_JOULE: Record<string, number> = {
	"openai/gpt-oss-20b": 1.371,
	"mistralai/Devstral-Small-2-24B-Instruct-2512": 0.809,
	"deepseek-ai/deepseek-coder-33b-instruct": 0.092,
	"moonshotai/Kimi-K2.5": 0.482,
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": 0.314,
};

const NEURALWATT_MODELS: Model<"openai-completions">[] = [
	{
		// Most energy-efficient: 1.371 tokens/J, cheapest at $0.10/$0.10/1M
		id: "openai/gpt-oss-20b",
		name: "GPT-OSS 20B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_384,
		maxTokens: 4_096,
	},
	{
		// Default: 0.809 tokens/J, $0.12/$0.12/1M
		id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
		name: "Devstral Small 24B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 8_192,
	},
];

/** Cheapest/most-efficient model — used when over budget but continuing anyway. */
const CHEAPEST_MODEL = NEURALWATT_MODELS[0];
const DEFAULT_MODEL = NEURALWATT_MODELS[1]; // Devstral-Small

/** Routing fires at >70% (~10500J), token limits at >50% (~7500J). */
const DEFAULT_BUDGET_JOULES = 15_000;

/** Memory key for this routing pair. */
const MEMORY_KEY = "devstral→gpt-oss-20b";

// -- Task definition ----------------------------------------------------------

const SYSTEM_PROMPT =
	"You are an expert TypeScript engineer. " +
	"Implement code concisely and correctly. " +
	"Include TypeScript types and JSDoc for public APIs. " +
	"Each response should be tightly focused — implement only what is asked. " +
	"No preamble, no prose explanations, just the code.";

/** Phase 1 prompts for the default rate-limiter task. */
const DEFAULT_BUILD_TURNS = [
	"Design a TypeScript interface for a rate limiter: RateLimiterOptions (windowMs, maxRequests, keyFn) and RateLimiterState (map of key to {count, resetAt}). Keep it concise.",
	"Implement a RateLimiter class using those interfaces. Include: constructor(options), isAllowed(key): boolean method that enforces the sliding window. Add JSDoc.",
	"Write an Express-style middleware factory: createRateLimitMiddleware(options: RateLimiterOptions): (req, res, next) => void. It should set X-RateLimit-Remaining and X-RateLimit-Reset headers, and return 429 with a JSON error when the limit is exceeded.",
	"Add input validation to the RateLimiter constructor: throw descriptive errors for invalid windowMs (must be > 0), invalid maxRequests (must be > 0 integer), and missing keyFn.",
];

/**
 * Phase 2 consolidation prompt for the default rate-limiter task.
 * Highly prescriptive about middleware wiring so the LLM generates testable
 * code on the first attempt without needing fix turns.
 */
const DEFAULT_CONSOLIDATE_PROMPT =
	"Write the final complete TypeScript implementation combining everything built so far.\n\n" +
	"Required exports:\n" +
	"  export interface RateLimiterOptions { windowMs: number; maxRequests: number; keyFn: (req: unknown) => string }\n" +
	"  export interface RateLimiterState { count: number; resetAt: number }\n" +
	"  export class RateLimiter { constructor(options: RateLimiterOptions); isAllowed(key: string): boolean }\n" +
	"  export function createRateLimitMiddleware(options: RateLimiterOptions): (req: unknown, res: unknown, next: () => void) => void\n\n" +
	"Middleware requirements (synchronous, not async):\n" +
	"  1. Create a RateLimiter internally with the provided options\n" +
	"  2. In each request: derive key via options.keyFn(req)\n" +
	"  3. If limiter.isAllowed(key): call (res as any).set('X-RateLimit-Remaining', String(remaining)) then call next()\n" +
	"  4. If not allowed: call (res as any).status(429).json({ error: 'Too Many Requests' })\n\n" +
	"Validation in RateLimiter constructor: throw if windowMs <= 0, maxRequests <= 0, or keyFn missing.\n" +
	"No imports except standard TypeScript — do not import Express or any npm package.\n" +
	"Output raw TypeScript only — no markdown fences, no explanations.";

/** Generic consolidation prompt for user-supplied tasks. */
const GENERIC_CONSOLIDATE_PROMPT =
	"Write the final complete implementation as a single TypeScript file named impl.ts, " +
	"incorporating everything built so far. " +
	"Export all public types and functions. " +
	"No external imports. Output raw TypeScript only — no markdown fences.";

/** Fix prompt suffix for the default rate-limiter task. */
const DEFAULT_FIX_EXTRA =
	"Critical requirements for this task:\n" +
	"  - createRateLimitMiddleware must be SYNCHRONOUS (not async)\n" +
	"  - Middleware must call options.keyFn(req) to get the key, then call limiter.isAllowed(key)\n" +
	"  - If allowed: call (res as any).set('X-RateLimit-Remaining', String(remaining)) then call next()\n" +
	"  - If not allowed: call (res as any).status(429).json({ error: 'Too Many Requests' })\n";

/**
 * Default acceptance tests for the rate-limiter task.
 * Uses top-level await + async test runner so async middleware is handled.
 * Provides a resilient mock res accepting set/setHeader/header interchangeably.
 */
const DEFAULT_ACCEPTANCE_TEST = `
import assert from 'node:assert/strict';
import { RateLimiter, createRateLimitMiddleware } from './impl.js';

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
   try {
      await fn();
      console.log('PASS: ' + name);
   } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('FAIL: ' + name + ': ' + msg);
      failed++;
   }
}

/** Mock res that accepts set/setHeader/header interchangeably. */
function mockRes(): { headers: Record<string, string>; res: Record<string, unknown> } {
   const headers: Record<string, string> = {};
   const res: Record<string, unknown> = {};
   const setH = (k: string, v: unknown) => { headers[String(k).toLowerCase()] = String(v); return res; };
   res['set'] = setH;
   res['setHeader'] = setH;
   res['header'] = setH;
   res['status'] = () => res;
   res['json'] = () => {};
   res['send'] = () => res;
   return { headers, res };
}

await test('allows requests within limit', () => {
   const rl = new RateLimiter({ windowMs: 1000, maxRequests: 3, keyFn: () => 'test' });
   assert.equal(rl.isAllowed('test'), true, 'first request should be allowed');
   assert.equal(rl.isAllowed('test'), true, 'second request should be allowed');
   assert.equal(rl.isAllowed('test'), true, 'third request should be allowed');
});

await test('blocks requests over limit', () => {
   const rl = new RateLimiter({ windowMs: 60000, maxRequests: 2, keyFn: () => 'test' });
   rl.isAllowed('test');
   rl.isAllowed('test');
   assert.equal(rl.isAllowed('test'), false, 'third request should be blocked');
});

await test('throws on invalid windowMs', () => {
   assert.throws(() => new RateLimiter({ windowMs: -1, maxRequests: 5, keyFn: () => 'k' }), 'should throw for windowMs <= 0');
});

await test('throws on invalid maxRequests', () => {
   assert.throws(() => new RateLimiter({ windowMs: 1000, maxRequests: 0, keyFn: () => 'k' }), 'should throw for maxRequests <= 0');
});

await test('middleware sets headers and calls next()', async () => {
   const mw = createRateLimitMiddleware({ windowMs: 60000, maxRequests: 10, keyFn: (req: unknown) => {
      const r = req as { ip?: string };
      return r.ip ?? 'anon';
   }});
   let nextCalled = false;
   const { headers, res } = mockRes();
   const req = { ip: '127.0.0.1' };
   await (mw as (req: unknown, res: unknown, next: () => void) => void | Promise<void>)(
      req, res, () => { nextCalled = true; }
   );
   assert.equal(nextCalled, true, 'middleware must call next() when request is within limit');
   const hasRemainingHeader = 'x-ratelimit-remaining' in headers || 'x-ratelimit-reset' in headers;
   assert.ok(hasRemainingHeader, 'middleware must set X-RateLimit-Remaining or X-RateLimit-Reset header');
});

if (failed > 0) process.exit(1);
`.trimStart();

// -- Run configuration --------------------------------------------------------

interface RunConfig {
	/** Human-readable task description for display. */
	taskLabel: string;
	/** Phase 1: prompts executed in sequence to build the solution. */
	buildTurns: string[];
	/** Phase 2: prompt to consolidate all output into a single impl.ts. */
	consolidatePrompt: string;
	/**
	 * Phase 3: TypeScript source of the acceptance test run against impl.ts.
	 * Null skips Phase 3 — the demo completes after consolidation.
	 */
	acceptanceTest: string | null;
	/**
	 * Extra guidance appended to fix prompts after listing test failures.
	 * Use for task-specific requirements the LLM must satisfy.
	 */
	fixPromptExtra: string;
}

// tsx binary: prefer the one from the monorepo root node_modules
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_TSX = join(__dirname, "../../../../node_modules/.bin/tsx");

// -- Energy tracking ----------------------------------------------------------

function estimateEnergy(message: AssistantMessage, modelId: string): number {
	const tokensPerJoule = TOKENS_PER_JOULE[modelId] ?? 1.0;
	return message.usage.totalTokens / tokensPerJoule;
}

function getEnergy(message: AssistantMessage, modelId: string): number {
	const fromApi = message.energy?.energy_joules;
	if (fromApi != null && fromApi > 0) return fromApi;
	return estimateEnergy(message, modelId);
}

// -- Acceptance tests ---------------------------------------------------------

function extractCode(text: string): string {
	const m = text.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
	return m ? m[1] : text;
}

interface TestResult {
	passed: boolean;
	output: string;
	passedTests: string[];
	failedTests: string[];
}

function runAcceptanceTest(code: string, testSource: string): TestResult {
	const tmpDir = mkdtempSync(join(tmpdir(), "coding-agent-"));
	try {
		writeFileSync(join(tmpDir, "impl.ts"), code, "utf8");
		// package.json with "type":"module" enables top-level await in tsx
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
		writeFileSync(join(tmpDir, "acceptance.ts"), testSource, "utf8");

		let output = "";
		try {
			output = execSync(`"${REPO_TSX}" acceptance.ts`, {
				cwd: tmpDir,
				encoding: "utf8",
				timeout: 30_000,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e) {
			const err = e as { stdout?: string; stderr?: string; message?: string };
			output = [err.stdout ?? "", err.stderr ?? ""].filter(Boolean).join("\n");
			if (!output) output = (e as Error).message ?? "Unknown error";
		}

		const passedTests: string[] = [];
		const failedTests: string[] = [];
		for (const line of output.split("\n")) {
			if (line.startsWith("PASS: ")) passedTests.push(line.slice(6).trim());
			else if (line.startsWith("FAIL: ")) failedTests.push(line.slice(6).trim());
		}
		return { passed: failedTests.length === 0 && passedTests.length > 0, output, passedTests, failedTests };
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

// -- Display ------------------------------------------------------------------

function energyBar(consumed: number, budget: number, width = 20): string {
	if (budget <= 0) return `${consumed.toFixed(2)}J`;
	const pct = consumed / budget;
	const filled = Math.min(width, Math.round(Math.min(1, pct) * width));
	const bar = "█".repeat(filled) + "░".repeat(width - filled);
	const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
	const pctLabel = pct > 1 ? `\x1b[31m${Math.round(pct * 100)}%\x1b[0m` : `${Math.round(pct * 100)}%`;
	return `${color}[${bar}]\x1b[0m ${consumed.toFixed(0)}J / ${budget}J (${pctLabel})`;
}

function truncateCode(text: string, maxLines = 8): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return `${lines.slice(0, maxLines).join("\n")}\n  \x1b[2m… (${lines.length - maxLines} more lines)\x1b[0m`;
}

function extractText(message: AssistantMessage): string {
	return message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("");
}

function printTurnHeader(
	mode: string,
	_turnNum: number,
	phase: string,
	modelId: string,
	decisionLabel: string,
	energy: number,
	budget: number,
): void {
	const tag = mode === "baseline" ? "\x1b[36m[baseline ]\x1b[0m" : "\x1b[35m[energy-▼ ]\x1b[0m";
	console.log(`\n${tag} ${phase}  model: ${modelId}  ${energyBar(energy, budget)}`);
	if (decisionLabel) {
		console.log(`           \x1b[33m${decisionLabel}\x1b[0m`);
	}
}

function printTestResults(result: TestResult): void {
	console.log("  \x1b[1m[acceptance test]\x1b[0m");
	for (const t of result.passedTests) {
		console.log(`    \x1b[32m✓ ${t}\x1b[0m`);
	}
	for (const t of result.failedTests) {
		console.log(`    \x1b[31m✗ ${t}\x1b[0m`);
	}
	if (result.passedTests.length === 0 && result.failedTests.length === 0) {
		const snippet = result.output.split("\n").slice(0, 6).join("\n");
		console.log(`    \x1b[31m${snippet}\x1b[0m`);
	}
}

// -- Run ----------------------------------------------------------------------

interface TurnResult {
	turn: number;
	model: string;
	energy: number;
	tokens: number;
	decision: string;
	overBudget: boolean;
}

interface RunStats {
	mode: string;
	totalEnergy: number;
	totalTokens: number;
	turns: TurnResult[];
	startTime: number;
	endTime: number;
	testPassed?: boolean;
	turnsToPass?: number;
}

async function callModel(
	model: Model<"openai-completions">,
	messages: Message[],
	apiKey: string,
	maxTokens?: number,
): Promise<AssistantMessage> {
	return completeSimple(model, { systemPrompt: SYSTEM_PROMPT, messages }, { apiKey, maxTokens });
}

async function runCodingAgent(
	mode: "baseline" | "energy-aware",
	policy: RuntimePolicy,
	budget: EnergyBudget,
	apiKey: string,
	config: RunConfig,
): Promise<RunStats> {
	const stats: RunStats = {
		mode,
		totalEnergy: 0,
		totalTokens: 0,
		turns: [],
		startTime: Date.now(),
		endTime: 0,
	};

	const messages: Message[] = [];
	const budgetJ = budget.energy_budget_joules ?? DEFAULT_BUDGET_JOULES;

	console.log(`\n${"═".repeat(70)}`);
	console.log(`  Running: ${mode.toUpperCase()} mode  |  Budget: ${budgetJ}J (informational, drives routing)`);
	console.log(`${"═".repeat(70)}`);

	/**
	 * Execute one turn. Never aborts due to budget — over-budget turns route to
	 * the cheapest model and are flagged in the turn record.
	 */
	async function runTurn(prompt: string, phaseLabel: string): Promise<void> {
		const turnNum = stats.turns.length + 1;

		const ctx: PolicyContext = {
			turnNumber: turnNum,
			model: DEFAULT_MODEL,
			availableModels: NEURALWATT_MODELS,
			budget,
			consumedEnergy: stats.totalEnergy,
			consumedTime: Date.now() - stats.startTime,
			messageCount: messages.length,
			estimatedInputTokens: messages.reduce((sum, m) => {
				if (m.role === "user" && typeof m.content === "string") return sum + Math.round(m.content.length / 4);
				if (m.role === "assistant") {
					return (
						sum +
						m.content
							.filter((c) => c.type === "text")
							.reduce((s, c) => s + Math.round((c as { type: "text"; text: string }).text.length / 4), 0)
					);
				}
				return sum;
			}, 0),
		};

		const decision = policy.beforeModelCall(ctx);

		let effectiveModel: Model<"openai-completions">;
		let decisionLabel: string;
		let overBudget = false;

		if (decision.abort) {
			// Over budget but continuing — force cheapest model to minimise further spend
			overBudget = true;
			effectiveModel = CHEAPEST_MODEL;
			decisionLabel = `→ over budget (${decision.reason ?? "pressure >= 100%"}) — using ${CHEAPEST_MODEL.name}`;
		} else {
			effectiveModel = (decision.model as Model<"openai-completions">) ?? DEFAULT_MODEL;
			decisionLabel = decision.model
				? `→ routed to ${decision.model.name ?? decision.model.id} (1.7x more energy-efficient)`
				: decision.maxTokens
					? `→ token limit reduced to ${decision.maxTokens} (budget pressure >= 50%)`
					: "";
		}

		printTurnHeader(mode, turnNum, phaseLabel, effectiveModel.id, decisionLabel, stats.totalEnergy, budgetJ);
		console.log(`  \x1b[2m${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}\x1b[0m`);

		messages.push({ role: "user", content: prompt, timestamp: Date.now() });

		const assistantMsg = await callModel(
			effectiveModel,
			messages,
			apiKey,
			overBudget ? CHEAPEST_MODEL.maxTokens : decision.maxTokens,
		);
		messages.push(assistantMsg);

		const energy = getEnergy(assistantMsg, effectiveModel.id);
		const tokens = assistantMsg.usage.totalTokens;
		stats.totalEnergy += energy;
		stats.totalTokens += tokens;

		const energySource =
			assistantMsg.energy?.energy_joules != null && assistantMsg.energy.energy_joules > 0 ? "api" : "est";
		console.log(
			`  \x1b[2m${tokens} tokens | ${energy.toFixed(3)}J [${energySource}] | input:${assistantMsg.usage.input} output:${assistantMsg.usage.output}\x1b[0m`,
		);

		const responseText = extractText(assistantMsg);
		console.log(truncateCode(responseText, 10));

		const usageWithEnergy: UsageWithEnergy = {
			input: assistantMsg.usage.input,
			output: assistantMsg.usage.output,
			totalTokens: tokens,
			cost: { total: assistantMsg.usage.cost.total },
			energy_joules: energy,
			energy_kwh: energy / 3_600_000,
		};
		policy.afterModelCall(ctx, usageWithEnergy);

		stats.turns.push({
			turn: turnNum,
			model: effectiveModel.id,
			energy,
			tokens,
			decision: decisionLabel,
			overBudget,
		});
	}

	// -- Phase 1: Build --------------------------------------------------------
	for (let i = 0; i < config.buildTurns.length; i++) {
		await runTurn(
			config.buildTurns[i],
			`Turn ${stats.turns.length + 1}  [build ${i + 1}/${config.buildTurns.length}]`,
		);
	}

	// -- Phase 2: Consolidate --------------------------------------------------
	await runTurn(config.consolidatePrompt, `Turn ${stats.turns.length + 1}  [consolidate]`);

	// If no acceptance test, we're done after consolidation
	if (!config.acceptanceTest) {
		stats.endTime = Date.now();
		const elapsed = ((stats.endTime - stats.startTime) / 1000).toFixed(1);
		console.log(
			`\n  \x1b[1mDone: ${stats.turns.length} turns | ${stats.totalEnergy.toFixed(2)}J | ${stats.totalTokens} tokens | ${elapsed}s\x1b[0m`,
		);
		return stats;
	}

	// -- Phase 3: Acceptance-test loop (runs until all tests pass) -------------
	const lastMsg = messages[messages.length - 1] as AssistantMessage;
	let code = extractCode(extractText(lastMsg));
	let testResult = runAcceptanceTest(code, config.acceptanceTest);
	printTestResults(testResult);

	if (testResult.passed) {
		stats.testPassed = true;
		stats.turnsToPass = stats.turns.length;
		console.log(`\n  \x1b[32m✓ All acceptance tests passed on turn ${stats.turns.length}\x1b[0m`);
	} else {
		let fixAttempt = 0;
		while (!testResult.passed) {
			fixAttempt++;
			const fixTurnLabel = `Turn ${stats.turns.length + 1}  [fix #${fixAttempt}]`;
			const failureSummary = testResult.failedTests.map((f) => `  - ${f}`).join("\n");
			const fixPrompt =
				`The acceptance tests failed:\n${failureSummary}\n\n` +
				(config.fixPromptExtra ? `${config.fixPromptExtra}\n` : "") +
				"Write the complete corrected implementation as a single TypeScript file. " +
				"No external imports. Output raw TypeScript only — no markdown fences.";

			await runTurn(fixPrompt, fixTurnLabel);

			const fixMsg = messages[messages.length - 1] as AssistantMessage;
			code = extractCode(extractText(fixMsg));
			testResult = runAcceptanceTest(code, config.acceptanceTest);
			printTestResults(testResult);

			if (testResult.passed) {
				stats.testPassed = true;
				stats.turnsToPass = stats.turns.length;
				console.log(
					`\n  \x1b[32m✓ All acceptance tests passed on turn ${stats.turns.length} (+${fixAttempt} fix${fixAttempt !== 1 ? "es" : ""})\x1b[0m`,
				);
			} else {
				console.log(
					`  → ${testResult.failedTests.length} test${testResult.failedTests.length !== 1 ? "s" : ""} failed — requesting correction`,
				);
			}
		}
	}

	stats.endTime = Date.now();
	const elapsed = ((stats.endTime - stats.startTime) / 1000).toFixed(1);
	console.log(
		`\n  \x1b[1mDone: ${stats.turns.length} turns | ${stats.totalEnergy.toFixed(2)}J | ${stats.totalTokens} tokens | ${elapsed}s\x1b[0m`,
	);
	return stats;
}

// -- Scorecard ----------------------------------------------------------------

function printScorecard(baseline: RunStats, energyAware: RunStats, config: RunConfig, budget: number): void {
	const baseTime = (baseline.endTime - baseline.startTime) / 1000;
	const eaTime = (energyAware.endTime - energyAware.startTime) / 1000;
	const energySaved =
		baseline.totalEnergy > 0 ? ((baseline.totalEnergy - energyAware.totalEnergy) / baseline.totalEnergy) * 100 : 0;
	const timeDelta = baseTime > 0 ? ((eaTime - baseTime) / baseTime) * 100 : 0;

	const devstralPrice = 0.12 / 1_000_000;
	const gptPrice = 0.1 / 1_000_000;
	const baseCost = baseline.turns.reduce((sum, t) => sum + t.tokens * devstralPrice, 0);
	const eaCost = energyAware.turns.reduce(
		(sum, t) => sum + t.tokens * (t.model.includes("gpt-oss") ? gptPrice : devstralPrice),
		0,
	);
	const costSaved = baseCost > 0 ? ((baseCost - eaCost) / baseCost) * 100 : 0;

	const fmtDelta = (val: number, positive = "+"): string => `${val >= 0 ? positive : ""}${val.toFixed(0)}%`;

	const consolidateTurnOffset = config.buildTurns.length + 1;
	const fmtQuality = (s: RunStats): string => {
		if (!config.acceptanceTest) return "n/a (no tests)       ";
		if (s.testPassed === true) {
			const fixCount = s.turnsToPass != null ? Math.max(0, s.turnsToPass - consolidateTurnOffset) : 0;
			const fixes = fixCount > 0 ? `, +${fixCount} fix${fixCount !== 1 ? "es" : ""}` : ", +0 fixes";
			return `✓ PASSED (turn ${s.turnsToPass}${fixes})`;
		}
		return "✗ FAILED             ";
	};

	const eaOverBudgetTurns = energyAware.turns.filter((t) => t.overBudget).length;

	console.log(`\n${"═".repeat(70)}`);
	console.log("  FINAL SCORECARD — Coding Agent Energy Challenge");
	console.log(`${"═".repeat(70)}`);
	console.log(`  Budget: ${budget}J (informational)  |  Devstral -> GPT-OSS-20B at >70% pressure`);
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log("  |                 | Baseline          | Energy-Aware              |");
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log(
		`  | Turns           | ${String(baseline.turns.length).padEnd(17)} | ${String(energyAware.turns.length).padEnd(25)} |`,
	);
	console.log(
		`  | Energy used     | ${`${baseline.totalEnergy.toFixed(0)} J`.padEnd(17)} | ${`${energyAware.totalEnergy.toFixed(0)} J  (${fmtDelta(-energySaved, "-")} saved)`.padEnd(25)} |`,
	);
	console.log(
		`  | Est. cost       | ${`$${baseCost.toFixed(4)}`.padEnd(17)} | ${`$${eaCost.toFixed(4)}  (${fmtDelta(-costSaved, "-")} saved)`.padEnd(25)} |`,
	);
	console.log(
		`  | Tokens used     | ${String(baseline.totalTokens).padEnd(17)} | ${String(energyAware.totalTokens).padEnd(25)} |`,
	);
	console.log(
		`  | Wall time       | ${`${baseTime.toFixed(1)} s`.padEnd(17)} | ${`${eaTime.toFixed(1)} s  (${fmtDelta(timeDelta)})`.padEnd(25)} |`,
	);
	if (config.acceptanceTest) {
		console.log(`  | Quality         | ${fmtQuality(baseline).padEnd(17)} | ${fmtQuality(energyAware).padEnd(25)} |`);
	}
	console.log("  +-----------------+-------------------+---------------------------+");

	if (eaOverBudgetTurns > 0) {
		console.log(
			`\n  Note: energy-aware ran ${eaOverBudgetTurns} turn${eaOverBudgetTurns !== 1 ? "s" : ""} over budget (continued on ${CHEAPEST_MODEL.name})`,
		);
	}

	const eaDecisions = energyAware.turns.filter((t) => t.decision);
	if (eaDecisions.length > 0) {
		console.log("\n  POLICY DECISIONS (energy-aware):");
		for (const t of eaDecisions) {
			const overLabel = t.overBudget ? " \x1b[31m[over budget]\x1b[0m" : "";
			console.log(`    Turn ${t.turn}: ${t.decision}${overLabel}`);
		}
	}

	console.log("");
	if (energySaved > 0) {
		const qualitySame =
			baseline.testPassed === true && energyAware.testPassed === true ? " — same quality outcome" : "";
		console.log(
			`  \x1b[32m✓ Energy-aware: ${energySaved.toFixed(0)}% less energy, ${costSaved.toFixed(0)}% lower cost${qualitySame}\x1b[0m`,
		);
	}
}

// -- Memory helpers -----------------------------------------------------------

function updateCodingMemory(mem: ReturnType<typeof loadMemory>, baseStats: RunStats, eaStats: RunStats): void {
	const prev: CodingMemory = mem.coding[MEMORY_KEY] ?? {
		runs: 0,
		baselinePassCount: 0,
		eaPassCount: 0,
		avgTurnsBaseline: 0,
		avgTurnsEA: 0,
		avgEnergySavingsPct: 0,
		lastUpdated: "",
	};

	const runs = prev.runs + 1;
	const baselinePassCount = prev.baselinePassCount + (baseStats.testPassed ? 1 : 0);
	const eaPassCount = prev.eaPassCount + (eaStats.testPassed ? 1 : 0);

	const avgTurnsBaseline =
		baseStats.testPassed && baseStats.turnsToPass != null
			? (prev.avgTurnsBaseline * prev.baselinePassCount + baseStats.turnsToPass) / (prev.baselinePassCount + 1)
			: prev.avgTurnsBaseline;

	const avgTurnsEA =
		eaStats.testPassed && eaStats.turnsToPass != null
			? (prev.avgTurnsEA * prev.eaPassCount + eaStats.turnsToPass) / (prev.eaPassCount + 1)
			: prev.avgTurnsEA;

	const energySavedPct =
		baseStats.totalEnergy > 0 ? ((baseStats.totalEnergy - eaStats.totalEnergy) / baseStats.totalEnergy) * 100 : 0;
	const avgEnergySavingsPct = (prev.avgEnergySavingsPct * prev.runs + energySavedPct) / runs;

	mem.coding[MEMORY_KEY] = {
		runs,
		baselinePassCount,
		eaPassCount,
		avgTurnsBaseline,
		avgTurnsEA,
		avgEnergySavingsPct,
		lastUpdated: new Date().toISOString(),
	};
}

// -- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			budget: { type: "string", default: String(DEFAULT_BUDGET_JOULES) },
			task: { type: "string" },
			acceptance: { type: "string" }, // path to a custom acceptance test .ts file
			"clear-memory": { type: "boolean", default: false },
		},
		allowPositionals: true,
	});

	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	if (values["clear-memory"]) {
		clearMemory();
		console.log("Memory cleared.");
	}

	const apiKey = process.env.NEURALWATT_API_KEY;
	const budgetJ = Number(values.budget);

	// Build RunConfig from CLI args
	let config: RunConfig;
	if (values.task) {
		// Custom single-turn task
		let acceptanceTest: string | null = null;
		if (values.acceptance) {
			acceptanceTest = readFileSync(values.acceptance, "utf8");
		}
		config = {
			taskLabel: values.task.slice(0, 60),
			buildTurns: [values.task],
			consolidatePrompt: GENERIC_CONSOLIDATE_PROMPT,
			acceptanceTest,
			fixPromptExtra: "",
		};
	} else {
		// Default rate-limiter task
		config = {
			taskLabel: "TypeScript rate-limiting middleware with acceptance tests",
			buildTurns: DEFAULT_BUILD_TURNS,
			consolidatePrompt: DEFAULT_CONSOLIDATE_PROMPT,
			acceptanceTest: DEFAULT_ACCEPTANCE_TEST,
			fixPromptExtra: DEFAULT_FIX_EXTRA,
		};
	}

	registerBuiltInApiProviders();

	// Load and display memory (only for default task — key is task-specific)
	const mem = loadMemory();
	const memSummary = values.task ? null : formatCodingMemory(MEMORY_KEY, mem);

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║               Coding Agent Energy Challenge                         ║");
	console.log(`║  Task:   ${config.taskLabel.padEnd(60)}║`);
	console.log(`║  Model:  ${DEFAULT_MODEL.id.padEnd(60)}║`);
	console.log(`║  Budget: ${`${budgetJ}J (informational — routes at >70%, token limits at >50%)`.padEnd(60)}║`);
	console.log(
		`║  Phases: build (${config.buildTurns.length}) + consolidate (1) + acceptance-test loop (no turn limit) ║`,
	);
	if (config.acceptanceTest) {
		console.log("║  Mode:   ACCEPTANCE-TEST-DRIVEN — both runs complete to pass/fail    ║");
	}
	console.log("╠══════════════════════════════════════════════════════════════════════╣");
	console.log("║  Flags:  --budget N  --task '...'  --acceptance file.ts             ║");
	console.log("║          --clear-memory  (wipe learned routing stats)               ║");
	console.log("╚══════════════════════════════════════════════════════════════════════╝");

	if (memSummary) {
		console.log(memSummary);
	} else if (!values.task) {
		console.log("  Memory: No previous runs recorded.");
	}

	const baselineStats = await runCodingAgent("baseline", new BaselinePolicy(), {}, apiKey, config);
	const energyAwareStats = await runCodingAgent(
		"energy-aware",
		new EnergyAwarePolicy(),
		{ energy_budget_joules: budgetJ },
		apiKey,
		config,
	);

	printScorecard(baselineStats, energyAwareStats, config, budgetJ);

	// Persist memory for default task only
	if (!values.task) {
		updateCodingMemory(mem, baselineStats, energyAwareStats);
		saveMemory(mem);
		console.log(`\n  Memory saved to ~/.energy-demo-memory.json`);
	}
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
