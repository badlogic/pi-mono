import { describe, expect, it } from "vitest";
import { type RequestBody, transformRequestBody } from "../src/providers/openai-codex/request-transformer.js";
import { parseCodexError } from "../src/providers/openai-codex/response-handler.js";

const DEFAULT_PROMPT_PREFIX =
	"You are an expert coding assistant. You help users with coding tasks by reading files, executing commands";

describe("openai-codex request transformer", () => {
	it("filters item_reference and strips ids", async () => {
		const body: RequestBody = {
			model: "gpt-5.1-codex",
			input: [
				{
					type: "message",
					role: "developer",
					id: "sys-1",
					content: [{ type: "input_text", text: `${DEFAULT_PROMPT_PREFIX}...` }],
				},
				{
					type: "message",
					role: "user",
					id: "user-1",
					content: [{ type: "input_text", text: "hello" }],
				},
				{ type: "item_reference", id: "ref-1" },
				{ type: "function_call_output", call_id: "missing", name: "tool", output: "result" },
			],
			tools: [{ type: "function", name: "tool", description: "", parameters: {} }],
		};

		const transformed = await transformRequestBody(body, {});

		expect(transformed.store).toBe(false);
		expect(transformed.stream).toBe(true);
		expect(transformed.include).toEqual(["reasoning.encrypted_content"]);

		const input = transformed.input || [];
		expect(input.some((item) => item.type === "item_reference")).toBe(false);
		expect(input.some((item) => "id" in item)).toBe(false);
		const first = input[0];
		expect(first?.type).toBe("message");
		expect(first?.role).toBe("developer");
		expect(first?.content).toEqual([{ type: "input_text", text: `${DEFAULT_PROMPT_PREFIX}...` }]);

		const orphaned = input.find((item) => item.type === "message" && item.role === "assistant");
		expect(orphaned?.content).toMatch(/Previous tool result/);
	});
});

describe("openai-codex reasoning effort clamping", () => {
	it("clamps gpt-5.1 xhigh to high", async () => {
		const body: RequestBody = { model: "gpt-5.1", input: [] };
		const transformed = await transformRequestBody(body, { reasoningEffort: "xhigh" });
		expect(transformed.reasoning?.effort).toBe("high");
	});

	it("clamps gpt-5.1-codex-mini to medium/high only", async () => {
		const body: RequestBody = { model: "gpt-5.1-codex-mini", input: [] };

		const low = await transformRequestBody({ ...body }, { reasoningEffort: "low" });
		expect(low.reasoning?.effort).toBe("medium");

		const xhigh = await transformRequestBody({ ...body }, { reasoningEffort: "xhigh" });
		expect(xhigh.reasoning?.effort).toBe("high");
	});
});

describe("openai-codex error parsing", () => {
	it("produces friendly usage-limit messages and rate limits", async () => {
		const resetAt = Math.floor(Date.now() / 1000) + 600;
		const response = new Response(
			JSON.stringify({
				error: { code: "usage_limit_reached", plan_type: "Plus", resets_at: resetAt },
			}),
			{
				status: 429,
				headers: {
					"x-codex-primary-used-percent": "99",
					"x-codex-primary-window-minutes": "60",
					"x-codex-primary-reset-at": String(resetAt),
				},
			},
		);

		const info = await parseCodexError(response);
		expect(info.friendlyMessage?.toLowerCase()).toContain("usage limit");
		expect(info.rateLimits?.primary?.used_percent).toBe(99);
	});
});
