import { join } from "node:path";
import type { VotgoCommand } from "./types.js";

export const DEFAULT_VOTGO_REPO_PATH = "/Users/francescooddo/Desktop/miniMaoMao/VotGO";

export const VOTGO_COMMANDS: readonly VotgoCommand[] = [
	"convert",
	"extract-audio",
	"remove-silence",
	"crop-bars",
	"transcribe",
	"analyze",
	"agent-run",
] as const;

export const MUTATING_COMMANDS: ReadonlySet<VotgoCommand> = new Set<VotgoCommand>([
	"convert",
	"extract-audio",
	"remove-silence",
	"crop-bars",
	"agent-run",
]);

export interface VideoElectronSettings {
	votgoRepoPath: string;
	votgoBinaryPath?: string;
	requireApproval: boolean;
	allowedCommands: VotgoCommand[];
}

export function createDefaultVideoElectronSettings(): VideoElectronSettings {
	return {
		votgoRepoPath: DEFAULT_VOTGO_REPO_PATH,
		votgoBinaryPath: undefined,
		requireApproval: false,
		allowedCommands: [...VOTGO_COMMANDS],
	};
}

export function getDefaultBinaryCandidates(settings: VideoElectronSettings): string[] {
	const explicit = settings.votgoBinaryPath ? [settings.votgoBinaryPath] : [];
	return [...explicit, join(settings.votgoRepoPath, "bin", "votgo"), join(settings.votgoRepoPath, "votgo"), "votgo"];
}
