import type { Api, ClientIdentity, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import { VERSION } from "../config.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

const OPENCODE_HOST = "opencode.ai";

/**
 * How pi's requests identify it to providers: a detailed `User-Agent` with pi's version, and attribution to pi as a
 * CLI agent while install telemetry is enabled.
 */
export function getClientIdentity(settingsManager: SettingsManager): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: isInstallTelemetryEnabled(settingsManager) ? { categories: "cli-agent" } : false,
	};
}

function isOpenCodeModel(model: Model<Api>): boolean {
	if (model.provider === "opencode" || model.provider === "opencode-go") return true;
	try {
		return new URL(model.baseUrl).hostname === OPENCODE_HOST;
	} catch {
		return false;
	}
}

/**
 * OpenCode's per-conversation routing header. pi-ai's OpenCode providers add it themselves; this also covers custom
 * providers pointing at OpenCode. Configured and request headers override it.
 */
export function withOpenCodeSessionHeader(
	model: Model<Api>,
	sessionId: string | undefined,
	headers: ProviderHeaders,
): ProviderHeaders {
	if (!sessionId || !isOpenCodeModel(model)) return headers;
	return { "x-opencode-session": sessionId, ...headers };
}
