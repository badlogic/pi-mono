import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels } from "../src/cli/list-models.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("listModels", () => {
	it("reports video input capability", async () => {
		const model: Model<"openai-completions"> = {
			id: "video-model",
			name: "Video Model",
			api: "openai-completions",
			provider: "local",
			baseUrl: "http://127.0.0.1:8080/v1",
			reasoning: false,
			input: ["text", "image", "video"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const modelRuntime = {
			getError: () => undefined,
			getAvailable: async () => [model],
		};
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await listModels(modelRuntime);

		expect(log.mock.calls).toEqual([[expect.stringMatching(/\bvideos\b/)], [expect.stringMatching(/\byes\s*$/)]]);
	});
});
