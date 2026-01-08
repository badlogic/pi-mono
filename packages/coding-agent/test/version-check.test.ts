import { afterEach, describe, expect, test, vi } from "vitest";
import { checkForNewVersion, getLatestVersion } from "../src/cli/version-check.js";
import { VERSION } from "../src/config.js";

describe("version-check", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.unstubAllEnvs();
	});

	describe("getLatestVersion", () => {
		test("returns version string on successful fetch", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "1.0.0" }),
			});

			const version = await getLatestVersion();
			expect(version).toBe("1.0.0");
		});

		test("returns null on network error", async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

			const version = await getLatestVersion();
			expect(version).toBe(null);
		});

		test("returns null on non-ok response", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
			});

			const version = await getLatestVersion();
			expect(version).toBe(null);
		});
	});

	describe("checkForNewVersion", () => {
		test("returns undefined when on latest version", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: VERSION }),
			});

			const newVersion = await checkForNewVersion();
			expect(newVersion).toBeUndefined();
		});

		test("returns new version when update available", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "99.99.99" }),
			});

			const newVersion = await checkForNewVersion();
			expect(newVersion).toBe("99.99.99");
		});

		test("respects PI_SKIP_VERSION_CHECK env var", async () => {
			vi.stubEnv("PI_SKIP_VERSION_CHECK", "1");

			const newVersion = await checkForNewVersion();
			expect(newVersion).toBeUndefined();
		});
	});
});
