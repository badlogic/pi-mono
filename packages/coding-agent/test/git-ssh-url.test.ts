import { describe, expect, it } from "vitest";
import { looksLikeSshGitUrl, parseSshGitUrl } from "../src/utils/git.js";

describe("SSH Git URL Detection", () => {
	it("should detect ssh:// protocol URLs", () => {
		expect(looksLikeSshGitUrl("ssh://git@github.com/user/repo")).toBe(true);
		expect(looksLikeSshGitUrl("ssh://git@gitlab.com/user/repo")).toBe(true);
	});

	it("should detect git@host:path pattern", () => {
		expect(looksLikeSshGitUrl("git@github.com:user/repo")).toBe(true);
		expect(looksLikeSshGitUrl("git@gitlab.com:user/repo.git")).toBe(true);
	});

	it("should not detect HTTPS URLs", () => {
		expect(looksLikeSshGitUrl("https://github.com/user/repo")).toBe(false);
		expect(looksLikeSshGitUrl("http://github.com/user/repo")).toBe(false);
	});

	it("should not detect plain host/path", () => {
		expect(looksLikeSshGitUrl("github.com/user/repo")).toBe(false);
	});
});

describe("SSH Git URL Parsing", () => {
	describe("ssh:// protocol", () => {
		it("should parse basic ssh:// URL", () => {
			const result = parseSshGitUrl("ssh://git@github.com/user/repo");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: undefined,
			});
		});

		it("should parse ssh:// URL with port", () => {
			const result = parseSshGitUrl("ssh://git@github.com:22/user/repo");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: undefined,
			});
		});

		it("should parse ssh:// URL with .git suffix", () => {
			const result = parseSshGitUrl("ssh://git@github.com/user/repo.git");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: undefined,
			});
		});

		it("should parse ssh:// URL with ref", () => {
			const result = parseSshGitUrl("ssh://git@github.com/user/repo@v1.0.0");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: "v1.0.0",
			});
		});

		it("should parse ssh:// URL with ref and .git", () => {
			const result = parseSshGitUrl("ssh://git@github.com/user/repo.git@main");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: "main",
			});
		});
	});

	describe("git@host:path pattern", () => {
		it("should parse basic git@host:path", () => {
			const result = parseSshGitUrl("git@github.com:user/repo");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: undefined,
			});
		});

		it("should parse git@host:path with .git", () => {
			const result = parseSshGitUrl("git@github.com:user/repo.git");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: undefined,
			});
		});

		it("should parse git@host:path with ref", () => {
			const result = parseSshGitUrl("git@github.com:user/repo@v1.0.0");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: "v1.0.0",
			});
		});

		it("should parse git@host:path with ref and .git", () => {
			const result = parseSshGitUrl("git@github.com:user/repo.git@main");
			expect(result).toEqual({
				host: "github.com",
				path: "user/repo",
				ref: "main",
			});
		});

		it("should parse with nested path", () => {
			const result = parseSshGitUrl("git@github.com:org/team/project");
			expect(result).toEqual({
				host: "github.com",
				path: "org/team/project",
				ref: undefined,
			});
		});
	});

	describe("edge cases", () => {
		it("should return null for invalid SSH URLs", () => {
			expect(parseSshGitUrl("https://github.com/user/repo")).toBeNull();
			expect(parseSshGitUrl("github.com/user/repo")).toBeNull();
			expect(parseSshGitUrl("git@github.com")).toBeNull();
		});

		it("should handle different hosts", () => {
			const gitlab = parseSshGitUrl("git@gitlab.com:user/repo");
			expect(gitlab?.host).toBe("gitlab.com");

			const bitbucket = parseSshGitUrl("git@bitbucket.org:user/repo");
			expect(bitbucket?.host).toBe("bitbucket.org");

			const custom = parseSshGitUrl("git@git.company.com:user/repo");
			expect(custom?.host).toBe("git.company.com");
		});
	});
});
