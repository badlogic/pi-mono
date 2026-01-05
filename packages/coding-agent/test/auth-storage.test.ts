import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";

describe("AuthStorage", () => {
	let tempDir: string;
	let authPath: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-auth-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		authPath = join(tempDir, "auth.json");
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	test("normalizes Anthropic api_key entries with tokenType", () => {
		const storage = new AuthStorage(authPath);
		storage.set("anthropic", { type: "api_key", key: "sk-ant-oat-example" });

		const raw = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>;
		const entry = raw.anthropic as { tokenType?: string } | undefined;
		expect(entry?.tokenType).toBe("oauth");
	});

	test("honors explicit tokenType for Anthropic api_key entries", () => {
		const storage = new AuthStorage(authPath);
		storage.set("anthropic", { type: "api_key", key: "manual-key", tokenType: "oauth" });

		expect(storage.isOAuth("anthropic")).toBe(true);
	});

	test("reloads auth.json when file changes on disk", () => {
		writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api" } }, null, 2));
		const storage = new AuthStorage(authPath);

		const initial = storage.get("anthropic");
		expect(initial?.type).toBe("api_key");

		writeFileSync(
			authPath,
			JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-oat-updated", tokenType: "oauth" } }, null, 2),
		);
		utimesSync(authPath, new Date(), new Date(Date.now() + 1000));

		const updated = storage.get("anthropic");
		expect(updated?.type).toBe("api_key");
		if (!updated || updated.type !== "api_key") {
			throw new Error("Expected updated anthropic api_key entry");
		}
		expect(updated.key).toBe("sk-ant-oat-updated");
		expect(updated.tokenType).toBe("oauth");
	});
});
