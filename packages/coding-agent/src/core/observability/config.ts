import { join } from "node:path";

/**
 * How much prompt, tool argument, and tool result text is written to telemetry.
 * `off` records only sizes, counts, durations, and content hashes.
 */
export type ContentCapture = "off" | "redacted" | "full";

export interface ObservabilityConfig {
	enabled: boolean;
	dir: string;
	content: ContentCapture;
}

const CONTENT_VALUES: readonly ContentCapture[] = ["off", "redacted", "full"];

function isTruthy(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parseContentCapture(value: string | undefined): ContentCapture {
	const normalized = value?.toLowerCase();
	return CONTENT_VALUES.find((candidate) => candidate === normalized) ?? "off";
}

/** Reads observability settings from the environment. Disabled unless `PI_OBSERVABILITY` is set. */
export function readObservabilityConfig(env: NodeJS.ProcessEnv, agentDir: string): ObservabilityConfig {
	return {
		enabled: isTruthy(env.PI_OBSERVABILITY),
		dir: env.PI_OBSERVABILITY_DIR ?? join(agentDir, "telemetry"),
		content: parseContentCapture(env.PI_OBSERVABILITY_CONTENT),
	};
}
