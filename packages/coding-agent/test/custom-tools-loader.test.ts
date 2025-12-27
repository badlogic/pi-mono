/**
 * Tests for custom tool loader override behavior.
 */

import { describe, expect, it } from "vitest";

describe("Custom Tools Loader - Override Logic", () => {
	// Simulates the override logic from loader.ts
	function checkOverrides(
		tools: Array<{ name: string; canOverride: boolean }>,
		builtInNames: string[],
	): { loaded: string[]; errors: string[] } {
		const builtInSet = new Set(builtInNames);
		const seenNames = new Set<string>();
		const loaded: string[] = [];
		const errors: string[] = [];

		for (const { name, canOverride } of tools) {
			if (seenNames.has(name)) {
				errors.push(`${name}: conflicts with another custom tool`);
				continue;
			}
			if (builtInSet.has(name) && !canOverride) {
				errors.push(`${name}: cannot override built-in`);
				continue;
			}
			seenNames.add(name);
			loaded.push(name);
		}
		return { loaded, errors };
	}

	it("should allow global tools to override built-ins", () => {
		const result = checkOverrides([{ name: "bash", canOverride: true }], ["bash", "read"]);
		expect(result.loaded).toContain("bash");
		expect(result.errors).toHaveLength(0);
	});

	it("should reject project-local tools overriding built-ins", () => {
		const result = checkOverrides([{ name: "bash", canOverride: false }], ["bash", "read"]);
		expect(result.loaded).not.toContain("bash");
		expect(result.errors[0]).toContain("cannot override");
	});

	it("should allow non-conflicting tools from any source", () => {
		const result = checkOverrides(
			[
				{ name: "my-tool", canOverride: false },
				{ name: "other", canOverride: true },
			],
			["bash"],
		);
		expect(result.loaded).toEqual(["my-tool", "other"]);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject duplicate custom tool names", () => {
		const result = checkOverrides(
			[
				{ name: "my-tool", canOverride: true },
				{ name: "my-tool", canOverride: false },
			],
			[],
		);
		expect(result.loaded).toEqual(["my-tool"]);
		expect(result.errors[0]).toContain("conflicts with another");
	});
});
