import { type Api, type Model } from "@mariozechner/pi-ai";
import { existsSync } from "fs";
import { join } from "path";

export interface VibeProxyInfo {
	running: boolean;
	port: number;
	version?: string;
	models?: any[];
}

/**
 * Detect if VibeProxy is running and return its configuration
 */
export async function detectVibeProxy(): Promise<VibeProxyInfo> {
	// Check common VibeProxy ports
	const defaultPorts = [8318, 8317];
	
	for (const port of defaultPorts) {
		try {
			// Test if the endpoint is accessible
			const response = await fetch(`http://localhost:${port}/`, {
				method: 'GET',
				signal: AbortSignal.timeout(2000) // 2 second timeout
			});
			
			if (response.ok) {
				const data = await response.json();
				
				// This looks like VibeProxy/OpenAI-compatible endpoint
				if (data.endpoints && Array.isArray(data.endpoints)) {
					// Try to get available models
					let models: any[] = [];
					try {
						const modelsResponse = await fetch(`http://localhost:${port}/v1/models`, {
							signal: AbortSignal.timeout(5000)
						});
						if (modelsResponse.ok) {
							const modelsData = await modelsResponse.json();
							models = modelsData.data || [];
						}
					} catch {
						// Models endpoint not available, that's ok
					}
					
					return {
						running: true,
						port,
						models
					};
				}
			}
		} catch {
			// Port not available or not VibeProxy, try next
		}
	}
	
	return { running: false, port: 8318 };
}

/**
 * Generate VibeProxy provider configuration based on detected models
 */
export function generateVibeProxyConfig(models: any[]): Model<Api>[] {
	if (!models || models.length === 0) {
		// Fallback to common models if auto-detection fails
		return getFallbackVibeProxyModels();
	}
	
	const vibeproxyModels: Model<Api>[] = [];
	
	for (const model of models) {
		// Map VibeProxy models to our Model interface
		const piModel: Model<any> = {
			id: model.id,
			name: `${model.id} (via VibeProxy)`,
			api: "openai-completions",
			provider: "vibeproxy",
			baseUrl: `http://localhost:8318/v1`,
			reasoning: model.id.includes("thinking") || model.id.includes("opus"),
			input: ["text"], // VibeProxy currently supports text
			cost: {
				input: 0, // VibeProxy handles costs via subscription
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			contextWindow: 200000, // Default large context window
			maxTokens: getMaxTokensForModel(model.id)
		};
		
		vibeproxyModels.push(piModel);
	}
	
	return vibeproxyModels;
}

function getMaxTokensForModel(modelId: string): number {
	if (modelId.includes("opus")) return 4096;
	if (modelId.includes("sonnet")) return 8192;
	if (modelId.includes("haiku")) return 8192;
	if (modelId.includes("gpt-5")) return 8192;
	return 4096; // Default
}

function getFallbackVibeProxyModels(): Model<Api>[] {
	const fallbackModels: Model<any>[] = [
		{
			id: "claude-sonnet-4-20250514",
			name: "Claude Sonnet 4 (via VibeProxy)",
			api: "openai-completions",
			provider: "vibeproxy",
			baseUrl: "http://localhost:8318/v1",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			contextWindow: 200000,
			maxTokens: 8192
		},
		{
			id: "claude-opus-4-20250514",
			name: "Claude Opus 4 (via VibeProxy)",
			api: "openai-completions",
			provider: "vibeproxy",
			baseUrl: "http://localhost:8318/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			contextWindow: 200000,
			maxTokens: 4096
		},
		{
			id: "claude-3-5-sonnet-20250219",
			name: "Claude 3.5 Sonnet (via VibeProxy)",
			api: "openai-completions",
			provider: "vibeproxy",
			baseUrl: "http://localhost:8318/v1",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			contextWindow: 200000,
			maxTokens: 8192
		},
		{
			id: "gpt-5.1-codex",
			name: "GPT 5.1 Codex (via VibeProxy)",
			api: "openai-completions",
			provider: "vibeproxy",
			baseUrl: "http://localhost:8318/v1",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			contextWindow: 200000,
			maxTokens: 8192
		}
	];
	
	return fallbackModels;
}

/**
 * Check if VibeProxy configuration file exists
 */
export function hasVibeProxyConfig(): boolean {
	const configPath = join(require("os").homedir(), ".pi", "agent", "models.json");
	return existsSync(configPath);
}

// Export the fallback function for testing
export { getFallbackVibeProxyModels };
