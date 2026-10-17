import { describe, expect, it } from "vitest";
import { createPowerShellTool } from "../src/core/tools/powershell.ts";
import { getPowerShellConfig, POWERSHELL_ARGS } from "../src/utils/shell.ts";
import { lstatSync } from "node:fs";

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((content) => content.type === "text")
		.map((content) => content.text ?? "")
		.join("\n");
}

describe("powershell tool", () => {
	it("uses process-local execution policy bypass", () => {
		expect(POWERSHELL_ARGS).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
	});

	it.skipIf(process.platform !== "win32")("executes PowerShell commands with UTF-8 output", async () => {
		const config = getPowerShellConfig();
		expect(config.args).toEqual(POWERSHELL_ARGS);

		const tool = createPowerShellTool(process.cwd());
		const result = await tool.execute("powershell-test", {
			command: "Write-Output 'héllo €'; Get-ExecutionPolicy -Scope Process",
		});
		const output = getTextOutput(result);

		expect(output).toContain("héllo €");
		expect(output).toContain("Bypass");
	});

	it.skipIf(process.platform !== "win32")("resolver accepts a Store-style zero-byte reparse alias on PATH", () => {
		// Microsoft Store app-execution aliases are zero-length reparse points:
		// existsSync/statSync fail on them while lstatSync and spawning work.
		// Whatever the resolver returns must be spawnable, i.e. its lstat must
		// succeed. Regression for #10976 (Store pwsh 7 rejected -> silent 5.1
		// fallback); on machines without pwsh the fallback target is a real
		// file and this still holds.
		const config = getPowerShellConfig();
		expect(config.shell).toBeTruthy();
		expect(() => lstatSync(config.shell)).not.toThrow();
	});
});
