import { StringEnum, Text, Type, defineExtension, defineTool } from "@mariozechner/pi-extension-sdk";
import {
	POKEMON_COMMAND_USAGE,
	POKEMON_TOOL_ACTIONS,
	type PokemonRequest,
	type PokemonToolDetails,
	executePokemonRequest,
	parsePokemonCommand,
} from "../src/pokemon.js";

const POKEMON_PARAMS = Type.Object({
	action: StringEnum(POKEMON_TOOL_ACTIONS),
	session: Type.Optional(Type.String({ description: "Named pokemon-agent session. Default: default." })),
	romPath: Type.Optional(Type.String({ description: "Path to a local ROM file for setup/info/start." })),
	port: Type.Optional(Type.Number({ description: "HTTP port for start. Default: 8765." })),
	dataDir: Type.Optional(Type.String({ description: "Data directory for saves and logs. Default: ~/.pi/agent/tools/pokemon-agent/data/<session>" })),
	loadState: Type.Optional(Type.String({ description: "Saved state name to auto-load on start." })),
	actions: Type.Optional(Type.Array(Type.String({ description: "Pokemon action string." }), { description: "Action sequence for action." })),
	saveName: Type.Optional(Type.String({ description: "Save slot name for save/load." })),
});

export default defineExtension((pi) => {
	pi.registerTool(
		defineTool<typeof POKEMON_PARAMS, PokemonToolDetails>({
			name: "pokemon",
			label: "Pokemon",
			description:
				"Control a local pokemon-agent emulator session. Use setup/info/start/status plus state, action, screenshot, save, load, saves, minimap, and stop.",
			promptSnippet:
				"Drive a local pokemon-agent session for ROM inspection, emulator control, screenshots, saves, and session lifecycle management.",
			promptGuidelines: [
				"Use pokemon action setup before start if the environment or ROM path might be missing.",
				"Do not attempt to download or distribute ROM files. Ask the user for a legal local ROM path instead.",
				"Use the named session parameter when running multiple Pokemon servers in parallel.",
			],
			parameters: POKEMON_PARAMS,
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				return executePokemonRequest(params as PokemonRequest, ctx.cwd, signal, onUpdate);
			},
			renderCall(args, theme) {
				let line = theme.fg("toolTitle", theme.bold("pokemon ")) + theme.fg("muted", args.action);
				if (args.session) line += ` ${theme.fg("accent", args.session)}`;
				if (args.romPath) line += ` ${theme.fg("dim", args.romPath)}`;
				if (args.saveName) line += ` ${theme.fg("dim", args.saveName)}`;
				if (args.actions?.length) line += ` ${theme.fg("dim", args.actions.join(","))}`;
				return new Text(line, 0, 0);
			},
		}),
	);

	pi.registerCommand("pokemon", {
		description: "Control pokemon-agent sessions without calling the pokemon tool directly.",
		handler: async (args, ctx) => {
			const parsed = parsePokemonCommand(args);
			if (parsed.usage) {
				ctx.ui.notify(parsed.usage, "info");
				return;
			}
			if (parsed.error || !parsed.request) {
				ctx.ui.notify(parsed.error ?? POKEMON_COMMAND_USAGE, "error");
				return;
			}
			const result = await executePokemonRequest(parsed.request, ctx.cwd);
			const text = result.content.find((block) => block.type === "text")?.text ?? "Pokemon command finished.";
			ctx.ui.notify(text, result.isError ? "error" : "info");
		},
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trim().toLowerCase();
			if (!prefix) {
				return [
					{ value: "setup", label: "setup", description: "Validate python, pokemon-agent, pyboy, and ROM access" },
					{ value: "start --rom ", label: "start", description: "Launch a detached pokemon-agent session" },
					{ value: "status", label: "status", description: "Inspect or clear the current session" },
					{ value: "action ", label: "action", description: "Send one or more emulator actions" },
					{ value: "stop", label: "stop", description: "Stop the current pokemon-agent session" },
				];
			}
			if ("start".startsWith(prefix)) {
				return [{ value: "start --rom ", label: "start", description: "start --rom <path> [--session <name>]" }];
			}
			if ("action".startsWith(prefix)) {
				return [{ value: "action ", label: "action", description: "action walk_up walk_up press_a" }];
			}
			return null;
		},
	});
});
