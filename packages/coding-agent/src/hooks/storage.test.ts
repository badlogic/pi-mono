import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createStorageContext } from "./storage.js";

describe("Hook Storage", () => {
	const testHookId = "test-hook-" + Date.now();
	const baseDir = path.join(os.homedir(), ".pi", "hook-data", testHookId);

	afterEach(async () => {
		// Clean up test data
		try {
			await fs.rm(baseDir, { recursive: true, force: true });
		} catch {
			// Ignore if doesn't exist
		}
	});

	it("should store and retrieve values", async () => {
		const storage = createStorageContext(testHookId);

		await storage.set("test-key", { foo: "bar", num: 42 });
		const result = await storage.get<{ foo: string; num: number }>("test-key");

		expect(result).toEqual({ foo: "bar", num: 42 });
	});

	it("should return null for non-existent keys", async () => {
		const storage = createStorageContext(testHookId);

		const result = await storage.get("non-existent");

		expect(result).toBeNull();
	});

	it("should delete values", async () => {
		const storage = createStorageContext(testHookId);

		await storage.set("to-delete", { value: 1 });
		expect(await storage.get("to-delete")).toEqual({ value: 1 });

		await storage.delete("to-delete");
		expect(await storage.get("to-delete")).toBeNull();
	});

	it("should list keys", async () => {
		const storage = createStorageContext(testHookId);

		await storage.set("key-a", { a: 1 });
		await storage.set("key-b", { b: 2 });
		await storage.set("other-c", { c: 3 });

		const allKeys = await storage.list();
		expect(allKeys).toContain("key-a");
		expect(allKeys).toContain("key-b");
		expect(allKeys).toContain("other-c");
	});

	it("should list keys with prefix", async () => {
		const storage = createStorageContext(testHookId);

		await storage.set("checkpoint:1", { id: 1 });
		await storage.set("checkpoint:2", { id: 2 });
		await storage.set("other:1", { id: 3 });

		const checkpointKeys = await storage.list("checkpoint:");
		expect(checkpointKeys).toContain("checkpoint_1"); // sanitized
		expect(checkpointKeys).toContain("checkpoint_2"); // sanitized
		expect(checkpointKeys).not.toContain("other_1");
	});

	it("should handle special characters in keys", async () => {
		const storage = createStorageContext(testHookId);

		await storage.set("path/to/key", { value: "test" });
		const result = await storage.get("path/to/key");

		expect(result).toEqual({ value: "test" });
	});

	it("should return empty array when listing non-existent directory", async () => {
		const storage = createStorageContext("non-existent-hook-id");

		const keys = await storage.list();

		expect(keys).toEqual([]);
	});
});
