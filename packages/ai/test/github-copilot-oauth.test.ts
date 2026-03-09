import { afterEach, describe, expect, it, vi } from "vitest";
import { loginGitHubCopilot } from "../src/utils/oauth/github-copilot.js";

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function getUrl(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	if (input instanceof Request) {
		return input.url;
	}
	throw new Error(`Unsupported fetch input: ${String(input)}`);
}

describe("GitHub Copilot OAuth device flow", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("waits before the first poll and increases the safety margin after slow_down", async () => {
		vi.useFakeTimers();
		const startTime = new Date("2026-03-09T00:00:00Z");
		vi.setSystemTime(startTime);

		const accessTokenPollTimes: number[] = [];
		const accessTokenResponses = [
			jsonResponse({ error: "authorization_pending", error_description: "pending" }),
			jsonResponse({ error: "slow_down", error_description: "slow down", interval: 10 }),
			jsonResponse({ access_token: "ghu_refresh_token" }),
		];

		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);

			if (url.endsWith("/login/device/code")) {
				expect(init?.method).toBe("POST");
				expect(init?.headers).toMatchObject({
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				});
				expect(String(init?.body)).toContain("client_id=");
				expect(String(init?.body)).toContain("scope=read%3Auser");
				return jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://github.com/login/device",
					interval: 5,
					expires_in: 900,
				});
			}

			if (url.endsWith("/login/oauth/access_token")) {
				accessTokenPollTimes.push(Date.now());
				expect(init?.method).toBe("POST");
				expect(init?.headers).toMatchObject({
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				});
				expect(String(init?.body)).toContain("client_id=");
				expect(String(init?.body)).toContain("device_code=device-code");
				expect(String(init?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
				const response = accessTokenResponses.shift();
				if (!response) {
					throw new Error("Unexpected extra access token poll");
				}
				return response;
			}

			if (url.includes("/copilot_internal/v2/token")) {
				return jsonResponse({
					token: "tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;",
					expires_at: 9999999999,
				});
			}

			if (url.includes("/models/") && url.endsWith("/policy")) {
				return new Response("", { status: 200 });
			}

			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		vi.stubGlobal("fetch", fetchMock);

		const loginPromise = loginGitHubCopilot({
			onAuth: () => {},
			onPrompt: async () => "",
			onProgress: () => {},
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(accessTokenPollTimes).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(5999);
		expect(accessTokenPollTimes).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1);
		expect(accessTokenPollTimes).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(5999);
		expect(accessTokenPollTimes).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(accessTokenPollTimes).toHaveLength(2);

		await vi.advanceTimersByTimeAsync(13999);
		expect(accessTokenPollTimes).toHaveLength(2);

		await vi.advanceTimersByTimeAsync(1);
		await loginPromise;

		expect(accessTokenPollTimes).toEqual([
			startTime.getTime() + 6000,
			startTime.getTime() + 12000,
			startTime.getTime() + 26000,
		]);
	});

	it("uses the remaining lifetime for a final poll before timing out after repeated slow_down responses", async () => {
		vi.useFakeTimers();
		const startTime = new Date("2026-03-09T00:00:00Z");
		vi.setSystemTime(startTime);

		const accessTokenPollTimes: number[] = [];
		const accessTokenResponses = [
			jsonResponse({ error: "slow_down", error_description: "slow down", interval: 10 }),
			jsonResponse({ error: "slow_down", error_description: "still too fast", interval: 15 }),
			jsonResponse({ error: "authorization_pending", error_description: "pending" }),
		];

		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = getUrl(input);

			if (url.endsWith("/login/device/code")) {
				return jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://github.com/login/device",
					interval: 5,
					expires_in: 25,
				});
			}

			if (url.endsWith("/login/oauth/access_token")) {
				accessTokenPollTimes.push(Date.now());
				const response = accessTokenResponses.shift();
				if (!response) {
					throw new Error("Unexpected extra access token poll");
				}
				return response;
			}

			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		vi.stubGlobal("fetch", fetchMock);

		const loginPromise = loginGitHubCopilot({
			onAuth: () => {},
			onPrompt: async () => "",
		});
		const rejection = expect(loginPromise).rejects.toThrow(
			/Device flow timed out after one or more slow_down responses/,
		);

		await vi.advanceTimersByTimeAsync(6000);
		expect(accessTokenPollTimes).toEqual([startTime.getTime() + 6000]);

		await vi.advanceTimersByTimeAsync(14000);
		expect(accessTokenPollTimes).toEqual([startTime.getTime() + 6000, startTime.getTime() + 20000]);

		await vi.advanceTimersByTimeAsync(4999);
		expect(accessTokenPollTimes).toEqual([startTime.getTime() + 6000, startTime.getTime() + 20000]);

		await vi.advanceTimersByTimeAsync(1);
		await rejection;

		expect(accessTokenPollTimes).toEqual([
			startTime.getTime() + 6000,
			startTime.getTime() + 20000,
			startTime.getTime() + 25000,
		]);
	});
});
