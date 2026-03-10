/**
 * Demo 1: Coding Agent Energy Challenge
 *
 * Generates a fresh TypeScript coding challenge via LLM each run to defeat
 * server-side KV caching — every demo uses a different task.
 *
 * Architecture:
 *   Baseline:      Every turn uses Kimi K2.5 (0.21 tok/J)
 *   Energy-aware:  A four-tier discriminator (GPT-OSS-20B) routes each turn:
 *                    thinking → Kimi K2.5     ($0.52/$2.59 per 1M)
 *                    complex  → Qwen3.5 397B  ($0.69/$4.14 per 1M)
 *                    medium   → Devstral 24B  ($0.12/$0.35 per 1M)
 *                    simple   → GPT-OSS 20B  ($0.03/$0.16 per 1M)
 *                  Memory accumulates per-phase discriminator accuracy across runs.
 *   Fast (opt-in): Every turn uses Kimi K2.5 Fast (speed-optimized alias)
 *
 * Usage:
 *   npx tsx src/demos/coding-agent.ts                    (generate new challenge)
 *   npx tsx src/demos/coding-agent.ts --static           (use hardcoded rate-limiter)
 *   npx tsx src/demos/coding-agent.ts --budget 25000
 *   npx tsx src/demos/coding-agent.ts --fast             (add fast-mode 3rd column)
 *   npx tsx src/demos/coding-agent.ts --hard             (force hard difficulty challenges)
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
import {
	type AssistantMessage,
	completeSimple,
	type Message,
	type Model,
	registerBuiltInApiProviders,
} from "@mariozechner/pi-ai";
import {
	type DiscriminateOptions,
	type DiscriminatorConfig,
	type DiscriminatorTier,
	discriminate,
	type RoutingDecision,
} from "./demo-discriminator.js";
import {
	buildDiscriminatorContext,
	type CodingMemory,
	clearMemory,
	codingMemoryHints,
	formatCodingMemory,
	formatPhaseRouting,
	loadMemory,
	type PhaseRoutingStats,
	saveMemory,
} from "./demo-memory.js";

// -- Models -------------------------------------------------------------------

/**
 * Energy efficiency (tokens per joule) from portal.neuralwatt.com.
 * Used as fallback when the API does not return energy_joules.
 * Prefer API-reported energy_joules when available — these are approximations.
 */
const TOKENS_PER_JOULE: Record<string, number> = {
	"mistralai/Devstral-Small-2-24B-Instruct-2512": 22.35,
	"Qwen/Qwen3.5-397B-A17B-FP8": 1.03,
	"Qwen/Qwen3.5-35B-A3B": 27.51,
	"openai/gpt-oss-20b": 0.5,
	"moonshotai/Kimi-K2.5": 0.21,
	"MiniMaxAI/MiniMax-M2.5": 0.5,
	"kimi-k2.5-fast": 0.21,
	"glm-5-fast": 0.5,
};

/** Shared base for all NeuralWatt models. */
const NW_BASE = {
	api: "openai-completions" as const,
	provider: "neuralwatt" as const,
	baseUrl: "https://api.neuralwatt.com/v1",
	reasoning: false,
	input: ["text"] as ["text"],
};

const KIMI_MODEL: Model<"openai-completions"> = {
	// thinking tier: $0.52/$2.59 per 1M — best CoT reasoning, 262K context
	id: "moonshotai/Kimi-K2.5",
	name: "Kimi K2.5",
	...NW_BASE,
	cost: { input: 0.52, output: 2.59, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

const QWEN_MODEL: Model<"openai-completions"> = {
	// complex tier: $0.69/$4.14 per 1M — 397B MoE (17B active), high quality
	id: "Qwen/Qwen3.5-397B-A17B-FP8",
	name: "Qwen3.5 397B",
	...NW_BASE,
	cost: { input: 0.69, output: 4.14, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

const DEVSTRAL_MODEL: Model<"openai-completions"> = {
	// medium tier: 22.35 tok/J, $0.12/$0.35 per 1M — most energy-efficient, 262K context
	id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
	name: "Devstral 24B",
	...NW_BASE,
	cost: { input: 0.12, output: 0.35, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 8_192,
};

const GPT_OSS_MODEL: Model<"openai-completions"> = {
	// simple tier + discriminator: $0.03/$0.16 per 1M — cheapest model
	id: "openai/gpt-oss-20b",
	name: "GPT-OSS 20B",
	...NW_BASE,
	cost: { input: 0.03, output: 0.16, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_384,
	maxTokens: 4_096,
};

const MINIMAX_MODEL: Model<"openai-completions"> = {
	// $0.35/$1.38 per 1M — 196K context, tools+JSON
	id: "MiniMaxAI/MiniMax-M2.5",
	name: "MiniMax M2.5",
	...NW_BASE,
	cost: { input: 0.35, output: 1.38, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 196_608,
	maxTokens: 16_384,
};

const QWEN_35B_MODEL: Model<"openai-completions"> = {
	// 27.51 tok/J, $0.29/$1.15 per 1M — small MoE, very energy-efficient, 16K context
	id: "Qwen/Qwen3.5-35B-A3B",
	name: "Qwen3.5 35B",
	...NW_BASE,
	cost: { input: 0.29, output: 1.15, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_384,
	maxTokens: 4_096,
};

const KIMI_FAST_MODEL: Model<"openai-completions"> = {
	// fast alias of Kimi K2.5 — speed-optimized, $0.52/$2.59 per 1M
	id: "kimi-k2.5-fast",
	name: "Kimi K2.5 Fast",
	...NW_BASE,
	cost: { input: 0.52, output: 2.59, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

const GLM_FAST_MODEL: Model<"openai-completions"> = {
	// fast alias of GLM-5 — speed-optimized, $0.92/$2.94 per 1M, 200K context
	id: "glm-5-fast",
	name: "GLM-5 Fast",
	...NW_BASE,
	cost: { input: 0.92, output: 2.94, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 16_384,
};

/** Default model for baseline and EA complex turns. */
const DEFAULT_MODEL = KIMI_MODEL;

/** Default model for fast mode. */
const FAST_MODEL = KIMI_FAST_MODEL;

/**
 * Budget sized for Kimi K2.5 (~3100J/turn).
 * 5 turns (4 build + consolidate) ≈ 15500J on baseline.
 * EA with discriminator routing simple turns to GPT-OSS should land ~6-10kJ.
 */
const DEFAULT_BUDGET_JOULES = 25_000;

/** Memory key for this routing pair. */
const MEMORY_KEY = "kimi-k2.5→gpt-oss-discriminator";

/** Discriminator config for the coding demo — four tiers. */
const DISCRIMINATOR_CONFIG: DiscriminatorConfig = {
	classifierModel: GPT_OSS_MODEL,
	thinking: { model: KIMI_MODEL },
	complex: { model: QWEN_MODEL },
	medium: { model: DEVSTRAL_MODEL, briefMaxTokens: 4_096 },
	simple: { model: GPT_OSS_MODEL, briefMaxTokens: 2_048 },
	tokensPerJoule: TOKENS_PER_JOULE,
	systemPrompt:
		"You are a routing classifier for a four-tier coding AI system.\n" +
		"Choose the CHEAPEST tier that can handle the task correctly:\n" +
		'  "thinking" → Kimi K2.5: ONLY for truly ambiguous specs, algorithmic puzzles, or multi-step logical reasoning.\n' +
		'  "complex"  → Qwen3.5 397B: novel architecture or design decisions with no clear pattern to follow.\n' +
		'  "medium"   → Devstral 24B: standard implementation — the model has conversation context with prior code.\n' +
		'  "simple"   → GPT-OSS 20B: boilerplate, interface/type definitions, trivial wrappers.\n' +
		"Phase hints (the phase label tells you the workflow stage):\n" +
		'  build-N   → usually "medium" or "simple"; the spec is clear and incremental.\n' +
		'  consolidate → "medium" at most; merging existing code from prior turns into one file.\n' +
		'  fix-N     → "medium" at most; test failures with error output — straightforward correction, not open-ended debugging.\n' +
		'Also classify response length: "full" for complete implementations, "brief" for short focused answers.\n' +
		'Reply with ONLY valid JSON: {"tier":"medium","length":"full","reason":"<=10 words"}',
};

// -- Task definition (fallback when generation is unavailable) ----------------

const SYSTEM_PROMPT =
	"You are an expert TypeScript engineer. " +
	"Implement code concisely and correctly. " +
	"Include TypeScript types and JSDoc for public APIs. " +
	"Each response should be tightly focused — implement only what is asked. " +
	"No preamble, no prose explanations, just the code.";

const DEFAULT_BUILD_TURNS = [
	"Design a TypeScript interface for a rate limiter: RateLimiterOptions (windowMs, maxRequests, keyFn) and RateLimiterState (map of key to {count, resetAt}). Keep it concise.",
	"Implement a RateLimiter class using those interfaces. Include: constructor(options), isAllowed(key): boolean method that enforces the sliding window. Add JSDoc.",
	"Write an Express-style middleware factory: createRateLimitMiddleware(options: RateLimiterOptions): (req, res, next) => void. It should set X-RateLimit-Remaining and X-RateLimit-Reset headers, and return 429 with a JSON error when the limit is exceeded.",
	"Add input validation to the RateLimiter constructor: throw descriptive errors for invalid windowMs (must be > 0), invalid maxRequests (must be > 0 integer), and missing keyFn.",
];

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

const DEFAULT_FIX_EXTRA =
	"Critical requirements for this task:\n" +
	"  - createRateLimitMiddleware must be SYNCHRONOUS (not async)\n" +
	"  - Middleware must call options.keyFn(req) to get the key, then call limiter.isAllowed(key)\n" +
	"  - If allowed: call (res as any).set('X-RateLimit-Remaining', String(remaining)) then call next()\n" +
	"  - If not allowed: call (res as any).status(429).json({ error: 'Too Many Requests' })\n";

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

// -- Challenge generation -----------------------------------------------------

/**
 * Prompt for generating a fresh coding challenge with a self-contained
 * acceptance test. Embedded template ensures the test harness is correct.
 */
interface ChallengeTopic {
	topic: string;
	difficulty: "standard" | "hard";
}

const CHALLENGE_TOPICS: ChallengeTopic[] = [
	// Standard — medium/simple models handle these well
	{ topic: "LRU cache", difficulty: "standard" },
	{ topic: "debounce/throttle utility", difficulty: "standard" },
	{ topic: "event emitter", difficulty: "standard" },
	{ topic: "retry with exponential backoff", difficulty: "standard" },
	{ topic: "promise queue with concurrency limit", difficulty: "standard" },
	{ topic: "memoize with TTL", difficulty: "standard" },
	{ topic: "circular buffer (ring buffer)", difficulty: "standard" },
	{ topic: "priority queue (min-heap)", difficulty: "standard" },
	{ topic: "pub-sub message bus", difficulty: "standard" },
	{ topic: "undo-redo stack", difficulty: "standard" },
	{ topic: "object pool with auto-reclaim", difficulty: "standard" },
	{ topic: "middleware pipeline", difficulty: "standard" },
	// Hard — algorithmic reasoning, tricky invariants, or subtle edge cases
	{ topic: "observable with switchMap, mergeMap, and backpressure", difficulty: "hard" },
	{ topic: "trie with wildcard search and prefix-count", difficulty: "hard" },
	{ topic: "skip list with probabilistic balancing", difficulty: "hard" },
	{ topic: "async dependency resolver (topological sort with cycle detection)", difficulty: "hard" },
	{ topic: "interval tree with overlap queries", difficulty: "hard" },
	{ topic: "CRDT counter (conflict-free replicated data type)", difficulty: "hard" },
	{ topic: "regex engine supporting ., *, +, and ? operators", difficulty: "hard" },
	{ topic: "constraint propagation solver (Sudoku-style)", difficulty: "hard" },
	{ topic: "persistent (immutable) balanced BST with structural sharing", difficulty: "hard" },
	{ topic: "async stream with map, filter, take, and backpressure", difficulty: "hard" },
	{ topic: "expression parser and evaluator with operator precedence", difficulty: "hard" },
	{ topic: "cron expression parser and next-run calculator", difficulty: "hard" },
];

function buildChallengePrompt(hardOnly = false): { prompt: string; topic: string; difficulty: string } {
	const pool = hardOnly ? CHALLENGE_TOPICS.filter((e) => e.difficulty === "hard") : CHALLENGE_TOPICS;
	const entry = pool[Math.floor(Math.random() * pool.length)];
	const difficultyGuide =
		entry.difficulty === "hard"
			? "This is a HARD challenge. The build turns should require non-trivial algorithmic reasoning:\n" +
				"  1. Define the core types/interfaces — include any non-obvious data structures needed\n" +
				"  2. Implement the core algorithm (the tricky part — correctness matters)\n" +
				"  3. Add advanced operations, edge cases, and performance-sensitive paths\n"
			: "buildTurns must have exactly 3 prompts that build incrementally:\n" +
				"  1. Define the TypeScript interfaces/types for the data structure\n" +
				"  2. Implement the core class or function\n" +
				"  3. Add input validation and edge-case handling\n";

	const prompt =
		`Generate a TypeScript coding challenge about: ${entry.topic}\n` +
		"Reply with ONLY a JSON object — no prose, no markdown fences.\n\n" +
		'{"taskLabel":"<50-char description>","buildTurns":["turn1","turn2","turn3"],"consolidatePrompt":"...","acceptanceTest":"...TypeScript source..."}\n\n' +
		`${difficultyGuide}\n` +
		"consolidatePrompt must:\n" +
		"  - Ask for a single impl.ts combining everything\n" +
		"  - List EXACT exports with their TypeScript signatures, e.g.: export class Foo {...} export function bar(...) {...}\n" +
		"  - End with: No imports except node standard lib. Output raw TypeScript only — no markdown fences.\n\n" +
		"acceptanceTest must be valid TypeScript that:\n" +
		"  - Starts with: import assert from 'node:assert/strict';\n" +
		"  - Imports the named exports from './impl.js'\n" +
		"  - Uses this EXACT test harness (copy verbatim):\n" +
		"      let failed = 0;\n" +
		"      async function test(name: string, fn: () => void | Promise<void>): Promise<void> {\n" +
		"        try { await fn(); console.log('PASS: ' + name); }\n" +
		"        catch (e) { const msg = e instanceof Error ? e.message : String(e); console.log('FAIL: ' + name + ': ' + msg); failed++; }\n" +
		"      }\n" +
		"  - Has 4-5 test cases covering: happy path, boundary conditions, error cases\n" +
		"  - Ends with: if (failed > 0) process.exit(1);\n" +
		"  - Uses only top-level await and node:assert (no timeouts, no randomness)\n\n" +
		"AVOID: rate limiting, express middleware, HTTP servers, auth systems.\n\n" +
		"Output ONLY the JSON object.";
	return { prompt, topic: entry.topic, difficulty: entry.difficulty };
}

interface GeneratedChallenge {
	taskLabel: string;
	buildTurns: string[];
	consolidatePrompt: string;
	acceptanceTest: string;
	difficulty: "standard" | "hard";
}

async function generateChallenge(apiKey: string, hardOnly = false): Promise<GeneratedChallenge | null> {
	const challenge = buildChallengePrompt(hardOnly);
	const diffTag = challenge.difficulty === "hard" ? " \x1b[31m[HARD]\x1b[0m" : "";
	process.stdout.write(`  Generating challenge via Kimi K2.5...${diffTag} topic: ${challenge.topic}`);
	try {
		const msg = await completeSimple(
			KIMI_MODEL,
			{
				systemPrompt: "You are a technical challenge designer. Output only valid JSON.",
				messages: [{ role: "user", content: challenge.prompt, timestamp: Date.now() }],
			},
			{ apiKey, maxTokens: 3_000 },
		);
		const text = msg.content
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("");

		let parsed: unknown = null;
		try {
			parsed = JSON.parse(text);
		} catch {
			const m = text.match(/\{[\s\S]*\}/);
			if (m) {
				try {
					parsed = JSON.parse(m[0]);
				} catch {
					// fall through to null
				}
			}
		}

		if (!parsed || typeof parsed !== "object") {
			console.log(" ✗ (invalid JSON, using default task)");
			return null;
		}

		const c = parsed as Record<string, unknown>;
		if (
			typeof c.taskLabel !== "string" ||
			!Array.isArray(c.buildTurns) ||
			c.buildTurns.length < 2 ||
			!c.buildTurns.every((t) => typeof t === "string") ||
			typeof c.consolidatePrompt !== "string" ||
			typeof c.acceptanceTest !== "string"
		) {
			console.log(" ✗ (schema mismatch, using default task)");
			return null;
		}

		const label = c.taskLabel.slice(0, 55);
		console.log(` ✓ "${label}"`);
		return {
			taskLabel: label,
			buildTurns: c.buildTurns as string[],
			consolidatePrompt: c.consolidatePrompt as string,
			acceptanceTest: c.acceptanceTest as string,
			difficulty: challenge.difficulty as "standard" | "hard",
		};
	} catch (e) {
		console.log(` ✗ (${(e as Error).message?.slice(0, 50) ?? "error"}, using default task)`);
		return null;
	}
}

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
	/** True when the challenge was generated via LLM (suppresses static-task memory hints). */
	generated: boolean;
	/** Difficulty level of the generated challenge. */
	difficulty?: "standard" | "hard";
}

// tsx binary: prefer the one from the monorepo root node_modules
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_TSX = join(__dirname, "../../../../node_modules/.bin/tsx");

// -- Energy tracking ----------------------------------------------------------

function getEnergy(message: AssistantMessage, modelId: string): { joules: number; fromApi: boolean } {
	const api = message.energy?.energy_joules;
	if (api != null && api > 0) return { joules: api, fromApi: true };
	const tokensPerJoule = TOKENS_PER_JOULE[modelId] ?? 1.0;
	return { joules: message.usage.totalTokens / tokensPerJoule, fromApi: false };
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
	phase: string,
	modelId: string,
	decisionLabel: string,
	energy: number,
	budget: number,
): void {
	const tag =
		mode === "baseline"
			? "\x1b[36m[baseline ]\x1b[0m"
			: mode === "fast"
				? "\x1b[33m[fast     ]\x1b[0m"
				: "\x1b[35m[energy-▼ ]\x1b[0m";
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

/** Simplified phase key used as memory key, e.g. "Turn 2  [build 2/3]" → "build-2". */
function simplifyPhase(phaseLabel: string): string {
	const buildMatch = phaseLabel.match(/\[build (\d+)/);
	if (buildMatch) return `build-${buildMatch[1]}`;
	if (phaseLabel.includes("[consolidate]")) return "consolidate";
	const fixMatch = phaseLabel.match(/\[fix #(\d+)\]/);
	if (fixMatch) return `fix-${fixMatch[1]}`;
	return phaseLabel.trim();
}

interface TurnResult {
	turn: number;
	phase: string;
	model: string;
	energy: number;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	/** Human-readable decision label shown in scorecard. */
	decision: string;
	/** EA mode: discriminator tier for this turn. */
	discriminatorDecision?: DiscriminatorTier;
	/** EA mode: discriminator reason string (≤80 chars). */
	discriminatorReason?: string;
	/** EA mode: energy cost of the discriminator call itself. */
	discriminatorEnergyJ: number;
}

interface RunStats {
	mode: string;
	/** Total energy including discriminator overhead for EA mode. */
	totalEnergy: number;
	totalTokens: number;
	totalInputTokens: number;
	totalCacheRead: number;
	turns: TurnResult[];
	startTime: number;
	endTime: number;
	testPassed?: boolean;
	turnsToPass?: number;
	/** Test names that required fix turns this run (de-duplicated). */
	failedTestNames: string[];
	/** Energy spent on discriminator calls — already included in totalEnergy. */
	totalDiscriminatorEnergyJ: number;
}

async function runCodingAgent(
	mode: "baseline" | "energy-aware" | "fast",
	config: RunConfig,
	mem: ReturnType<typeof loadMemory>,
	apiKey: string,
	budgetJ: number,
): Promise<RunStats> {
	const stats: RunStats = {
		mode,
		totalEnergy: 0,
		totalTokens: 0,
		totalInputTokens: 0,
		totalCacheRead: 0,
		turns: [],
		startTime: Date.now(),
		endTime: 0,
		failedTestNames: [],
		totalDiscriminatorEnergyJ: 0,
	};

	const messages: Message[] = [];

	console.log(`\n${"═".repeat(70)}`);
	console.log(`  Running: ${mode.toUpperCase()} mode  |  Budget: ${budgetJ}J (display only)`);
	if (mode === "energy-aware") {
		console.log("  Routing: discriminator (GPT-OSS-20B) classifies each prompt → Kimi or GPT-OSS");
	} else if (mode === "fast") {
		console.log(`  Model: ${FAST_MODEL.name} (speed-optimized alias)`);
	}
	console.log(`${"═".repeat(70)}`);

	/**
	 * Execute one turn. In EA mode, calls the discriminator first to select model.
	 */
	async function runTurn(
		prompt: string,
		phaseLabel: string,
		maxTier?: DiscriminatorTier,
		minTier?: DiscriminatorTier,
	): Promise<void> {
		const turnNum = stats.turns.length + 1;
		const phase = simplifyPhase(phaseLabel);

		let effectiveModel: Model<"openai-completions">;
		let decisionLabel: string;
		let discriminatorDecision: DiscriminatorTier | undefined;
		let discriminatorReason: string | undefined;
		let discriminatorEnergyJ = 0;
		let turnMaxTokens: number | undefined;

		if (mode === "energy-aware") {
			const memCtx = buildDiscriminatorContext(phase, MEMORY_KEY, mem);
			const discOptsArg: DiscriminateOptions | undefined =
				maxTier || minTier ? { ...(maxTier && { maxTier }), ...(minTier && { minTier }) } : undefined;
			const disc: RoutingDecision = await discriminate(
				phase,
				prompt,
				DISCRIMINATOR_CONFIG,
				memCtx,
				apiKey,
				discOptsArg,
			);
			discriminatorDecision = disc.tier;
			discriminatorReason = disc.reason;
			discriminatorEnergyJ = disc.energyJ;
			turnMaxTokens = disc.maxTokens;
			stats.totalDiscriminatorEnergyJ += discriminatorEnergyJ;
			// Include discriminator overhead in the running total so totalEnergy
			// reflects true cost of the EA run (not just model call energy).
			stats.totalEnergy += discriminatorEnergyJ;

			effectiveModel = disc.model;
			const modelLabel =
				discriminatorDecision === "thinking"
					? "Kimi K2.5 (thinking)"
					: discriminatorDecision === "complex"
						? "Qwen3.5-397B"
						: discriminatorDecision === "medium"
							? "Devstral-24B"
							: "GPT-OSS-20B";
			const memLabel = memCtx ? " \x1b[2m[memory-informed]\x1b[0m" : "";
			const briefLabel = turnMaxTokens ? ` \x1b[2m[brief: max ${turnMaxTokens} tok]\x1b[0m` : "";
			decisionLabel = `↳ discriminated: ${discriminatorDecision} → ${modelLabel}${memLabel}${briefLabel}  (${discriminatorEnergyJ.toFixed(1)}J)  reason: ${disc.reason}`;
		} else {
			effectiveModel = mode === "fast" ? FAST_MODEL : DEFAULT_MODEL;
			decisionLabel = "";
		}

		printTurnHeader(
			mode,
			`Turn ${turnNum}  ${phaseLabel}`,
			effectiveModel.id,
			decisionLabel,
			stats.totalEnergy,
			budgetJ,
		);
		console.log(`  \x1b[2m${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}\x1b[0m`);

		messages.push({ role: "user", content: prompt, timestamp: Date.now() });

		const assistantMsg = await completeSimple(
			effectiveModel,
			{ systemPrompt: SYSTEM_PROMPT, messages },
			{ apiKey, ...(turnMaxTokens ? { maxTokens: turnMaxTokens } : {}) },
		);
		messages.push(assistantMsg);

		const { joules: energy, fromApi } = getEnergy(assistantMsg, effectiveModel.id);
		const tokens = assistantMsg.usage.totalTokens;
		const inputTokens = assistantMsg.usage.input;
		const cacheRead = assistantMsg.usage.cacheRead;
		stats.totalEnergy += energy;
		stats.totalTokens += tokens;
		stats.totalInputTokens += inputTokens;
		stats.totalCacheRead += cacheRead;

		const energyLabel = fromApi ? "api" : "est";
		const totalPrompt = inputTokens + cacheRead;
		const cachePct = totalPrompt > 0 && cacheRead > 0 ? Math.round((cacheRead / totalPrompt) * 100) : 0;
		const cacheLabel = cacheRead > 0 ? ` \x1b[33m(${cacheRead} cached = ${cachePct}% of input)\x1b[0m` : "";
		console.log(
			`  \x1b[2m${tokens} tokens | ${energy.toFixed(1)}J [${energyLabel}] | input:${inputTokens} output:${assistantMsg.usage.output}\x1b[0m${cacheLabel}`,
		);

		const responseText = extractText(assistantMsg);
		console.log(truncateCode(responseText, 10));

		stats.turns.push({
			turn: turnNum,
			phase,
			model: effectiveModel.id,
			energy,
			tokens,
			inputTokens,
			outputTokens: assistantMsg.usage.output,
			cacheRead,
			decision: decisionLabel,
			discriminatorDecision,
			discriminatorReason,
			discriminatorEnergyJ,
		});
	}

	// -- Phase 1: Build --------------------------------------------------------
	for (let i = 0; i < config.buildTurns.length; i++) {
		await runTurn(config.buildTurns[i], `[build ${i + 1}/${config.buildTurns.length}]`);
	}

	// -- Phase 2: Consolidate --------------------------------------------------
	await runTurn(config.consolidatePrompt, "[consolidate]", "medium");

	// If no acceptance test, done after consolidation
	if (!config.acceptanceTest) {
		stats.endTime = Date.now();
		const elapsed = ((stats.endTime - stats.startTime) / 1000).toFixed(1);
		console.log(
			`\n  \x1b[1mDone: ${stats.turns.length} turns | ${stats.totalEnergy.toFixed(0)}J | ${stats.totalTokens} tokens | ${elapsed}s\x1b[0m`,
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
		// Record tests that needed fixing (initial failure)
		for (const f of testResult.failedTests) {
			const name = f.includes(": ") ? f.slice(0, f.indexOf(": ")) : f;
			if (!stats.failedTestNames.includes(name)) stats.failedTestNames.push(name);
		}

		const MAX_FIX_ATTEMPTS = 5;
		// Failure-based escalation: after 2 consecutive failures at the same tier,
		// force the next fix to use at least one tier above the failing tier.
		const TIER_ESCALATION: DiscriminatorTier[] = ["simple", "medium", "complex", "thinking"];
		const MAX_FAILURES_BEFORE_ESCALATION = 2;
		let fixAttempt = 0;
		let consecutiveFailuresAtTier = 0;
		let currentMinTier: DiscriminatorTier | undefined;
		let lastFixTier: DiscriminatorTier | undefined;
		while (!testResult.passed && fixAttempt < MAX_FIX_ATTEMPTS) {
			fixAttempt++;
			// Escalate: jump one tier above the actual failing tier (not currentMinTier)
			if (lastFixTier && consecutiveFailuresAtTier >= MAX_FAILURES_BEFORE_ESCALATION) {
				const failingIdx = TIER_ESCALATION.indexOf(lastFixTier);
				if (failingIdx < TIER_ESCALATION.length - 1) {
					currentMinTier = TIER_ESCALATION[failingIdx + 1];
					console.log(
						`  \x1b[33m↑ Escalating: ${MAX_FAILURES_BEFORE_ESCALATION} failures at ${lastFixTier} → minTier=${currentMinTier}\x1b[0m`,
					);
					// Reset to 1 (not 0): the last failure counts as the first at the new tier
					consecutiveFailuresAtTier = 1;
				}
			}
			const fixTurnLabel = `[fix #${fixAttempt}]`;
			const failureSummary =
				testResult.failedTests.length > 0
					? testResult.failedTests.map((f) => `  - ${f}`).join("\n")
					: testResult.output.split("\n").slice(0, 10).join("\n");

			// Extract expected imports from acceptance test so the model knows what to export
			const importLine = config.acceptanceTest?.match(/import \{[^}]+\} from ['"]\.\/impl\.js['"]/)?.[0];
			const importHint = importLine ? `\nThe test imports: ${importLine}\nYou MUST export these exact names.\n` : "";

			const fixPrompt =
				`The acceptance tests failed:\n${failureSummary}\n${importHint}\n` +
				(config.fixPromptExtra ? `${config.fixPromptExtra}\n` : "") +
				"Write the complete corrected implementation as a single TypeScript file. " +
				"Make sure all classes and functions are named exports (use 'export class', 'export function'). " +
				"No external imports. Output raw TypeScript only — no markdown fences.";

			await runTurn(fixPrompt, fixTurnLabel, undefined, currentMinTier);

			const fixMsg = messages[messages.length - 1] as AssistantMessage;
			code = extractCode(extractText(fixMsg));
			testResult = runAcceptanceTest(code, config.acceptanceTest);
			printTestResults(testResult);

			// Track which tier was used for escalation logic
			const fixTurn = stats.turns[stats.turns.length - 1];
			const fixTierUsed = fixTurn.discriminatorDecision;

			if (testResult.passed) {
				stats.testPassed = true;
				stats.turnsToPass = stats.turns.length;
				console.log(
					`\n  \x1b[32m✓ All acceptance tests passed on turn ${stats.turns.length} (+${fixAttempt} fix${fixAttempt !== 1 ? "es" : ""})\x1b[0m`,
				);
			} else {
				// Track consecutive failures at the same effective tier for escalation
				if (fixTierUsed && fixTierUsed === lastFixTier) {
					consecutiveFailuresAtTier++;
				} else {
					consecutiveFailuresAtTier = 1;
				}
				lastFixTier = fixTierUsed;

				// Track any newly-failing tests during fix iterations
				for (const f of testResult.failedTests) {
					const name = f.includes(": ") ? f.slice(0, f.indexOf(": ")) : f;
					if (!stats.failedTestNames.includes(name)) stats.failedTestNames.push(name);
				}
				if (fixAttempt >= MAX_FIX_ATTEMPTS) {
					console.log(`\n  \x1b[31m✗ Giving up after ${MAX_FIX_ATTEMPTS} fix attempts\x1b[0m`);
				} else {
					console.log(
						`  → ${testResult.failedTests.length} test${testResult.failedTests.length !== 1 ? "s" : ""} failed — requesting correction`,
					);
				}
			}
		}
	}

	stats.endTime = Date.now();
	const elapsed = ((stats.endTime - stats.startTime) / 1000).toFixed(1);
	console.log(
		`\n  \x1b[1mDone: ${stats.turns.length} turns | ${stats.totalEnergy.toFixed(0)}J | ${stats.totalTokens} tokens | ${elapsed}s\x1b[0m`,
	);
	return stats;
}

// -- Cost helpers -------------------------------------------------------------

/** All known models for cost lookup. */
const ALL_MODELS: Model<"openai-completions">[] = [
	KIMI_MODEL,
	KIMI_FAST_MODEL,
	QWEN_MODEL,
	QWEN_35B_MODEL,
	DEVSTRAL_MODEL,
	GPT_OSS_MODEL,
	MINIMAX_MODEL,
	GLM_FAST_MODEL,
];

/** Look up a model's cost rates (per 1M tokens) by model ID. */
function modelCostRates(modelId: string): { input: number; output: number } {
	const model = ALL_MODELS.find((m) => m.id === modelId);
	if (!model) return { input: KIMI_MODEL.cost.input, output: KIMI_MODEL.cost.output };
	return { input: model.cost.input, output: model.cost.output };
}

/** Estimate total cost for a set of turns using separate input/output pricing. */
function estimateCost(turns: { inputTokens: number; outputTokens: number; model: string }[]): number {
	return turns.reduce((sum, t) => {
		const rates = modelCostRates(t.model);
		return sum + (t.inputTokens * rates.input + t.outputTokens * rates.output) / 1_000_000;
	}, 0);
}

// -- Scorecard ----------------------------------------------------------------

function printScorecard(
	baseline: RunStats,
	energyAware: RunStats,
	config: RunConfig,
	budget: number,
	runLabel = "",
	fast?: RunStats,
): void {
	const baseTime = (baseline.endTime - baseline.startTime) / 1000;
	const eaTime = (energyAware.endTime - energyAware.startTime) / 1000;
	const energySaved =
		baseline.totalEnergy > 0 ? ((baseline.totalEnergy - energyAware.totalEnergy) / baseline.totalEnergy) * 100 : 0;
	const timeDelta = baseTime > 0 ? ((eaTime - baseTime) / baseTime) * 100 : 0;

	const baseCost = estimateCost(baseline.turns);
	const eaCost = estimateCost(energyAware.turns);
	const costSaved = baseCost > 0 ? ((baseCost - eaCost) / baseCost) * 100 : 0;

	const fmtDelta = (val: number, positive = "+"): string => `${val >= 0 ? positive : ""}${val.toFixed(0)}%`;

	const consolidateTurnOffset = config.buildTurns.length + 1;
	const fmtQuality = (s: RunStats): string => {
		if (!config.acceptanceTest) return "n/a (no tests)";
		if (s.testPassed === true) {
			const fixCount = s.turnsToPass != null ? Math.max(0, s.turnsToPass - consolidateTurnOffset) : 0;
			const fixes = fixCount > 0 ? `, +${fixCount} fix${fixCount !== 1 ? "es" : ""}` : ", +0 fixes";
			return `✓ PASSED (turn ${s.turnsToPass}${fixes})`;
		}
		return "✗ FAILED";
	};

	// Model distribution for EA mode
	const countTurns = (stats: RunStats, id: string) => stats.turns.filter((t) => t.model === id).length;
	const eaModelParts = [
		countTurns(energyAware, KIMI_MODEL.id) > 0 ? `Kimi:${countTurns(energyAware, KIMI_MODEL.id)}` : null,
		countTurns(energyAware, QWEN_MODEL.id) > 0 ? `Qwen:${countTurns(energyAware, QWEN_MODEL.id)}` : null,
		countTurns(energyAware, DEVSTRAL_MODEL.id) > 0 ? `Devstral:${countTurns(energyAware, DEVSTRAL_MODEL.id)}` : null,
		countTurns(energyAware, GPT_OSS_MODEL.id) > 0 ? `GPT-OSS:${countTurns(energyAware, GPT_OSS_MODEL.id)}` : null,
	].filter((p): p is string => p !== null);
	const eaModelLabel = `${eaModelParts.join(", ")} (discriminator)`;

	const hasFast = fast != null;

	// Fast mode stats (computed only when present)
	const fastTime = hasFast ? (fast.endTime - fast.startTime) / 1000 : 0;
	const fastEnergySaved =
		hasFast && baseline.totalEnergy > 0
			? ((baseline.totalEnergy - fast.totalEnergy) / baseline.totalEnergy) * 100
			: 0;
	const fastTimeDelta = hasFast && baseTime > 0 ? ((fastTime - baseTime) / baseTime) * 100 : 0;
	const fastCost = hasFast ? estimateCost(fast.turns) : 0;
	const fastCostSaved = hasFast && baseCost > 0 ? ((baseCost - fastCost) / baseCost) * 100 : 0;

	const header = runLabel
		? `SCORECARD ${runLabel} — Coding Agent Energy Challenge`
		: "FINAL SCORECARD — Coding Agent Energy Challenge";

	// Column widths adapt to 2-col or 3-col layout
	const colW = hasFast ? 21 : 25;
	const rowSep = hasFast
		? "  +-----------------+-------------------+---------------------+---------------------+"
		: "  +-----------------+-------------------+---------------------------+";

	console.log(`\n${"═".repeat(hasFast ? 82 : 70)}`);
	console.log(`  ${header}`);
	console.log(`${"═".repeat(hasFast ? 82 : 70)}`);
	console.log(`  Task:   ${config.taskLabel}`);
	console.log(
		`  Budget: ${budget}J (display)  |  ${config.generated ? `LLM-generated challenge${config.difficulty === "hard" ? " \x1b[31m[HARD]\x1b[0m" : ""}` : "hardcoded rate-limiter"}`,
	);
	console.log(rowSep);
	if (hasFast) {
		console.log(`  |                 | Baseline          | Energy-Aware        | Fast                |`);
	} else {
		console.log("  |                 | Baseline          | Energy-Aware              |");
	}
	console.log(rowSep);

	// Helper for building rows
	const row = (label: string, baseVal: string, eaVal: string, fastVal?: string): void => {
		if (hasFast && fastVal != null) {
			console.log(`  | ${label.padEnd(15)} | ${baseVal.padEnd(17)} | ${eaVal.padEnd(19)} | ${fastVal.padEnd(19)} |`);
		} else {
			console.log(`  | ${label.padEnd(15)} | ${baseVal.padEnd(17)} | ${eaVal.padEnd(colW)} |`);
		}
	};

	const fastModelLabel = hasFast ? `${FAST_MODEL.name} (all)` : undefined;
	row("Model(s)", "Kimi K2.5 (all)", eaModelLabel, fastModelLabel);
	row(
		"Turns",
		String(baseline.turns.length),
		String(energyAware.turns.length),
		hasFast ? String(fast.turns.length) : undefined,
	);
	row(
		"Energy used",
		`${baseline.totalEnergy.toFixed(0)} J`,
		`${energyAware.totalEnergy.toFixed(0)} J  (${fmtDelta(-energySaved, "-")})`,
		hasFast ? `${fast.totalEnergy.toFixed(0)} J  (${fmtDelta(-fastEnergySaved, "-")})` : undefined,
	);

	if (energyAware.totalDiscriminatorEnergyJ > 0) {
		row(
			"Discriminator",
			"n/a",
			`${energyAware.totalDiscriminatorEnergyJ.toFixed(1)}J (incl. ↑)`,
			hasFast ? "n/a" : undefined,
		);
	}

	const totalCacheRead = baseline.totalCacheRead + energyAware.totalCacheRead + (hasFast ? fast.totalCacheRead : 0);
	if (totalCacheRead > 0) {
		const fmtCache = (cr: number, inp: number) => {
			if (cr === 0) return "none";
			const totalPrompt = inp + cr;
			const pct = totalPrompt > 0 ? Math.round((cr / totalPrompt) * 100) : 0;
			return `\x1b[33m${cr} tok (${pct}%)\x1b[0m`;
		};
		row(
			"Cache reads",
			fmtCache(baseline.totalCacheRead, baseline.totalInputTokens),
			fmtCache(energyAware.totalCacheRead, energyAware.totalInputTokens),
			hasFast ? fmtCache(fast.totalCacheRead, fast.totalInputTokens) : undefined,
		);
	}

	row(
		"Est. cost",
		`$${baseCost.toFixed(4)}`,
		`$${eaCost.toFixed(4)}  (${fmtDelta(-costSaved, "-")})`,
		hasFast ? `$${fastCost.toFixed(4)}  (${fmtDelta(-fastCostSaved, "-")})` : undefined,
	);
	row(
		"Tokens used",
		String(baseline.totalTokens),
		String(energyAware.totalTokens),
		hasFast ? String(fast.totalTokens) : undefined,
	);
	row(
		"Wall time",
		`${baseTime.toFixed(1)} s`,
		`${eaTime.toFixed(1)} s  (${fmtDelta(timeDelta)})`,
		hasFast ? `${fastTime.toFixed(1)} s  (${fmtDelta(fastTimeDelta)})` : undefined,
	);
	if (config.acceptanceTest) {
		row("Quality", fmtQuality(baseline), fmtQuality(energyAware), hasFast ? fmtQuality(fast) : undefined);
	}
	console.log(rowSep);

	// Per-turn routing decisions for EA
	const eaDecisions = energyAware.turns.filter((t) => t.discriminatorDecision);
	if (eaDecisions.length > 0) {
		console.log("\n  DISCRIMINATOR DECISIONS (energy-aware):");
		for (const t of eaDecisions) {
			const tier = t.discriminatorDecision;
			const icon =
				tier === "thinking"
					? "\x1b[35m◆ thinking\x1b[0m"
					: tier === "complex"
						? "\x1b[33m▲ complex\x1b[0m"
						: tier === "medium"
							? "\x1b[36m● medium  \x1b[0m"
							: "\x1b[32m▼ simple  \x1b[0m";
			const model =
				tier === "thinking"
					? "Kimi K2.5  "
					: tier === "complex"
						? "Qwen3.5-397B"
						: tier === "medium"
							? "Devstral-24B"
							: "GPT-OSS-20B ";
			const reason = t.discriminatorReason ? `  \x1b[2m"${t.discriminatorReason}"\x1b[0m` : "";
			console.log(`    ${t.phase.padEnd(14)} ${icon} → ${model}  ${t.energy.toFixed(0)}J${reason}`);
		}
	}

	console.log("");
	// Summary line for each mode — account for quality differences
	const fmtSummary = (
		label: string,
		color: string,
		saved: number,
		costPct: number,
		passed: boolean | undefined,
		baselinePassed: boolean | undefined,
	): void => {
		if (passed === false && baselinePassed === true) {
			console.log(`  \x1b[31m✗ ${label}: ${saved.toFixed(0)}% less energy but FAILED (baseline passed)\x1b[0m`);
		} else if (saved > 0) {
			const qualitySame = baselinePassed === true && passed === true ? " — same quality outcome" : "";
			console.log(
				`  ${color}✓ ${label}: ${saved.toFixed(0)}% less energy, ${costPct.toFixed(0)}% lower cost${qualitySame}\x1b[0m`,
			);
		}
	};

	fmtSummary("Energy-aware", "\x1b[32m", energySaved, costSaved, energyAware.testPassed, baseline.testPassed);
	if (hasFast) {
		fmtSummary("Fast mode", "\x1b[33m", fastEnergySaved, fastCostSaved, fast.testPassed, baseline.testPassed);
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

	// Merge failed test names from both runs
	const failedTestCounts: Record<string, number> = { ...(prev.failedTestCounts ?? {}) };
	for (const name of [...baseStats.failedTestNames, ...eaStats.failedTestNames]) {
		failedTestCounts[name] = (failedTestCounts[name] ?? 0) + 1;
	}

	// Update per-phase discriminator routing stats (EA mode only)
	const phaseRouting: Record<string, PhaseRoutingStats> = { ...(prev.phaseRouting ?? {}) };
	for (const turn of eaStats.turns) {
		if (!turn.discriminatorDecision) continue;
		const existing: PhaseRoutingStats = phaseRouting[turn.phase] ?? {
			complexCount: 0,
			simpleCount: 0,
			complexPassCount: 0,
			simplePassCount: 0,
		};
		// thinking + complex → "complex" bucket; medium + simple → "simple" bucket
		if (turn.discriminatorDecision === "thinking" || turn.discriminatorDecision === "complex") {
			existing.complexCount++;
			if (eaStats.testPassed) existing.complexPassCount++;
		} else {
			existing.simpleCount++;
			if (eaStats.testPassed) existing.simplePassCount++;
		}
		phaseRouting[turn.phase] = existing;
	}

	mem.coding[MEMORY_KEY] = {
		runs,
		baselinePassCount,
		eaPassCount,
		avgTurnsBaseline,
		avgTurnsEA,
		avgEnergySavingsPct,
		failedTestCounts,
		phaseRouting,
		lastUpdated: new Date().toISOString(),
	};
}

// -- Multi-run ----------------------------------------------------------------

interface RunPair {
	runIndex: number;
	order: "baseline-first" | "ea-first";
	config: RunConfig;
	baseline: RunStats;
	ea: RunStats;
	fast?: RunStats;
}

/**
 * Builds a RunConfig for one iteration. For generated mode, calls the LLM each
 * time so each run gets a fresh task (defeats cross-run KV caching).
 */
async function buildRunConfig(
	isStatic: boolean,
	taskStr: string | undefined,
	acceptancePath: string | undefined,
	apiKey: string,
	mem: ReturnType<typeof loadMemory>,
	hardOnly = false,
): Promise<RunConfig> {
	if (taskStr) {
		const acceptanceTest = acceptancePath ? readFileSync(acceptancePath, "utf8") : null;
		return {
			taskLabel: taskStr.slice(0, 60),
			buildTurns: [taskStr],
			consolidatePrompt:
				"Write the final complete implementation as a single TypeScript file named impl.ts, " +
				"incorporating everything built so far. " +
				"Export all public types and functions. " +
				"No external imports. Output raw TypeScript only — no markdown fences.",
			acceptanceTest,
			fixPromptExtra: "",
			generated: false,
		};
	}

	if (isStatic) {
		const memHints = codingMemoryHints(MEMORY_KEY, mem);
		const consolidatePrompt = memHints ? memHints + DEFAULT_CONSOLIDATE_PROMPT : DEFAULT_CONSOLIDATE_PROMPT;
		return {
			taskLabel: "TypeScript rate-limiting middleware with acceptance tests",
			buildTurns: DEFAULT_BUILD_TURNS,
			consolidatePrompt,
			acceptanceTest: DEFAULT_ACCEPTANCE_TEST,
			fixPromptExtra: DEFAULT_FIX_EXTRA,
			generated: false,
		};
	}

	// Generated: fresh challenge each call
	const gen = await generateChallenge(apiKey, hardOnly);
	if (gen) {
		return {
			taskLabel: gen.taskLabel,
			buildTurns: gen.buildTurns,
			consolidatePrompt: gen.consolidatePrompt,
			acceptanceTest: gen.acceptanceTest,
			fixPromptExtra:
				"Re-implement the complete solution satisfying all exports specified in the consolidation prompt.",
			generated: true,
			difficulty: gen.difficulty,
		};
	}
	// Fallback
	return {
		taskLabel: "TypeScript rate-limiting middleware with acceptance tests",
		buildTurns: DEFAULT_BUILD_TURNS,
		consolidatePrompt: DEFAULT_CONSOLIDATE_PROMPT,
		acceptanceTest: DEFAULT_ACCEPTANCE_TEST,
		fixPromptExtra: DEFAULT_FIX_EXTRA,
		generated: false,
	};
}

function printAggregateScorecard(pairs: RunPair[]): void {
	const hasFast = pairs.some((p) => p.fast != null);
	const baselineFirstCount = pairs.filter((p) => p.order === "baseline-first").length;
	const eaFirstCount = pairs.filter((p) => p.order === "ea-first").length;

	const basePassed = pairs.filter((p) => p.baseline.testPassed).length;
	const eaPassed = pairs.filter((p) => p.ea.testPassed).length;
	const totalCacheBase = pairs.reduce((s, p) => s + p.baseline.totalCacheRead, 0);
	const totalCacheEa = pairs.reduce((s, p) => s + p.ea.totalCacheRead, 0);

	// Fast pass/cache counts (all pairs)
	const fastPairs = pairs.filter((p): p is RunPair & { fast: RunStats } => p.fast != null);
	const fastPassed = hasFast ? fastPairs.filter((p) => p.fast.testPassed).length : 0;
	const totalCacheFast = hasFast ? fastPairs.reduce((s, p) => s + p.fast.totalCacheRead, 0) : 0;

	// Only average runs where ALL modes passed (apples-to-apples comparison)
	const allPassed = pairs.filter((p) => {
		if (!p.baseline.testPassed || !p.ea.testPassed) return false;
		if (p.fast && !p.fast.testPassed) return false;
		return true;
	});
	const nPassed = allPassed.length;

	const avgBaseEnergy = nPassed > 0 ? allPassed.reduce((s, p) => s + p.baseline.totalEnergy, 0) / nPassed : 0;
	const avgEaEnergy = nPassed > 0 ? allPassed.reduce((s, p) => s + p.ea.totalEnergy, 0) / nPassed : 0;
	const avgSavedPct =
		nPassed > 0
			? allPassed.reduce((s, p) => {
					const saved =
						p.baseline.totalEnergy > 0
							? ((p.baseline.totalEnergy - p.ea.totalEnergy) / p.baseline.totalEnergy) * 100
							: 0;
					return s + saved;
				}, 0) / nPassed
			: 0;

	const avgBaseCost = nPassed > 0 ? allPassed.reduce((s, p) => s + estimateCost(p.baseline.turns), 0) / nPassed : 0;
	const avgEaCost = nPassed > 0 ? allPassed.reduce((s, p) => s + estimateCost(p.ea.turns), 0) / nPassed : 0;
	const avgCostSavedPct = avgBaseCost > 0 ? ((avgBaseCost - avgEaCost) / avgBaseCost) * 100 : 0;

	// Fast aggregates (only all-passed runs)
	const allPassedFast = allPassed.filter((p): p is RunPair & { fast: RunStats } => p.fast != null);
	const avgFastEnergy =
		hasFast && allPassedFast.length > 0
			? allPassedFast.reduce((s, p) => s + p.fast.totalEnergy, 0) / allPassedFast.length
			: 0;
	const avgFastSavedPct =
		hasFast && allPassedFast.length > 0
			? allPassedFast.reduce((s, p) => {
					const saved =
						p.baseline.totalEnergy > 0
							? ((p.baseline.totalEnergy - p.fast.totalEnergy) / p.baseline.totalEnergy) * 100
							: 0;
					return s + saved;
				}, 0) / allPassedFast.length
			: 0;
	const avgFastCost =
		hasFast && allPassedFast.length > 0
			? allPassedFast.reduce((s, p) => s + estimateCost(p.fast.turns), 0) / allPassedFast.length
			: 0;
	const avgFastCostSavedPct = hasFast && avgBaseCost > 0 ? ((avgBaseCost - avgFastCost) / avgBaseCost) * 100 : 0;

	const taskCol = 32;
	const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
	const tableWidth = hasFast ? 100 : 80;

	console.log(`\n${"═".repeat(tableWidth)}`);
	console.log(
		`  AGGREGATE — ${pairs.length} run${pairs.length !== 1 ? "s" : ""}  (${baselineFirstCount} baseline-first, ${eaFirstCount} ea-first)`,
	);
	console.log(`${"═".repeat(tableWidth)}`);

	if (hasFast) {
		console.log(
			`  ${"#  Task".padEnd(taskCol)}  ${"Order".padEnd(10)}  ${"Baseline".padEnd(10)}  ${"EA".padEnd(10)}  ${"Fast".padEnd(10)}  ${"Saved".padEnd(6)}  Quality`,
		);
		console.log(
			`  ${"─".repeat(taskCol)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(6)}  ───────`,
		);
	} else {
		console.log(
			`  ${"#  Task".padEnd(taskCol)}  ${"Order".padEnd(10)}  ${"Baseline".padEnd(10)}  ${"EA".padEnd(10)}  ${"Saved".padEnd(6)}  Quality`,
		);
		console.log(
			`  ${"─".repeat(taskCol)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(6)}  ───────`,
		);
	}

	for (const p of pairs) {
		const orderLabel = p.order === "baseline-first" ? "base→ea" : "ea→base";
		const savedPct =
			p.baseline.totalEnergy > 0 ? ((p.baseline.totalEnergy - p.ea.totalEnergy) / p.baseline.totalEnergy) * 100 : 0;
		const qualLabel = `${p.baseline.testPassed ? "✓" : "✗"}/${p.ea.testPassed ? "✓" : "✗"}`;
		const taskStr = `${p.runIndex + 1}  ${p.config.taskLabel}`;
		const cacheFlag =
			p.baseline.totalCacheRead + p.ea.totalCacheRead + (p.fast?.totalCacheRead ?? 0) > 0
				? " \x1b[33m[C]\x1b[0m"
				: "";
		if (hasFast) {
			const fastEnergy = p.fast ? `${p.fast.totalEnergy.toFixed(0)}J` : "n/a";
			const qualFast = p.fast ? `/${p.fast.testPassed ? "✓" : "✗"}` : "";
			console.log(
				`  ${pad(taskStr, taskCol)}  ${orderLabel.padEnd(10)}  ${`${p.baseline.totalEnergy.toFixed(0)}J`.padEnd(10)}  ${`${p.ea.totalEnergy.toFixed(0)}J`.padEnd(10)}  ${fastEnergy.padEnd(10)}  ${`${savedPct.toFixed(0)}%`.padEnd(6)}  ${qualLabel}${qualFast}${cacheFlag}`,
			);
		} else {
			console.log(
				`  ${pad(taskStr, taskCol)}  ${orderLabel.padEnd(10)}  ${`${p.baseline.totalEnergy.toFixed(0)}J`.padEnd(10)}  ${`${p.ea.totalEnergy.toFixed(0)}J`.padEnd(10)}  ${`${savedPct.toFixed(0)}%`.padEnd(6)}  ${qualLabel}${cacheFlag}`,
			);
		}
	}

	const avgLabel = nPassed < pairs.length ? `avg (${nPassed}/${pairs.length} all-pass)` : "avg";
	if (hasFast) {
		console.log(
			`  ${"─".repeat(taskCol)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(6)}  ───────`,
		);
		console.log(
			`  ${"passed".padEnd(taskCol)}  ${"".padEnd(10)}  ${"".padEnd(10)}  ${"".padEnd(10)}  ${"".padEnd(10)}  ${"".padEnd(6)}  ${basePassed}/${pairs.length} / ${eaPassed}/${pairs.length} / ${fastPassed}/${fastPairs.length}`,
		);
		if (nPassed > 0) {
			console.log(
				`  ${avgLabel.padEnd(taskCol)}  ${"".padEnd(10)}  ${`${avgBaseEnergy.toFixed(0)}J`.padEnd(10)}  ${`${avgEaEnergy.toFixed(0)}J`.padEnd(10)}  ${`${avgFastEnergy.toFixed(0)}J`.padEnd(10)}  ${`${avgSavedPct.toFixed(0)}%`.padEnd(6)}`,
			);
			console.log(
				`  ${"est. cost".padEnd(taskCol)}  ${"".padEnd(10)}  ${`$${avgBaseCost.toFixed(4)}`.padEnd(10)}  ${`$${avgEaCost.toFixed(4)}`.padEnd(10)}  ${`$${avgFastCost.toFixed(4)}`.padEnd(10)}  ${`${avgCostSavedPct.toFixed(0)}%`.padEnd(6)}`,
			);
		}
	} else {
		console.log(
			`  ${"─".repeat(taskCol)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(6)}  ───────`,
		);
		console.log(
			`  ${"passed".padEnd(taskCol)}  ${"".padEnd(10)}  ${"".padEnd(10)}  ${"".padEnd(10)}  ${"".padEnd(6)}  ${basePassed}/${pairs.length} / ${eaPassed}/${pairs.length}`,
		);
		if (nPassed > 0) {
			console.log(
				`  ${avgLabel.padEnd(taskCol)}  ${"".padEnd(10)}  ${`${avgBaseEnergy.toFixed(0)}J`.padEnd(10)}  ${`${avgEaEnergy.toFixed(0)}J`.padEnd(10)}  ${`${avgSavedPct.toFixed(0)}%`.padEnd(6)}`,
			);
			console.log(
				`  ${"est. cost".padEnd(taskCol)}  ${"".padEnd(10)}  ${`$${avgBaseCost.toFixed(4)}`.padEnd(10)}  ${`$${avgEaCost.toFixed(4)}`.padEnd(10)}  ${`${avgCostSavedPct.toFixed(0)}%`.padEnd(6)}`,
			);
		}
	}

	const totalCacheAll = totalCacheBase + totalCacheEa + totalCacheFast;
	if (totalCacheAll > 0) {
		console.log(`\n  \x1b[33m[C] = cache reads detected — results for those runs may be skewed\x1b[0m`);
		const fastLabel = hasFast ? `, fast=${totalCacheFast} tok` : "";
		console.log(`  Cache reads: baseline=${totalCacheBase} tok, ea=${totalCacheEa} tok${fastLabel} across all runs`);
	}
	console.log(`${"═".repeat(tableWidth)}`);

	if (nPassed === 0) {
		console.log(`\n  \x1b[31mNo runs where all modes passed — no averages to compare.\x1b[0m`);
	} else {
		if (nPassed < pairs.length) {
			const skipped = pairs.length - nPassed;
			console.log(
				`\n  \x1b[33m${skipped} run${skipped !== 1 ? "s" : ""} excluded — only runs where all modes passed acceptance tests are counted in averages.\x1b[0m`,
			);
		}
		if (avgSavedPct > 0) {
			console.log(
				`  \x1b[32m✓ Average energy savings: ${avgSavedPct.toFixed(0)}%, cost savings: ${avgCostSavedPct.toFixed(0)}%\x1b[0m`,
			);
		}
		if (hasFast && avgFastSavedPct > 0) {
			console.log(
				`  \x1b[33m✓ Fast mode avg savings: ${avgFastSavedPct.toFixed(0)}% energy, ${avgFastCostSavedPct.toFixed(0)}% cost\x1b[0m`,
			);
		}
	}
}

// -- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			budget: { type: "string", default: String(DEFAULT_BUDGET_JOULES) },
			task: { type: "string" },
			acceptance: { type: "string" },
			static: { type: "boolean", default: false },
			reverse: { type: "boolean", default: false }, // run EA first in every pair
			runs: { type: "string", default: "1" }, // number of run pairs
			fast: { type: "boolean", default: false }, // add fast mode as 3rd column
			hard: { type: "boolean", default: false }, // force hard difficulty challenges
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

	registerBuiltInApiProviders();

	const apiKey = process.env.NEURALWATT_API_KEY;
	const budgetJ = Number(values.budget);
	const numRuns = Math.max(1, parseInt(values.runs ?? "1", 10));
	const startEaFirst = values.reverse ?? false;
	const enableFast = values.fast ?? false;
	const enableHard = values.hard ?? false;

	const mem = loadMemory();

	// -- Startup banner -------------------------------------------------------
	const memSummary = formatCodingMemory(MEMORY_KEY, mem);
	const phaseRoutingSummary = formatPhaseRouting(MEMORY_KEY, mem);

	const orderDesc =
		numRuns === 1
			? startEaFirst
				? "ea → baseline"
				: "baseline → ea"
			: startEaFirst
				? "alternating (ea-first)"
				: "alternating (baseline-first)";

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║               Coding Agent Energy Challenge                         ║");
	console.log(`║  Model:  ${"Kimi K2.5 (baseline) + GPT-OSS-20B (discriminator)".padEnd(60)}║`);
	console.log(`║  Budget: ${`${budgetJ}J (display)`.padEnd(60)}║`);
	console.log(`║  Runs:   ${`${numRuns}  order: ${orderDesc}`.padEnd(60)}║`);
	if (values.task) {
		console.log(`║  Task:   ${(values.task as string).slice(0, 60).padEnd(60)}║`);
	} else if (values.static) {
		console.log(`║  Task:   ${"hardcoded rate-limiter (--static)".padEnd(60)}║`);
	} else {
		const diffLabel = enableHard
			? "LLM-generated per run (--hard: hard challenges only)"
			: "LLM-generated per run (fresh challenge each time)";
		console.log(`║  Task:   ${diffLabel.padEnd(60)}║`);
	}
	if (enableFast) {
		console.log(`║  Fast:   ${`${FAST_MODEL.name} (speed-optimized 3rd column)`.padEnd(60)}║`);
	}
	console.log("╠══════════════════════════════════════════════════════════════════════╣");
	console.log("║  Flags:  --runs N --reverse --budget N --static --fast --hard       ║");
	console.log("╚══════════════════════════════════════════════════════════════════════╝");

	if (memSummary) {
		console.log(memSummary);
		if (phaseRoutingSummary) console.log(phaseRoutingSummary);
		const numHints = Object.keys(mem.coding[MEMORY_KEY]?.failedTestCounts ?? {}).length;
		if (numHints > 0 && values.static) {
			console.log(
				`  Hints:  ${numHints} learned constraint${numHints !== 1 ? "s" : ""} injected into consolidation prompt`,
			);
		}
	} else {
		console.log("  Memory: No previous runs recorded.");
	}

	// -- Run loop -------------------------------------------------------------
	const pairs: RunPair[] = [];

	for (let i = 0; i < numRuns; i++) {
		const order: "baseline-first" | "ea-first" = (i % 2 === 0) !== startEaFirst ? "baseline-first" : "ea-first";
		const orderArrow = order === "baseline-first" ? "baseline → ea-aware" : "ea-aware → baseline";

		if (numRuns > 1) {
			console.log(`\n${"─".repeat(70)}`);
			console.log(`  Run ${i + 1}/${numRuns}  (${orderArrow})`);
			console.log(`${"─".repeat(70)}`);
		}

		const config = await buildRunConfig(
			values.static ?? false,
			values.task,
			values.acceptance,
			apiKey,
			mem,
			enableHard,
		);

		let baselineStats: RunStats;
		let eaStats: RunStats;
		let fastStats: RunStats | undefined;

		if (order === "baseline-first") {
			baselineStats = await runCodingAgent("baseline", config, mem, apiKey, budgetJ);
			eaStats = await runCodingAgent("energy-aware", config, mem, apiKey, budgetJ);
		} else {
			eaStats = await runCodingAgent("energy-aware", config, mem, apiKey, budgetJ);
			baselineStats = await runCodingAgent("baseline", config, mem, apiKey, budgetJ);
		}

		if (enableFast) {
			fastStats = await runCodingAgent("fast", config, mem, apiKey, budgetJ);
		}

		const runLabel = numRuns > 1 ? `(Run ${i + 1}/${numRuns})` : "";
		printScorecard(baselineStats, eaStats, config, budgetJ, runLabel, fastStats);

		updateCodingMemory(mem, baselineStats, eaStats);
		saveMemory(mem);

		pairs.push({ runIndex: i, order, config, baseline: baselineStats, ea: eaStats, fast: fastStats });
	}

	if (numRuns > 1) {
		printAggregateScorecard(pairs);
	}

	console.log(`\n  Memory saved to ~/.energy-demo-memory.json`);
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
