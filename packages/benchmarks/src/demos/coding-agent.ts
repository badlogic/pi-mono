/**
 * Demo 1: Coding Agent Energy Challenge
 *
 * Runs a real multi-turn coding task under both BaselinePolicy and
 * EnergyAwarePolicy using actual Neuralwatt API calls. Shows turn-by-turn
 * energy consumption, live code output, and policy interventions.
 *
 * Task: implement a TypeScript rate-limiting middleware with types, JSDoc,
 * validation, and unit tests — across 3 phases:
 *
 *   Phase 1 (turns 1-4): Incremental build — interfaces → class → middleware → validation
 *   Phase 2 (turn 5):    Consolidate into a single impl.ts file
 *   Phase 3 (turns 6-N): Acceptance-test loop — run tests, request corrections until pass
 *
 * Baseline: uses Devstral-Small throughout (full quality, full energy).
 * Energy-aware: starts on Devstral-Small, routes to GPT-OSS-20B at >70%
 * budget pressure (1.2x cost reduction, 1.7x more energy-efficient) — saving
 * energy while completing the task.
 *
 * Energy benchmarks from portal.neuralwatt.com:
 *   Devstral-Small: 0.809 tokens/J  ($0.12/$0.12 per 1M)
 *   GPT-OSS-20B:    1.371 tokens/J  ($0.10/$0.10 per 1M)  <- 1.7x more efficient
 *
 * Usage:
 *   npx tsx src/demos/coding-agent.ts [--budget <joules>] [--task "custom task"]
 *   npx tsx src/demos/coding-agent.ts --clear-memory
 *
 * Requires NEURALWATT_API_KEY in the environment.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		// Default: 0.809 tokens/J, $0.12/$0.12/1M — reliable coding model with predictable output
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

const DEFAULT_MODEL = NEURALWATT_MODELS[1]; // Devstral-Small — routes to GPT-OSS at >70%

/**
 * Budget calibrated for the 3-phase acceptance-test loop:
 * Devstral-Small ~3500J/turn unconstrained; token limits fire at >50% (~7500J).
 * Routing to GPT-OSS-20B (1.7x efficient) fires at >70% (~10500J).
 * After routing, fix turns cost ~1000J each — all 10 possible turns complete
 * within budget while still showing both policy interventions.
 */
const DEFAULT_BUDGET_JOULES = 15_000;

/** Memory key for this routing pair. */
const MEMORY_KEY = "devstral→gpt-oss-20b";

/** Maximum turns in the verify+fix phase (Phase 3). */
const MAX_FIX_TURNS = 5;

// -- Task definition ----------------------------------------------------------

const SYSTEM_PROMPT =
	"You are an expert TypeScript engineer. " +
	"Implement code concisely and correctly. " +
	"Include TypeScript types and JSDoc for public APIs. " +
	"Each response should be tightly focused — implement only what is asked. " +
	"No preamble, no prose explanations, just the code.";

/** Phase 1: Incremental build turns (turns 1-4). */
const BUILD_TURNS = [
	"Design a TypeScript interface for a rate limiter: RateLimiterOptions (windowMs, maxRequests, keyFn) and RateLimiterState (map of key to {count, resetAt}). Keep it concise.",
	"Implement a RateLimiter class using those interfaces. Include: constructor(options), isAllowed(key): boolean method that enforces the sliding window. Add JSDoc.",
	"Write an Express-style middleware factory: createRateLimitMiddleware(options: RateLimiterOptions): (req, res, next) => void. It should set X-RateLimit-Remaining and X-RateLimit-Reset headers, and return 429 with a JSON error when the limit is exceeded.",
	"Add input validation to the RateLimiter constructor: throw descriptive errors for invalid windowMs (must be > 0), invalid maxRequests (must be > 0 integer), and missing keyFn.",
];

/**
 * Phase 2: Consolidation prompt — requests a complete, self-contained impl.ts.
 * Highly prescriptive so the model generates testable code on the first attempt.
 * No external imports — must run in a temp dir without node_modules.
 */
const CONSOLIDATE_PROMPT =
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

/**
 * Acceptance tests run against impl.ts in a temp dir.
 * Uses top-level await so async middlewares are handled correctly.
 * Provides a resilient mock res that handles set/setHeader/header variants.
 * Tests use PASS:/FAIL: prefixes for easy parsing.
 * Never shown to the LLM — it only sees error output on failure.
 */
const ACCEPTANCE_TEST = `
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

/** Build a mock res that accepts set/setHeader/header interchangeably. */
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
   // Await in case the middleware is async; cast to any to avoid type friction
   await (mw as (req: unknown, res: unknown, next: () => void) => void | Promise<void>)(
      req, res, () => { nextCalled = true; }
   );
   assert.equal(nextCalled, true, 'middleware must call next() when request is within limit');
   const hasRemainingHeader = 'x-ratelimit-remaining' in headers || 'x-ratelimit-reset' in headers;
   assert.ok(hasRemainingHeader, 'middleware must set X-RateLimit-Remaining or X-RateLimit-Reset header');
});

if (failed > 0) process.exit(1);
`.trimStart();

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

function runAcceptanceTest(code: string): TestResult {
	const tmpDir = mkdtempSync(join(tmpdir(), "coding-agent-"));
	try {
		writeFileSync(join(tmpDir, "impl.ts"), code, "utf8");
		writeFileSync(join(tmpDir, "acceptance.ts"), ACCEPTANCE_TEST, "utf8");

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
	const pct = budget > 0 ? Math.min(1, consumed / budget) : 0;
	const filled = Math.round(pct * width);
	const bar = "█".repeat(filled) + "░".repeat(width - filled);
	const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
	return `${color}[${bar}]\x1b[0m ${consumed.toFixed(2)}J / ${budget}J (${Math.round(pct * 100)}%)`;
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
		// No structured output — show raw output for debugging
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
}

interface RunStats {
	mode: string;
	totalEnergy: number;
	totalTokens: number;
	turns: TurnResult[];
	abortedAt?: number;
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
	console.log(`  Running: ${mode.toUpperCase()} mode  |  Budget: ${budgetJ}J  |  Model: ${DEFAULT_MODEL.id}`);
	console.log(`${"═".repeat(70)}`);

	// Helper: call policy + model for one turn. Returns false if aborted.
	async function runTurn(prompt: string, phaseLabel: string): Promise<boolean> {
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

		if (decision.abort) {
			stats.abortedAt = turnNum;
			console.log(
				`\n\x1b[31m[${mode}] Budget exhausted at turn ${turnNum} — ${decision.reason ?? "aborting"}\x1b[0m`,
			);
			return false;
		}

		const decisionLabel = decision.model
			? `→ routed to ${decision.model.name ?? decision.model.id} (1.7x more energy-efficient)`
			: decision.maxTokens
				? `→ token limit reduced to ${decision.maxTokens} (budget pressure >= 50%)`
				: "";

		const effectiveModel = (decision.model as Model<"openai-completions">) ?? DEFAULT_MODEL;

		printTurnHeader(mode, turnNum, phaseLabel, effectiveModel.id, decisionLabel, stats.totalEnergy, budgetJ);
		console.log(`  \x1b[2m${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}\x1b[0m`);

		messages.push({ role: "user", content: prompt, timestamp: Date.now() });

		const assistantMsg = await callModel(effectiveModel, messages, apiKey, decision.maxTokens);
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

		stats.turns.push({ turn: turnNum, model: effectiveModel.id, energy, tokens, decision: decisionLabel });
		return true;
	}

	// -- Phase 1: Incremental build (turns 1-4) --------------------------------
	for (let i = 0; i < BUILD_TURNS.length; i++) {
		const ok = await runTurn(BUILD_TURNS[i], `Turn ${i + 1}/${BUILD_TURNS.length + 1 + MAX_FIX_TURNS}  [build]`);
		if (!ok) {
			stats.endTime = Date.now();
			return stats;
		}
	}

	// -- Phase 2: Consolidate into impl.ts (turn 5) ----------------------------
	const consolidatePhaseLabel = `Turn ${BUILD_TURNS.length + 1}  [consolidate]`;
	const ok = await runTurn(CONSOLIDATE_PROMPT, consolidatePhaseLabel);
	if (!ok) {
		stats.endTime = Date.now();
		return stats;
	}

	// Extract code from the last assistant message
	const lastMsg = messages[messages.length - 1] as AssistantMessage;
	const lastText = extractText(lastMsg);
	let code = extractCode(lastText);

	// -- Phase 3: Acceptance-test loop (turns 6-N) -----------------------------
	let testResult = runAcceptanceTest(code);
	printTestResults(testResult);

	if (testResult.passed) {
		stats.testPassed = true;
		stats.turnsToPass = stats.turns.length;
		console.log(`\n  \x1b[32m✓ All acceptance tests passed on turn ${stats.turns.length}\x1b[0m`);
	} else {
		let fixAttempt = 0;
		while (!testResult.passed && fixAttempt < MAX_FIX_TURNS) {
			fixAttempt++;
			const fixTurnLabel = `Turn ${BUILD_TURNS.length + 1 + fixAttempt}  [fix #${fixAttempt}]`;
			const failureSummary = testResult.failedTests.map((f) => `  - ${f}`).join("\n");
			const fixPrompt =
				`The acceptance tests failed:\n${failureSummary}\n\n` +
				"Write the complete corrected implementation. Critical requirements:\n" +
				"  - createRateLimitMiddleware must be SYNCHRONOUS (not async)\n" +
				"  - Middleware must call options.keyFn(req) to get the key, then call limiter.isAllowed(key)\n" +
				"  - If allowed: call (res as any).set('X-RateLimit-Remaining', String(remaining)) then call next()\n" +
				"  - If not allowed: call (res as any).status(429).json({ error: 'Too Many Requests' })\n" +
				"No imports except standard TypeScript. Output raw TypeScript only — no markdown fences.";

			const fixOk = await runTurn(fixPrompt, fixTurnLabel);
			if (!fixOk) {
				stats.testPassed = false;
				stats.endTime = Date.now();
				return stats;
			}

			const fixMsg = messages[messages.length - 1] as AssistantMessage;
			code = extractCode(extractText(fixMsg));
			testResult = runAcceptanceTest(code);
			printTestResults(testResult);

			if (testResult.passed) {
				stats.testPassed = true;
				stats.turnsToPass = stats.turns.length;
				console.log(
					`\n  \x1b[32m✓ All acceptance tests passed on turn ${stats.turns.length} (+${fixAttempt} fix${fixAttempt !== 1 ? "es" : ""})\x1b[0m`,
				);
				break;
			} else {
				console.log(
					`  → ${testResult.failedTests.length} test${testResult.failedTests.length !== 1 ? "s" : ""} failed — requesting correction (turn ${stats.turns.length + 1})`,
				);
			}
		}

		if (!testResult.passed) {
			stats.testPassed = false;
			console.log(
				`\n  \x1b[31m✗ Tests still failing after ${fixAttempt} fix attempt${fixAttempt !== 1 ? "s" : ""}\x1b[0m`,
			);
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

function printScorecard(baseline: RunStats, energyAware: RunStats, budget: number): void {
	const baseTime = (baseline.endTime - baseline.startTime) / 1000;
	const eaTime = (energyAware.endTime - energyAware.startTime) / 1000;
	const energySaved =
		baseline.totalEnergy > 0 ? ((baseline.totalEnergy - energyAware.totalEnergy) / baseline.totalEnergy) * 100 : 0;
	const timeDelta = baseTime > 0 ? ((eaTime - baseTime) / baseTime) * 100 : 0;

	// Rough cost estimate: tokens x price/1M
	const devstralPrice = 0.12 / 1_000_000;
	const gptPrice = 0.1 / 1_000_000;
	const baseCost = baseline.turns.reduce((sum, t) => sum + t.tokens * devstralPrice, 0);
	const eaCost = energyAware.turns.reduce(
		(sum, t) => sum + t.tokens * (t.model.includes("gpt-oss") ? gptPrice : devstralPrice),
		0,
	);
	const costSaved = baseCost > 0 ? ((baseCost - eaCost) / baseCost) * 100 : 0;

	const fmtDelta = (val: number, positive = "+"): string => `${val >= 0 ? positive : ""}${val.toFixed(0)}%`;

	// Quality row values
	const fmtQuality = (s: RunStats): string => {
		// testPassed=undefined can mean: never reached Phase 2 (budget abort in build phase)
		// or budget aborted during fix phase (also sets testPassed=false now, but guard both)
		if (s.testPassed === undefined) {
			return s.abortedAt != null ? `✗ FAILED (budget, turn ${s.abortedAt})` : "n/a (no tests run)  ";
		}
		if (s.testPassed) {
			const fixCount = s.turnsToPass != null ? s.turnsToPass - (BUILD_TURNS.length + 1) : 0;
			const fixes = fixCount > 0 ? `, +${fixCount} fix${fixCount !== 1 ? "es" : ""}` : ", +0 fixes";
			return `✓ PASSED (turn ${s.turnsToPass}${fixes})`;
		}
		return s.abortedAt != null ? `✗ FAILED (budget, turn ${s.abortedAt})` : "✗ FAILED (max turns)";
	};

	console.log(`\n${"═".repeat(70)}`);
	console.log("  FINAL SCORECARD — Coding Agent Energy Challenge");
	console.log(`${"═".repeat(70)}`);
	console.log(`  Budget: ${budget}J  |  Devstral-Small ($0.12/M) -> GPT-OSS-20B ($0.10/M), 1.7x more efficient`);
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log("  |                 | Baseline          | Energy-Aware              |");
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log(
		`  | Turns           | ${String(baseline.turns.length).padEnd(17)} | ${String(energyAware.turns.length + (energyAware.abortedAt ? " (aborted)" : " (complete)")).padEnd(25)} |`,
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
	console.log(`  | Quality         | ${fmtQuality(baseline).padEnd(17)} | ${fmtQuality(energyAware).padEnd(25)} |`);
	console.log("  +-----------------+-------------------+---------------------------+");

	const eaDecisions = energyAware.turns.filter((t) => t.decision);
	if (eaDecisions.length > 0) {
		console.log("\n  POLICY DECISIONS (energy-aware):");
		for (const t of eaDecisions) {
			console.log(`    Turn ${t.turn}: ${t.decision}`);
		}
	}

	console.log("");
	if (energySaved > 0) {
		console.log(
			`  \x1b[32m✓ Energy-aware: ${energySaved.toFixed(0)}% less energy, ${costSaved.toFixed(0)}% lower cost${energyAware.abortedAt ? ` (stopped at turn ${energyAware.abortedAt})` : ""}\x1b[0m`,
		);
	} else {
		console.log("  Budget was not exhausted — reduce --budget to see routing in action.");
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

	// Rolling average for turns-to-pass (only from passing runs)
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
			"clear-memory": { type: "boolean", default: false },
		},
		allowPositionals: true,
	});

	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	// Handle --clear-memory before anything else
	if (values["clear-memory"]) {
		clearMemory();
		console.log("Memory cleared.");
	}

	const apiKey = process.env.NEURALWATT_API_KEY;
	const budgetJ = Number(values.budget);
	const taskLabel = "TypeScript rate-limiting middleware with acceptance tests";

	registerBuiltInApiProviders();

	// Load and display memory
	const mem = loadMemory();
	const memSummary = formatCodingMemory(MEMORY_KEY, mem);

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║               Coding Agent Energy Challenge                         ║");
	console.log(`║  Task: ${taskLabel.padEnd(62)}║`);
	console.log(`║  Model: ${DEFAULT_MODEL.id.padEnd(61)}║`);
	console.log(`║  Budget: ${`${budgetJ}J for energy-aware run (no limit for baseline)`.padEnd(60)}║`);
	console.log(`║  Phases: build (4) + consolidate (1) + acceptance-test loop (max ${MAX_FIX_TURNS}) ║`);
	console.log("╚══════════════════════════════════════════════════════════════════════╝");

	if (memSummary) {
		console.log(memSummary);
	} else {
		console.log("  Memory: No previous runs recorded.");
	}

	const baselineStats = await runCodingAgent("baseline", new BaselinePolicy(), {}, apiKey);
	const energyAwareStats = await runCodingAgent(
		"energy-aware",
		new EnergyAwarePolicy(),
		{ energy_budget_joules: budgetJ },
		apiKey,
	);

	printScorecard(baselineStats, energyAwareStats, budgetJ);

	// Update and persist memory
	updateCodingMemory(mem, baselineStats, energyAwareStats);
	saveMemory(mem);
	console.log(`\n  Memory saved to ~/.energy-demo-memory.json`);
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
