import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type VotgoCommand =
	| "convert"
	| "extract-audio"
	| "remove-silence"
	| "crop-bars"
	| "transcribe"
	| "analyze"
	| "agent-run";

export interface VotgoGlobalOptions {
	ffmpegPath?: string;
	ffprobePath?: string;
	verbose?: boolean;
	yes?: boolean;
	timeout?: string;
	model?: string;
	elevenlabsKey?: string;
	openrouterKey?: string;
}

export interface VotgoBaseInvocation {
	command: VotgoCommand;
	global?: VotgoGlobalOptions;
}

export interface ConvertInvocation extends VotgoBaseInvocation {
	command: "convert";
	input: string;
	output?: string;
	format?: string;
	reencode?: boolean;
	vcodec?: string;
	acodec?: string;
}

export interface ExtractAudioInvocation extends VotgoBaseInvocation {
	command: "extract-audio";
	input: string;
	output?: string;
	stream?: number;
	forceFormat?: string;
	reencode?: boolean;
}

export interface RemoveSilenceInvocation extends VotgoBaseInvocation {
	command: "remove-silence";
	input: string;
	output?: string;
	noise?: string;
	minSilence?: number;
	pad?: number;
	vcodec?: string;
	acodec?: string;
	report?: string;
}

export interface CropBarsInvocation extends VotgoBaseInvocation {
	command: "crop-bars";
	input: string;
	output?: string;
	auto?: boolean;
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
	limit?: number;
	round?: number;
	detectSeconds?: number;
	seek?: number;
	dryRun?: boolean;
	vcodec?: string;
}

export interface TranscribeInvocation extends VotgoBaseInvocation {
	command: "transcribe";
	input: string;
	output?: string;
}

export interface AnalyzeInvocation extends VotgoBaseInvocation {
	command: "analyze";
	input: string;
	output?: string;
	prompt?: string;
}

export interface AgentRunInvocation extends VotgoBaseInvocation {
	command: "agent-run";
	input: string;
	output?: string;
	prompt?: string;
}

export type VotgoInvocation =
	| ConvertInvocation
	| ExtractAudioInvocation
	| RemoveSilenceInvocation
	| CropBarsInvocation
	| TranscribeInvocation
	| AnalyzeInvocation
	| AgentRunInvocation;

export interface VotgoProgressEvent {
	command: VotgoCommand;
	stream: "stdout" | "stderr";
	chunk: string;
	timestamp: number;
}

export interface VotgoRunResult {
	command: VotgoCommand;
	binaryPath: string;
	args: string[];
	cwd: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	startedAt: string;
	endedAt: string;
	durationMs: number;
}

export interface VideoClipMeta {
	id: string;
	path: string;
	durationSec: number;
	width: number;
	height: number;
	fps?: number;
	hasAudio: boolean;
	codecVideo?: string;
	codecAudio?: string;
}

export interface VideoProjectManifestV1 {
	version: 1;
	projectId: string;
	rootPath: string;
	createdAt: string;
	updatedAt: string;
	clips: VideoClipMeta[];
	activeTimelineId?: string;
}

export interface TimelineSegment {
	clipId: string;
	startSec: number;
	endSec: number;
	placementSec: number;
}

export interface TimelineTrack {
	id: string;
	kind: "video" | "audio";
	segments: TimelineSegment[];
}

export interface TimelineV1 {
	version: 1;
	timelineId: string;
	title: string;
	fps: number;
	resolution: { width: number; height: number };
	tracks: TimelineTrack[];
	totalDurationSec: number;
}

export interface FfmpegRecipeV1 {
	version: 1;
	recipeId: string;
	timelineId: string;
	commands: string[];
	notes: string[];
	requiresApproval: true;
}

export interface ApprovalDecision {
	approved: boolean;
	reason?: string;
}

export interface AgentStateSnapshot {
	model: Model<Api> | null;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	isStreaming: boolean;
	sessionId: string;
	sessionFile: string | undefined;
}

export type VideoControllerEvent =
	| { type: "agent_event"; event: AgentSessionEvent }
	| { type: "votgo_progress"; progress: VotgoProgressEvent }
	| { type: "project_index_progress"; indexed: number; total: number; path: string }
	| { type: "project_index_complete"; manifest: VideoProjectManifestV1 };
