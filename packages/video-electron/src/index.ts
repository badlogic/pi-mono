export { type CreateVideoAgentSessionResult, createVideoAgentSession, type VideoSessionRuntime } from "./agent.js";
export { type ApprovalHandler, type ApprovalRequest, defaultApprovalReason, requiresApproval } from "./approval.js";
export {
	buildRecipeFromTimeline,
	resolveConstraintsPath,
	saveRecipeArtifact,
	saveTimelineArtifact,
} from "./artifacts.js";
export {
	createDefaultVideoElectronSettings,
	DEFAULT_VOTGO_REPO_PATH,
	getDefaultBinaryCandidates,
	MUTATING_COMMANDS,
	type VideoElectronSettings,
	VOTGO_COMMANDS,
} from "./config.js";
export { VideoAgentController, type VideoAgentControllerOptions } from "./controller.js";
export { type CreateVideoElectronAppOptions, createVideoElectronApp, type VideoElectronApp } from "./electron-main.js";
export type {
	CommandFailure,
	CommandResult,
	CommandSuccess,
	RendererCommand,
	RendererCommandData,
	RendererEvent,
} from "./ipc.js";
export type { VideoAgentPreloadApi } from "./preload.js";
export {
	ensureProjectLayout,
	getProjectLayoutPaths,
	getRecipeFilename,
	getTimelineFilename,
	type IndexProjectOptions,
	loadProjectManifest,
	openOrCreateVideoProject,
	type ProjectLayoutPaths,
	saveProjectManifest,
} from "./project.js";
export type {
	AgentRunInvocation,
	AgentStateSnapshot,
	AnalyzeInvocation,
	ApprovalDecision,
	ConvertInvocation,
	CropBarsInvocation,
	ExtractAudioInvocation,
	FfmpegRecipeV1,
	RemoveSilenceInvocation,
	TimelineSegment,
	TimelineTrack,
	TimelineV1,
	TranscribeInvocation,
	VideoClipMeta,
	VideoControllerEvent,
	VideoProjectManifestV1,
	VotgoCommand,
	VotgoGlobalOptions,
	VotgoInvocation,
	VotgoProgressEvent,
	VotgoRunResult,
} from "./types.js";
export { type RunVotgoCommandOptions, resolveVotgoBinary, runVotgoCommand, VotgoBinaryNotFoundError } from "./votgo.js";
