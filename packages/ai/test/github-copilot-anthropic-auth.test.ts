import { describe, expect, it } from "vitest";
import { buildAnthropicClientOptions } from "../src/providers/anthropic.js";
import type { Model } from "../src/types.js";

const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
};

function makeCopilotClaudeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		headers: { ...COPILOT_HEADERS },
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

describe("Anthropic Copilot auth config", () => {
	it("uses apiKey: null and Authorization Bearer for Copilot models", () => {
		const model = makeCopilotClaudeModel();
		const token = "ghu_test_token_12345";
		const options = buildAnthropicClientOptions({
			model,
			apiKey: token,
			interleavedThinking: true,
			dynamicHeaders: {
				"X-Initiator": "user",
				"Openai-Intent": "conversation-edits",
			},
		});

		expect(options.apiKey).toBeNull();
		expect(options.defaultHeaders?.["Authorization"]).toBe(`Bearer ${token}`);
	});

	it("includes Copilot static headers from model.headers", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			interleavedThinking: false,
			dynamicHeaders: {},
		});

		expect(options.defaultHeaders?.["User-Agent"]).toContain("GitHubCopilotChat");
		expect(options.defaultHeaders?.["Copilot-Integration-Id"]).toBe("vscode-chat");
	});

	it("includes interleaved-thinking beta header when enabled", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			interleavedThinking: true,
			dynamicHeaders: {},
		});

		const beta = options.defaultHeaders?.["anthropic-beta"];
		expect(beta).toBeDefined();
		expect(beta).toContain("interleaved-thinking-2025-05-14");
	});

	it("does not include interleaved-thinking beta when disabled", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			interleavedThinking: false,
			dynamicHeaders: {},
		});

		const beta = options.defaultHeaders?.["anthropic-beta"];
		if (beta) {
			expect(beta).not.toContain("interleaved-thinking-2025-05-14");
		}
	});

	it("does not include fine-grained-tool-streaming beta for Copilot", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			interleavedThinking: true,
			dynamicHeaders: {},
		});

		const beta = options.defaultHeaders?.["anthropic-beta"];
		if (beta) {
			expect(beta).not.toContain("fine-grained-tool-streaming");
		}
	});

	it("does not set isOAuthToken for Copilot models", () => {
		const model = makeCopilotClaudeModel();
		const result = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			interleavedThinking: true,
			dynamicHeaders: {},
		});

		expect(result.isOAuthToken).toBe(false);
	});
});
