import { describe, expect, it } from "vitest";
import { extractBashCommand, restoreGuardrailState, toPlanText } from "../src/extensions/product-extension.js";

describe("product extension helpers", () => {
	it("extracts bash command from bash tool call", () => {
		const command = extractBashCommand({
			toolName: "bash",
			input: { command: "npm test" },
		});
		expect(command).toBe("npm test");
	});

	it("restores guardrail state from custom session entries", () => {
		const state = restoreGuardrailState([
			{ type: "custom", customType: "agent-service-guardrail", data: { blockedCount: 1, lastBlockedCommand: "rm" } },
			{ type: "custom", customType: "agent-service-guardrail", data: { blockedCount: 2, lastBlockedCommand: "mv" } },
		]);
		expect(state.blockedCount).toBe(2);
		expect(state.lastBlockedCommand).toBe("mv");
	});

	it("builds deterministic plan message text", () => {
		const timestamp = Date.UTC(2026, 1, 24, 10, 0, 0);
		const text = toPlanText("build API", timestamp);
		expect(text).toContain("build API");
		expect(text).toContain("2026-02-24T10:00:00.000Z");
	});
});
