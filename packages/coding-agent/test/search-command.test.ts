import { describe, expect, it, vi } from "vitest";
import { runSearchCommand } from "../src/cli/search-command.js";

describe("search command", () => {
	it("renders json search results", async () => {
		process.exitCode = undefined;
		const html = `
			<a class="result__a" href="https://example.com/one">First Result</a>
			<div class="result__snippet">First snippet</div>
			<a class="result__a" href="https://example.com/two">Second Result</a>
			<div class="result__snippet">Second snippet</div>
		`;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runSearchCommand(["--json", "--limit", "2", "test", "query"], {
				fetch: vi.fn(async () => new Response(html, { status: 200 })),
			});
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output) as {
				query: string;
				provider: string;
				results: Array<{ title: string; url: string; snippet?: string }>;
			};
			expect(parsed.query).toBe("test query");
			expect(parsed.provider).toBe("duckduckgo");
			expect(parsed.results).toHaveLength(2);
			expect(parsed.results[0]).toMatchObject({
				title: "First Result",
				url: "https://example.com/one",
				snippet: "First snippet",
			});
		} finally {
			logSpy.mockRestore();
		}
	});

	it("fails on invalid provider", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		process.exitCode = undefined;
		try {
			await runSearchCommand(["--provider", "exa", "hello"]);
			const output = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('Invalid provider "exa"');
			expect(process.exitCode).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("renders compact text output", async () => {
		process.exitCode = undefined;
		const html = `
			<a class="result__a" href="https://example.com/one">First Result</a>
			<div class="result__snippet">First snippet</div>
		`;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runSearchCommand(["--compact", "hello"], {
				fetch: vi.fn(async () => new Response(html, { status: 200 })),
			});
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('Web results for "hello"');
			expect(output).toContain("First Result");
			expect(output).not.toContain("First snippet");
		} finally {
			logSpy.mockRestore();
		}
	});
});
