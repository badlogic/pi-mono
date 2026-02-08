import { describe, expect, it } from "vitest";
import { parseGitUrl } from "../src/utils/git.js";

describe("SSH Git URL Parsing", () => {
	describe("ssh:// protocol", () => {
		it("should parse basic ssh:// URL", () => {
			const result = parseGitUrl("ssh://git@github.com/user/repo");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "ssh://git@github.com/user/repo",
			});
			expect(result?.ref).toBeUndefined();
		});

		it("should parse ssh:// URL with port", () => {
			const result = parseGitUrl("ssh://git@github.com:22/user/repo");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "ssh://git@github.com:22/user/repo",
			});
		});

		it("should parse ssh:// URL with .git suffix", () => {
			const result = parseGitUrl("ssh://git@github.com/user/repo.git");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "ssh://git@github.com/user/repo.git",
			});
		});

		it("should parse ssh:// URL with ref", () => {
			const result = parseGitUrl("ssh://git@github.com/user/repo@v1.0.0");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				ref: "v1.0.0",
				repo: "ssh://git@github.com/user/repo",
			});
		});
	});

	describe("git@host:path pattern", () => {
		it("should parse basic git@host:path", () => {
			const result = parseGitUrl("git@github.com:user/repo");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "git@github.com:user/repo",
			});
			expect(result?.ref).toBeUndefined();
		});

		it("should parse git@host:path with .git", () => {
			const result = parseGitUrl("git@github.com:user/repo.git");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "git@github.com:user/repo.git",
			});
		});

		it("should parse git@host:path with ref", () => {
			const result = parseGitUrl("git@github.com:user/repo@v1.0.0");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				ref: "v1.0.0",
				repo: "git@github.com:user/repo",
			});
		});

		it("should parse git@host:path with ref and .git", () => {
			const result = parseGitUrl("git@github.com:user/repo.git@main");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				ref: "main",
				repo: "git@github.com:user/repo.git",
			});
		});
	});

	describe("HTTPS URLs", () => {
		it("should parse HTTPS URL", () => {
			const result = parseGitUrl("https://github.com/user/repo");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "https://github.com/user/repo",
			});
		});

		it("should parse shorthand URL", () => {
			const result = parseGitUrl("github.com/user/repo");
			expect(result).toMatchObject({
				host: "github.com",
				path: "user/repo",
				repo: "https://github.com/user/repo",
			});
		});
	});

	describe("edge cases", () => {
		it("should return null for invalid URLs", () => {
			expect(parseGitUrl("git@github.com")).toBeNull();
			expect(parseGitUrl("not-a-url")).toBeNull();
		});

		it("should handle different hosts", () => {
			expect(parseGitUrl("git@gitlab.com:user/repo")?.host).toBe("gitlab.com");
			expect(parseGitUrl("git@bitbucket.org:user/repo")?.host).toBe("bitbucket.org");
		});
	});
});
