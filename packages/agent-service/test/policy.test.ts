import { describe, expect, it } from "vitest";
import { createPolicyBashSpawnHook, isCommandAllowed, normalizePolicyConfig } from "../src/policy.js";

describe("policy", () => {
	it("allows configured command prefixes and blocks others", () => {
		const allowed = ["ls", "git status", "npm test"];
		expect(isCommandAllowed("ls -la", allowed)).toBe(true);
		expect(isCommandAllowed("git status --short", allowed)).toBe(true);
		expect(isCommandAllowed("rm -rf /", allowed)).toBe(false);
	});

	it("normalizes default policy when not configured", () => {
		const normalized = normalizePolicyConfig();
		expect(normalized.allowedPrefixes.length).toBeGreaterThan(0);
		expect(normalized.allowedPrefixes.includes("ls")).toBe(true);
	});

	it("spawn hook throws POLICY_DENIED for blocked command", () => {
		const hook = createPolicyBashSpawnHook({ allowedPrefixes: ["ls"] });
		expect(() => hook({ command: "ls", cwd: "/tmp", env: {} })).not.toThrow();
		expect(() => hook({ command: "rm -rf /tmp/x", cwd: "/tmp", env: {} })).toThrow(/POLICY_DENIED/);
	});
});
