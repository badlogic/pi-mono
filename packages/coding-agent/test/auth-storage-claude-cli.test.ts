import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";

describe("AuthStorage Claude CLI import", () => {
	let tempDir: string;
	let originalHome: string | undefined;
	let originalUserProfile: string | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-auth-"));
		originalHome = process.env.HOME;
		originalUserProfile = process.env.USERPROFILE;
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
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
});
