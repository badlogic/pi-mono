import { StringEnum, Text, Type, defineExtension, defineTool } from "@mariozechner/pi-extension-sdk";
import {
	EVOLUTION_ACTIONS,
	EVOLUTION_COMMAND_USAGE,
	type EvolutionRequest,
	type EvolutionToolDetails,
	executeEvolutionRequest,
	parseEvolutionCommand,
} from "../src/evolution.js";

const EVOLUTION_PARAMS = Type.Object({
	action: StringEnum(EVOLUTION_ACTIONS),
	targetType: Type.Optional(Type.String({ description: 'Evolution target type. Only "skill" is supported in v1.' })),
	skillName: Type.Optional(Type.String({ description: "Skill name or relative path to evolve." })),
	cwd: Type.Optional(Type.String({ description: "Working directory for .pi/evolution outputs." })),
	datasetPath: Type.Optional(Type.String({ description: "Dataset directory or JSONL path." })),
	iterations: Type.Optional(Type.Number({ description: "Optimization iterations. Default: 5." })),
	evalSource: Type.Optional(Type.String({ description: 'Dataset source: "synthetic" or "golden". Default: synthetic.' })),
	optimizerModel: Type.Optional(Type.String({ description: "DSPy optimizer model id." })),
	evalModel: Type.Optional(Type.String({ description: "Evaluation/judge model id." })),
	dryRun: Type.Optional(Type.Boolean({ description: "Validate and stage a dry-run without mutating live skills." })),
	overwrite: Type.Optional(Type.Boolean({ description: "Allow overwriting dataset skeleton files." })),
});

export default defineExtension((pi) => {
	pi.registerTool(
		defineTool<typeof EVOLUTION_PARAMS, EvolutionToolDetails>({
			name: "evolution",
			label: "Evolution",
			description:
				"Run bounded skill-evolution workflows for Pi skills. Actions: setup, targets, init_dataset, run, and status.",
			promptSnippet:
				"Inspect Pi skill targets, initialize evaluation datasets, run bounded skill-evolution helpers, and inspect saved run artifacts.",
			promptGuidelines: [
				"Use evolution action targets before run if the requested skill path might be ambiguous.",
				"Use evolution action init_dataset to create the train/val/holdout skeleton when a golden dataset does not exist yet.",
				"Do not auto-apply evolved skill candidates to live skill roots in v1.",
			],
			parameters: EVOLUTION_PARAMS,
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				return executeEvolutionRequest(params as EvolutionRequest, ctx.cwd, signal, onUpdate);
			},
			renderCall(args, theme) {
				let line = theme.fg("toolTitle", theme.bold("evolution ")) + theme.fg("muted", args.action);
				if (args.skillName) line += ` ${theme.fg("accent", args.skillName)}`;
				if (args.dryRun) line += ` ${theme.fg("dim", "dry-run")}`;
				return new Text(line, 0, 0);
			},
		}),
	);

	pi.registerCommand("evolution", {
		description: "Run skill-evolution setup, dataset initialization, and status flows without calling the tool directly.",
		handler: async (args, ctx) => {
			const parsed = parseEvolutionCommand(args);
			if (parsed.usage) {
				ctx.ui.notify(parsed.usage, "info");
				return;
			}
			if (parsed.error || !parsed.request) {
				ctx.ui.notify(parsed.error ?? EVOLUTION_COMMAND_USAGE, "error");
				return;
			}
			const result = await executeEvolutionRequest(parsed.request, ctx.cwd);
			const text = result.content.find((block) => block.type === "text")?.text ?? "Evolution command finished.";
			ctx.ui.notify(text, result.isError ? "error" : "info");
		},
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trim().toLowerCase();
			if (!prefix) {
				return [
					{ value: "setup", label: "setup", description: "Validate Python, DSPy, and credentials" },
					{ value: "targets", label: "targets", description: "List evolvable skills" },
					{ value: "init-dataset ", label: "init-dataset", description: "Create train/val/holdout JSONL skeletons" },
					{ value: "run ", label: "run", description: "Run a bounded skill-evolution job" },
					{ value: "status", label: "status", description: "Show latest saved run metrics" },
				];
			}
			if ("run".startsWith(prefix)) {
				return [{ value: "run ", label: "run", description: "run <skill> [--dry-run]" }];
			}
			if ("init-dataset".startsWith(prefix)) {
				return [{ value: "init-dataset ", label: "init-dataset", description: "init-dataset <skill>" }];
			}
			return null;
		},
	});
});
