import { mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkPi,
	deriveDirName,
	deriveServerName,
	isNpmNotFoundError,
	isUvxNotFoundError,
} from "../src/wrap-mcp/discovery.js";
import { parseWrapMcpArgs } from "../src/wrap-mcp/index.js";
import { resolvePath } from "../src/wrap-mcp/output.js";
import { detectLocalAgentsFile, getGlobalAgentsPath } from "../src/wrap-mcp/registration.js";
import {
	buildMcpCommand,
	fetchPackageDescription,
	getRunnerType,
	hasExplicitRunner,
	toModuleName,
} from "../src/wrap-mcp/runner.js";

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

	it("handles Python-style package names", () => {
		expect(deriveServerName("mcp-server-fetch")).toBe("server-fetch");
	});
});

describe("deriveDirName", () => {
	it("derives directory name from package", () => {
		expect(deriveDirName("chrome-devtools-mcp")).toBe("chrome-devtools");
		expect(deriveDirName("@org/my-mcp-server-mcp")).toBe("my-mcp-server");
	});
});

describe("toModuleName", () => {
	it("converts hyphens to underscores", () => {
		expect(toModuleName("mcp-server-fetch")).toBe("mcp_server_fetch");
	});

	it("preserves names without hyphens", () => {
		expect(toModuleName("mcpserver")).toBe("mcpserver");
	});

	it("handles multiple hyphens", () => {
		expect(toModuleName("my-cool-mcp-server")).toBe("my_cool_mcp_server");
	});
});

describe("hasExplicitRunner", () => {
	it("returns false when no options", () => {
		expect(hasExplicitRunner({})).toBe(false);
	});

	it("returns true for --uvx", () => {
		expect(hasExplicitRunner({ uvx: true })).toBe(true);
	});

	it("returns true for --pip", () => {
		expect(hasExplicitRunner({ pip: true })).toBe(true);
	});

	it("returns true for --command", () => {
		expect(hasExplicitRunner({ command: "docker run mcp" })).toBe(true);
	});

	it("returns false for empty command string", () => {
		expect(hasExplicitRunner({ command: "" })).toBe(false);
	});
});

describe("getRunnerType", () => {
	it("returns npx by default", () => {
		expect(getRunnerType({})).toBe("npx");
	});

	it("returns uvx when --uvx", () => {
		expect(getRunnerType({ uvx: true })).toBe("uvx");
	});

	it("returns pip when --pip", () => {
		expect(getRunnerType({ pip: true })).toBe("pip");
	});

	it("returns command when --command", () => {
		expect(getRunnerType({ command: "docker run mcp" })).toBe("command");
	});

	it("command takes precedence over other flags", () => {
		expect(getRunnerType({ uvx: true, command: "docker" })).toBe("command");
	});
});

describe("buildMcpCommand", () => {
	describe("npx runner", () => {
		it("builds npx command for simple package", () => {
			expect(buildMcpCommand("chrome-devtools-mcp", "npx")).toBe("npx -y chrome-devtools-mcp@latest");
		});

		it("builds npx command for scoped package", () => {
			expect(buildMcpCommand("@anthropic-ai/chrome-devtools-mcp", "npx")).toBe(
				"npx -y @anthropic-ai/chrome-devtools-mcp@latest",
			);
		});

		it("preserves explicit version", () => {
			expect(buildMcpCommand("my-mcp@1.2.3", "npx")).toBe("npx -y my-mcp@1.2.3");
			expect(buildMcpCommand("@org/my-mcp@2.0.0", "npx")).toBe("npx -y @org/my-mcp@2.0.0");
		});
	});

	describe("uvx runner", () => {
		it("builds uvx command", () => {
			expect(buildMcpCommand("mcp-server-fetch", "uvx")).toBe("uvx mcp-server-fetch");
		});

		it("does not add suffix for uvx", () => {
			expect(buildMcpCommand("mcp-server-fetch", "uvx")).not.toContain("@latest");
		});
	});

	describe("pip runner", () => {
		it("builds pip command with module transform", () => {
			expect(buildMcpCommand("mcp-server-fetch", "pip")).toBe("python -m mcp_server_fetch");
		});

		it("transforms hyphens to underscores", () => {
			expect(buildMcpCommand("my-cool-package", "pip")).toBe("python -m my_cool_package");
		});
	});

	describe("command runner", () => {
		it("returns custom command", () => {
			expect(buildMcpCommand("anything", "command", "docker run -i mcp/fetch")).toBe("docker run -i mcp/fetch");
		});

		it("throws if command runner without custom command", () => {
			expect(() => buildMcpCommand("pkg", "command")).toThrow("Custom command required");
		});

		it("throws if custom command is undefined", () => {
			expect(() => buildMcpCommand("pkg", "command", undefined)).toThrow();
		});
	});
});

describe("checkPi", () => {
	it("returns boolean indicating pi availability", () => {
		const result = checkPi();
		expect(typeof result).toBe("boolean");
	});
});

describe("isNpmNotFoundError", () => {
	it("detects E404 error", () => {
		expect(isNpmNotFoundError("npm error code E404")).toBe(true);
	});

	it("detects '404 not found' error", () => {
		expect(isNpmNotFoundError("npm error 404 Not Found")).toBe(true);
	});

	it("detects 'not in this registry' error", () => {
		expect(isNpmNotFoundError("'pkg@latest' is not in this registry")).toBe(true);
	});

	it("returns false for other errors", () => {
		expect(isNpmNotFoundError("ECONNREFUSED")).toBe(false);
		expect(isNpmNotFoundError("ETIMEDOUT")).toBe(false);
		expect(isNpmNotFoundError("permission denied")).toBe(false);
	});

	it("handles empty string", () => {
		expect(isNpmNotFoundError("")).toBe(false);
	});
});

describe("isUvxNotFoundError", () => {
	it("detects 'no solution found' error", () => {
		expect(isUvxNotFoundError("No solution found when resolving tool dependencies")).toBe(true);
	});

	it("detects 'not found in the package registry' error", () => {
		expect(isUvxNotFoundError("was not found in the package registry")).toBe(true);
	});

	it("returns false for other errors", () => {
		expect(isUvxNotFoundError("permission denied")).toBe(false);
		expect(isUvxNotFoundError("timeout")).toBe(false);
	});

	it("handles empty string", () => {
		expect(isUvxNotFoundError("")).toBe(false);
	});
});

describe("parseWrapMcpArgs", () => {
	it("parses package name", () => {
		const args = parseWrapMcpArgs("/wrap-mcp chrome-devtools-mcp");
		expect(args.packageName).toBe("chrome-devtools-mcp");
		expect(args.local).toBe(false);
		expect(args.force).toBe(false);
		expect(args.help).toBe(false);
		expect(args.uvx).toBe(false);
		expect(args.pip).toBe(false);
		expect(args.command).toBeUndefined();
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

	it("parses --uvx flag", () => {
		const args = parseWrapMcpArgs("/wrap-mcp mcp-server-fetch --uvx");
		expect(args.packageName).toBe("mcp-server-fetch");
		expect(args.uvx).toBe(true);
	});

	it("parses --pip flag", () => {
		const args = parseWrapMcpArgs("/wrap-mcp mcp-server-fetch --pip");
		expect(args.packageName).toBe("mcp-server-fetch");
		expect(args.pip).toBe(true);
	});

	it("parses --command option", () => {
		// Note: Our parser uses simple whitespace splitting, so complex commands
		// with spaces should be passed as a single token (handled by shell quoting
		// before reaching our parser in TUI). For testing, use a simple command.
		const args = parseWrapMcpArgs("/wrap-mcp fetch --command docker-run-mcp");
		expect(args.packageName).toBe("fetch");
		expect(args.command).toBe("docker-run-mcp");
	});

	it("handles combined flags", () => {
		const args = parseWrapMcpArgs("/wrap-mcp @org/mcp@1.0.0 --local --name custom --force");
		expect(args.packageName).toBe("@org/mcp@1.0.0");
		expect(args.local).toBe(true);
		expect(args.name).toBe("custom");
		expect(args.force).toBe(true);
	});

	it("combines runner and other options", () => {
		const args = parseWrapMcpArgs("/wrap-mcp mcp-server-fetch --uvx --local --force");
		expect(args.packageName).toBe("mcp-server-fetch");
		expect(args.uvx).toBe(true);
		expect(args.local).toBe(true);
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

	it("does not consume next flag as --command value", () => {
		const args = parseWrapMcpArgs("/wrap-mcp my-pkg --command --force");
		expect(args.packageName).toBe("my-pkg");
		expect(args.command).toBeUndefined();
		expect(args.force).toBe(true);
	});

	it("defaults runner flags to false", () => {
		const args = parseWrapMcpArgs("/wrap-mcp my-mcp");
		expect(args.uvx).toBe(false);
		expect(args.pip).toBe(false);
		expect(args.command).toBeUndefined();
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

describe("fetchPackageDescription", () => {
	it("returns undefined for command runner", async () => {
		const result = await fetchPackageDescription("anything", "command");
		expect(result).toBeUndefined();
	});

	it("returns undefined for non-existent npm package", async () => {
		const result = await fetchPackageDescription("this-package-definitely-does-not-exist-xyz-123", "npx");
		expect(result).toBeUndefined();
	});

	it("returns undefined for non-existent PyPI package", async () => {
		const result = await fetchPackageDescription("this-package-definitely-does-not-exist-xyz-123", "uvx");
		expect(result).toBeUndefined();
	});
});
