import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("Package Manager SSH URL Support", () => {
	let tempDir: string;
	let agentDir: string;
	let settingsManager: SettingsManager;
	let packageManager: DefaultPackageManager;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pm-ssh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });

		settingsManager = SettingsManager.inMemory();
		packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("parseSource with SSH URLs", () => {
		it("should parse git@host:path format", () => {
			const parsed = (packageManager as any).parseSource("git@github.com:user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("git@github.com:user/repo");
			expect(parsed.pinned).toBe(false);
		});

		it("should parse git@host:path with ref", () => {
			const parsed = (packageManager as any).parseSource("git@github.com:user/repo@v1.0.0");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.ref).toBe("v1.0.0");
			expect(parsed.repo).toBe("git@github.com:user/repo");
			expect(parsed.pinned).toBe(true);
		});

		it("should parse ssh:// protocol format", () => {
			const parsed = (packageManager as any).parseSource("ssh://git@github.com/user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("ssh://git@github.com/user/repo");
		});

		it("should parse ssh:// with port", () => {
			const parsed = (packageManager as any).parseSource("ssh://git@github.com:22/user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("ssh://git@github.com:22/user/repo");
		});

		it("should parse git: prefix with SSH URL", () => {
			const parsed = (packageManager as any).parseSource("git:git@github.com:user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("git@github.com:user/repo");
		});

		it("should parse .git suffix", () => {
			const parsed = (packageManager as any).parseSource("git@github.com:user/repo.git");
			expect(parsed.type).toBe("git");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("git@github.com:user/repo.git");
		});
	});

	describe("getPackageIdentity with SSH URLs", () => {
		it("should normalize SSH URL to same identity as HTTPS", () => {
			const sshIdentity = (packageManager as any).getPackageIdentity("git@github.com:user/repo");
			const httpsIdentity = (packageManager as any).getPackageIdentity("https://github.com/user/repo");
			expect(sshIdentity).toBe(httpsIdentity);
			expect(sshIdentity).toBe("git:github.com/user/repo");
		});

		it("should normalize ssh:// to same identity as git@", () => {
			const sshProtocol = (packageManager as any).getPackageIdentity("ssh://git@github.com/user/repo");
			const gitAt = (packageManager as any).getPackageIdentity("git@github.com:user/repo");
			expect(sshProtocol).toBe(gitAt);
		});

		it("should ignore ref in identity", () => {
			const withRef = (packageManager as any).getPackageIdentity("git@github.com:user/repo@v1.0.0");
			const withoutRef = (packageManager as any).getPackageIdentity("git@github.com:user/repo");
			expect(withRef).toBe(withoutRef);
		});
	});

	describe("SSH URL install behavior", () => {
		it("should emit start event for SSH URL install", async () => {
			const events: any[] = [];
			packageManager.setProgressCallback((event) => events.push(event));

			try {
				await packageManager.install("git@github.com:nonexistent/repo");
			} catch {
				// Expected to fail - repo doesn't exist or no SSH access
			}

			expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
		});

		it("should emit start event for ssh:// URL install", async () => {
			const events: any[] = [];
			packageManager.setProgressCallback((event) => events.push(event));

			try {
				await packageManager.install("ssh://git@github.com/nonexistent/repo");
			} catch {
				// Expected to fail
			}

			expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
		});
	});

	describe("different git hosts", () => {
		it("should parse GitLab SSH URL", () => {
			const parsed = (packageManager as any).parseSource("git@gitlab.com:group/project");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("gitlab.com");
			expect(parsed.path).toBe("group/project");
			expect(parsed.repo).toBe("git@gitlab.com:group/project");
		});

		it("should parse Bitbucket SSH URL", () => {
			const parsed = (packageManager as any).parseSource("git@bitbucket.org:team/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("bitbucket.org");
			expect(parsed.path).toBe("team/repo");
			expect(parsed.repo).toBe("git@bitbucket.org:team/repo");
		});
	});
});
