const DEFAULT_ANTIGRAVITY_VERSION = "1.15.8";

export function getAntigravityHeaders(): Record<string, string> {
	const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
	return {
		"User-Agent": `antigravity/${version} darwin/arm64`,
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": JSON.stringify({
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		}),
	};
}
