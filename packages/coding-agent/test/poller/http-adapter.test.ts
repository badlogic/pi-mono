import { describe, expect, it, vi } from "vitest";
import { HttpAdapter } from "../../src/poller/db/http-adapter.js";
import type { HttpBackendConfig, Logger } from "../../src/poller/types.js";

function makeLogger(): Logger & {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
} {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function makeConfig(): HttpBackendConfig {
	return {
		baseUrl: "http://example.test",
		timeoutMs: 1234,
	};
}

describe("HttpAdapter", () => {
	it("wraps AbortError as timeout error", async () => {
		const logger = makeLogger();
		const cfg = makeConfig();

		const abortError = new Error("Aborted");
		abortError.name = "AbortError";

		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

		const adapter = new HttpAdapter(cfg, logger);

		await expect(adapter.fetchQueued("agent", 5)).rejects.toThrow(
			"[poller] HTTP request timeout after 1234ms: http://example.test/messages/queued?agentId=agent&limit=5",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockRestore();
	});

	it("includes status text from non-OK responses", async () => {
		const logger = makeLogger();
		const cfg = makeConfig();

		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: async () => "Server went boom",
		} as unknown as Response);

		const adapter = new HttpAdapter(cfg, logger);

		await expect(adapter.fetchQueued("agent", 5)).rejects.toThrow("HTTP 500: Server went boom");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		fetchMock.mockRestore();
	});

	it("constructs queued URL with agentId and limit", async () => {
		const logger = makeLogger();
		const cfg = makeConfig();

		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
			async (_url: RequestInfo | URL) =>
				({
					ok: true,
					json: async () => [],
				}) as unknown as Response,
		);

		const adapter = new HttpAdapter(cfg, logger);
		await adapter.fetchQueued("test-agent", 10);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledWith = fetchMock.mock.calls[0]?.[0] as string;
		expect(calledWith).toContain("/messages/queued");
		expect(calledWith).toContain("agentId=test-agent");
		expect(calledWith).toContain("limit=10");

		fetchMock.mockRestore();
	});
});
