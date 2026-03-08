import { describe, expect, it, vi } from "vitest";
import { resolveCliCommand, runCli } from "../src/cli/command-router.js";

describe("CLI command router", () => {
	it("routes empty args to launch", () => {
		expect(resolveCliCommand([])).toEqual({
			command: "launch",
			forwardedArgs: [],
		});
	});

	it("routes flag-only invocations to launch without rewriting args", () => {
		expect(resolveCliCommand(["--help"])).toEqual({
			command: "launch",
			forwardedArgs: ["--help"],
		});
	});

	it("routes explicit launch and strips the subcommand", () => {
		expect(resolveCliCommand(["launch", "--print", "hello"])).toEqual({
			command: "launch",
			forwardedArgs: ["--print", "hello"],
		});
	});

	it("routes agents and strips the subcommand", () => {
		expect(resolveCliCommand(["agents", "--json"])).toEqual({
			command: "agents",
			forwardedArgs: ["--json"],
		});
	});

	it("routes commit and strips the subcommand", () => {
		expect(resolveCliCommand(["commit", "--dry-run"])).toEqual({
			command: "commit",
			forwardedArgs: ["--dry-run"],
		});
	});

	it("routes grep and strips the subcommand", () => {
		expect(resolveCliCommand(["grep", "TODO", "src"])).toEqual({
			command: "grep",
			forwardedArgs: ["TODO", "src"],
		});
	});

	it("routes jupyter and strips the subcommand", () => {
		expect(resolveCliCommand(["jupyter", "status", "--json"])).toEqual({
			command: "jupyter",
			forwardedArgs: ["status", "--json"],
		});
	});

	it("routes plugin and strips the subcommand", () => {
		expect(resolveCliCommand(["plugin", "list", "--json"])).toEqual({
			command: "plugin",
			forwardedArgs: ["list", "--json"],
		});
	});

	it("routes q alias and strips the subcommand", () => {
		expect(resolveCliCommand(["q", "hello", "world"])).toEqual({
			command: "search",
			forwardedArgs: ["hello", "world"],
		});
	});

	it("routes ssh and strips the subcommand", () => {
		expect(resolveCliCommand(["ssh", "list"])).toEqual({
			command: "ssh",
			forwardedArgs: ["list"],
		});
	});

	it("routes setup and strips the subcommand", () => {
		expect(resolveCliCommand(["setup", "python", "--check"])).toEqual({
			command: "setup",
			forwardedArgs: ["python", "--check"],
		});
	});

	it("routes shell and strips the subcommand", () => {
		expect(resolveCliCommand(["shell", "--timeout", "1000"])).toEqual({
			command: "shell",
			forwardedArgs: ["--timeout", "1000"],
		});
	});

	it("routes stats and strips the subcommand", () => {
		expect(resolveCliCommand(["stats", "--sync"])).toEqual({
			command: "stats",
			forwardedArgs: ["--sync"],
		});
	});

	it("preserves existing main-command style invocations for compatibility", () => {
		expect(resolveCliCommand(["install", "./pkg"])).toEqual({
			command: "launch",
			forwardedArgs: ["install", "./pkg"],
		});
	});

	it("dispatches to the selected handler", async () => {
		const launch = vi.fn(async () => {});
		const agents = vi.fn(async () => {});
		const commit = vi.fn(async () => {});
		const grep = vi.fn(async () => {});
		const jupyter = vi.fn(async () => {});
		const ssh = vi.fn(async () => {});
		const plugin = vi.fn(async () => {});
		const search = vi.fn(async () => {});
		const setup = vi.fn(async () => {});
		const shell = vi.fn(async () => {});
		const stats = vi.fn(async () => {});

		await runCli(["stats", "--json"], {
			agents,
			commit,
			grep,
			jupyter,
			launch,
			plugin,
			search,
			setup,
			shell,
			ssh,
			stats,
		});

		expect(stats).toHaveBeenCalledWith(["--json"]);
		expect(agents).not.toHaveBeenCalled();
		expect(commit).not.toHaveBeenCalled();
		expect(grep).not.toHaveBeenCalled();
		expect(jupyter).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(plugin).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
		expect(setup).not.toHaveBeenCalled();
		expect(shell).not.toHaveBeenCalled();
		expect(ssh).not.toHaveBeenCalled();
	});

	it("falls back to launch for unrecognized commands", async () => {
		const launch = vi.fn(async () => {});
		const agents = vi.fn(async () => {});
		const commit = vi.fn(async () => {});
		const grep = vi.fn(async () => {});
		const jupyter = vi.fn(async () => {});
		const ssh = vi.fn(async () => {});
		const plugin = vi.fn(async () => {});
		const search = vi.fn(async () => {});
		const setup = vi.fn(async () => {});
		const shell = vi.fn(async () => {});
		const stats = vi.fn(async () => {});

		await runCli(["some prompt"], {
			agents,
			commit,
			grep,
			jupyter,
			launch,
			plugin,
			search,
			setup,
			shell,
			ssh,
			stats,
		});

		expect(launch).toHaveBeenCalledWith(["some prompt"]);
		expect(agents).not.toHaveBeenCalled();
		expect(commit).not.toHaveBeenCalled();
		expect(grep).not.toHaveBeenCalled();
		expect(jupyter).not.toHaveBeenCalled();
		expect(plugin).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
		expect(setup).not.toHaveBeenCalled();
		expect(shell).not.toHaveBeenCalled();
		expect(ssh).not.toHaveBeenCalled();
		expect(stats).not.toHaveBeenCalled();
	});
});
