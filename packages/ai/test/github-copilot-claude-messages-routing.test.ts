import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";

describe("Copilot Claude model routing", () => {
	it("routes claude-sonnet-4 via anthropic-messages API", () => {
		const model = getModel("github-copilot", "claude-sonnet-4");
		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
	});

	it("routes claude-sonnet-4.5 via anthropic-messages API", () => {
		const model = getModel("github-copilot", "claude-sonnet-4.5");
		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
	});

	it("routes claude-haiku-4.5 via anthropic-messages API", () => {
		const model = getModel("github-copilot", "claude-haiku-4.5");
		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
	});

	it("routes claude-opus-4.5 via anthropic-messages API", () => {
		const model = getModel("github-copilot", "claude-opus-4.5");
		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
	});

	it("does not have compat block on Claude models (completions-API-specific)", () => {
		const sonnet = getModel("github-copilot", "claude-sonnet-4");
		expect((sonnet as any).compat).toBeUndefined();
	});

	it("preserves static Copilot headers on Claude models", () => {
		const model = getModel("github-copilot", "claude-sonnet-4");
		expect(model.headers).toBeDefined();
		expect(model.headers!["User-Agent"]).toContain("GitHubCopilotChat");
		expect(model.headers!["Copilot-Integration-Id"]).toBe("vscode-chat");
	});

	it("keeps non-Claude Copilot models on their existing APIs", () => {
		// Spot-check: gpt-4o should stay on openai-completions
		const gpt4o = getModel("github-copilot", "gpt-4o");
		expect(gpt4o).toBeDefined();
		expect(gpt4o.api).toBe("openai-completions");

		// Spot-check: gpt-5 should stay on openai-responses
		const gpt5 = getModel("github-copilot", "gpt-5");
		expect(gpt5).toBeDefined();
		expect(gpt5.api).toBe("openai-responses");
	});
});
