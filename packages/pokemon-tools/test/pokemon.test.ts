import type * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildPokemonSetupDiagnostics,
	clearPokemonSessionMetadata,
	executePokemonRequest,
	getPokemonSessionMetaPath,
	parsePokemonCommand,
	pokemonRuntime,
	readPokemonSessionMetadata,
} from "../src/pokemon.js";

function makeTempAgentDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-tools-"));
}

function commandResult(ok: boolean, stdout = "", stderr = "") {
	return { ok, stdout, stderr, exitCode: ok ? 0 : 1 };
}

describe("pokemon tools", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = makeTempAgentDir();
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		delete process.env.PI_CODING_AGENT_DIR;
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("isolates session metadata paths", () => {
		expect(getPokemonSessionMetaPath("default")).toBe(path.join(agentDir, "tools", "pokemon-agent", "default.json"));
		expect(getPokemonSessionMetaPath("boss-rush")).toBe(
			path.join(agentDir, "tools", "pokemon-agent", "boss-rush.json"),
		);
	});

	it("clears stale metadata when health lookup fails", async () => {
		const metaPath = getPokemonSessionMetaPath("default");
		fs.mkdirSync(path.dirname(metaPath), { recursive: true });
		fs.writeFileSync(
			metaPath,
			JSON.stringify({
				session: "default",
				pid: process.pid,
				port: 8765,
				baseUrl: "http://127.0.0.1:8765",
				dashboardUrl: "http://127.0.0.1:8765/dashboard",
				romPath: "/tmp/game.gb",
				dataDir: "/tmp/data",
				logPath: "/tmp/game.log",
				command: ["pokemon-agent", "serve"],
				startedAt: new Date().toISOString(),
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connection refused");
			}),
		);

		const result = await executePokemonRequest({ action: "status" }, process.cwd());
		expect(result.isError).toBe(false);
		expect(result.content[0]?.type).toBe("text");
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("stale");
		expect(readPokemonSessionMetadata("default")).toBeUndefined();
	});

	it("reports missing runtime components in setup diagnostics", () => {
		const spawnSync = vi.spyOn(pokemonRuntime, "runProcessSync");
		spawnSync.mockReturnValueOnce(commandResult(false, "", "missing"));
		spawnSync.mockReturnValueOnce(commandResult(false, "", "missing"));

		const diagnostics = buildPokemonSetupDiagnostics(process.cwd(), { romPath: "missing.gb" });
		expect(diagnostics.python.available).toBe(false);
		expect(diagnostics.pokemonAgent.available).toBe(false);
		expect(diagnostics.pyboy.available).toBe(false);
		expect(diagnostics.guidance.join("\n")).toContain("Install python3");
	});

	it("parses slash command requests", () => {
		expect(parsePokemonCommand('start --rom "./poke.gb" --session firered --port 9000').request).toEqual({
			action: "start",
			session: "firered",
			romPath: "./poke.gb",
			port: 9000,
			dataDir: undefined,
			loadState: undefined,
		});
		expect(parsePokemonCommand("status --session firered").request).toEqual({
			action: "status",
			session: "firered",
			romPath: undefined,
			port: undefined,
			dataDir: undefined,
			loadState: undefined,
		});
		expect(parsePokemonCommand("action walk_up walk_right press_a").request).toEqual({
			action: "action",
			session: undefined,
			actions: ["walk_up", "walk_right", "press_a"],
		});
		expect(parsePokemonCommand("stop --session firered").request).toEqual({
			action: "stop",
			session: "firered",
			romPath: undefined,
			port: undefined,
			dataDir: undefined,
			loadState: undefined,
		});
	});

	it("starts a detached session and proxies HTTP actions", async () => {
		const romPath = path.join(agentDir, "firered.gba");
		fs.writeFileSync(romPath, "rom");

		const spawnSync = vi.spyOn(pokemonRuntime, "runProcessSync");
		spawnSync
			.mockReturnValueOnce(commandResult(true, "", "Python 3.12.0"))
			.mockReturnValueOnce(commandResult(true, "pokemon-agent 0.1.0", ""))
			.mockReturnValueOnce(commandResult(true, "1.0.0", ""));

		const unref = vi.fn();
		vi.spyOn(pokemonRuntime, "spawn").mockReturnValue({
			pid: 12345,
			unref,
		} as unknown as childProcess.ChildProcess);

		const processKill = vi.spyOn(process, "kill").mockImplementation(() => true as never);
		const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
			async (input) => {
				const url = String(input);
				if (url.endsWith("/health")) {
					return new Response(JSON.stringify({ status: "ok", emulator_ready: true }), { status: 200 });
				}
				if (url.endsWith("/dashboard")) {
					return new Response("dashboard", { status: 200 });
				}
				if (url.endsWith("/state")) {
					return new Response(JSON.stringify({ map: { map_name: "Pallet Town" } }), { status: 200 });
				}
				if (url.endsWith("/action")) {
					return new Response(
						JSON.stringify({ success: true, actions_executed: 2, state_after: { phase: "dialog" } }),
						{
							status: 200,
						},
					);
				}
				if (url.endsWith("/save")) {
					return new Response(JSON.stringify({ success: true, path: "/tmp/before-brock.state" }), { status: 200 });
				}
				if (url.endsWith("/load")) {
					return new Response(JSON.stringify({ success: true, name: "before-brock" }), { status: 200 });
				}
				if (url.endsWith("/saves")) {
					return new Response(JSON.stringify({ saves: [{ name: "before-brock" }] }), { status: 200 });
				}
				if (url.endsWith("/minimap")) {
					return new Response("=== Pallet Town ===", { status: 200 });
				}
				if (url.endsWith("/screenshot/base64")) {
					return new Response(JSON.stringify({ image: "aGVsbG8=", format: "png" }), { status: 200 });
				}
				return new Response("not-found", { status: 404 });
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const start = await executePokemonRequest({ action: "start", romPath, session: "firered" }, process.cwd());
		expect(start.isError).toBe(false);
		expect(unref).toHaveBeenCalled();
		expect((start.content[0] as { type: "text"; text: string }).text).toContain("started");

		const state = await executePokemonRequest({ action: "state", session: "firered" }, process.cwd());
		expect((state.content[0] as { type: "text"; text: string }).text).toContain("Pallet Town");

		const action = await executePokemonRequest(
			{ action: "action", session: "firered", actions: ["walk_up", "press_a"] },
			process.cwd(),
		);
		expect((action.content[0] as { type: "text"; text: string }).text).toContain("Executed 2 action(s)");

		const save = await executePokemonRequest(
			{ action: "save", session: "firered", saveName: "before-brock" },
			process.cwd(),
		);
		expect((save.content[0] as { type: "text"; text: string }).text).toContain("Saved");

		const load = await executePokemonRequest(
			{ action: "load", session: "firered", saveName: "before-brock" },
			process.cwd(),
		);
		expect((load.content[0] as { type: "text"; text: string }).text).toContain("Loaded");

		const saves = await executePokemonRequest({ action: "saves", session: "firered" }, process.cwd());
		expect((saves.content[0] as { type: "text"; text: string }).text).toContain("before-brock");

		const minimap = await executePokemonRequest({ action: "minimap", session: "firered" }, process.cwd());
		expect((minimap.content[0] as { type: "text"; text: string }).text).toContain("Pallet Town");

		const screenshot = await executePokemonRequest({ action: "screenshot", session: "firered" }, process.cwd());
		expect(screenshot.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

		const stop = await executePokemonRequest({ action: "stop", session: "firered" }, process.cwd());
		expect((stop.content[0] as { type: "text"; text: string }).text).toContain("Stopped");
		expect(processKill).toHaveBeenCalled();
		expect(readPokemonSessionMetadata("firered")).toBeUndefined();
	});

	it("returns a clear error when the ROM path is missing", async () => {
		const spawnSync = vi.spyOn(pokemonRuntime, "runProcessSync");
		spawnSync
			.mockReturnValueOnce(commandResult(true, "", "Python 3.12.0"))
			.mockReturnValueOnce(commandResult(true, "pokemon-agent 0.1.0", ""))
			.mockReturnValueOnce(commandResult(true, "1.0.0", ""));

		const result = await executePokemonRequest({ action: "start", romPath: "missing.gba" }, process.cwd());
		expect(result.isError).toBe(true);
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("ROM not found");
		clearPokemonSessionMetadata("default");
	});
});
