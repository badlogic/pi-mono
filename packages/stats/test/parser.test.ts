import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseSessionFile } from "../src/parser.js";

test("parseSessionFile extracts assistant stats from a session log", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stats-parser-"));
	const sessionPath = join(directory, "session.jsonl");
	const contents = `${[
		JSON.stringify({
			type: "session",
			id: "session-1",
			timestamp: new Date(0).toISOString(),
			cwd: "/tmp/project",
		}),
		JSON.stringify({
			type: "message",
			id: "message-1",
			parentId: null,
			timestamp: new Date(1_000).toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				api: "anthropic",
				provider: "zai",
				model: "glm-5",
				usage: {
					input: 10,
					output: 5,
					cacheRead: 2,
					cacheWrite: 1,
					totalTokens: 18,
					premiumRequests: 3,
					cost: {
						input: 0.01,
						output: 0.02,
						cacheRead: 0.003,
						cacheWrite: 0.004,
						total: 0.037,
					},
				},
				stopReason: "stop",
				timestamp: 1_000,
				duration: 450,
				ttft: 75,
			},
		}),
	].join("\n")}\n`;

	writeFileSync(sessionPath, contents, "utf8");

	try {
		const { stats, newOffset } = await parseSessionFile(sessionPath);
		assert.equal(newOffset, Buffer.byteLength(contents));
		assert.equal(stats.length, 1);
		assert.equal(stats[0].sessionFile, sessionPath);
		assert.equal(stats[0].folder, "/tmp/project");
		assert.equal(stats[0].model, "glm-5");
		assert.equal(stats[0].provider, "zai");
		assert.equal(stats[0].api, "anthropic");
		assert.equal(stats[0].duration, 450);
		assert.equal(stats[0].ttft, 75);
		assert.equal(stats[0].usage.premiumRequests, 3);
		assert.equal(stats[0].usage.totalTokens, 18);
		assert.equal(stats[0].usage.cost.total, 0.037);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
