import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type ExecutionState =
  | "INIT"
  | "CONTRACT_SYNTHESIS"
  | "PREFLIGHT"
  | "FROZEN"
  | "EXECUTING"
  | "COMPLETE"
  | "FAILED"
  | "PAUSED";

export interface ExecutionContract {
  requiredInputs: string[];
  requiredFiles: string[];
  requiredTools: string[];
  requiredScripts: string[];
  missingInformation: string[];
}

export interface Snapshot {
  prompt: string;
  skillText: string;
  contract: ExecutionContract;
  fileDigests: Record<string, string>;
  toolWhitelist: string[];
  repoCommitHash?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  state: ExecutionState;
  userPrompt: string;
  skillText: string;
  contract?: ExecutionContract;
  snapshot?: Snapshot;
  messageHistory?: AgentMessage[];
  currentStep?: number;
  totalSteps?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionRequest {
  userPrompt: string;
  skillText: string;
  workingDir: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SessionStatusResponse {
  sessionId: string;
  state: ExecutionState;
  progress?: {
    current: number;
    total: number;
  };
  error?: string;
}
