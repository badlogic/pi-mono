import { describe, expect, it } from "vitest";
import {
	ADMIN_CAPABILITY_SET,
	type CapabilitySet,
	DEFAULT_CAPABILITY_SET,
	err,
	hasCapability,
	isSubsetOf,
	MAX_RECURSION_DEPTH,
	ok,
	roleHasPermission,
} from "../src/types.js";

// ─── hasCapability ────────────────────────────────────────────────────────────

describe("hasCapability", () => {
	it("matches exact capability", () => {
		const set: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:read")).toBe(true);
	});

	it("does not match different capability", () => {
		const set: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:write")).toBe(false);
	});

	it("matches via wildcard prefix", () => {
		const set: CapabilitySet = {
			capabilities: ["github:*"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:read")).toBe(true);
		expect(hasCapability(set, "github:write")).toBe(true);
		expect(hasCapability(set, "github:push")).toBe(true);
	});

	it("wildcard does not match different namespace", () => {
		const set: CapabilitySet = {
			capabilities: ["github:*"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "notion:read")).toBe(false);
	});

	it("full wildcard matches anything", () => {
		const set: CapabilitySet = {
			capabilities: ["*"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:read")).toBe(true);
		expect(hasCapability(set, "notion:write")).toBe(true);
		expect(hasCapability(set, "deploy:anything")).toBe(true);
	});

	it("returns false for empty capability set", () => {
		const set: CapabilitySet = {
			capabilities: [],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:read")).toBe(false);
	});

	it("multiple capabilities — matches if any match", () => {
		const set: CapabilitySet = {
			capabilities: ["github:read", "notion:write"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "none",
		};
		expect(hasCapability(set, "github:read")).toBe(true);
		expect(hasCapability(set, "notion:write")).toBe(true);
		expect(hasCapability(set, "github:write")).toBe(false);
	});
});

// ─── isSubsetOf ───────────────────────────────────────────────────────────────

describe("isSubsetOf", () => {
	it("subset with same capabilities is valid", () => {
		const parent: CapabilitySet = {
			capabilities: ["github:*"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 1000,
			networkPolicy: "full",
		};
		const child: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 2,
			maxBudgetJoules: 500,
			networkPolicy: "full",
		};
		expect(isSubsetOf(child, parent)).toBe(true);
	});

	it("child requesting capability parent lacks is rejected", () => {
		const parent: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 1000,
			networkPolicy: "full",
		};
		const child: CapabilitySet = {
			capabilities: ["github:write"],
			maxRecursionDepth: 2,
			maxBudgetJoules: 500,
			networkPolicy: "full",
		};
		expect(isSubsetOf(child, parent)).toBe(false);
	});

	it("child exceeding recursion depth is rejected", () => {
		const parent: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 2,
			maxBudgetJoules: 1000,
			networkPolicy: "full",
		};
		const child: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 500,
			networkPolicy: "full",
		};
		expect(isSubsetOf(child, parent)).toBe(false);
	});

	it("child exceeding budget is rejected", () => {
		const parent: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 100,
			networkPolicy: "full",
		};
		const child: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 2,
			maxBudgetJoules: 200,
			networkPolicy: "full",
		};
		expect(isSubsetOf(child, parent)).toBe(false);
	});

	it("empty child capabilities is always valid", () => {
		const parent: CapabilitySet = {
			capabilities: ["github:read"],
			maxRecursionDepth: 3,
			maxBudgetJoules: 1000,
			networkPolicy: "full",
		};
		const child: CapabilitySet = {
			capabilities: [],
			maxRecursionDepth: 1,
			maxBudgetJoules: 100,
			networkPolicy: "full",
		};
		expect(isSubsetOf(child, parent)).toBe(true);
	});

	it("ADMIN_CAPABILITY_SET contains DEFAULT", () => {
		expect(isSubsetOf(DEFAULT_CAPABILITY_SET, ADMIN_CAPABILITY_SET)).toBe(true);
	});

	it("DEFAULT is not superset of ADMIN", () => {
		expect(isSubsetOf(ADMIN_CAPABILITY_SET, DEFAULT_CAPABILITY_SET)).toBe(false);
	});
});

// ─── roleHasPermission ────────────────────────────────────────────────────────

describe("roleHasPermission", () => {
	it("admin has all permissions", () => {
		expect(roleHasPermission("admin", "canvas:read")).toBe(true);
		expect(roleHasPermission("admin", "canvas:write")).toBe(true);
		expect(roleHasPermission("admin", "graph:delete")).toBe(true);
		expect(roleHasPermission("admin", "anything:goes")).toBe(true);
	});

	it("member can read and write canvas and graph", () => {
		expect(roleHasPermission("member", "canvas:read")).toBe(true);
		expect(roleHasPermission("member", "canvas:write")).toBe(true);
		expect(roleHasPermission("member", "graph:read")).toBe(true);
		expect(roleHasPermission("member", "graph:write")).toBe(true);
	});

	it("member cannot delete or admin", () => {
		expect(roleHasPermission("member", "users:admin")).toBe(false);
		expect(roleHasPermission("member", "system:deploy")).toBe(false);
	});

	it("viewer can only read", () => {
		expect(roleHasPermission("viewer", "canvas:read")).toBe(true);
		expect(roleHasPermission("viewer", "graph:read")).toBe(true);
		expect(roleHasPermission("viewer", "canvas:write")).toBe(false);
		expect(roleHasPermission("viewer", "graph:write")).toBe(false);
		expect(roleHasPermission("viewer", "agents:spawn")).toBe(false);
	});
});

// ─── Result type ──────────────────────────────────────────────────────────────

describe("Result", () => {
	it("ok wraps a value", () => {
		const r = ok(42);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe(42);
	});

	it("err wraps an error", () => {
		const r = err("something went wrong");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toBe("something went wrong");
	});

	it("ok does not have error property", () => {
		const r = ok("hello");
		expect("error" in r).toBe(false);
	});

	it("err does not have value property", () => {
		const r = err("oops");
		expect("value" in r).toBe(false);
	});
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
	it("MAX_RECURSION_DEPTH is 5", () => {
		expect(MAX_RECURSION_DEPTH).toBe(5);
	});

	it("DEFAULT_CAPABILITY_SET has empty capabilities", () => {
		expect(DEFAULT_CAPABILITY_SET.capabilities).toHaveLength(0);
	});

	it("ADMIN_CAPABILITY_SET has wildcard", () => {
		expect(ADMIN_CAPABILITY_SET.capabilities).toContain("*");
	});
});
