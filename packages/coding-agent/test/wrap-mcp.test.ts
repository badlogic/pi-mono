import { mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpCommand, checkPi, deriveDirName, deriveServerName } from "../src/wrap-mcp/discovery.js";
import { parseWrapMcpArgs } from "../src/wrap-mcp/index.js";
import { resolvePath } from "../src/wrap-mcp/output.js";
import { detectLocalAgentsFile, getGlobalAgentsPath } from "../src/wrap-mcp/registration.js";

describe("deriveServerName", () => {
	it("handles simple package names", () => {
		expect(deriveServerName("chrome-devtools-mcp")).toBe("chrome-devtools");
	});

	it("handles scoped packages", () => {
		expect(deriveServerName("@anthropic-ai/chrome-devtools-mcp")).toBe("chrome-devtools");
	});

	it("handles version suffixes", () => {
		expect(deriveServerName("chrome-devtools-mcp@latest")).toBe("chrome-devtools");
		expect(deriveServerName("@anthropic-ai/chrome-devtools-mcp@1.0.0")).toBe("chrome-devtools");
	});

	it("handles mcp- prefix", () => {
		expect(deriveServerName("mcp-github")).toBe("github");
	});

	it("handles packages without -mcp suffix", () => {
		expect(deriveServerName("my-tool")).toBe("my-tool");
	});
});

describe("deriveDirName", () => {
	it("derives directory name from package", () => {
		expect(deriveDirName("chrome-devtools-mcp")).toBe("chrome-devtools");
		expect(deriveDirName("@org/my-mcp-server-mcp")).toBe("my-mcp-server");
	});
});

describe("buildMcpCommand", () => {
	it("builds npx command for simple package", () => {
		expect(buildMcpCommand("chrome-devtools-mcp")).toBe("npx -y chrome-devtools-mcp@latest");
	});

	it("builds npx command for scoped package", () => {
		expect(buildMcpCommand("@anthropic-ai/chrome-devtools-mcp")).toBe(
			"npx -y @anthropic-ai/chrome-devtools-mcp@latest",
		);
	});

	it("preserves explicit version", () => {
		expect(buildMcpCommand("my-mcp@1.2.3")).toBe("npx -y my-mcp@1.2.3");
		expect(buildMcpCommand("@org/my-mcp@2.0.0")).toBe("npx -y @org/my-mcp@2.0.0");
	});
});

describe("checkPi", () => {
	it("returns boolean indicating pi availability", () => {
		// checkPi uses `which pi` which should work on this system
		const result = checkPi();
		expect(typeof result).toBe("boolean");
	});
});

describe("parseWrapMcpArgs", () => {
	it("parses package name", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp");
		expect(args.packageName).toBe("chrome-devtools-mcp");
		expect(args.local).toBe(false);
		expect(args.force).toBe(false);
		expect(args.help).toBe(false);
	});

	it("parses --local flag", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp --local");
		expect(args.packageName).toBe("chrome-devtools-mcp");
		expect(args.local).toBe(true);
	});

	it("parses --name option", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp --name my-tools");
		expect(args.packageName).toBe("chrome-devtools-mcp");
		expect(args.name).toBe("my-tools");
	});

	it("parses --force flag", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp --force");
		expect(args.force).toBe(true);
	});

	it("parses -f shorthand", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp -f");
		expect(args.force).toBe(true);
	});

	it("handles combined flags", () => {
		const args = parseWrapMcpArgs("/wrap-mcp @org/mcp@1.0.0 --local --name custom --force");
		expect(args.packageName).toBe("@org/mcp@1.0.0");
		expect(args.local).toBe(true);
		expect(args.name).toBe("custom");
		expect(args.force).toBe(true);
	});

	it("returns undefined packageName when missing", () => {
		const args = parseWrapMcpArgs("/wrap-mcp");
		expect(args.packageName).toBeUndefined();
	});

	it("returns undefined packageName with only flags", () => {
		const args = parseWrapMcpArgs("/wrap-mcp --local --force");
		expect(args.packageName).toBeUndefined();
		expect(args.local).toBe(true);
		expect(args.force).toBe(true);
	});

	it("parses --help flag", () => {
		const args = parseWrapMcpArgs("/wrap-mcp --help");
		expect(args.help).toBe(true);
		expect(args.packageName).toBeUndefined();
	});

	it("parses -h shorthand", () => {
		const args = parseWrapMcpArgs("/wrap-mcp -h");
		expect(args.help).toBe(true);
	});

	it("handles trailing whitespace correctly", () => {
		const args = parseWrapMcpArgs("/wrap-mcp  ");
		expect(args.packageName).toBeUndefined();
	});

	it("handles multiple spaces between arguments", () => {
		const args = parseWrapMcpArgs("/wrap-mcp   my-package   --local   --force");
		expect(args.packageName).toBe("my-package");
		expect(args.local).toBe(true);
		expect(args.force).toBe(true);
	});

	it("does not consume next flag as --name value", () => {
		const args = parseWrapMcpArgs("/wrap-mcp my-pkg --name --force");
		expect(args.packageName).toBe("my-pkg");
		expect(args.name).toBeUndefined();
		expect(args.force).toBe(true);
	});
});

describe("resolvePath", () => {
	it("expands ~ to home directory", () => {
		const resolved = resolvePath("~/test/path");
		expect(resolved).toBe(join(homedir(), "test/path"));
	});

	it("returns absolute paths unchanged", () => {
		expect(resolvePath("/absolute/path")).toBe("/absolute/path");
	});

	it("returns relative paths unchanged", () => {
		expect(resolvePath("relative/path")).toBe("relative/path");
	});
});

describe("getGlobalAgentsPath", () => {
	it("returns path to global AGENTS.md", () => {
		const path = getGlobalAgentsPath();
		expect(path).toBe(join(homedir(), ".pi", "agent", "AGENTS.md"));
	});
});

describe("detectLocalAgentsFile", () => {
	const testDir = join(homedir(), ".pi-wrap-mcp-test-" + Date.now());

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("finds AGENTS.md", () => {
		writeFileSync(join(testDir, "AGENTS.md"), "# Test");
		const result = detectLocalAgentsFile(testDir);
		expect(result).toBe(join(testDir, "AGENTS.md"));
	});

	it("finds CLAUDE.md as fallback", () => {
		writeFileSync(join(testDir, "CLAUDE.md"), "# Test");
		const result = detectLocalAgentsFile(testDir);
		expect(result).toBe(join(testDir, "CLAUDE.md"));
	});

	it("prefers AGENTS.md over CLAUDE.md", () => {
		writeFileSync(join(testDir, "AGENTS.md"), "# Test");
		writeFileSync(join(testDir, "CLAUDE.md"), "# Test");
		const result = detectLocalAgentsFile(testDir);
		expect(result).toBe(join(testDir, "AGENTS.md"));
	});

	it("returns AGENTS.md path when neither exists", () => {
		const result = detectLocalAgentsFile(testDir);
		expect(result).toBe(join(testDir, "AGENTS.md"));
	});
});
