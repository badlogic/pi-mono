import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";

describe("AuthStorage Claude CLI import", () => {
	let tempDir: string;
	let originalHome: string | undefined;
	let originalUserProfile: string | undefined;
	let originalAccessToken: string | undefined;
	let originalRefreshToken: string | undefined;
	let originalExpiresAt: string | undefined;
	let originalExpiresIn: string | undefined;
	let originalEmail: string | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-auth-"));
		originalHome = process.env.HOME;
		originalUserProfile = process.env.USERPROFILE;
		originalAccessToken = process.env.ANTHROPIC_ACCESS_TOKEN;
		originalRefreshToken = process.env.ANTHROPIC_REFRESH_TOKEN;
		originalExpiresAt = process.env.ANTHROPIC_EXPIRES_AT;
		originalExpiresIn = process.env.ANTHROPIC_EXPIRES_IN;
		originalEmail = process.env.ANTHROPIC_EMAIL;
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		delete process.env.ANTHROPIC_ACCESS_TOKEN;
		delete process.env.ANTHROPIC_REFRESH_TOKEN;
		delete process.env.ANTHROPIC_EXPIRES_AT;
		delete process.env.ANTHROPIC_EXPIRES_IN;
		delete process.env.ANTHROPIC_EMAIL;
	});

	afterEach(() => {
		if (originalHome !== undefined) {
			process.env.HOME = originalHome;
		} else {
			delete process.env.HOME;
		}
		if (originalUserProfile !== undefined) {
			process.env.USERPROFILE = originalUserProfile;
		} else {
			delete process.env.USERPROFILE;
		}
		if (originalAccessToken !== undefined) {
			process.env.ANTHROPIC_ACCESS_TOKEN = originalAccessToken;
		} else {
			delete process.env.ANTHROPIC_ACCESS_TOKEN;
		}
		if (originalRefreshToken !== undefined) {
			process.env.ANTHROPIC_REFRESH_TOKEN = originalRefreshToken;
		} else {
			delete process.env.ANTHROPIC_REFRESH_TOKEN;
		}
		if (originalExpiresAt !== undefined) {
			process.env.ANTHROPIC_EXPIRES_AT = originalExpiresAt;
		} else {
			delete process.env.ANTHROPIC_EXPIRES_AT;
		}
		if (originalExpiresIn !== undefined) {
			process.env.ANTHROPIC_EXPIRES_IN = originalExpiresIn;
		} else {
			delete process.env.ANTHROPIC_EXPIRES_IN;
		}
		if (originalEmail !== undefined) {
			process.env.ANTHROPIC_EMAIL = originalEmail;
		} else {
			delete process.env.ANTHROPIC_EMAIL;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("imports credentials from Claude CLI file", async () => {
		const claudeDir = join(tempDir, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		const credentials = {
			claudeAiOauth: {
				accessToken: "access-token",
				refreshToken: "refresh-token",
				expiresAt: Date.now() + 60 * 60 * 1000,
			},
		};
		writeFileSync(join(claudeDir, "credentials.json"), JSON.stringify(credentials), "utf-8");

		const authPath = join(tempDir, "auth.json");
		const storage = new AuthStorage(authPath);

		const apiKey = await storage.getApiKey("anthropic");
		expect(apiKey).toBe("access-token");

		const saved = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, { type: string }>;
		expect(saved.anthropic.type).toBe("oauth");
	});

	it("imports credentials from environment variables", async () => {
		process.env.ANTHROPIC_ACCESS_TOKEN = "env-access";
		process.env.ANTHROPIC_REFRESH_TOKEN = "env-refresh";
		process.env.ANTHROPIC_EXPIRES_AT = `${Date.now() + 60 * 60 * 1000}`;
		process.env.ANTHROPIC_EMAIL = "user@example.com";

		const authPath = join(tempDir, "auth.json");
		const storage = new AuthStorage(authPath);

		const apiKey = await storage.getApiKey("anthropic");
		expect(apiKey).toBe("env-access");

		const saved = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, { type: string }>;
		expect(saved.anthropic.type).toBe("oauth");
	});
});
