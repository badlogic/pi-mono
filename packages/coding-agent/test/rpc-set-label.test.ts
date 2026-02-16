/**
 * Unit tests for set_label RPC command.
 *
 * Tests label set/clear and error on non-existent entries.
 * Uses SessionManager.inMemory() — no API key needed.
 */

import { describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import { userMsg } from "./utilities.js";

describe("set_label (via SessionManager)", () => {
	test("set a label on an entry", () => {
		const sm = SessionManager.inMemory();
		const id = sm.appendMessage(userMsg("Hello"));

		sm.appendLabelChange(id, "checkpoint");

		expect(sm.getLabel(id)).toBe("checkpoint");
	});

	test("clear a label by passing undefined", () => {
		const sm = SessionManager.inMemory();
		const id = sm.appendMessage(userMsg("Hello"));

		sm.appendLabelChange(id, "checkpoint");
		expect(sm.getLabel(id)).toBe("checkpoint");

		sm.appendLabelChange(id, undefined);
		expect(sm.getLabel(id)).toBeUndefined();
	});

	test("clear a label by passing empty string", () => {
		const sm = SessionManager.inMemory();
		const id = sm.appendMessage(userMsg("Hello"));

		sm.appendLabelChange(id, "checkpoint");
		expect(sm.getLabel(id)).toBe("checkpoint");

		sm.appendLabelChange(id, "");
		expect(sm.getLabel(id)).toBeUndefined();
	});

	test("throws on non-existent entry", () => {
		const sm = SessionManager.inMemory();
		expect(() => sm.appendLabelChange("nonexistent", "test")).toThrow("Entry nonexistent not found");
	});
});
