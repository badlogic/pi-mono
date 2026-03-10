import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const EVOLUTION_ACTIONS = ["setup", "targets", "init_dataset", "run", "status"] as const;
type EvolutionAction = (typeof EVOLUTION_ACTIONS)[number];
type SkillScope = "user" | "project";

export interface EvolutionRequest {
	action: EvolutionAction;
	targetType?: string;
	skillName?: string;
	cwd?: string;
	datasetPath?: string;
	iterations?: number;
	evalSource?: string;
	optimizerModel?: string;
	evalModel?: string;
	dryRun?: boolean;
	overwrite?: boolean;
}

export interface SkillTarget {
	name: string;
	scope: SkillScope;
	relativePath: string;
	filePath: string;
}

export interface EvolutionRunMetrics {
	skill_name?: string;
	run_dir?: string;
	dataset_path?: string;
	status?: string;
	dry_run?: boolean;
	improvement?: number;
	baseline_score?: number;
	candidate_score?: number;
	baseline_size?: number;
	candidate_size?: number;
	iterations?: number;
	eval_source?: string;
	optimizer_model?: string;
	eval_model?: string;
	constraints_passed?: boolean;
	semantic_preservation_score?: number;
	train_examples?: number;
	val_examples?: number;
	holdout_examples?: number;
	candidate_path?: string;
	baseline_path?: string;
}

export interface EvolutionDiagnostics {
	pythonAvailable: boolean;
	pythonVersion?: string;
	missingPackages: string[];
	apiCredentialsAvailable: boolean;
	apiCredentialHint: string;
	writableOutputRoot: boolean;
	error?: string;
}

export interface EvolutionToolDetails {
	action: EvolutionAction;
	cwd: string;
	targetType: string;
	skillName?: string;
	skillPath?: string;
	datasetPath?: string;
	runDir?: string;
	pythonCommand?: string[];
	targets?: SkillTarget[];
	metrics?: EvolutionRunMetrics;
	diagnostics?: EvolutionDiagnostics;
	error?: string;
}

export interface EvolutionToolResult<TDetails = EvolutionToolDetails> {
	content: Array<{ type: "text"; text: string }>;
	details: TDetails;
	isError?: boolean;
}

export type EvolutionToolUpdateCallback<TDetails = EvolutionToolDetails> = (
	result: EvolutionToolResult<TDetails>,
) => void;

export interface CommandParseResult {
	request?: EvolutionRequest;
	usage?: string;
	error?: string;
}

interface ParsedCliArgs {
	positionals: string[];
	options: Record<string, string | boolean>;
	error?: string;
}

const DEFAULT_TARGET_TYPE = "skill";
const DEFAULT_ITERATIONS = 5;
const DEFAULT_OPTIMIZER_MODEL = "openai/gpt-4.1";
const DEFAULT_EVAL_MODEL = "openai/gpt-4.1-mini";
const LAST_CWD_FILENAME = "last-cwd.txt";

export const evolutionRuntime = {
	runProcessSync(
		command: string,
		args: string[],
	): { ok: boolean; stdout: string; stderr: string; exitCode: number | null } {
		try {
			const result = childProcess.spawnSync(command, args, { encoding: "utf8" });
			return {
				ok: (result.status ?? 1) === 0,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				exitCode: result.status ?? null,
			};
		} catch (error) {
			return {
				ok: false,
				stdout: "",
				stderr: error instanceof Error ? error.message : String(error),
				exitCode: null,
			};
		}
	},
	spawn: childProcess.spawn,
};

export const EVOLUTION_COMMAND_USAGE =
	"Usage: /evolution setup [--cwd <path>]\n" +
	"/evolution targets [--cwd <path>]\n" +
	"/evolution init-dataset <skill> [--cwd <path>] [--overwrite]\n" +
	"/evolution run <skill> [--cwd <path>] [--dataset-path <path>] [--iterations <number>] [--eval-source <synthetic|golden>] [--optimizer-model <model>] [--eval-model <model>] [--dry-run]\n" +
	"/evolution status [<skill>] [--cwd <path>]";

function resolveAgentDir(): string {
	const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
	if (explicit) {
		if (explicit === "~") return os.homedir();
		if (explicit.startsWith("~/")) return path.join(os.homedir(), explicit.slice(2));
		return explicit;
	}
	return path.join(os.homedir(), ".pi", "agent");
}

function evolutionRoot(): string {
	return path.join(resolveAgentDir(), "tools", "evolution");
}

function userSkillsRoot(): string {
	return path.join(resolveAgentDir(), "skills");
}

function projectSkillsRoot(cwd: string): string {
	return path.join(cwd, ".pi", "skills");
}

function evolutionProjectRoot(cwd: string): string {
	return path.join(cwd, ".pi", "evolution");
}

function datasetRoot(cwd: string, skillName: string): string {
	return path.join(evolutionProjectRoot(cwd), "datasets", "skills", skillName);
}

function runsRoot(cwd: string, skillName: string): string {
	return path.join(evolutionProjectRoot(cwd), "runs", skillName);
}

function lastCwdFile(): string {
	return path.join(evolutionRoot(), LAST_CWD_FILENAME);
}

function expandHome(candidate: string): string {
	if (candidate === "~") return os.homedir();
	if (candidate.startsWith("~/")) return path.join(os.homedir(), candidate.slice(2));
	return candidate;
}

function resolveMaybeRelativePath(baseCwd: string, candidate: string): string {
	const expanded = expandHome(candidate.trim());
	return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(baseCwd, expanded);
}

export function rememberEvolutionCwd(cwd: string): void {
	const root = evolutionRoot();
	fs.mkdirSync(root, { recursive: true });
	fs.writeFileSync(lastCwdFile(), cwd, "utf8");
}

export function readRememberedEvolutionCwd(): string | undefined {
	const filePath = lastCwdFile();
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const stored = fs.readFileSync(filePath, "utf8").trim();
		if (!stored) return undefined;
		return fs.existsSync(stored) ? stored : undefined;
	} catch {
		return undefined;
	}
}

export function resolveEvolutionCwd(requestCwd: string | undefined, fallbackCwd: string): string {
	if (requestCwd?.trim()) {
		return resolveMaybeRelativePath(fallbackCwd, requestCwd);
	}
	return readRememberedEvolutionCwd() ?? fallbackCwd;
}

function listSkillTargetsInRoot(root: string, scope: SkillScope): SkillTarget[] {
	if (!fs.existsSync(root)) return [];
	const records: SkillTarget[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || entry.name !== "SKILL.md") continue;
			const skillDir = path.dirname(full);
			records.push({
				name: path.basename(skillDir),
				scope,
				relativePath: path.relative(root, skillDir),
				filePath: full,
			});
		}
	}
	return records.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function listEvolutionTargets(cwd: string): SkillTarget[] {
	return [
		...listSkillTargetsInRoot(projectSkillsRoot(cwd), "project"),
		...listSkillTargetsInRoot(userSkillsRoot(), "user"),
	];
}

function findSkillTarget(skillName: string, cwd: string): { target?: SkillTarget; error?: string } {
	const needle = skillName.trim();
	if (!needle) return { error: "skillName is required." };
	const matches = listEvolutionTargets(cwd).filter(
		(target) => target.name === needle || target.relativePath === needle,
	);
	if (matches.length === 0) return { error: `Skill "${needle}" was not found in project or user skill roots.` };
	if (matches.length > 1) {
		return {
			error: `Multiple skills matched "${needle}". Use a relative path. Matches: ${matches.map((target) => `${target.scope}:${target.relativePath}`).join(", ")}`,
		};
	}
	return { target: matches[0] };
}

export function initEvolutionDatasetSkeleton(
	cwd: string,
	skillName: string,
	overwrite = false,
): { datasetPath: string; created: boolean } {
	const root = datasetRoot(cwd, skillName);
	const splitFiles = ["train.jsonl", "val.jsonl", "holdout.jsonl"].map((fileName) => path.join(root, fileName));
	const exists = splitFiles.some((filePath) => fs.existsSync(filePath));
	if (exists && !overwrite) {
		throw new Error(`Dataset already exists at ${root}. Set overwrite=true to replace it.`);
	}
	fs.mkdirSync(root, { recursive: true });
	for (const filePath of splitFiles) {
		fs.writeFileSync(filePath, "", "utf8");
	}
	return { datasetPath: root, created: true };
}

function helperScriptPath(): string {
	return fileURLToPath(new URL("../python/evolve_skill.py", import.meta.url));
}

function detectPython(): { command?: string; version?: string } {
	for (const candidate of ["python3", "python"]) {
		const result = evolutionRuntime.runProcessSync(candidate, ["--version"]);
		if (result.ok) {
			return { command: candidate, version: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] };
		}
	}
	return {};
}

export function buildEvolutionSetupDiagnostics(cwd: string): EvolutionDiagnostics {
	const python = detectPython();
	if (!python.command) {
		return {
			pythonAvailable: false,
			missingPackages: ["dspy", "openai", "pyyaml", "click", "rich"],
			apiCredentialsAvailable: false,
			apiCredentialHint: "Set OPENAI_API_KEY or use another provider model supported by DSPy.",
			writableOutputRoot: false,
			error: "Python not found on PATH.",
		};
	}
	const importCheck = evolutionRuntime.runProcessSync(python.command, [
		"-c",
		"import dspy, openai, yaml, click, rich",
	]);
	const missingPackages = importCheck.ok ? [] : ["dspy", "openai", "pyyaml", "click", "rich"];
	const outputRoot = evolutionProjectRoot(cwd);
	let writableOutputRoot = true;
	try {
		fs.mkdirSync(outputRoot, { recursive: true });
		fs.accessSync(outputRoot, fs.constants.W_OK);
	} catch {
		writableOutputRoot = false;
	}
	return {
		pythonAvailable: true,
		pythonVersion: python.version,
		missingPackages,
		apiCredentialsAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()),
		apiCredentialHint:
			"OPENAI_API_KEY is required for the default model IDs. Other providers may work if the chosen DSPy model is already configured.",
		writableOutputRoot,
	};
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaped = false;
	for (const char of input) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (escaped) current += "\\";
	if (current) tokens.push(current);
	return tokens;
}

function parseCliArgs(input: string): ParsedCliArgs {
	const tokens = tokenizeArgs(input);
	const positionals: string[] = [];
	const options: Record<string, string | boolean> = {};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const [key, inlineValue] = token.slice(2).split("=", 2);
		if (!key) return { positionals, options, error: `Invalid flag: ${token}` };
		if (inlineValue !== undefined) {
			options[key] = inlineValue;
			continue;
		}
		const next = tokens[index + 1];
		if (!next || next.startsWith("--")) {
			options[key] = true;
			continue;
		}
		options[key] = next;
		index += 1;
	}
	return { positionals, options };
}

export function parseEvolutionCommand(args: string): CommandParseResult {
	const parsed = parseCliArgs(args);
	if (parsed.error) return { error: parsed.error };
	const [command, ...rest] = parsed.positionals;
	if (!command) return { usage: EVOLUTION_COMMAND_USAGE };

	const cwd = typeof parsed.options.cwd === "string" ? parsed.options.cwd : undefined;
	const datasetPath = typeof parsed.options["dataset-path"] === "string" ? parsed.options["dataset-path"] : undefined;
	const iterations = typeof parsed.options.iterations === "string" ? Number(parsed.options.iterations) : undefined;
	const evalSource = typeof parsed.options["eval-source"] === "string" ? parsed.options["eval-source"] : undefined;
	const optimizerModel =
		typeof parsed.options["optimizer-model"] === "string" ? parsed.options["optimizer-model"] : undefined;
	const evalModel = typeof parsed.options["eval-model"] === "string" ? parsed.options["eval-model"] : undefined;
	const dryRun = parsed.options["dry-run"] === true;
	const overwrite = parsed.options.overwrite === true;

	if (iterations !== undefined && (!Number.isFinite(iterations) || iterations <= 0)) {
		return { error: "iterations must be a positive number." };
	}

	if (command === "setup") return { request: { action: "setup", cwd } };
	if (command === "targets") return { request: { action: "targets", cwd } };
	if (command === "init-dataset") {
		if (!rest[0]) return { error: "init-dataset requires a skill name." };
		return { request: { action: "init_dataset", cwd, skillName: rest[0], overwrite } };
	}
	if (command === "run") {
		if (!rest[0]) return { error: "run requires a skill name." };
		return {
			request: {
				action: "run",
				cwd,
				skillName: rest[0],
				datasetPath,
				iterations,
				evalSource,
				optimizerModel,
				evalModel,
				dryRun,
			},
		};
	}
	if (command === "status") {
		return { request: { action: "status", cwd, skillName: rest[0] } };
	}
	return { error: `Unknown evolution action "${command}".\n${EVOLUTION_COMMAND_USAGE}` };
}

function textResult(
	text: string,
	details: EvolutionToolDetails,
	isError = false,
): EvolutionToolResult<EvolutionToolDetails> {
	return { content: [{ type: "text", text }], details, isError };
}

function errorResult(
	action: EvolutionAction,
	cwd: string,
	error: string,
	overrides: Partial<EvolutionToolDetails> = {},
) {
	return textResult(`Error: ${error}`, { action, cwd, targetType: DEFAULT_TARGET_TYPE, error, ...overrides }, true);
}

function formatTargetsText(targets: SkillTarget[]): string {
	if (targets.length === 0) return "No skill targets found.";
	return targets.map((target, index) => `${index + 1}. ${target.scope}:${target.relativePath}`).join("\n");
}

function timestampForRun(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildEvolutionRunInvocation(
	request: EvolutionRequest,
	cwd: string,
	target: SkillTarget,
): {
	pythonCommand: string;
	args: string[];
	runDir: string;
	datasetPath: string;
} {
	const python = detectPython();
	if (!python.command) throw new Error("Python not found on PATH.");
	const runDir = path.join(runsRoot(cwd, target.name), timestampForRun());
	const datasetPath = request.datasetPath
		? resolveMaybeRelativePath(cwd, request.datasetPath)
		: datasetRoot(cwd, target.name);
	const args = [
		helperScriptPath(),
		"--skill",
		target.name,
		"--skill-path",
		target.filePath,
		"--run-dir",
		runDir,
		"--dataset-path",
		datasetPath,
		"--eval-source",
		request.evalSource?.trim() || "synthetic",
		"--iterations",
		String(Math.max(1, Math.floor(request.iterations ?? DEFAULT_ITERATIONS))),
		"--optimizer-model",
		request.optimizerModel?.trim() || DEFAULT_OPTIMIZER_MODEL,
		"--eval-model",
		request.evalModel?.trim() || DEFAULT_EVAL_MODEL,
		"--project-skill-root",
		projectSkillsRoot(cwd),
		"--user-skill-root",
		userSkillsRoot(),
	];
	if (request.dryRun) args.push("--dry-run");
	return { pythonCommand: python.command, args, runDir, datasetPath };
}

async function runEvolutionHelper(
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate?: EvolutionToolUpdateCallback<EvolutionToolDetails>,
	updateDetails?: EvolutionToolDetails,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		const child = evolutionRuntime.spawn(command, args, {
			cwd,
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		let closed = false;

		const abortHandler = () => {
			if (!closed) child.kill("SIGTERM");
		};
		signal?.addEventListener("abort", abortHandler);

		child.stdout?.on("data", (chunk) => {
			const text = String(chunk);
			stdout += text;
			const line = text.trim().split(/\r?\n/).filter(Boolean).pop();
			if (line && updateDetails) {
				onUpdate?.({
					content: [{ type: "text", text: line }],
					details: updateDetails,
				});
			}
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			closed = true;
			signal?.removeEventListener("abort", abortHandler);
			reject(error);
		});
		child.on("close", (exitCode) => {
			closed = true;
			signal?.removeEventListener("abort", abortHandler);
			resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
		});
	});
}

export function readEvolutionStatus(
	cwd: string,
	skillName?: string,
): { runDir?: string; metrics?: EvolutionRunMetrics; error?: string } {
	const root = path.join(evolutionProjectRoot(cwd), "runs");
	if (!fs.existsSync(root)) return { error: `No runs directory found at ${root}.` };

	let candidateRoots: string[] = [];
	if (skillName?.trim()) {
		candidateRoots = [path.join(root, skillName.trim())];
	} else {
		candidateRoots = fs
			.readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(root, entry.name));
	}

	const runDirs = candidateRoots.flatMap((skillRoot) => {
		if (!fs.existsSync(skillRoot)) return [];
		return fs
			.readdirSync(skillRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(skillRoot, entry.name));
	});
	if (runDirs.length === 0) return { error: "No evolution runs found." };

	runDirs.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
	const latest = runDirs[0];
	const metricsPath = path.join(latest, "metrics.json");
	if (!fs.existsSync(metricsPath)) {
		return { runDir: latest, error: `Missing metrics.json in ${latest}.` };
	}
	const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8")) as EvolutionRunMetrics;
	return { runDir: latest, metrics };
}

export async function executeEvolutionRequest(
	request: EvolutionRequest,
	contextCwd: string,
	signal?: AbortSignal,
	onUpdate?: EvolutionToolUpdateCallback<EvolutionToolDetails>,
): Promise<EvolutionToolResult<EvolutionToolDetails>> {
	const cwd = resolveEvolutionCwd(request.cwd, contextCwd);
	const targetType = request.targetType?.trim() || DEFAULT_TARGET_TYPE;
	if (targetType !== DEFAULT_TARGET_TYPE) {
		return errorResult(
			request.action,
			cwd,
			`Unsupported targetType "${targetType}". Only "skill" is supported in v1.`,
		);
	}

	if (request.action === "setup") {
		const diagnostics = buildEvolutionSetupDiagnostics(cwd);
		const text = [
			`Python: ${diagnostics.pythonAvailable ? diagnostics.pythonVersion : diagnostics.error}`,
			`Missing packages: ${diagnostics.missingPackages.length === 0 ? "none" : diagnostics.missingPackages.join(", ")}`,
			`API credentials: ${diagnostics.apiCredentialsAvailable ? "available" : "missing"}`,
			`Writable output root: ${diagnostics.writableOutputRoot ? "yes" : "no"}`,
			`Hint: ${diagnostics.apiCredentialHint}`,
		].join("\n");
		return textResult(text, { action: request.action, cwd, targetType, diagnostics });
	}

	if (request.action === "targets") {
		const targets = listEvolutionTargets(cwd);
		return textResult(formatTargetsText(targets), { action: request.action, cwd, targetType, targets });
	}

	if (request.action === "init_dataset") {
		if (!request.skillName?.trim()) return errorResult(request.action, cwd, "init_dataset requires skillName.");
		const match = findSkillTarget(request.skillName, cwd);
		if (!match.target)
			return errorResult(request.action, cwd, match.error ?? "Skill not found.", { skillName: request.skillName });
		try {
			const result = initEvolutionDatasetSkeleton(cwd, match.target.name, request.overwrite ?? false);
			rememberEvolutionCwd(cwd);
			return textResult(`Initialized dataset skeleton at ${result.datasetPath}.`, {
				action: request.action,
				cwd,
				targetType,
				skillName: match.target.name,
				skillPath: match.target.filePath,
				datasetPath: result.datasetPath,
			});
		} catch (error) {
			return errorResult(request.action, cwd, error instanceof Error ? error.message : String(error), {
				skillName: match.target.name,
				skillPath: match.target.filePath,
			});
		}
	}

	if (request.action === "status") {
		rememberEvolutionCwd(cwd);
		const status = readEvolutionStatus(cwd, request.skillName);
		if (!status.metrics) {
			return errorResult(request.action, cwd, status.error ?? "No run status available.", {
				skillName: request.skillName,
			});
		}
		const text = [
			`Run: ${status.runDir}`,
			`Skill: ${status.metrics.skill_name ?? request.skillName ?? "(unknown)"}`,
			`Status: ${status.metrics.status ?? "unknown"}`,
			status.metrics.improvement !== undefined ? `Improvement: ${status.metrics.improvement.toFixed(3)}` : "",
			status.metrics.constraints_passed !== undefined
				? `Constraints passed: ${status.metrics.constraints_passed ? "yes" : "no"}`
				: "",
			status.metrics.candidate_path ? `Candidate: ${status.metrics.candidate_path}` : "",
			status.metrics.baseline_path ? `Baseline: ${status.metrics.baseline_path}` : "",
		]
			.filter(Boolean)
			.join("\n");
		return textResult(text, {
			action: request.action,
			cwd,
			targetType,
			skillName: status.metrics.skill_name ?? request.skillName,
			runDir: status.runDir,
			metrics: status.metrics,
		});
	}

	if (!request.skillName?.trim()) {
		return errorResult(request.action, cwd, "run requires skillName.");
	}

	const match = findSkillTarget(request.skillName, cwd);
	if (!match.target) {
		return errorResult(request.action, cwd, match.error ?? "Skill not found.", { skillName: request.skillName });
	}

	rememberEvolutionCwd(cwd);
	const diagnostics = buildEvolutionSetupDiagnostics(cwd);
	if (!diagnostics.pythonAvailable) {
		return errorResult(request.action, cwd, diagnostics.error ?? "Python is unavailable.", {
			skillName: match.target.name,
			skillPath: match.target.filePath,
			diagnostics,
		});
	}
	if (diagnostics.missingPackages.length > 0) {
		return errorResult(request.action, cwd, `Missing Python packages: ${diagnostics.missingPackages.join(", ")}.`, {
			skillName: match.target.name,
			skillPath: match.target.filePath,
			diagnostics,
		});
	}
	if (!diagnostics.writableOutputRoot) {
		return errorResult(request.action, cwd, `Output root ${evolutionProjectRoot(cwd)} is not writable.`, {
			skillName: match.target.name,
			skillPath: match.target.filePath,
			diagnostics,
		});
	}

	const invocation = buildEvolutionRunInvocation(request, cwd, match.target);
	fs.mkdirSync(path.dirname(invocation.runDir), { recursive: true });
	onUpdate?.({
		content: [{ type: "text", text: `Running skill evolution for ${match.target.name}...` }],
		details: {
			action: request.action,
			cwd,
			targetType,
			skillName: match.target.name,
			skillPath: match.target.filePath,
			datasetPath: invocation.datasetPath,
			runDir: invocation.runDir,
			pythonCommand: [invocation.pythonCommand, ...invocation.args],
		},
	});

	try {
		const child = await runEvolutionHelper(invocation.pythonCommand, invocation.args, cwd, signal, onUpdate, {
			action: request.action,
			cwd,
			targetType,
			skillName: match.target.name,
			skillPath: match.target.filePath,
			datasetPath: invocation.datasetPath,
			runDir: invocation.runDir,
			pythonCommand: [invocation.pythonCommand, ...invocation.args],
		});
		const status = readEvolutionStatus(cwd, match.target.name);
		if (!status.metrics) {
			const missingMetricsError = status.error ?? child.stderr ?? "Evolution helper finished without metrics.";
			return errorResult(request.action, cwd, missingMetricsError, {
				skillName: match.target.name,
				skillPath: match.target.filePath,
				datasetPath: invocation.datasetPath,
				runDir: invocation.runDir,
				pythonCommand: [invocation.pythonCommand, ...invocation.args],
			});
		}
		const summary = [
			`Evolution ${status.metrics.status ?? (child.exitCode === 0 ? "completed" : "failed")} for ${match.target.name}.`,
			`Run: ${status.runDir}`,
			`Dataset: ${invocation.datasetPath}`,
			status.metrics.improvement !== undefined ? `Improvement: ${status.metrics.improvement.toFixed(3)}` : "",
			status.metrics.candidate_path ? `Candidate: ${status.metrics.candidate_path}` : "",
			status.metrics.baseline_path ? `Baseline: ${status.metrics.baseline_path}` : "",
		]
			.filter(Boolean)
			.join("\n");
		return textResult(
			summary,
			{
				action: request.action,
				cwd,
				targetType,
				skillName: match.target.name,
				skillPath: match.target.filePath,
				datasetPath: invocation.datasetPath,
				runDir: status.runDir,
				pythonCommand: [invocation.pythonCommand, ...invocation.args],
				metrics: status.metrics,
				diagnostics,
			},
			child.exitCode !== 0,
		);
	} catch (error) {
		return errorResult(request.action, cwd, error instanceof Error ? error.message : String(error), {
			skillName: match.target.name,
			skillPath: match.target.filePath,
			datasetPath: invocation.datasetPath,
			runDir: invocation.runDir,
			pythonCommand: [invocation.pythonCommand, ...invocation.args],
			diagnostics,
		});
	}
}
