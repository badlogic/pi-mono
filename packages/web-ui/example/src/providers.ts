import type { CustomProvider, CustomProvidersStore } from "@mariozechner/pi-web-ui";

const PROVIDER_PRESETS: ReadonlyArray<{
	id: string;
	name: string;
	type: CustomProvider["type"];
	port?: number;
	baseUrl?: string;
}> = [
	{ id: "preset-local-ollama", name: "Local Ollama", type: "ollama", port: 11434 },
	{ id: "preset-local-vllm", name: "Local vLLM", type: "vllm", baseUrl: "/v1" },
	{ id: "preset-local-lmstudio", name: "Local LM Studio", type: "lmstudio", port: 1234, baseUrl: "/v1" },
	{ id: "preset-local-llama-cpp", name: "Local llama.cpp", type: "llama.cpp", port: 8080 },
];

function resolveHost(): string {
	return window.location.hostname || "127.0.0.1";
}

function buildBaseUrl(port?: number, suffix = ""): string {
	const host = resolveHost();
	if (!port) return suffix || `http://${host}`;
	return `http://${host}:${port}${suffix}`;
}

function createPreset(definition: (typeof PROVIDER_PRESETS)[number]): CustomProvider {
	return {
		id: definition.id,
		name: definition.name,
		type: definition.type,
		baseUrl: definition.baseUrl
			? definition.baseUrl.startsWith("http")
				? definition.baseUrl
				: buildBaseUrl(definition.port, definition.baseUrl)
			: buildBaseUrl(definition.port),
	};
}

export async function ensureProviderPresets(customProviders: CustomProvidersStore): Promise<void> {
	for (const definition of PROVIDER_PRESETS) {
		if (!(await customProviders.has(definition.id))) {
			await customProviders.set(createPreset(definition));
		}
	}
}

export async function countCustomProviders(customProviders: CustomProvidersStore): Promise<number> {
	return (await customProviders.getAll()).length;
}
