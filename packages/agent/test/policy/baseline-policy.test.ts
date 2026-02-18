import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../../src/agent-loop.js";
import { BaselinePolicy } from "../../src/policy/baseline-policy.js";
import type { PolicyContext, UsageWithEnergy } from "../../src/policy/types.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../../src/types.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 100,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 150,
		cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
	};
}

function createModel(): Model<"openai-completions"> {
	return {
		id: "mock-model",
		name: "Mock Model",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "openai",
		model: "mock-model",
		usage: createUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function createPolicyContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		turnNumber: 1,
		model: createModel(),
		availableModels: [],
		budget: {},
		consumedEnergy: 0,
		consumedTime: 0,
		messageCount: 1,
		estimatedInputTokens: 0,
		...overrides,
	};
}

describe("BaselinePolicy", () => {
	it("should have name 'baseline'", () => {
		const policy = new BaselinePolicy();
		expect(policy.name).toBe("baseline");
	});

	it("should return empty PolicyDecision from beforeModelCall", () => {
		const policy = new BaselinePolicy();
		const ctx = createPolicyContext();
		const decision = policy.beforeModelCall(ctx);

		expect(decision).toEqual({});
		expect(decision.model).toBeUndefined();
		expect(decision.maxTokens).toBeUndefined();
		expect(decision.reasoning).toBeUndefined();
		expect(decision.shouldCompact).toBeUndefined();
		expect(decision.abort).toBeUndefined();
		expect(decision.reason).toBeUndefined();
	});

	it("should log telemetry on afterModelCall", () => {
		const policy = new BaselinePolicy();
		const ctx = createPolicyContext({ turnNumber: 1, consumedEnergy: 1.5 });
		const usage: UsageWithEnergy = {
			input: 100,
			output: 50,
			totalTokens: 150,
			cost: { total: 0.003 },
			energy_joules: 1.5,
			energy_kwh: 0.0000004,
		};

		policy.afterModelCall(ctx, usage);

		expect(policy.log).toHaveLength(1);
		expect(policy.log[0].usage.energy_joules).toBe(1.5);
		expect(policy.log[0].ctx.turnNumber).toBe(1);
	});

	it("should accumulate multiple afterModelCall entries", () => {
		const policy = new BaselinePolicy();

		for (let i = 0; i < 5; i++) {
			policy.afterModelCall(createPolicyContext({ turnNumber: i + 1 }), {
				input: 100,
				output: 50,
				totalTokens: 150,
				cost: { total: 0.003 },
			});
		}

		expect(policy.log).toHaveLength(5);
		expect(policy.log[4].ctx.turnNumber).toBe(5);
	});

	it("should never override model parameters regardless of budget pressure", () => {
		const policy = new BaselinePolicy();

		// Simulate high budget pressure
		const ctx = createPolicyContext({
			consumedEnergy: 99,
			budget: { energy_budget_joules: 100 },
		});

		const decision = policy.beforeModelCall(ctx);
		expect(decision).toEqual({});
	});

	it("should produce identical results to no-policy execution", async () => {
		const model = createModel();
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: createAssistantMessage("response") });
			});
			return stream;
		};

		// Run without policy
		const noPolicyConfig: AgentLoopConfig = { model, convertToLlm: identityConverter };
		const noPolicyContext: AgentContext = { ...context, messages: [] };
		const noPolicyStream = agentLoop([createUserMessage("hi")], noPolicyContext, noPolicyConfig, undefined, streamFn);
		const noPolicyEvents: AgentEvent[] = [];
		for await (const e of noPolicyStream) {
			noPolicyEvents.push(e);
		}
		const noPolicyMessages = await noPolicyStream.result();

		// Run with BaselinePolicy
		const baselineConfig: AgentLoopConfig = {
			model,
			convertToLlm: identityConverter,
			policy: new BaselinePolicy(),
		};
		const baselineContext: AgentContext = { ...context, messages: [] };
		const baselineStream = agentLoop([createUserMessage("hi")], baselineContext, baselineConfig, undefined, streamFn);
		const baselineEvents: AgentEvent[] = [];
		for await (const e of baselineStream) {
			baselineEvents.push(e);
		}
		const baselineMessages = await baselineStream.result();

		// Same event types
		expect(noPolicyEvents.map((e) => e.type)).toEqual(baselineEvents.map((e) => e.type));

		// Same number and roles of messages
		expect(noPolicyMessages.length).toBe(baselineMessages.length);
		expect(noPolicyMessages.map((m) => m.role)).toEqual(baselineMessages.map((m) => m.role));
	});

	it("should handle missing energy data gracefully", () => {
		const policy = new BaselinePolicy();
		const usage: UsageWithEnergy = {
			input: 100,
			output: 50,
			totalTokens: 150,
			cost: { total: 0.003 },
		};

		policy.afterModelCall(createPolicyContext(), usage);

		expect(policy.log).toHaveLength(1);
		expect(policy.log[0].usage.energy_joules).toBeUndefined();
		expect(policy.log[0].usage.energy_kwh).toBeUndefined();
	});
});
