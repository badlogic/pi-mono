import type {
	AgentStateSnapshot,
	FfmpegRecipeV1,
	TimelineV1,
	VideoControllerEvent,
	VideoProjectManifestV1,
	VotgoInvocation,
	VotgoRunResult,
} from "./types.js";

export type RendererCommand =
	| { type: "project/open"; projectRoot: string }
	| {
			type: "project/import_media";
			projectRoot: string;
			sourcePath: string;
			destination?: "input" | "output";
	  }
	| { type: "project/get_manifest" }
	| { type: "agent/prompt"; message: string }
	| { type: "agent/abort" }
	| { type: "agent/get_state" }
	| { type: "agent/set_model"; provider: string; modelId: string }
	| { type: "agent/set_thinking_level"; level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" }
	| { type: "tools/votgo/run"; invocation: VotgoInvocation }
	| { type: "artifact/save_timeline"; timeline: TimelineV1 }
	| { type: "artifact/save_recipe"; recipe: FfmpegRecipeV1 }
	| { type: "fs/read_text"; path: string }
	| { type: "fs/exists"; path: string };

export type RendererCommandData =
	| { type: "project/open"; manifest: VideoProjectManifestV1 }
	| { type: "project/import_media"; manifest: VideoProjectManifestV1; importedPath: string }
	| { type: "project/get_manifest"; manifest: VideoProjectManifestV1 | null }
	| { type: "agent/prompt"; queued: true }
	| { type: "agent/abort"; aborted: true }
	| { type: "agent/get_state"; state: AgentStateSnapshot }
	| { type: "agent/set_model"; changed: true }
	| { type: "agent/set_thinking_level"; changed: true }
	| { type: "tools/votgo/run"; result: VotgoRunResult }
	| { type: "artifact/save_timeline"; path: string }
	| { type: "artifact/save_recipe"; path: string }
	| { type: "fs/read_text"; content: string }
	| { type: "fs/exists"; exists: boolean };

export interface CommandSuccess {
	ok: true;
	data: RendererCommandData;
}

export interface CommandFailure {
	ok: false;
	error: string;
	commandType: RendererCommand["type"];
}

export type CommandResult = CommandSuccess | CommandFailure;

export type RendererEvent = VideoControllerEvent;
