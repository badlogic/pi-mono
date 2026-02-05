import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Decision } from "../src/decision-log.js";
import { createDecisionRecorder } from "../src/decision-log.js";

describe("Decision Recording", () => {
	let logDir: string;

	beforeEach(() => {
		logDir = mkdtempSync(join(tmpdir(), "decision-log-test-"));
	});

	afterEach(() => {
		rmSync(logDir, { recursive: true, force: true });
	});

	describe("createDecisionRecorder", () => {
		it("should return a recorder with record and getDecisions methods", () => {
			const recorder = createDecisionRecorder(logDir);

			expect(recorder).toBeDefined();
			expect(typeof recorder.record).toBe("function");
			expect(typeof recorder.getDecisions).toBe("function");
		});
	});

	describe("recorder.record", () => {
		it("should write a .md file to logDir", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 10,
				timestamp: 1700000000000,
				reasoning: "Enemy is weak, time to attack.",
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			expect(files).toHaveLength(1);
			expect(files[0]).toMatch(/\.md$/);
		});

		it("should name the file as {tick}-{timestamp}.md", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 42,
				timestamp: 1700000001234,
				reasoning: "Gathering resources.",
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			expect(files[0]).toBe("42-1700000001234.md");
		});

		it("should include YAML frontmatter with tick and timestamp", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 5,
				timestamp: 1700000000000,
				reasoning: "Scouting the area.",
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			const content = readFileSync(join(logDir, files[0]), "utf-8");

			// Check frontmatter delimiters
			expect(content).toMatch(/^---\n/);
			expect(content).toMatch(/\n---\n/);

			// Check frontmatter content
			expect(content).toContain("tick: 5");
			expect(content).toContain("timestamp: 1700000000000");
		});

		it("should include reasoning in the file body", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 1,
				timestamp: 1700000000000,
				reasoning: "Need to build defenses before the next wave.",
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			const content = readFileSync(join(logDir, files[0]), "utf-8");

			expect(content).toContain("## Reasoning");
			expect(content).toContain("Need to build defenses before the next wave.");
		});

		it("should include action details when actionTaken is provided", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 3,
				timestamp: 1700000000000,
				reasoning: "Attacking enemy base.",
				actionTaken: { type: "attack", params: { targetId: "base-1" } },
				result: { success: true, txHash: "0xdef456" },
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			const content = readFileSync(join(logDir, files[0]), "utf-8");

			expect(content).toContain("## Action");
			expect(content).toContain("Type: attack");
			expect(content).toContain("## Result");
			expect(content).toContain("Success: true");
			expect(content).toContain("TxHash: 0xdef456");
		});

		it("should include error in result section when action failed", async () => {
			const recorder = createDecisionRecorder(logDir);
			const decision: Decision = {
				tick: 4,
				timestamp: 1700000000000,
				reasoning: "Tried to build but failed.",
				actionTaken: { type: "build", params: { building: "tower" } },
				result: { success: false, error: "Not enough gold" },
			};

			await recorder.record(decision);

			const files = readdirSync(logDir);
			const content = readFileSync(join(logDir, files[0]), "utf-8");

			expect(content).toContain("Success: false");
			expect(content).toContain("Error: Not enough gold");
		});

		it("should create the logDir if it does not exist", async () => {
			const nestedDir = join(logDir, "nested", "decisions");
			const recorder = createDecisionRecorder(nestedDir);

			await recorder.record({
				tick: 1,
				timestamp: 1700000000000,
				reasoning: "First decision in new directory.",
			});

			const files = readdirSync(nestedDir);
			expect(files).toHaveLength(1);
		});
	});

	describe("recorder.getDecisions", () => {
		it("should read all .md files and return parsed decisions", async () => {
			const recorder = createDecisionRecorder(logDir);

			await recorder.record({ tick: 1, timestamp: 1700000000000, reasoning: "Decision one." });
			await recorder.record({ tick: 2, timestamp: 1700000001000, reasoning: "Decision two." });
			await recorder.record({ tick: 3, timestamp: 1700000002000, reasoning: "Decision three." });

			const decisions = await recorder.getDecisions();

			expect(decisions).toHaveLength(3);
			expect(decisions[0].tick).toBe(1);
			expect(decisions[0].reasoning).toBe("Decision one.");
			expect(decisions[1].tick).toBe(2);
			expect(decisions[2].tick).toBe(3);
		});

		it("should return empty array when logDir does not exist", async () => {
			const recorder = createDecisionRecorder(join(logDir, "nonexistent"));

			const decisions = await recorder.getDecisions();

			expect(decisions).toEqual([]);
		});

		it("should limit results with { limit: N }", async () => {
			const recorder = createDecisionRecorder(logDir);

			for (let i = 1; i <= 10; i++) {
				await recorder.record({
					tick: i,
					timestamp: 1700000000000 + i * 1000,
					reasoning: `Decision ${i}.`,
				});
			}

			const decisions = await recorder.getDecisions({ limit: 5 });

			expect(decisions).toHaveLength(5);
			// Should return the last 5 (most recent)
			expect(decisions[0].tick).toBe(6);
			expect(decisions[4].tick).toBe(10);
		});

		it("should filter by tick with { since: tick }", async () => {
			const recorder = createDecisionRecorder(logDir);

			await recorder.record({ tick: 1, timestamp: 1700000000000, reasoning: "Old decision." });
			await recorder.record({ tick: 5, timestamp: 1700000005000, reasoning: "Mid decision." });
			await recorder.record({ tick: 10, timestamp: 1700000010000, reasoning: "Recent decision." });

			const decisions = await recorder.getDecisions({ since: 5 });

			expect(decisions).toHaveLength(2);
			expect(decisions[0].tick).toBe(5);
			expect(decisions[1].tick).toBe(10);
		});

		it("should combine since and limit", async () => {
			const recorder = createDecisionRecorder(logDir);

			for (let i = 1; i <= 10; i++) {
				await recorder.record({
					tick: i,
					timestamp: 1700000000000 + i * 1000,
					reasoning: `Decision ${i}.`,
				});
			}

			const decisions = await recorder.getDecisions({ since: 5, limit: 3 });

			expect(decisions).toHaveLength(3);
			// since: 5 gives ticks 5-10 (6 items), limit: 3 takes last 3
			expect(decisions[0].tick).toBe(8);
			expect(decisions[2].tick).toBe(10);
		});
	});
});
