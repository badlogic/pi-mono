import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initTheme, setTheme, theme } from "../src/modes/interactive/theme/theme.js";

describe("theme: thinkingText", () => {
	const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
	let tmpAgentDir: string;

	beforeAll(() => {
		initTheme("dark");

		tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-dir-"));
		process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
		fs.mkdirSync(path.join(tmpAgentDir, "themes"), { recursive: true });

		// Base it on the built-in dark theme, but remove thinkingText.
		// This simulates an outdated custom theme file.
		const darkThemePath = path.join(process.cwd(), "src", "modes", "interactive", "theme", "dark.json");
		const json = JSON.parse(fs.readFileSync(darkThemePath, "utf-8"));
		json.name = "no-thinking-text";
		delete json.colors.thinkingText;

		fs.writeFileSync(path.join(tmpAgentDir, "themes", "no-thinking-text.json"), JSON.stringify(json, null, 2));
	});

	afterAll(() => {
		// Restore environment
		if (prevAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = prevAgentDir;
		}

		try {
			fs.rmSync(tmpAgentDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test("rejects a custom theme without thinkingText", () => {
		const result = setTheme("no-thinking-text");
		expect(result.success).toBe(false);
		expect(result.error).toContain("Missing required color tokens");
		expect(result.error).toContain("thinkingText");

		// Should still have a valid theme loaded (fallback to dark)
		expect(() => theme.fg("thinkingText", "hello")).not.toThrow();
	});
});
