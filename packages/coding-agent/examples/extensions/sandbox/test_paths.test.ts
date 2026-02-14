/**
 * Test file for isReadAllowed and isWriteAllowed functions
 *
 * This test file verifies that the filesystem access control functions
 * behave according to the DEFAULT_CONFIG and platform-specific rules:
 *
 * - isReadAllowed: DENY-ONLY pattern (allow by default, deny specific paths)
 * - isWriteAllowed: ALLOW-ONLY pattern (deny by default, allow specific paths)
 *
 * Platform differences:
 * - macOS: Supports glob patterns (*, **, ?, [abc]) for path matching
 * - Linux: Only supports literal path matching or prefix matching (no globs)
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, expandPath, isReadAllowed, isWriteAllowed, matchesAnyPattern, resolvePath } from "./index.js";

// Use actual process.platform
const platform = process.platform;

describe("path access control functions", () => {
	const cwd = process.cwd();
	const config = DEFAULT_CONFIG;

	describe("expandPath", () => {
		it("should expand ~ to home directory", () => {
			const result = expandPath("~");
			expect(result).toBe(homedir());
		});

		it("should expand ~/path to home directory", () => {
			const result = expandPath("~/Documents/file.txt");
			expect(result).toBe(join(homedir(), "Documents/file.txt"));
		});

		it("should not modify paths that don't start with ~", () => {
			const result = expandPath("/absolute/path");
			expect(result).toBe("/absolute/path");
		});
	});

	describe("resolvePath", () => {
		it("should resolve absolute paths as-is", () => {
			const result = resolvePath("/absolute/path", cwd);
			expect(result).toBe("/absolute/path");
		});

		it("should resolve relative paths against cwd", () => {
			const result = resolvePath("relative/file.txt", cwd);
			expect(result).toBe(resolve(cwd, "relative/file.txt"));
		});

		it("should expand ~ before resolving", () => {
			const result = resolvePath("~/test.txt", cwd);
			expect(result).toBe(resolve(join(homedir(), "test.txt")));
		});
	});

	describe("matchesAnyPattern", () => {
		it("should match exact paths on Linux", () => {
			if (platform !== "darwin") {
				const result = matchesAnyPattern("/tmp/test.txt", ["/tmp"], cwd, "linux");
				expect(result.matched).toBe(true);
			}
		});

		it("should match glob patterns on macOS", () => {
			if (platform === "darwin") {
				const result = matchesAnyPattern("test.env.production", ["*.env.*"], cwd, "darwin");
				expect(result.matched).toBe(true);
			}
		});

		it("should return the matched pattern", () => {
			const patterns = ["~/.ssh", "~/.aws"];
			const result = matchesAnyPattern("~/.ssh/id_rsa", patterns, cwd, platform);
			if (result.matched) {
				expect(result.pattern).toBe("~/.ssh");
			}
		});
	});

	describe("isReadAllowed", () => {
		it("should allow read access by default (empty denyRead)", () => {
			const testConfig = { ...config, filesystem: { ...config.filesystem, denyRead: [] } };
			const result = isReadAllowed("/any/path", cwd, testConfig, platform);
			expect(result.allowed).toBe(true);
		});

		const readTestCases = [
			// Should be allowed (not in denyRead)
			{ path: ".", expected: true, description: "Current directory" },
			{ path: "./index.ts", expected: true, description: "File in current directory" },
			{ path: "package.json", expected: true, description: "package.json file" },
			{ path: "/tmp/test.txt", expected: true, description: "File in /tmp" },
			{ path: "node_modules", expected: true, description: "node_modules directory" },

			// Should be denied (in denyRead: ~/.ssh, ~/.aws, ~/.gnupg)
			{ path: "~/.ssh", expected: false, description: "SSH directory (denied)" },
			{ path: "~/.ssh/id_rsa", expected: false, description: "SSH key file (denied)" },
			{ path: join(homedir(), ".ssh/id_rsa"), expected: false, description: "SSH key file absolute (denied)" },
			{ path: "~/.aws", expected: false, description: "AWS directory (denied)" },
			{ path: "~/.aws/credentials", expected: false, description: "AWS credentials file (denied)" },
			{ path: "~/.gnupg", expected: false, description: "GPG directory (denied)" },
			{ path: "~/.gnupg/secring.gpg", expected: false, description: "GPG key file (denied)" },
		];

		readTestCases.forEach((testCase) => {
			it(`should ${testCase.expected ? "allow" : "deny"} read: ${testCase.description}`, () => {
				const result = isReadAllowed(testCase.path, cwd, config, platform);
				expect(result.allowed).toBe(testCase.expected);

				if (!testCase.expected) {
					expect(result.reason).toBeDefined();
				}
			});
		});
	});

	describe("isWriteAllowed", () => {
		it("should deny write access by default (empty allowWrite)", () => {
			const testConfig = { ...config, filesystem: { ...config.filesystem, allowWrite: [] } };
			const result = isWriteAllowed("/any/path", cwd, testConfig, platform);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("allowWrite is empty");
		});

		const writeTestCases = [
			// Should be allowed (in allowWrite: ".", "/tmp")
			{ path: ".", expected: true, description: "Current directory (allowed)" },
			{ path: "./test.txt", expected: true, description: "File in current directory (allowed)" },
			{ path: "new-file.js", expected: true, description: "New file in current directory (allowed)" },
			{ path: "/tmp", expected: true, description: "/tmp directory (allowed)" },
			{ path: "/tmp/test.txt", expected: true, description: "File in /tmp (allowed)" },

			// Should be denied (not in allowWrite)
			{ path: "/etc", expected: false, description: "/etc directory (not allowed)" },
			{ path: "/etc/passwd", expected: false, description: "/etc/passwd file (not allowed)" },
			{ path: "/usr/local", expected: false, description: "/usr/local directory (not allowed)" },
			{ path: "../sibling-dir", expected: false, description: "Parent sibling directory (not allowed)" },
			{ path: "~/.config", expected: false, description: "Home config directory (not allowed)" },

			// Should be denied (in denyWrite within allowed paths)
			{ path: ".env", expected: false, description: ".env file (denied within allowed path)" },
			{
				path: ".env.production",
				expected: platform !== "darwin",
				description: ".env.* file (denied on macOS, allowed on Linux - no glob support)",
			},
			{
				path: "key.pem",
				expected: platform !== "darwin",
				description: "*.pem file (denied on macOS, allowed on Linux - no glob support)",
			},
			{
				path: "private.key",
				expected: platform !== "darwin",
				description: "*.key file (denied on macOS, allowed on Linux - no glob support)",
			},

			// Edge cases
			{
				path: "/home/user/test.txt",
				expected: false,
				description: "Absolute path outside allowed directories (denied)",
			},
			{ path: "../test.txt", expected: false, description: "Relative parent path (denied)" },
			{ path: "subdir/test.txt", expected: true, description: "Subdirectory within allowed path (allowed)" },
		];

		writeTestCases.forEach((testCase) => {
			it(`should ${testCase.expected ? "allow" : "deny"} write: ${testCase.description}`, () => {
				const result = isWriteAllowed(testCase.path, cwd, config, platform);
				expect(result.allowed).toBe(testCase.expected);

				if (!testCase.expected) {
					expect(result.reason).toBeDefined();
				}
			});
		});
	});

	describe("platform-specific behavior", () => {
		it("should handle glob patterns differently on macOS vs Linux", () => {
			const testPath = ".env.production";
			const patterns = [".env.*"];

			const macOSResult = matchesAnyPattern(testPath, patterns, cwd, "darwin");
			const linuxResult = matchesAnyPattern(testPath, patterns, cwd, "linux");

			// macOS should match glob patterns
			expect(macOSResult.matched).toBe(true);

			// Linux should not match glob patterns (literal matching only)
			expect(linuxResult.matched).toBe(false);
		});
	});
});
