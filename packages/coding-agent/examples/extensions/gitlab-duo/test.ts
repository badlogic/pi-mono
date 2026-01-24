/**
 * Test script for GitLab Duo - full streaming flow
 * Run: npx tsx test.ts
 */

import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	registerApiProvider,
	type SimpleStreamOptions,
	streamSimple,
} from "@mariozechner/pi-ai";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// =============================================================================
// Constants (copied from index.ts)
// =============================================================================

const GITLAB_COM_URL = "https://gitlab.com";
const AI_GATEWAY_URL = "https://cloud.gitlab.com";
const ANTHROPIC_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/anthropic/`;
const OPENAI_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/openai/v1`;
const DIRECT_ACCESS_TTL = 25 * 60 * 1000;

const MODEL_MAPPINGS: Record<
	string,
	{ api: "anthropic-messages" | "openai-completions"; backendModel: string; baseUrl: string }
> = {
	"duo-chat-opus-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-opus-4-5-20251101",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-sonnet-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-sonnet-4-5-20250929",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-haiku-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-haiku-4-5-20251001",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-gpt-5-1": { api: "openai-completions", backendModel: "gpt-5.1-2025-11-13", baseUrl: OPENAI_PROXY_URL },
	"duo-chat-gpt-5-mini": {
		api: "openai-completions",
		backendModel: "gpt-5-mini-2025-08-07",
		baseUrl: OPENAI_PROXY_URL,
	},
	"duo-chat-gpt-5-codex": { api: "openai-completions", backendModel: "gpt-5-codex", baseUrl: OPENAI_PROXY_URL },
};

// =============================================================================
// Direct Access Token
// =============================================================================

interface DirectAccessToken {
	token: string;
	headers: Record<string, string>;
	expiresAt: number;
}

let cachedDirectAccess: DirectAccessToken | null = null;

async function getDirectAccessToken(gitlabAccessToken: string): Promise<DirectAccessToken> {
	const now = Date.now();
	if (cachedDirectAccess && cachedDirectAccess.expiresAt > now) {
		return cachedDirectAccess;
	}

	const url = `${GITLAB_COM_URL}/api/v4/ai/third_party_agents/direct_access`;
	console.log("Fetching direct access token from:", url);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${gitlabAccessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ feature_flags: { DuoAgentPlatformNext: true } }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to get direct access token: ${response.status} ${errorText}`);
	}

	const data = (await response.json()) as { token: string; headers: Record<string, string> };
	console.log("Got direct access token");
	console.log("Token type:", data.token?.substring(0, 10));
	console.log("Headers received:", JSON.stringify(data.headers, null, 2));
	cachedDirectAccess = {
		token: data.token,
		headers: data.headers,
		expiresAt: now + DIRECT_ACCESS_TTL,
	};
	return cachedDirectAccess;
}

// =============================================================================
// Stream Function (copied from index.ts)
// =============================================================================

function streamGitLabDuo(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		try {
			const gitlabAccessToken = options?.apiKey;
			console.log("streamGitLabDuo called");
			console.log("  model.id:", model.id);
			console.log("  options.apiKey present:", !!gitlabAccessToken);
			console.log("  options.apiKey (first 20):", gitlabAccessToken?.substring(0, 20) + "...");

			if (!gitlabAccessToken) {
				throw new Error("No GitLab access token provided in options.apiKey");
			}

			const mapping = MODEL_MAPPINGS[model.id];
			if (!mapping) throw new Error(`Unknown model: ${model.id}`);

			// Get direct access token (cached)
			const directAccess = await getDirectAccessToken(gitlabAccessToken);

			// Create a proxy model that uses the backend API
			const proxyModel: Model<typeof mapping.api> = {
				...model,
				id: mapping.backendModel,
				api: mapping.api,
				baseUrl: mapping.baseUrl,
				headers: directAccess.headers,
			};

			// Merge GitLab headers with Authorization
			const headers = {
				...directAccess.headers,
				Authorization: `Bearer ${directAccess.token}`,
			};

			console.log("Calling streamSimple with proxy model:");
			console.log("  proxyModel.id:", proxyModel.id);
			console.log("  proxyModel.api:", proxyModel.api);
			console.log("  proxyModel.baseUrl:", proxyModel.baseUrl);
			console.log("  headers keys:", Object.keys(headers));

			// Delegate to pi-ai's built-in streaming with headers (not apiKey)
			const innerStream = streamSimple(proxyModel, context, {
				...options,
				apiKey: "dummy", // Need something to pass the "no api key" check
				headers,
			});

			// Forward all events
			for await (const event of innerStream) {
				// Patch the model info back to gitlab-duo
				if ("partial" in event && event.partial) {
					event.partial.api = model.api;
					event.partial.provider = model.provider;
					event.partial.model = model.id;
				}
				if ("message" in event && event.message) {
					event.message.api = model.api;
					event.message.provider = model.provider;
					event.message.model = model.id;
				}
				if ("error" in event && event.error) {
					event.error.api = model.api;
					event.error.provider = model.provider;
					event.error.model = model.id;
				}
				stream.push(event);
			}
			stream.end();
		} catch (error) {
			console.error("Stream error:", error);
			stream.push({
				type: "error",
				reason: "error",
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();

	return stream;
}

// =============================================================================
// Main Test
// =============================================================================

interface AuthData {
	[provider: string]: {
		type: "oauth" | "api_key";
		refresh?: string;
		access?: string;
		expires?: number;
		key?: string;
	};
}

async function main() {
	// Read auth.json
	const authPath = join(homedir(), ".pi", "agent", "auth.json");
	console.log("Reading auth from:", authPath);

	let authData: AuthData;
	try {
		authData = JSON.parse(readFileSync(authPath, "utf-8"));
	} catch (e) {
		console.error("Failed to read auth.json:", e);
		process.exit(1);
	}

	const gitlabCred = authData["gitlab-duo"];
	if (!gitlabCred || gitlabCred.type !== "oauth" || !gitlabCred.access) {
		console.error("No gitlab-duo OAuth credentials found. Run /login gitlab-duo first.");
		process.exit(1);
	}

	console.log("Found gitlab-duo OAuth credentials");
	const gitlabAccessToken = gitlabCred.access;

	// Register our custom API provider
	console.log("\nRegistering gitlab-duo-api provider...");
	registerApiProvider({
		api: "gitlab-duo-api" as Api,
		stream: (model, context, options) => streamGitLabDuo(model, context, options as SimpleStreamOptions),
		streamSimple: streamGitLabDuo,
	});

	// Create a test model
	const testModel: Model<Api> = {
		id: "duo-chat-sonnet-4-5",
		name: "GitLab Duo Claude Sonnet 4.5",
		api: "gitlab-duo-api" as Api,
		provider: "gitlab-duo",
		baseUrl: AI_GATEWAY_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 16384,
	};

	// Create test context
	const context: Context = {
		messages: [{ role: "user", content: "Say hello in exactly 3 words.", timestamp: Date.now() }],
	};

	console.log("\nStarting stream test...");
	console.log("Model:", testModel.id);
	console.log("Prompt:", context.messages[0].content);
	console.log("");

	// Call streamSimple
	const stream = streamSimple(testModel, context, {
		apiKey: gitlabAccessToken,
		maxTokens: 100,
	});

	// Consume the stream
	for await (const event of stream) {
		if (event.type === "text_delta") {
			process.stdout.write(event.delta);
		} else if (event.type === "error") {
			console.error("\nError:", event.error.errorMessage);
		} else if (event.type === "done") {
			console.log("\n\nDone! Stop reason:", event.reason);
			console.log("Usage:", event.message.usage);
		}
	}
}

main().catch(console.error);
