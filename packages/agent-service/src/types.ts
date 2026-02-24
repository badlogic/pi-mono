import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type ServiceErrorCode =
	| "AUTH_INVALID"
	| "SESSION_NOT_FOUND"
	| "SESSION_BUSY"
	| "POLICY_DENIED"
	| "TOOL_EXEC_ERROR"
	| "MODEL_ERROR"
	| "INTERNAL_ERROR";

export interface ServiceErrorShape {
	code: ServiceErrorCode;
	message: string;
	retryable: boolean;
	details: JsonObject;
}

export interface SessionEventEnvelope {
	seq: number;
	sessionId: string;
	runId: string;
	ts: string;
	event: AgentSessionEvent;
}

export interface PromptRequest {
	text: string;
	streamingBehavior?: "steer" | "followUp";
}

export interface SteerRequest {
	text: string;
}

export interface FollowUpRequest {
	text: string;
}

export interface SetModelRequest {
	provider: string;
	modelId: string;
}

export interface SetThinkingLevelRequest {
	level: ThinkingLevel;
}

export interface ForkRequest {
	entryId: string;
}

export interface NavigateTreeRequest {
	targetId: string;
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface NewSessionRequest {
	parentSession?: string;
}

export interface SwitchSessionRequest {
	sessionPath: string;
}

export interface CreateSessionRequest {
	cwd?: string;
	agentDir?: string;
	sessionDir?: string;
	sessionPath?: string;
	continueRecent?: boolean;
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface RuntimeState {
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	modelProvider?: string;
	modelId?: string;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	pendingMessageCount: number;
	messageCount: number;
	activeRunId?: string;
	isBusy: boolean;
}

export interface RuntimeForkResult {
	selectedText: string;
	cancelled: boolean;
}

export interface RuntimeNavigateResult {
	editorText?: string;
	cancelled: boolean;
	aborted?: boolean;
	summaryEntryId?: string;
}

export interface RuntimeNewSessionResult {
	cancelled: boolean;
}

export interface RuntimeSwitchSessionResult {
	cancelled: boolean;
}

export interface RuntimePromptResult {
	runId: string;
}

export interface RuntimeSessionView {
	id: string;
	state: RuntimeState;
}

export interface RuntimeMessagesView {
	sessionId: string;
	messages: AgentMessage[];
}

export interface BashPolicyConfig {
	allowedPrefixes: string[];
}

export interface ServiceConfig {
	apiKey: string;
	heartbeatMs?: number;
	defaultCwd?: string;
	defaultAgentDir?: string;
	defaultSessionDir?: string;
	bashPolicy?: BashPolicyConfig;
}
