import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const POKEMON_TOOL_ACTIONS = [
	"setup",
	"info",
	"start",
	"status",
	"state",
	"action",
	"screenshot",
	"save",
	"load",
	"saves",
	"minimap",
	"stop",
] as const;

export type PokemonAction = (typeof POKEMON_TOOL_ACTIONS)[number];

export interface PokemonRequest {
	action: PokemonAction;
	session?: string;
	romPath?: string;
	port?: number;
	dataDir?: string;
	loadState?: string;
	actions?: string[];
	saveName?: string;
}

export interface PokemonSessionMetadata {
	session: string;
	pid: number;
	port: number;
	baseUrl: string;
	dashboardUrl: string;
	romPath: string;
	dataDir: string;
	logPath: string;
	command: string[];
	loadState?: string;
	startedAt: string;
}

export interface CommandProbe {
	available: boolean;
	commandPrefix: string[];
	version?: string;
	error?: string;
}

export interface PokemonSetupDiagnostics {
	python: CommandProbe;
	pokemonAgent: CommandProbe;
	pyboy: CommandProbe;
	romPath?: string;
	romExists?: boolean;
	guidance: string[];
}

export interface PokemonToolDetails {
	action: PokemonAction;
	session: string;
	metaPath: string;
	metadata?: PokemonSessionMetadata;
	health?: { status?: string; emulator_ready?: boolean };
	response?: unknown;
	logPath?: string;
	baseUrl?: string;
	dashboardUrl?: string;
	dashboardAvailable?: boolean;
	diagnostics?: PokemonSetupDiagnostics;
	clearedStaleSession?: boolean;
	error?: string;
}

export type PokemonToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface PokemonToolResult<TDetails = PokemonToolDetails> {
	content: PokemonToolContent[];
	details: TDetails;
	isError?: boolean;
}

export type PokemonToolUpdateCallback<TDetails = PokemonToolDetails> = (result: PokemonToolResult<TDetails>) => void;

export interface CommandParseResult {
	request?: PokemonRequest;
	usage?: string;
	error?: string;
}

const DEFAULT_PORT = 8765;
const DEFAULT_SESSION = "default";
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const SESSION_NAME_RE = /[^a-zA-Z0-9._-]+/g;
const ROM_EXTENSIONS = [".gb", ".gbc", ".gba"];

export const pokemonRuntime = {
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

export const POKEMON_COMMAND_USAGE =
	"Usage: /pokemon setup [--rom <path>] [--session <name>]\n" +
	"/pokemon info --rom <path>\n" +
	"/pokemon start --rom <path> [--port <number>] [--data-dir <path>] [--load-state <name>] [--session <name>]\n" +
	"/pokemon status [--session <name>]\n" +
	"/pokemon state [--session <name>]\n" +
	"/pokemon action <action...> [--session <name>]\n" +
	"/pokemon screenshot [--session <name>]\n" +
	"/pokemon save <name> [--session <name>]\n" +
	"/pokemon load <name> [--session <name>]\n" +
	"/pokemon saves [--session <name>]\n" +
	"/pokemon minimap [--session <name>]\n" +
	"/pokemon stop [--session <name>]";

interface ParsedCliArgs {
	positionals: string[];
	options: Record<string, string | boolean>;
	error?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveAgentDir(): string {
	const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
	if (explicit) {
		if (explicit === "~") return os.homedir();
		if (explicit.startsWith("~/")) return path.join(os.homedir(), explicit.slice(2));
		return explicit;
	}
	return path.join(os.homedir(), ".pi", "agent");
}

function pokemonToolsRoot(): string {
	return path.join(resolveAgentDir(), "tools", "pokemon-agent");
}

function pokemonVenvPythonCandidates(): string[] {
	const root = pokemonToolsRoot();
	const binDir = process.platform === "win32" ? "Scripts" : "bin";
	const exeName = process.platform === "win32" ? "python.exe" : "python";
	return [path.join(root, ".venv", binDir, exeName), path.join(root, "venv", binDir, exeName)];
}

function sanitizeSessionName(session: string | undefined): string {
	const cleaned = (session?.trim() || DEFAULT_SESSION).replace(SESSION_NAME_RE, "-").replace(/^-+|-+$/g, "");
	return cleaned || DEFAULT_SESSION;
}

function expandHome(candidate: string): string {
	if (candidate === "~") return os.homedir();
	if (candidate.startsWith("~/")) return path.join(os.homedir(), candidate.slice(2));
	return candidate;
}

function resolveMaybeRelativePath(cwd: string, candidate: string): string {
	const expanded = expandHome(candidate.trim());
	return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

function resolveRomPath(cwd: string, candidate: string): string {
	const base = resolveMaybeRelativePath(cwd, candidate);
	if (fs.existsSync(base)) {
		return base;
	}
	for (const extension of ROM_EXTENSIONS) {
		const withExtension = `${base}${extension}`;
		if (fs.existsSync(withExtension)) {
			return withExtension;
		}
	}
	return base;
}

function metadataRootForSession(session: string): string {
	return path.join(pokemonToolsRoot(), "data", session);
}

export function getPokemonSessionMetaPath(session: string | undefined): string {
	return path.join(pokemonToolsRoot(), `${sanitizeSessionName(session)}.json`);
}

function getPokemonLogPath(session: string): string {
	return path.join(pokemonToolsRoot(), `${session}.log`);
}

export function readPokemonSessionMetadata(session: string | undefined): PokemonSessionMetadata | undefined {
	const metaPath = getPokemonSessionMetaPath(session);
	if (!fs.existsSync(metaPath)) return undefined;
	try {
		return JSON.parse(fs.readFileSync(metaPath, "utf8")) as PokemonSessionMetadata;
	} catch {
		return undefined;
	}
}

function writePokemonSessionMetadata(metadata: PokemonSessionMetadata): void {
	const root = pokemonToolsRoot();
	fs.mkdirSync(root, { recursive: true });
	fs.writeFileSync(getPokemonSessionMetaPath(metadata.session), JSON.stringify(metadata, null, 2), "utf8");
}

export function clearPokemonSessionMetadata(session: string | undefined): void {
	const metaPath = getPokemonSessionMetaPath(session);
	if (fs.existsSync(metaPath)) {
		fs.rmSync(metaPath, { force: true });
	}
}

function detectPython(): CommandProbe {
	const explicit = process.env.POKEMON_AGENT_PYTHON?.trim();
	const candidates = [
		...(explicit ? [expandHome(explicit)] : []),
		...pokemonVenvPythonCandidates(),
		"python3",
		"python",
	];
	for (const candidate of candidates) {
		if ((candidate.includes(path.sep) || path.isAbsolute(candidate)) && !fs.existsSync(candidate)) {
			continue;
		}
		const result = pokemonRuntime.runProcessSync(candidate, ["--version"]);
		if (result.ok) {
			const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0];
			return { available: true, commandPrefix: [candidate], version };
		}
	}
	return {
		available: false,
		commandPrefix: [],
		error: "Python not found on PATH. Install python3 first.",
	};
}

function detectPokemonAgent(python: CommandProbe): CommandProbe {
	const direct = pokemonRuntime.runProcessSync("pokemon-agent", ["--version"]);
	if (direct.ok) {
		const version = `${direct.stdout}\n${direct.stderr}`.trim().split(/\r?\n/)[0];
		return { available: true, commandPrefix: ["pokemon-agent"], version };
	}
	if (!python.available || python.commandPrefix.length === 0) {
		return {
			available: false,
			commandPrefix: [],
			error: "pokemon-agent not found and Python fallback is unavailable.",
		};
	}
	const pythonModule = pokemonRuntime.runProcessSync(python.commandPrefix[0], [
		"-m",
		"pokemon_agent.cli",
		"--version",
	]);
	if (pythonModule.ok) {
		const version = `${pythonModule.stdout}\n${pythonModule.stderr}`.trim().split(/\r?\n/)[0];
		return { available: true, commandPrefix: [python.commandPrefix[0], "-m", "pokemon_agent.cli"], version };
	}
	return {
		available: false,
		commandPrefix: [],
		error: 'pokemon-agent is not installed. Run "pip install pokemon-agent[dashboard] pyboy".',
	};
}

function detectPythonModule(python: CommandProbe, moduleName: string): CommandProbe {
	if (!python.available || python.commandPrefix.length === 0) {
		return { available: false, commandPrefix: [], error: "Python is unavailable." };
	}
	const result = pokemonRuntime.runProcessSync(python.commandPrefix[0], [
		"-c",
		`import ${moduleName}; print(getattr(${moduleName}, "__version__", "ok"))`,
	]);
	if (result.ok) {
		return {
			available: true,
			commandPrefix: [python.commandPrefix[0]],
			version: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0],
		};
	}
	return {
		available: false,
		commandPrefix: [python.commandPrefix[0]],
		error: `${moduleName} is not importable. Run "pip install pokemon-agent[dashboard] pyboy".`,
	};
}

export function buildPokemonSetupDiagnostics(
	cwd: string,
	request: Pick<PokemonRequest, "romPath">,
): PokemonSetupDiagnostics {
	const python = detectPython();
	const pokemonAgent = detectPokemonAgent(python);
	const pyboy = detectPythonModule(python, "pyboy");
	const romPath = request.romPath ? resolveRomPath(cwd, request.romPath) : undefined;
	const romExists = romPath ? fs.existsSync(romPath) : undefined;
	const guidance: string[] = [];

	if (!python.available) guidance.push("Install python3 and make sure it is on PATH.");
	if (python.available && (!pokemonAgent.available || !pyboy.available)) {
		guidance.push("Install dependencies with: pip install pokemon-agent[dashboard] pyboy");
	}
	if (!romPath) {
		guidance.push("Provide a local ROM path with romPath or /pokemon start --rom <path>.");
	} else if (!romExists) {
		guidance.push(`ROM not found at ${romPath}. Provide a valid local path.`);
	}
	if (pokemonAgent.available) {
		guidance.push("Start a game with: /pokemon start --rom <path>.");
	}

	return { python, pokemonAgent, pyboy, romPath, romExists, guidance };
}

function resultText(lines: string[]): string {
	return lines.filter((line) => line.trim().length > 0).join("\n");
}

function textResult(text: string, details: PokemonToolDetails, isError = false): PokemonToolResult<PokemonToolDetails> {
	return { content: [{ type: "text", text }], details, isError };
}

function errorResult(
	action: PokemonAction,
	session: string,
	error: string,
	overrides: Partial<PokemonToolDetails> = {},
): PokemonToolResult<PokemonToolDetails> {
	return textResult(
		`Error: ${error}`,
		{ action, session, metaPath: getPokemonSessionMetaPath(session), error, ...overrides },
		true,
	);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
	}
	return response.json();
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
	}
	return response.text();
}

export function isPokemonProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function pollPokemonHealth(
	baseUrl: string,
	signal: AbortSignal | undefined,
): Promise<{ status?: string; emulator_ready?: boolean } | undefined> {
	const started = Date.now();
	while (Date.now() - started < DEFAULT_HEALTH_TIMEOUT_MS) {
		if (signal?.aborted) throw new Error("Pokemon start aborted.");
		try {
			const response = (await fetchJson(`${baseUrl}/health`, { signal })) as {
				status?: string;
				emulator_ready?: boolean;
			};
			if (response.status === "ok") return response;
		} catch {
			// Keep polling until timeout.
		}
		await sleep(HEALTH_POLL_INTERVAL_MS);
	}
	return undefined;
}

async function probeDashboard(url: string, signal: AbortSignal | undefined): Promise<boolean> {
	try {
		const response = await fetch(url, { method: "GET", signal });
		return response.ok;
	} catch {
		return false;
	}
}

async function resolveActivePokemonSession(
	session: string,
	signal: AbortSignal | undefined,
): Promise<{
	metadata?: PokemonSessionMetadata;
	health?: { status?: string; emulator_ready?: boolean };
	dashboardAvailable?: boolean;
	clearedStaleSession?: boolean;
}> {
	const metadata = readPokemonSessionMetadata(session);
	if (!metadata) return {};
	if (!isPokemonProcessAlive(metadata.pid)) {
		clearPokemonSessionMetadata(session);
		return { clearedStaleSession: true };
	}
	try {
		const health = (await fetchJson(`${metadata.baseUrl}/health`, { signal })) as {
			status?: string;
			emulator_ready?: boolean;
		};
		if (health.status !== "ok") {
			clearPokemonSessionMetadata(session);
			return { clearedStaleSession: true, health };
		}
		const dashboardAvailable = await probeDashboard(metadata.dashboardUrl, signal);
		return { metadata, health, dashboardAvailable };
	} catch {
		clearPokemonSessionMetadata(session);
		return { clearedStaleSession: true };
	}
}

function buildPokemonCommandText(
	action: PokemonAction,
	session: string,
	details?: Partial<PokemonToolDetails>,
): string {
	const lines = [`Pokemon ${action} (${session})`];
	if (details?.baseUrl) lines.push(`Base URL: ${details.baseUrl}`);
	if (details?.dashboardUrl && details.dashboardAvailable) lines.push(`Dashboard: ${details.dashboardUrl}`);
	if (details?.logPath) lines.push(`Log: ${details.logPath}`);
	return resultText(lines);
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
		const withoutPrefix = token.slice(2);
		const [rawKey, inlineValue] = withoutPrefix.split("=", 2);
		if (!rawKey) return { positionals, options, error: `Invalid flag: ${token}` };
		if (inlineValue !== undefined) {
			options[rawKey] = inlineValue;
			continue;
		}
		const next = tokens[index + 1];
		if (!next || next.startsWith("--")) {
			options[rawKey] = true;
			continue;
		}
		options[rawKey] = next;
		index += 1;
	}

	return { positionals, options };
}

function parseActions(values: string[]): string[] {
	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

export function parsePokemonCommand(args: string): CommandParseResult {
	const parsed = parseCliArgs(args);
	if (parsed.error) return { error: parsed.error };
	const [actionToken, ...rest] = parsed.positionals;
	if (!actionToken) return { usage: POKEMON_COMMAND_USAGE };
	if (!POKEMON_TOOL_ACTIONS.includes(actionToken as PokemonAction)) {
		return { error: `Unknown pokemon action "${actionToken}".\n${POKEMON_COMMAND_USAGE}` };
	}
	const session = typeof parsed.options.session === "string" ? parsed.options.session : undefined;
	const romPath = typeof parsed.options.rom === "string" ? parsed.options.rom : undefined;
	const port = typeof parsed.options.port === "string" ? Number(parsed.options.port) : undefined;
	const dataDir = typeof parsed.options["data-dir"] === "string" ? parsed.options["data-dir"] : undefined;
	const loadState = typeof parsed.options["load-state"] === "string" ? parsed.options["load-state"] : undefined;

	if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
		return { error: "port must be a positive number." };
	}

	const action = actionToken as PokemonAction;
	if (action === "info" && !romPath) {
		return { error: "info requires --rom <path>." };
	}
	if (action === "start" && !romPath) {
		return { error: "start requires --rom <path>." };
	}
	if (action === "action") {
		const actions = parseActions(rest);
		if (actions.length === 0) return { error: "action requires at least one action string." };
		return { request: { action, session, actions } };
	}
	if (action === "save" || action === "load") {
		const saveName = rest[0];
		if (!saveName) return { error: `${action} requires a save name.` };
		return { request: { action, session, saveName } };
	}

	return { request: { action, session, romPath, port, dataDir, loadState } };
}

export async function executePokemonRequest(
	request: PokemonRequest,
	cwd: string,
	signal?: AbortSignal,
	onUpdate?: PokemonToolUpdateCallback<PokemonToolDetails>,
): Promise<PokemonToolResult<PokemonToolDetails>> {
	const session = sanitizeSessionName(request.session);
	const metaPath = getPokemonSessionMetaPath(session);

	if (request.action === "setup") {
		const diagnostics = buildPokemonSetupDiagnostics(cwd, request);
		const text = resultText([
			`Python: ${diagnostics.python.available ? diagnostics.python.version : diagnostics.python.error}`,
			`pokemon-agent: ${diagnostics.pokemonAgent.available ? diagnostics.pokemonAgent.version : diagnostics.pokemonAgent.error}`,
			`pyboy: ${diagnostics.pyboy.available ? diagnostics.pyboy.version : diagnostics.pyboy.error}`,
			diagnostics.romPath
				? `ROM: ${diagnostics.romExists ? diagnostics.romPath : `missing (${diagnostics.romPath})`}`
				: "ROM: not provided",
			"",
			...diagnostics.guidance.map((line) => `- ${line}`),
		]);
		return textResult(text, { action: request.action, session, metaPath, diagnostics });
	}

	if (request.action === "info") {
		if (!request.romPath) return errorResult(request.action, session, "info requires romPath.");
		const diagnostics = buildPokemonSetupDiagnostics(cwd, request);
		if (!diagnostics.pokemonAgent.available) {
			return errorResult(
				request.action,
				session,
				diagnostics.pokemonAgent.error ?? "pokemon-agent is unavailable.",
				{ diagnostics },
			);
		}
		if (!diagnostics.romExists || !diagnostics.romPath) {
			return errorResult(request.action, session, `ROM not found: ${diagnostics.romPath ?? request.romPath}`, {
				diagnostics,
			});
		}
		const [command, ...prefixArgs] = diagnostics.pokemonAgent.commandPrefix;
		const output = pokemonRuntime.runProcessSync(command, [...prefixArgs, "info", "--rom", diagnostics.romPath]);
		if (!output.ok) {
			return errorResult(request.action, session, output.stderr.trim() || "pokemon-agent info failed.", {
				diagnostics,
			});
		}
		return textResult(output.stdout.trim(), {
			action: request.action,
			session,
			metaPath,
			diagnostics,
			response: output.stdout.trim(),
		});
	}

	if (request.action === "start") {
		const diagnostics = buildPokemonSetupDiagnostics(cwd, request);
		if (!diagnostics.python.available)
			return errorResult(request.action, session, diagnostics.python.error ?? "Python unavailable.", {
				diagnostics,
			});
		if (!diagnostics.pokemonAgent.available) {
			return errorResult(request.action, session, diagnostics.pokemonAgent.error ?? "pokemon-agent unavailable.", {
				diagnostics,
			});
		}
		if (!diagnostics.pyboy.available)
			return errorResult(request.action, session, diagnostics.pyboy.error ?? "pyboy unavailable.", { diagnostics });
		if (!diagnostics.romExists || !diagnostics.romPath) {
			return errorResult(
				request.action,
				session,
				`ROM not found: ${diagnostics.romPath ?? request.romPath ?? "(missing)"}`,
				{ diagnostics },
			);
		}

		const existing = await resolveActivePokemonSession(session, signal);
		if (existing.metadata && existing.health?.status === "ok") {
			return textResult(
				resultText([
					`Pokemon session "${session}" is already running.`,
					`Base URL: ${existing.metadata.baseUrl}`,
					existing.dashboardAvailable ? `Dashboard: ${existing.metadata.dashboardUrl}` : "",
				]),
				{
					action: request.action,
					session,
					metaPath,
					metadata: existing.metadata,
					health: existing.health,
					baseUrl: existing.metadata.baseUrl,
					dashboardUrl: existing.metadata.dashboardUrl,
					dashboardAvailable: existing.dashboardAvailable,
					diagnostics,
				},
			);
		}

		const port =
			request.port && Number.isFinite(request.port) && request.port > 0 ? Math.floor(request.port) : DEFAULT_PORT;
		const baseUrl = `http://127.0.0.1:${port}`;
		const dashboardUrl = `${baseUrl}/dashboard`;
		const dataDir = request.dataDir
			? resolveMaybeRelativePath(cwd, request.dataDir)
			: metadataRootForSession(session);
		fs.mkdirSync(dataDir, { recursive: true });
		const logPath = getPokemonLogPath(session);
		fs.mkdirSync(pokemonToolsRoot(), { recursive: true });
		const logFd = fs.openSync(logPath, "a");
		const [command, ...prefixArgs] = diagnostics.pokemonAgent.commandPrefix;
		const args = [
			...prefixArgs,
			"serve",
			"--rom",
			diagnostics.romPath,
			"--port",
			String(port),
			"--data-dir",
			dataDir,
		];
		if (request.loadState?.trim()) args.push("--load-state", request.loadState.trim());

		onUpdate?.({
			content: [{ type: "text", text: `Starting pokemon-agent for session "${session}" on ${baseUrl}...` }],
			details: { action: request.action, session, metaPath, logPath, baseUrl, dashboardUrl, diagnostics },
		});

		const child = pokemonRuntime.spawn(command, args, {
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		fs.closeSync(logFd);
		if (!child.pid) {
			return errorResult(request.action, session, "pokemon-agent failed to spawn.", {
				diagnostics,
				logPath,
				baseUrl,
				dashboardUrl,
			});
		}
		child.unref();

		const metadata: PokemonSessionMetadata = {
			session,
			pid: child.pid,
			port,
			baseUrl,
			dashboardUrl,
			romPath: diagnostics.romPath,
			dataDir,
			logPath,
			command: [command, ...args],
			loadState: request.loadState?.trim() || undefined,
			startedAt: new Date().toISOString(),
		};
		writePokemonSessionMetadata(metadata);

		const health = await pollPokemonHealth(baseUrl, signal);
		if (!health) {
			if (!isPokemonProcessAlive(child.pid)) {
				clearPokemonSessionMetadata(session);
			}
			return errorResult(
				request.action,
				session,
				`pokemon-agent did not become healthy within ${DEFAULT_HEALTH_TIMEOUT_MS / 1000}s.`,
				{
					metadata,
					logPath,
					baseUrl,
					dashboardUrl,
					diagnostics,
				},
			);
		}

		const dashboardAvailable = await probeDashboard(dashboardUrl, signal);
		return textResult(
			resultText([
				`Pokemon session "${session}" started.`,
				`Base URL: ${baseUrl}`,
				dashboardAvailable
					? `Dashboard: ${dashboardUrl}`
					: "Dashboard: unavailable (install pokemon-agent[dashboard] for /dashboard)",
				`Log: ${logPath}`,
			]),
			{
				action: request.action,
				session,
				metaPath,
				metadata,
				health,
				logPath,
				baseUrl,
				dashboardUrl,
				dashboardAvailable,
				diagnostics,
			},
		);
	}

	const active = await resolveActivePokemonSession(session, signal);
	if (request.action === "status") {
		if (!active.metadata) {
			return textResult(
				active.clearedStaleSession
					? `Pokemon session "${session}" was stale and its metadata was removed.`
					: `No active pokemon session named "${session}".`,
				{
					action: request.action,
					session,
					metaPath,
					clearedStaleSession: active.clearedStaleSession,
				},
			);
		}
		return textResult(
			resultText([
				buildPokemonCommandText(request.action, session, {
					baseUrl: active.metadata.baseUrl,
					dashboardUrl: active.metadata.dashboardUrl,
					dashboardAvailable: active.dashboardAvailable,
					logPath: active.metadata.logPath,
				}),
				`PID: ${active.metadata.pid}`,
				`ROM: ${active.metadata.romPath}`,
				`Data dir: ${active.metadata.dataDir}`,
				`Started: ${active.metadata.startedAt}`,
				`Emulator ready: ${active.health?.emulator_ready ? "yes" : "no"}`,
			]),
			{
				action: request.action,
				session,
				metaPath,
				metadata: active.metadata,
				health: active.health,
				baseUrl: active.metadata.baseUrl,
				dashboardUrl: active.metadata.dashboardUrl,
				dashboardAvailable: active.dashboardAvailable,
				logPath: active.metadata.logPath,
			},
		);
	}

	if (!active.metadata) {
		return errorResult(request.action, session, `No active pokemon session named "${session}".`, {
			clearedStaleSession: active.clearedStaleSession,
		});
	}

	const metadata = active.metadata;
	const baseUrl = metadata.baseUrl;
	const dashboardUrl = metadata.dashboardUrl;

	if (request.action === "state") {
		const response = await fetchJson(`${baseUrl}/state`, { signal });
		return textResult(JSON.stringify(response, null, 2), {
			action: request.action,
			session,
			metaPath,
			metadata,
			baseUrl,
			dashboardUrl,
			dashboardAvailable: active.dashboardAvailable,
			response,
		});
	}

	if (request.action === "action") {
		const actions = request.actions?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
		if (actions.length === 0)
			return errorResult(request.action, session, "action requires a non-empty actions array.", { metadata });
		const response = await fetchJson(`${baseUrl}/action`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ actions }),
			signal,
		});
		return textResult(
			resultText([
				`Executed ${actions.length} action(s) on session "${session}".`,
				active.dashboardAvailable ? `Dashboard: ${dashboardUrl}` : "",
				JSON.stringify(response, null, 2),
			]),
			{
				action: request.action,
				session,
				metaPath,
				metadata,
				baseUrl,
				dashboardUrl,
				dashboardAvailable: active.dashboardAvailable,
				response,
			},
		);
	}

	if (request.action === "screenshot") {
		const response = (await fetchJson(`${baseUrl}/screenshot/base64`, { signal })) as {
			image?: string;
			format?: string;
		};
		if (!response.image)
			return errorResult(request.action, session, "pokemon-agent did not return screenshot data.", { metadata });
		return {
			content: [
				{
					type: "text",
					text: resultText([
						`Captured screenshot for session "${session}".`,
						active.dashboardAvailable ? `Dashboard: ${dashboardUrl}` : "",
					]),
				},
				{ type: "image", data: response.image, mimeType: `image/${response.format || "png"}` },
			],
			details: {
				action: request.action,
				session,
				metaPath,
				metadata,
				baseUrl,
				dashboardUrl,
				dashboardAvailable: active.dashboardAvailable,
				response,
			},
		};
	}

	if (request.action === "save" || request.action === "load") {
		const saveName = request.saveName?.trim();
		if (!saveName) return errorResult(request.action, session, `${request.action} requires saveName.`, { metadata });
		const response = await fetchJson(`${baseUrl}/${request.action}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: saveName }),
			signal,
		});
		return textResult(
			resultText([
				`${request.action === "save" ? "Saved" : "Loaded"} "${saveName}" for session "${session}".`,
				JSON.stringify(response, null, 2),
			]),
			{
				action: request.action,
				session,
				metaPath,
				metadata,
				baseUrl,
				dashboardUrl,
				dashboardAvailable: active.dashboardAvailable,
				response,
			},
		);
	}

	if (request.action === "saves") {
		const response = await fetchJson(`${baseUrl}/saves`, { signal });
		return textResult(JSON.stringify(response, null, 2), {
			action: request.action,
			session,
			metaPath,
			metadata,
			baseUrl,
			dashboardUrl,
			dashboardAvailable: active.dashboardAvailable,
			response,
		});
	}

	if (request.action === "minimap") {
		const response = await fetchText(`${baseUrl}/minimap`, { signal });
		return textResult(response, {
			action: request.action,
			session,
			metaPath,
			metadata,
			baseUrl,
			dashboardUrl,
			dashboardAvailable: active.dashboardAvailable,
			response,
		});
	}

	if (request.action === "stop") {
		try {
			process.kill(metadata.pid, "SIGTERM");
		} catch {
			// Ignore already-dead processes; metadata is cleared either way.
		}
		await sleep(200);
		if (isPokemonProcessAlive(metadata.pid)) {
			try {
				process.kill(metadata.pid, "SIGKILL");
			} catch {
				// Best effort only.
			}
		}
		clearPokemonSessionMetadata(session);
		return textResult(`Stopped pokemon session "${session}".`, {
			action: request.action,
			session,
			metaPath,
			metadata,
			baseUrl,
			dashboardUrl,
			dashboardAvailable: active.dashboardAvailable,
		});
	}

	return errorResult(request.action, session, `Unsupported pokemon action: ${request.action}`);
}
