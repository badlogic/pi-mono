import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../../src/agent-loop.js";
import type { PolicyContext, PolicyDecision, RuntimePolicy, UsageWithEnergy } from "../../src/policy/types.js";
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

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "mock-model",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function createMockPolicy(overrides?: Partial<RuntimePolicy>): RuntimePolicy & {
	beforeCalls: PolicyContext[];
	afterCalls: Array<{ ctx: PolicyContext; usage: UsageWithEnergy }>;
	decisions: PolicyDecision[];
} {
	const beforeCalls: PolicyContext[] = [];
	const afterCalls: Array<{ ctx: PolicyContext; usage: UsageWithEnergy }> = [];
	const decisions: PolicyDecision[] = [];

	return {
		name: "test-policy",
		beforeModelCall(ctx: PolicyContext): PolicyDecision {
			beforeCalls.push({ ...ctx });
			const decision = overrides?.beforeModelCall?.(ctx) ?? {};
			decisions.push(decision);
			return decision;
		},
		afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void {
			afterCalls.push({ ctx: { ...ctx }, usage: { ...usage } });
			overrides?.afterModelCall?.(ctx, usage);
		},
		beforeCalls,
		afterCalls,
		decisions,
	};
}

describe("Policy hooks integration", () => {
	it("should call beforeModelCall and afterModelCall on each turn", async () => {
		const policy = createMockPolicy();
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		expect(policy.beforeCalls).toHaveLength(1);
		expect(policy.afterCalls).toHaveLength(1);
		expect(policy.beforeCalls[0].turnNumber).toBe(1);
		expect(policy.afterCalls[0].usage.totalTokens).toBe(150);
	});

	it("should not call policy hooks when no policy is set", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		const events: AgentEvent[] = [];
		for await (const e of s) {
			events.push(e);
		}

		// Should complete normally without errors
		expect(events.some((e) => e.type === "agent_end")).toBe(true);
	});

	it("should abort when policy sets abort=true", async () => {
		const policy = createMockPolicy({
			name: "abort-policy",
			beforeModelCall: () => ({ abort: true, reason: "Budget exceeded" }),
			afterModelCall: () => {},
		});

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
		};

		const streamFnSpy = vi.fn();
		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFnSpy);
		const events: AgentEvent[] = [];
		for await (const e of s) {
			events.push(e);
		}

		// streamFn should never be called since policy aborted before model call
		expect(streamFnSpy).not.toHaveBeenCalled();

		// Should have agent_end with the abort message
		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();

		const messages = await s.result();
		const abortMsg = messages.find((m) => m.role === "assistant") as AssistantMessage;
		expect(abortMsg).toBeDefined();
		expect(abortMsg.stopReason).toBe("aborted");
		expect(abortMsg.content[0]).toEqual({ type: "text", text: "Budget exceeded" });
	});

	it("should apply model override from policy decision", async () => {
		const cheapModel = createModel();
		cheapModel.id = "cheap-model";
		cheapModel.name = "Cheap Model";

		const policy = createMockPolicy({
			name: "route-policy",
			beforeModelCall: () => ({ model: cheapModel }),
			afterModelCall: () => {},
		});

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
		};

		let calledWithModel: string | undefined;
		const streamFn = (model: Model<any>) => {
			calledWithModel = model.id;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		expect(calledWithModel).toBe("cheap-model");
	});

	it("should apply maxTokens and reasoning overrides from policy decision", async () => {
		const policy = createMockPolicy({
			name: "throttle-policy",
			beforeModelCall: () => ({ maxTokens: 512, reasoning: "low" }),
			afterModelCall: () => {},
		});

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
			maxTokens: 2048,
			reasoning: "high",
		};

		let capturedOptions: Record<string, unknown> = {};
		const streamFn = (_model: Model<any>, _ctx: any, options: any) => {
			capturedOptions = options;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		expect(capturedOptions.maxTokens).toBe(512);
		expect(capturedOptions.reasoning).toBe("low");
	});

	it("should track energy consumption across turns", async () => {
		const energyPerCall = 1.5;
		const policy = createMockPolicy();

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
			getFollowUpMessages: (() => {
				let called = false;
				return async () => {
					if (!called) {
						called = true;
						return [createUserMessage("follow up")];
					}
					return [];
				};
			})(),
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const msg = createAssistantMessage([{ type: "text", text: "ok" }]);
				(msg as any).energy = { energy_joules: energyPerCall, energy_kwh: 0.0000004 };
				stream.push({ type: "done", reason: "stop", message: msg });
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		// Two turns (initial + follow-up)
		expect(policy.beforeCalls).toHaveLength(2);
		expect(policy.afterCalls).toHaveLength(2);

		// Second beforeModelCall should see accumulated energy from first call
		expect(policy.beforeCalls[1].consumedEnergy).toBe(energyPerCall);

		// After both calls, total energy should be 2x
		expect(policy.afterCalls[1].ctx.consumedEnergy).toBe(energyPerCall * 2);
	});

	it("should track estimatedInputTokens from previous response", async () => {
		const policy = createMockPolicy();

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
			getFollowUpMessages: (() => {
				let called = false;
				return async () => {
					if (!called) {
						called = true;
						return [createUserMessage("follow up")];
					}
					return [];
				};
			})(),
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		// First call should have 0 estimated tokens
		expect(policy.beforeCalls[0].estimatedInputTokens).toBe(0);

		// Second call should reflect the totalTokens from the first response (150)
		expect(policy.beforeCalls[1].estimatedInputTokens).toBe(150);
	});

	it("should increment turnNumber across calls", async () => {
		const policy = createMockPolicy();

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
			getFollowUpMessages: (() => {
				let called = false;
				return async () => {
					if (!called) {
						called = true;
						return [createUserMessage("follow up")];
					}
					return [];
				};
			})(),
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		expect(policy.beforeCalls[0].turnNumber).toBe(1);
		expect(policy.beforeCalls[1].turnNumber).toBe(2);
	});

	it("should pass messageCount correctly", async () => {
		const policy = createMockPolicy();

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			policy,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "ok" }]),
				});
			});
			return stream;
		};

		const s = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of s) {
			/* consume */
		}

		// At before call: context has the user prompt (1 message)
		expect(policy.beforeCalls[0].messageCount).toBe(1);
	});
});
