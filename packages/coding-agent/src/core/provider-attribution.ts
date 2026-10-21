import {
	type Api,
	getProviderAttributionHeaders,
	getProviderSessionHeaders,
	type Model,
	type ProviderAttributionClient,
	type ProviderHeaders,
} from "@earendil-works/pi-ai";
import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

const PI_CODING_AGENT_ATTRIBUTION: ProviderAttributionClient = {
	openRouter: { referer: "https://pi.dev", title: "pi", categories: "cli-agent" },
	nvidia: { billingOrigin: "Pi" },
	cloudflare: { userAgent: "pi-coding-agent" },
	opencode: { client: "pi" },
};

export function mergeProviderAttributionHeaders(
	model: Model<Api>,
	settingsManager: SettingsManager,
	sessionId: string | undefined,
	...headerSources: Array<ProviderHeaders | undefined>
): ProviderHeaders | undefined {
	const merged: ProviderHeaders = {
		...getProviderSessionHeaders(model, sessionId, PI_CODING_AGENT_ATTRIBUTION),
		...(isInstallTelemetryEnabled(settingsManager)
			? getProviderAttributionHeaders(model, PI_CODING_AGENT_ATTRIBUTION)
			: undefined),
	};

	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}
