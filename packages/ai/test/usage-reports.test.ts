import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";

vi.mock("../src/providers/anthropic.models.ts", () => ({ ANTHROPIC_MODELS: {} }));

const { anthropicProvider } = await import("../src/providers/anthropic.ts");

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function createAnthropicModels() {
	const credentials = new InMemoryCredentialStore();
	const models = createModels({ credentials });
	models.setProvider(anthropicProvider());
	return { credentials, models };
}

describe.sequential("Models.getUsageReport", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("normalizes Anthropic's five-hour OAuth window", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				five_hour: { utilization: 42.5, resets_at: "2026-09-08T18:00:00Z" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		const observedAt = Date.now();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: observedAt + 10 * 60_000,
		}));

		await expect(models.getUsageReport("anthropic")).resolves.toEqual({
			windows: [
				{
					duration: 5 * 60 * 60_000,
					used: 0.425,
					observedAt,
					resetsAt: Date.parse("2026-09-08T18:00:00Z"),
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.anthropic.com/api/oauth/usage",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-access-token",
					"anthropic-beta": "oauth-2025-04-20",
					"User-Agent": "claude-cli/2.1.251",
				}),
			}),
		);
	});

	it("reuses a report for five minutes without sharing it between OAuth accounts", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 10, resets_at: "2026-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 20, resets_at: "2026-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 30, resets_at: "2026-09-08T18:00:00Z" } }));
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "first-account",
			refresh: "refresh-token",
			expires: Date.now() + 20 * 60_000,
		}));

		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.1);
		vi.advanceTimersByTime(4 * 60_000);
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.1);
		vi.advanceTimersByTime(60_000);
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.2);
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "second-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.3);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("shares one in-flight request for concurrent callers", async () => {
		let respond: ((response: Response) => void) | undefined;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));

		const first = models.getUsageReport("anthropic");
		const second = models.getUsageReport("anthropic");
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		respond?.(jsonResponse({ five_hour: { utilization: 42.5, resets_at: "2099-09-08T18:00:00Z" } }));
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
	});

	it("does not request usage for API-key credentials", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({ type: "api_key", key: "api-key" }));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("silently returns unavailable when an OAuth caller has already cancelled", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		const controller = new AbortController();
		controller.abort();
		await expect(models.getUsageReport("anthropic", { signal: controller.signal })).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("silently rejects invalid, elapsed, and failed usage responses", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: -1, resets_at: "2099-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 1, resets_at: "2000-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "first-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "second-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "third-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
	});
});
