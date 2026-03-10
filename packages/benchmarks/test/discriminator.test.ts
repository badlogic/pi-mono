import type { Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { type DiscriminatorConfig, discriminate } from "../src/demos/demo-discriminator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockModel(id: string, name: string, capabilities: string[] = []): Model<"openai-completions"> {
	return {
		id,
		name,
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_384,
		maxTokens: 4_096,
		capabilities,
	} as Model<"openai-completions">;
}

/** Full 4-tier config: simple has NO tool_calling; medium/complex/thinking do. */
function fullConfig(): DiscriminatorConfig {
	return {
		classifierModel: mockModel("classifier", "Classifier"),
		thinking: { model: mockModel("thinking-model", "Thinking", ["tool_calling", "reasoning"]) },
		complex: { model: mockModel("complex-model", "Complex", ["tool_calling"]) },
		medium: { model: mockModel("medium-model", "Medium", ["tool_calling"]), briefMaxTokens: 4_096 },
		simple: { model: mockModel("simple-model", "Simple", []), briefMaxTokens: 2_048 },
		tokensPerJoule: { classifier: 1.0 },
	};
}

/** Minimal 2-tier config (no thinking/medium). */
function minimalConfig(): DiscriminatorConfig {
	return {
		classifierModel: mockModel("classifier", "Classifier"),
		complex: { model: mockModel("complex-model", "Complex", ["tool_calling"]) },
		simple: { model: mockModel("simple-model", "Simple", []) },
		tokensPerJoule: {},
	};
}

// ─── Mock pi-ai ───────────────────────────────────────────────────────────────

vi.mock("@mariozechner/pi-ai", () => ({
	completeSimple: vi.fn(),
}));

import { completeSimple } from "@mariozechner/pi-ai";

function mockClassifierResponse(tier: string, length = "full", reason = "test") {
	(completeSimple as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
		content: [{ type: "text", text: JSON.stringify({ tier, length, reason }) }],
		usage: {
			totalTokens: 20,
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		energy: { energy_joules: 0.01 },
	});
}

function mockClassifierError() {
	(completeSimple as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("classifier down"));
}

// ─── Basic backward compatibility (no requires) ──────────────────────────────

describe("discriminate — backward compatibility", () => {
	it("routes simple tier without options parameter", async () => {
		mockClassifierResponse("simple");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});

	it("routes medium tier without options parameter", async () => {
		mockClassifierResponse("medium");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("routes complex tier without options parameter", async () => {
		mockClassifierResponse("complex");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("routes thinking tier without options parameter", async () => {
		mockClassifierResponse("thinking");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("thinking");
		expect(result.model.id).toBe("thinking-model");
	});

	it("falls back to complex on classifier error", async () => {
		mockClassifierError();
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
		expect(result.reason).toContain("fallback");
		expect(result.energyJ).toBe(0);
	});

	it("falls back to complex for invalid tier string", async () => {
		mockClassifierResponse("nonexistent");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("complex");
	});

	it("applies briefMaxTokens when classifier returns brief", async () => {
		mockClassifierResponse("medium", "brief");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.tier).toBe("medium");
		expect(result.maxTokens).toBe(4_096);
	});

	it("does not cap maxTokens when classifier returns full", async () => {
		mockClassifierResponse("medium", "full");
		const result = await discriminate("test", "hello", fullConfig(), "", "key");
		expect(result.maxTokens).toBeUndefined();
	});
});

// ─── Tier fallback when optional tiers missing (no requires) ────────────────

describe("discriminate — tier fallback (no requires)", () => {
	it("thinking falls back to complex when thinking not configured", async () => {
		mockClassifierResponse("thinking");
		const result = await discriminate("test", "hello", minimalConfig(), "", "key");
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("medium falls back to simple when medium not configured", async () => {
		mockClassifierResponse("medium");
		const result = await discriminate("test", "hello", minimalConfig(), "", "key");
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});
});

// ─── Capability-based routing (requires: ["tool_calling"]) ───────────────────

describe("discriminate — requires: tool_calling", () => {
	it("keeps tier when model already has tool_calling", async () => {
		mockClassifierResponse("complex");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("skips simple → falls back to medium when simple lacks tool_calling", async () => {
		mockClassifierResponse("simple");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		// simple fallback chain: medium → complex → thinking
		expect(result.model.id).toBe("medium-model");
		expect(result.model.capabilities).toContain("tool_calling");
	});

	it("keeps thinking tier when it has tool_calling", async () => {
		mockClassifierResponse("thinking");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.tier).toBe("thinking");
		expect(result.model.id).toBe("thinking-model");
	});

	it("falls back to complex (safe default) when no tier has capability", async () => {
		mockClassifierResponse("simple");
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			complex: { model: mockModel("complex-model", "Complex", []) },
			simple: { model: mockModel("simple-model", "Simple", []) },
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		// Falls through entire chain, lands on complex as safe default
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("works with empty requires array (same as no requires)", async () => {
		mockClassifierResponse("simple");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: [],
		});
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});
});

// ─── Multiple capability requirements ────────────────────────────────────────

describe("discriminate — multiple requires", () => {
	it("selects model that has all required capabilities", async () => {
		mockClassifierResponse("medium");
		// medium has only tool_calling, thinking has tool_calling + reasoning
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: ["tool_calling", "reasoning"],
		});
		// medium lacks reasoning → fallback: simple (no caps) → complex (no reasoning) → thinking (has both)
		expect(result.model.id).toBe("thinking-model");
		expect(result.model.capabilities).toContain("tool_calling");
		expect(result.model.capabilities).toContain("reasoning");
	});

	it("falls back when no model has all capabilities", async () => {
		mockClassifierResponse("simple");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", {
			requires: ["tool_calling", "vision"],
		});
		// No model has vision → falls back to complex as safe default
		expect(result.tier).toBe("complex");
	});
});

// ─── Fallback chain per tier ─────────────────────────────────────────────────

describe("discriminate — fallback chain ordering", () => {
	it("simple fallback order: medium → complex → thinking", async () => {
		mockClassifierResponse("simple");
		// Only thinking has tool_calling
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			thinking: { model: mockModel("thinking-model", "Thinking", ["tool_calling"]) },
			complex: { model: mockModel("complex-model", "Complex", []) },
			medium: { model: mockModel("medium-model", "Medium", []) },
			simple: { model: mockModel("simple-model", "Simple", []) },
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.model.id).toBe("thinking-model");
	});

	it("complex fallback order: medium → simple → thinking", async () => {
		mockClassifierResponse("complex");
		// Only simple has tool_calling (unusual but tests the chain)
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			thinking: { model: mockModel("thinking-model", "Thinking", []) },
			complex: { model: mockModel("complex-model", "Complex", []) },
			medium: { model: mockModel("medium-model", "Medium", []) },
			simple: { model: mockModel("simple-model", "Simple", ["tool_calling"]) },
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		// complex chain: medium (no) → simple (yes!)
		expect(result.model.id).toBe("simple-model");
	});

	it("medium fallback order: simple → complex → thinking", async () => {
		mockClassifierResponse("medium");
		// Only complex has tool_calling
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			thinking: { model: mockModel("thinking-model", "Thinking", []) },
			complex: { model: mockModel("complex-model", "Complex", ["tool_calling"]) },
			medium: { model: mockModel("medium-model", "Medium", []) },
			simple: { model: mockModel("simple-model", "Simple", []) },
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		// medium chain: simple (no) → complex (yes!)
		expect(result.model.id).toBe("complex-model");
	});

	it("thinking fallback order: complex → medium → simple", async () => {
		mockClassifierResponse("thinking");
		// Only medium has tool_calling
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			thinking: { model: mockModel("thinking-model", "Thinking", []) },
			complex: { model: mockModel("complex-model", "Complex", []) },
			medium: { model: mockModel("medium-model", "Medium", ["tool_calling"]) },
			simple: { model: mockModel("simple-model", "Simple", []) },
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		// thinking chain: complex (no) → medium (yes!)
		expect(result.model.id).toBe("medium-model");
	});
});

// ─── Model with undefined capabilities ───────────────────────────────────────

describe("discriminate — models without capabilities field", () => {
	it("treats undefined capabilities as empty array", async () => {
		mockClassifierResponse("simple");
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			complex: {
				model: { ...mockModel("complex-model", "Complex"), capabilities: undefined } as Model<"openai-completions">,
			},
			simple: {
				model: { ...mockModel("simple-model", "Simple"), capabilities: undefined } as Model<"openai-completions">,
			},
			tokensPerJoule: {},
		};
		// Without requires, undefined capabilities should work fine
		const result = await discriminate("test", "hello", config, "", "key");
		expect(result.model.id).toBe("simple-model");
	});

	it("skips models with undefined capabilities when requires is set", async () => {
		mockClassifierResponse("simple");
		const config: DiscriminatorConfig = {
			classifierModel: mockModel("classifier", "Classifier"),
			complex: { model: mockModel("complex-model", "Complex", ["tool_calling"]) },
			simple: {
				model: { ...mockModel("simple-model", "Simple"), capabilities: undefined } as Model<"openai-completions">,
			},
			tokensPerJoule: {},
		};
		const result = await discriminate("test", "hello", config, "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.model.id).toBe("complex-model");
	});
});

// ─── maxTier clamping ────────────────────────────────────────────────────────

describe("discriminate — maxTier", () => {
	it("clamps thinking → medium when maxTier is medium", async () => {
		mockClassifierResponse("thinking", "full", "needs debugging");
		const result = await discriminate("fix-1", "tests failed", fullConfig(), "", "key", { maxTier: "medium" });
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("clamps complex → medium when maxTier is medium", async () => {
		mockClassifierResponse("complex", "full", "complex task");
		const result = await discriminate("consolidate", "merge code", fullConfig(), "", "key", { maxTier: "medium" });
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("allows medium when maxTier is medium", async () => {
		mockClassifierResponse("medium", "full", "standard impl");
		const result = await discriminate("fix-1", "tests failed", fullConfig(), "", "key", { maxTier: "medium" });
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("allows simple when maxTier is medium", async () => {
		mockClassifierResponse("simple", "full", "boilerplate");
		const result = await discriminate("fix-1", "tests failed", fullConfig(), "", "key", { maxTier: "medium" });
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});

	it("clamps thinking → simple when maxTier is simple", async () => {
		mockClassifierResponse("thinking", "full", "debugging");
		const result = await discriminate("test", "hello", fullConfig(), "", "key", { maxTier: "simple" });
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});

	it("combines maxTier with requires — clamp then fallback", async () => {
		mockClassifierResponse("thinking", "full", "needs debugging");
		// maxTier=medium clamps to medium; medium has tool_calling so it stays
		const result = await discriminate("fix-1", "tests failed", fullConfig(), "", "key", {
			maxTier: "medium",
			requires: ["tool_calling"],
		});
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("no maxTier does not clamp", async () => {
		mockClassifierResponse("thinking", "full", "needs debugging");
		const result = await discriminate("fix-1", "tests failed", fullConfig(), "", "key");
		expect(result.tier).toBe("thinking");
		expect(result.model.id).toBe("thinking-model");
	});
});

// ─── minTier clamping ────────────────────────────────────────────────────────

describe("discriminate — minTier", () => {
	it("raises simple → medium when minTier is medium", async () => {
		mockClassifierResponse("simple", "full", "boilerplate");
		const result = await discriminate("fix-3", "tests failed", fullConfig(), "", "key", { minTier: "medium" });
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("raises simple → complex when minTier is complex", async () => {
		mockClassifierResponse("simple", "full", "boilerplate");
		const result = await discriminate("fix-3", "tests failed", fullConfig(), "", "key", { minTier: "complex" });
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("does not raise complex when minTier is medium", async () => {
		mockClassifierResponse("complex", "full", "hard task");
		const result = await discriminate("fix-3", "tests failed", fullConfig(), "", "key", { minTier: "medium" });
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("maxTier wins when minTier > maxTier", async () => {
		mockClassifierResponse("simple", "full", "boilerplate");
		const result = await discriminate("fix-3", "tests failed", fullConfig(), "", "key", {
			minTier: "complex",
			maxTier: "medium",
		});
		// maxTier=medium should take precedence over minTier=complex
		expect(result.tier).toBe("medium");
		expect(result.model.id).toBe("medium-model");
	});

	it("no minTier does not raise", async () => {
		mockClassifierResponse("simple", "full", "boilerplate");
		const result = await discriminate("fix-3", "tests failed", fullConfig(), "", "key");
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
	});
});

// ─── Fugue-specific scenario: tool_calling routing ───────────────────────────

describe("discriminate — Fugue tool_calling scenario", () => {
	/** Mirrors FUGUE_DISCRIMINATOR_CONFIG from model-config.ts */
	function fugueConfig(): DiscriminatorConfig {
		return {
			classifierModel: mockModel("openai/gpt-oss-20b", "GPT-OSS 20B", []),
			thinking: { model: mockModel("moonshotai/Kimi-K2.5", "Kimi K2.5", ["tool_calling"]) },
			complex: { model: mockModel("Qwen/Qwen3.5-397B-A17B-FP8", "Qwen3.5 397B", ["tool_calling"]) },
			medium: {
				model: mockModel("mistralai/Devstral-Small-2-24B-Instruct-2512", "Devstral 24B", ["tool_calling"]),
				briefMaxTokens: 4_096,
			},
			simple: { model: mockModel("openai/gpt-oss-20b", "GPT-OSS 20B", []), briefMaxTokens: 2_048 },
			tokensPerJoule: {
				"openai/gpt-oss-20b": 0.5,
				"mistralai/Devstral-Small-2-24B-Instruct-2512": 9.92,
				"moonshotai/Kimi-K2.5": 0.21,
				"Qwen/Qwen3.5-397B-A17B-FP8": 1.03,
			},
		};
	}

	it("classifier says simple → GPT-OSS lacks tool_calling → routes to Devstral", async () => {
		mockClassifierResponse("simple", "full", "straightforward research");
		const result = await discriminate("fugue-agent", "Research sorting algorithms", fugueConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.model.name).toBe("Devstral 24B");
		expect(result.model.id).toBe("mistralai/Devstral-Small-2-24B-Instruct-2512");
	});

	it("classifier says complex → Qwen3 has tool_calling → uses Qwen3 directly", async () => {
		mockClassifierResponse("complex", "full", "needs deep analysis");
		const result = await discriminate(
			"fugue-agent",
			"Debug the memory leak in agent loop",
			fugueConfig(),
			"",
			"key",
			{
				requires: ["tool_calling"],
			},
		);
		expect(result.model.name).toBe("Qwen3.5 397B");
	});

	it("classifier says medium → Devstral has tool_calling → uses Devstral directly", async () => {
		mockClassifierResponse("medium", "full", "moderate task");
		const result = await discriminate("fugue-agent", "List competition entries", fugueConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.model.name).toBe("Devstral 24B");
	});

	it("classifier says thinking → Kimi has tool_calling → uses Kimi directly", async () => {
		mockClassifierResponse("thinking", "full", "needs chain-of-thought");
		const result = await discriminate("fugue-agent", "Debug why edges are missing", fugueConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		expect(result.model.name).toBe("Kimi K2.5");
	});

	it("classifier error → falls back to Qwen3 (complex default)", async () => {
		mockClassifierError();
		const result = await discriminate("fugue-agent", "anything", fugueConfig(), "", "key", {
			requires: ["tool_calling"],
		});
		// Error path doesn't apply requires — goes straight to complex model
		expect(result.model.name).toBe("Qwen3.5 397B");
	});
});
