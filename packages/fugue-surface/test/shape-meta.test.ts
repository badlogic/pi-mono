import { describe, expect, it } from "vitest";
import { getArrowMeta, getNodeMeta, getShapeText, isArrow } from "../src/lib/shape-meta.js";

// ─── Minimal shape stubs ──────────────────────────────────────────────────────

function makeShape(overrides: Record<string, unknown> = {}) {
	return {
		id: "shape:test-1",
		typeName: "shape",
		type: "geo",
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		props: { text: "", geo: "rectangle", w: 100, h: 100, ...((overrides.props as object) ?? {}) },
		meta: {},
		parentId: "page:page1",
		index: "a1",
		...(({ props: _p, ...rest }) => rest)(overrides),
	} as unknown as import("tldraw").TLShape;
}

// ─── getNodeMeta ──────────────────────────────────────────────────────────────

describe("getNodeMeta", () => {
	it("returns empty object when meta is empty", () => {
		const shape = makeShape({ meta: {} });
		expect(getNodeMeta(shape)).toEqual({});
	});

	it("extracts nodeId and nodeType", () => {
		const shape = makeShape({ meta: { nodeId: "node-abc", nodeType: "idea" } });
		expect(getNodeMeta(shape)).toEqual({ nodeId: "node-abc", nodeType: "idea" });
	});

	it("ignores non-string nodeId", () => {
		const shape = makeShape({ meta: { nodeId: 123, nodeType: "idea" } });
		expect(getNodeMeta(shape).nodeId).toBeUndefined();
	});

	it("ignores non-string nodeType", () => {
		const shape = makeShape({ meta: { nodeId: "n1", nodeType: null } });
		expect(getNodeMeta(shape).nodeType).toBeUndefined();
	});

	it("handles extra meta fields without leaking", () => {
		const shape = makeShape({ meta: { nodeId: "n1", nodeType: "decision", foo: "bar" } });
		const result = getNodeMeta(shape);
		expect(result).not.toHaveProperty("foo");
	});
});

// ─── getArrowMeta ─────────────────────────────────────────────────────────────

describe("getArrowMeta", () => {
	it("returns empty object for shape with no arrow meta", () => {
		const shape = makeShape({ meta: {} });
		expect(getArrowMeta(shape)).toEqual({});
	});

	it("extracts edgeId and edgeType", () => {
		const shape = makeShape({ meta: { edgeId: "edge-xyz", edgeType: "supports" } });
		expect(getArrowMeta(shape)).toEqual({ edgeId: "edge-xyz", edgeType: "supports" });
	});

	it("ignores non-string edgeId", () => {
		const shape = makeShape({ meta: { edgeId: {}, edgeType: "builds_on" } });
		expect(getArrowMeta(shape).edgeId).toBeUndefined();
	});
});

// ─── getShapeText ─────────────────────────────────────────────────────────────

describe("getShapeText", () => {
	it("returns empty string when no text prop", () => {
		const shape = makeShape({ props: { geo: "rectangle" } });
		expect(getShapeText(shape)).toBe("");
	});

	it("returns trimmed text from props.text", () => {
		const shape = makeShape({ props: { text: "  My Idea  " } });
		expect(getShapeText(shape)).toBe("My Idea");
	});

	it("returns trimmed name from props.name (frame shapes)", () => {
		const shape = makeShape({ type: "frame", props: { name: " Frame Title " } });
		expect(getShapeText(shape)).toBe("Frame Title");
	});

	it("prefers props.text over props.name", () => {
		const shape = makeShape({ props: { text: "text value", name: "name value" } });
		expect(getShapeText(shape)).toBe("text value");
	});

	it("returns empty string for empty text prop", () => {
		const shape = makeShape({ props: { text: "   " } });
		expect(getShapeText(shape)).toBe("");
	});
});

// ─── isArrow ──────────────────────────────────────────────────────────────────

describe("isArrow", () => {
	it("returns true for arrow shapes", () => {
		const shape = makeShape({ type: "arrow" });
		expect(isArrow(shape)).toBe(true);
	});

	it("returns false for geo shapes", () => {
		const shape = makeShape({ type: "geo" });
		expect(isArrow(shape)).toBe(false);
	});

	it("returns false for note shapes", () => {
		const shape = makeShape({ type: "note" });
		expect(isArrow(shape)).toBe(false);
	});
});
