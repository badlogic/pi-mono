import type * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildEvolutionRunInvocation,
	buildEvolutionSetupDiagnostics,
	evolutionRuntime,
	executeEvolutionRequest,
	initEvolutionDatasetSkeleton,
	listEvolutionTargets,
	parseEvolutionCommand,
	readEvolutionStatus,
	readRememberedEvolutionCwd,
	rememberEvolutionCwd,
	resolveEvolutionCwd,
} from "../src/evolution.js";

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function commandResult(ok: boolean, stdout = "", stderr = "") {
	return { ok, stdout, stderr, exitCode: ok ? 0 : 1 };
}

describe("evolution tools", () => {
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		agentDir = makeTempDir("evolution-agent-");
		cwd = makeTempDir("evolution-cwd-");
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.PI_CODING_AGENT_DIR;
		fs.rmSync(agentDir, { recursive: true, force: true });
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("lists skills from user and project roots", () => {
		const userSkill = path.join(agentDir, "skills", "reviewer", "SKILL.md");
		const projectSkill = path.join(cwd, ".pi", "skills", "release-checks", "SKILL.md");
		fs.mkdirSync(path.dirname(userSkill), { recursive: true });
		fs.mkdirSync(path.dirname(projectSkill), { recursive: true });
		fs.writeFileSync(userSkill, "---\nname: reviewer\ndescription: review\n---\n");
		fs.writeFileSync(projectSkill, "---\nname: release-checks\ndescription: release\n---\n");

		expect(listEvolutionTargets(cwd)).toEqual([
			{
				name: "release-checks",
				scope: "project",
				relativePath: "release-checks",
				filePath: projectSkill,
			},
			{
				name: "reviewer",
				scope: "user",
				relativePath: "reviewer",
				filePath: userSkill,
			},
		]);
	});

	it("initializes dataset skeletons and protects existing files", () => {
		const first = initEvolutionDatasetSkeleton(cwd, "release-checks");
		expect(first.datasetPath).toBe(path.join(cwd, ".pi", "evolution", "datasets", "skills", "release-checks"));
		expect(fs.existsSync(path.join(first.datasetPath, "train.jsonl"))).toBe(true);
		expect(() => initEvolutionDatasetSkeleton(cwd, "release-checks")).toThrow(/overwrite=true/);
		expect(() => initEvolutionDatasetSkeleton(cwd, "release-checks", true)).not.toThrow();
	});

	it("remembers and reuses the last cwd", () => {
		rememberEvolutionCwd(cwd);
		expect(readRememberedEvolutionCwd()).toBe(cwd);
		expect(resolveEvolutionCwd(undefined, process.cwd())).toBe(cwd);
	});

	it("builds python invocations for dry runs and real runs", () => {
		const skillFile = path.join(cwd, ".pi", "skills", "release-checks", "SKILL.md");
		fs.mkdirSync(path.dirname(skillFile), { recursive: true });
		fs.writeFileSync(skillFile, "---\nname: release-checks\ndescription: release\n---\n");

		const spawnSync = vi.spyOn(evolutionRuntime, "runProcessSync");
		spawnSync.mockReturnValue(commandResult(true, "", "Python 3.12.0"));

		const invocation = buildEvolutionRunInvocation(
			{ action: "run", skillName: "release-checks", dryRun: true, iterations: 7 },
			cwd,
			{
				name: "release-checks",
				scope: "project",
				relativePath: "release-checks",
				filePath: skillFile,
			},
		);
		expect(invocation.pythonCommand).toBe("python3");
		expect(invocation.args).toContain("--dry-run");
		expect(invocation.args).toContain("--iterations");
		expect(invocation.args).toContain("7");
		expect(invocation.runDir).toContain(path.join(cwd, ".pi", "evolution", "runs", "release-checks"));
		expect(invocation.datasetPath).toBe(path.join(cwd, ".pi", "evolution", "datasets", "skills", "release-checks"));
	});

	it("parses evolution slash commands", () => {
		expect(parseEvolutionCommand("run release-checks --dry-run --iterations 9").request).toEqual({
			action: "run",
			cwd: undefined,
			skillName: "release-checks",
			datasetPath: undefined,
			iterations: 9,
			evalSource: undefined,
			optimizerModel: undefined,
			evalModel: undefined,
			dryRun: true,
		});
		expect(parseEvolutionCommand("targets --cwd ./work").request).toEqual({
			action: "targets",
			cwd: "./work",
		});
		expect(parseEvolutionCommand("status release-checks").request).toEqual({
			action: "status",
			cwd: undefined,
			skillName: "release-checks",
		});
	});

	it("parses saved run metrics for status", () => {
		const runDir = path.join(cwd, ".pi", "evolution", "runs", "release-checks", "2026-03-09T12-00-00-000Z");
		fs.mkdirSync(runDir, { recursive: true });
		fs.writeFileSync(
			path.join(runDir, "metrics.json"),
			JSON.stringify({
				skill_name: "release-checks",
				status: "completed",
				improvement: 0.22,
				candidate_path: path.join(runDir, "candidate_skill.md"),
				baseline_path: path.join(runDir, "baseline_skill.md"),
			}),
		);

		const status = readEvolutionStatus(cwd, "release-checks");
		expect(status.runDir).toBe(runDir);
		expect(status.metrics?.improvement).toBe(0.22);
	});

	it("runs dry-run jobs under .pi/evolution without touching live skills", async () => {
		const skillFile = path.join(cwd, ".pi", "skills", "release-checks", "SKILL.md");
		fs.mkdirSync(path.dirname(skillFile), { recursive: true });
		const baseline = "---\nname: release-checks\ndescription: release\n---\n\nOriginal body\n";
		fs.writeFileSync(skillFile, baseline);

		const spawnSync = vi.spyOn(evolutionRuntime, "runProcessSync");
		spawnSync
			.mockReturnValueOnce(commandResult(true, "", "Python 3.12.0"))
			.mockReturnValueOnce(commandResult(true, "", "Python 3.12.0"))
			.mockReturnValueOnce(commandResult(true, "", ""));

		vi.spyOn(evolutionRuntime, "spawn").mockImplementation((_command, args) => {
			const runDir = String(args[args.indexOf("--run-dir") + 1]);
			const datasetPath = String(args[args.indexOf("--dataset-path") + 1]);
			fs.mkdirSync(runDir, { recursive: true });
			fs.mkdirSync(datasetPath, { recursive: true });
			fs.writeFileSync(path.join(runDir, "baseline_skill.md"), baseline);
			fs.writeFileSync(path.join(runDir, "candidate_skill.md"), baseline);
			fs.writeFileSync(
				path.join(runDir, "metrics.json"),
				JSON.stringify({
					skill_name: "release-checks",
					status: "dry_run",
					dry_run: true,
					improvement: 0,
					candidate_path: path.join(runDir, "candidate_skill.md"),
					baseline_path: path.join(runDir, "baseline_skill.md"),
				}),
			);

			const child = {
				stdout: {
					on(event: string, handler: (chunk: string) => void) {
						if (event === "data") handler("dry run complete\n");
						return this;
					},
				},
				stderr: {
					on() {
						return this;
					},
				},
				on(event: string, handler: (value?: number | Error) => void) {
					if (event === "close") handler(0);
					return this;
				},
				kill() {
					return true;
				},
			};

			return child as unknown as childProcess.ChildProcess;
		});

		const result = await executeEvolutionRequest({ action: "run", skillName: "release-checks", dryRun: true }, cwd);
		expect(result.isError).toBe(false);
		expect((result.content[0] as { type: "text"; text: string }).text).toContain(".pi/evolution/runs/release-checks");
		expect(fs.readFileSync(skillFile, "utf8")).toBe(baseline);
	});

	it("reports missing setup dependencies clearly", () => {
		const spawnSync = vi.spyOn(evolutionRuntime, "runProcessSync");
		spawnSync
			.mockReturnValueOnce(commandResult(true, "", "Python 3.12.0"))
			.mockReturnValueOnce(commandResult(false, "", "missing imports"));

		const diagnostics = buildEvolutionSetupDiagnostics(cwd);
		expect(diagnostics.pythonAvailable).toBe(true);
		expect(diagnostics.missingPackages).toEqual(["dspy", "openai", "pyyaml", "click", "rich"]);
	});
});
