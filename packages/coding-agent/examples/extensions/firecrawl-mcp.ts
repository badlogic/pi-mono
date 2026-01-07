/**
 * Firecrawl MCP Extension
 *
 * Provides Firecrawl MCP tools via HTTP:
 * - firecrawl_scrape
 * - firecrawl_batch_scrape
 * - firecrawl_check_batch_status
 * - firecrawl_map
 * - firecrawl_search
 * - firecrawl_crawl
 * - firecrawl_check_crawl_status
 * - firecrawl_extract
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Optional config:
 *    - JSON config: ~/.pi/agent/extensions/firecrawl-mcp.json or .pi/extensions/firecrawl-mcp.json
 *      (or set FIRECRAWL_MCP_CONFIG / --firecrawl-mcp-config for a custom path)
 *      Keys: url, apiKey, headers, timeoutMs, protocolVersion, tools, maxBytes, maxLines
 *    - FIRECRAWL_MCP_URL (default: https://mcp.firecrawl.dev/v2/mcp)
 *    - FIRECRAWL_API_KEY (optional; used as Bearer token)
 *    - FIRECRAWL_MCP_TIMEOUT_MS (default: 30000)
 *    - FIRECRAWL_MCP_PROTOCOL_VERSION (default: 2025-06-18)
 *    - FIRECRAWL_MCP_TOOLS (comma-separated list, limits registered tools)
 *    - FIRECRAWL_MCP_MAX_BYTES (default: 51200)
 *    - FIRECRAWL_MCP_MAX_LINES (default: 2000)
 * 3. Or pass flags:
 *    --firecrawl-mcp-url, --firecrawl-mcp-api-key, --firecrawl-mcp-timeout-ms,
 *    --firecrawl-mcp-protocol, --firecrawl-mcp-config, --firecrawl-mcp-tools,
 *    --firecrawl-mcp-max-bytes, --firecrawl-mcp-max-lines
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

const DEFAULT_ENDPOINT = "https://mcp.firecrawl.dev/v2/mcp";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const CLIENT_INFO = {
	name: "pi-firecrawl-mcp-extension",
	version: "0.1.0",
} as const;

type JsonRpcId = string;

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: JsonRpcId | number | null;
	result?: unknown;
	error?: JsonRpcError;
}

interface McpToolResult {
	content?: Array<Record<string, unknown>>;
	isError?: boolean;
}

interface McpToolDetails {
	tool: string;
	endpoint: string;
	truncated: boolean;
	truncation?: {
		truncatedBy: "lines" | "bytes" | null;
		totalLines: number;
		totalBytes: number;
		outputLines: number;
		outputBytes: number;
		maxLines: number;
		maxBytes: number;
	};
	tempFile?: string;
}

interface McpErrorDetails {
	tool: string;
	endpoint: string;
	error: string;
}

interface FirecrawlMcpConfig {
	url?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	protocolVersion?: string;
	tools?: string[];
	maxBytes?: number;
	maxLines?: number;
}

interface FirecrawlRequestConfig {
	endpoint: string;
	headers: Record<string, string>;
	timeoutMs: number;
	protocolVersion: string;
	apiKey?: string;
	tools?: string[];
	maxBytes?: number;
	maxLines?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	return isRecord(value) && value.jsonrpc === "2.0";
}

function toJsonString(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatToolOutput(
	toolName: string,
	endpoint: string,
	result: McpToolResult,
	limits?: { maxBytes?: number; maxLines?: number },
): { text: string; details: McpToolDetails } {
	const contentBlocks = Array.isArray(result.content) ? result.content : [];
	const renderedBlocks =
		contentBlocks.length > 0
			? contentBlocks.map((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						return block.text;
					}
					return toJsonString(block);
				})
			: [toJsonString(result)];

	const rawText = renderedBlocks.join("\n");
	const truncation = truncateHead(rawText, {
		maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
		maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
	});

	let text = truncation.content;
	let tempFile: string | undefined;

	if (truncation.truncated) {
		tempFile = writeTempFile(toolName, rawText);
		text +=
			`\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
			`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
			`Full output saved to: ${tempFile}]`;
	}

	if (truncation.firstLineExceedsLimit && rawText.length > 0) {
		text =
			`[First line exceeded ${formatSize(truncation.maxBytes)} limit. Full output saved to: ${tempFile ?? "N/A"}]\n` +
			text;
	}

	return {
		text,
		details: {
			tool: toolName,
			endpoint,
			truncated: truncation.truncated,
			truncation: {
				truncatedBy: truncation.truncatedBy,
				totalLines: truncation.totalLines,
				totalBytes: truncation.totalBytes,
				outputLines: truncation.outputLines,
				outputBytes: truncation.outputBytes,
				maxLines: truncation.maxLines,
				maxBytes: truncation.maxBytes,
			},
			tempFile,
		},
	};
}

function writeTempFile(toolName: string, content: string): string {
	const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
	const filename = `pi-firecrawl-mcp-${safeName}-${Date.now()}.txt`;
	const filePath = join(tmpdir(), filename);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function parseTimeoutMs(value: string | number | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function splitParams(params: Record<string, unknown>): {
	mcpArgs: Record<string, unknown>;
	requestedLimits: { maxBytes?: number; maxLines?: number };
} {
	const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
		piMaxBytes?: unknown;
		piMaxLines?: unknown;
	};
	return {
		mcpArgs: rest,
		requestedLimits: {
			maxBytes: normalizeNumber(piMaxBytes),
			maxLines: normalizeNumber(piMaxLines),
		},
	};
}

function resolveMaxLimits(config: FirecrawlRequestConfig): { maxBytes: number; maxLines: number } {
	return {
		maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
		maxLines: config.maxLines ?? DEFAULT_MAX_LINES,
	};
}

function resolveEffectiveLimits(
	requested: { maxBytes?: number; maxLines?: number },
	maxAllowed: { maxBytes: number; maxLines: number },
): { maxBytes: number; maxLines: number } {
	const requestedBytes = requested.maxBytes ?? DEFAULT_MAX_BYTES;
	const requestedLines = requested.maxLines ?? DEFAULT_MAX_LINES;
	return {
		maxBytes: Math.min(requestedBytes, maxAllowed.maxBytes),
		maxLines: Math.min(requestedLines, maxAllowed.maxLines),
	};
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const headers: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(value)) {
		if (typeof rawValue === "string") {
			headers[key] = rawValue;
		}
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeTools(value: unknown): string[] | undefined {
	if (typeof value === "string") {
		const tools = value
			.split(",")
			.map((tool) => tool.trim())
			.filter((tool) => tool.length > 0);
		return tools.length > 0 ? tools : undefined;
	}
	if (Array.isArray(value)) {
		const tools = value
			.map((tool) => (typeof tool === "string" ? tool.trim() : ""))
			.filter((tool) => tool.length > 0);
		return tools.length > 0 ? tools : undefined;
	}
	return undefined;
}

function resolveConfigPath(configPath: string): string {
	const trimmed = configPath.trim();
	if (trimmed.startsWith("~/")) {
		return join(homedir(), trimmed.slice(2));
	}
	if (trimmed.startsWith("~")) {
		return join(homedir(), trimmed.slice(1));
	}
	if (isAbsolute(trimmed)) {
		return trimmed;
	}
	return resolve(process.cwd(), trimmed);
}

function parseConfig(raw: unknown, pathHint: string): FirecrawlMcpConfig {
	if (!isRecord(raw)) {
		throw new Error(`Invalid Firecrawl MCP config at ${pathHint}: expected an object.`);
	}
	return {
		url: normalizeString(raw.url),
		apiKey: normalizeString(raw.apiKey),
		headers: normalizeHeaders(raw.headers),
		timeoutMs: normalizeNumber(raw.timeoutMs),
		protocolVersion: normalizeString(raw.protocolVersion),
		tools: normalizeTools(raw.tools),
		maxBytes: normalizeNumber(raw.maxBytes),
		maxLines: normalizeNumber(raw.maxLines),
	};
}

function loadConfig(configPath: string | undefined): FirecrawlMcpConfig | null {
	const candidates: string[] = [];
	if (configPath) {
		candidates.push(resolveConfigPath(configPath));
	} else if (process.env.FIRECRAWL_MCP_CONFIG) {
		candidates.push(resolveConfigPath(process.env.FIRECRAWL_MCP_CONFIG));
	} else {
		candidates.push(join(process.cwd(), ".pi", "extensions", "firecrawl-mcp.json"));
		candidates.push(join(homedir(), ".pi", "agent", "extensions", "firecrawl-mcp.json"));
	}

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		const raw = readFileSync(candidate, "utf-8");
		const parsed = JSON.parse(raw);
		return parseConfig(parsed, candidate);
	}

	return null;
}

function resolveEndpoint(baseUrl: string, apiKey?: string): string {
	if (!apiKey) {
		return baseUrl;
	}
	return baseUrl.replace(/\{FIRECRAWL_API_KEY\}/g, apiKey);
}

function redactEndpoint(endpoint: string, apiKey?: string): string {
	if (!apiKey) {
		return endpoint;
	}
	return endpoint.replace(new RegExp(apiKey, "g"), "REDACTED");
}

function buildHeaders(
	apiKey: string | undefined,
	extraHeaders: Record<string, string> | undefined,
): Record<string, string> {
	const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
	if (apiKey && !headers.Authorization && !headers.authorization) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return headers;
}

class FirecrawlMcpClient {
	private requestCounter = 0;
	private initialized = false;
	private initializing: Promise<void> | null = null;
	private lastEndpoint: string | null = null;

	constructor(private readonly getConfig: () => FirecrawlRequestConfig) {}

	currentConfig(): FirecrawlRequestConfig {
		return this.getConfig();
	}

	async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
		await this.ensureInitialized(signal);
		const result = await this.sendRequest("tools/call", { name: toolName, arguments: args }, signal);
		if (isRecord(result)) {
			return result as McpToolResult;
		}
		return { content: [{ type: "text", text: toJsonString(result) }] };
	}

	private async ensureInitialized(signal?: AbortSignal): Promise<void> {
		const { endpoint } = this.getConfig();
		if (this.lastEndpoint !== endpoint) {
			this.initialized = false;
			this.initializing = null;
			this.lastEndpoint = endpoint;
		}

		if (this.initialized) {
			return;
		}

		if (!this.initializing) {
			this.initializing = this.initialize(signal);
		}

		await this.initializing;
		this.initialized = true;
	}

	private async initialize(signal?: AbortSignal): Promise<void> {
		const { endpoint, protocolVersion } = this.getConfig();
		await this.sendRequest(
			"initialize",
			{
				protocolVersion,
				capabilities: {},
				clientInfo: CLIENT_INFO,
			},
			signal,
			endpoint,
		);
		await this.sendNotification("notifications/initialized", {}, signal, endpoint);
	}

	private async sendRequest(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		overrideEndpoint?: string,
	): Promise<unknown> {
		const id = this.nextId();
		const response = await this.sendJsonRpc(
			{
				jsonrpc: "2.0",
				id,
				method,
				params,
			},
			signal,
			overrideEndpoint,
		);

		const json = extractJsonRpcResponse(response, id);
		if (json.error) {
			throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
		}
		return json.result;
	}

	private async sendNotification(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		overrideEndpoint?: string,
	): Promise<void> {
		await this.sendJsonRpc(
			{
				jsonrpc: "2.0",
				method,
				params,
			},
			signal,
			overrideEndpoint,
			true,
		);
	}

	private async sendJsonRpc(
		payload: Record<string, unknown>,
		signal?: AbortSignal,
		overrideEndpoint?: string,
		isNotification = false,
	): Promise<unknown> {
		const { endpoint, headers, timeoutMs } = this.getConfig();
		const url = overrideEndpoint ?? endpoint;
		const { signal: mergedSignal, cleanup } = createMergedSignal(signal, timeoutMs);

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					...headers,
				},
				body: JSON.stringify(payload),
				signal: mergedSignal,
			});

			if (response.status === 204 || response.status === 202) {
				return undefined;
			}

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`MCP HTTP ${response.status}: ${text || response.statusText}`);
			}

			if (isNotification) {
				return undefined;
			}

			const contentType = response.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				const json: unknown = await response.json();
				return json;
			}
			if (contentType.includes("text/event-stream")) {
				return parseSseResponse(response, payload.id);
			}

			const text = await response.text();
			throw new Error(`Unexpected MCP response content-type: ${contentType || "unknown"} (${text.slice(0, 200)})`);
		} finally {
			cleanup();
		}
	}

	private nextId(): JsonRpcId {
		this.requestCounter += 1;
		return `firecrawl-mcp-${this.requestCounter}`;
	}
}

function extractJsonRpcResponse(response: unknown, requestId: unknown): JsonRpcResponse {
	if (Array.isArray(response)) {
		const match = response.find((item) => isJsonRpcResponse(item) && item.id === requestId);
		if (match) {
			return match;
		}
		throw new Error("MCP response did not include matching request id.");
	}

	if (isJsonRpcResponse(response)) {
		return response;
	}

	throw new Error("Invalid MCP response payload.");
}

async function parseSseResponse(response: Response, requestId: unknown): Promise<unknown> {
	if (!response.body) {
		throw new Error("MCP response stream missing body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let matched: unknown;

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });

		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = buffer.slice(0, newlineIndex).trimEnd();
			buffer = buffer.slice(newlineIndex + 1);
			newlineIndex = buffer.indexOf("\n");

			if (!line.startsWith("data:")) {
				continue;
			}

			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") {
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(data);
				if (isRecord(parsed) && parsed.id === requestId) {
					matched = parsed;
					await reader.cancel();
					return matched;
				}
			} catch {
				// Ignore malformed SSE chunk.
			}
		}
	}

	if (matched) {
		return matched;
	}

	throw new Error("MCP SSE response ended without a matching result.");
}

function createMergedSignal(
	parentSignal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	let timeoutId: NodeJS.Timeout | undefined;

	const handleAbort = () => {
		controller.abort();
	};

	if (parentSignal) {
		if (parentSignal.aborted) {
			controller.abort();
		} else {
			parentSignal.addEventListener("abort", handleAbort, { once: true });
		}
	}

	if (timeoutMs > 0) {
		timeoutId = setTimeout(() => {
			controller.abort();
		}, timeoutMs);
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			if (parentSignal) {
				parentSignal.removeEventListener("abort", handleAbort);
			}
		},
	};
}

const piLimitFields = {
	piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
	piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
};

const scrapeParams = Type.Object(
	{
		url: Type.String({ description: "Target URL." }),
		formats: Type.Optional(Type.Array(Type.String())),
		onlyMainContent: Type.Optional(Type.Boolean()),
		waitFor: Type.Optional(Type.Integer()),
		timeout: Type.Optional(Type.Integer()),
		mobile: Type.Optional(Type.Boolean()),
		includeTags: Type.Optional(Type.Array(Type.String())),
		excludeTags: Type.Optional(Type.Array(Type.String())),
		skipTlsVerification: Type.Optional(Type.Boolean()),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const batchScrapeParams = Type.Object(
	{
		urls: Type.Array(Type.String(), { description: "URLs to scrape." }),
		options: Type.Optional(Type.Object({}, { additionalProperties: true })),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const checkBatchStatusParams = Type.Object(
	{
		id: Type.String({ description: "Batch job id." }),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const mapParams = Type.Object(
	{
		url: Type.String({ description: "Base URL to map." }),
		search: Type.Optional(Type.String()),
		sitemap: Type.Optional(Type.String()),
		includeSubdomains: Type.Optional(Type.Boolean()),
		limit: Type.Optional(Type.Integer()),
		ignoreQueryParameters: Type.Optional(Type.Boolean()),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const searchParams = Type.Object(
	{
		query: Type.String({ description: "Search query." }),
		limit: Type.Optional(Type.Integer()),
		lang: Type.Optional(Type.String()),
		country: Type.Optional(Type.String()),
		scrapeOptions: Type.Optional(Type.Object({}, { additionalProperties: true })),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const crawlParams = Type.Object(
	{
		url: Type.String({ description: "Base URL to crawl." }),
		maxDepth: Type.Optional(Type.Integer()),
		limit: Type.Optional(Type.Integer()),
		allowExternalLinks: Type.Optional(Type.Boolean()),
		deduplicateSimilarURLs: Type.Optional(Type.Boolean()),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const checkCrawlStatusParams = Type.Object(
	{
		id: Type.String({ description: "Crawl job id." }),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

const extractParams = Type.Object(
	{
		urls: Type.Array(Type.String(), { description: "URLs to extract." }),
		prompt: Type.Optional(Type.String()),
		systemPrompt: Type.Optional(Type.String()),
		schema: Type.Optional(Type.Unknown()),
		allowExternalLinks: Type.Optional(Type.Boolean()),
		enableWebSearch: Type.Optional(Type.Boolean()),
		includeSubdomains: Type.Optional(Type.Boolean()),
		...piLimitFields,
	},
	{ additionalProperties: true },
);

export default function firecrawlMcpExtension(pi: ExtensionAPI) {
	pi.registerFlag("--firecrawl-mcp-url", {
		description: "Override the Firecrawl MCP endpoint.",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-api-key", {
		description: "Firecrawl API key (used as Authorization Bearer token).",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-timeout-ms", {
		description: "HTTP timeout for MCP requests (milliseconds).",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-protocol", {
		description: "MCP protocol version for initialize() (default: 2025-06-18).",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-config", {
		description: "Path to JSON config file (defaults to ~/.pi/agent/extensions/firecrawl-mcp.json).",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-tools", {
		description: "Comma-separated list of Firecrawl tools to register.",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-max-bytes", {
		description: "Max bytes to keep from tool output (default: 51200).",
		type: "string",
	});
	pi.registerFlag("--firecrawl-mcp-max-lines", {
		description: "Max lines to keep from tool output (default: 2000).",
		type: "string",
	});

	const client = new FirecrawlMcpClient(() => {
		const configFlag = pi.getFlag("--firecrawl-mcp-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

		const urlFlag = pi.getFlag("--firecrawl-mcp-url");
		const apiKeyFlag = pi.getFlag("--firecrawl-mcp-api-key");
		const timeoutFlag = pi.getFlag("--firecrawl-mcp-timeout-ms");
		const protocolFlag = pi.getFlag("--firecrawl-mcp-protocol");
		const toolsFlag = pi.getFlag("--firecrawl-mcp-tools");
		const maxBytesFlag = pi.getFlag("--firecrawl-mcp-max-bytes");
		const maxLinesFlag = pi.getFlag("--firecrawl-mcp-max-lines");

		const apiKey =
			typeof apiKeyFlag === "string" ? apiKeyFlag : (process.env.FIRECRAWL_API_KEY ?? config?.apiKey ?? undefined);

		const baseUrl =
			typeof urlFlag === "string" ? urlFlag : (process.env.FIRECRAWL_MCP_URL ?? config?.url ?? DEFAULT_ENDPOINT);
		const endpoint = resolveEndpoint(baseUrl, apiKey);

		const timeoutValue =
			typeof timeoutFlag === "string" ? timeoutFlag : (process.env.FIRECRAWL_MCP_TIMEOUT_MS ?? config?.timeoutMs);
		const timeoutMs = parseTimeoutMs(timeoutValue, DEFAULT_TIMEOUT_MS);

		let protocolVersion = DEFAULT_PROTOCOL_VERSION;
		if (typeof protocolFlag === "string" && protocolFlag.trim().length > 0) {
			protocolVersion = protocolFlag.trim();
		} else if (process.env.FIRECRAWL_MCP_PROTOCOL_VERSION?.trim()) {
			protocolVersion = process.env.FIRECRAWL_MCP_PROTOCOL_VERSION.trim();
		} else if (config?.protocolVersion) {
			protocolVersion = config.protocolVersion;
		}

		const headers = buildHeaders(apiKey, config?.headers);
		const tools =
			typeof toolsFlag === "string"
				? normalizeTools(toolsFlag)
				: normalizeTools(process.env.FIRECRAWL_MCP_TOOLS ?? config?.tools);
		const maxBytes =
			typeof maxBytesFlag === "string"
				? normalizeNumber(maxBytesFlag)
				: normalizeNumber(process.env.FIRECRAWL_MCP_MAX_BYTES ?? config?.maxBytes);
		const maxLines =
			typeof maxLinesFlag === "string"
				? normalizeNumber(maxLinesFlag)
				: normalizeNumber(process.env.FIRECRAWL_MCP_MAX_LINES ?? config?.maxLines);

		return {
			endpoint,
			headers,
			timeoutMs,
			protocolVersion,
			apiKey,
			tools,
			maxBytes,
			maxLines,
		};
	});

	const configuredTools = client.currentConfig().tools;
	const allowedTools = configuredTools ? new Set(configuredTools) : null;

	const registerTool = <TParams extends TSchema>(
		name: string,
		label: string,
		description: string,
		parameters: TParams,
	) => {
		if (allowedTools && !allowedTools.has(name)) {
			return;
		}
		pi.registerTool({
			name,
			label,
			description,
			parameters,
			async execute(_toolCallId, params: Static<TParams>, onUpdate, _ctx, signal) {
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
				}
				onUpdate?.({
					content: [{ type: "text", text: "Querying Firecrawl MCP..." }],
					details: { status: "pending" },
				});

				const config = client.currentConfig();
				const redactedEndpoint = redactEndpoint(config.endpoint, config.apiKey);
				const maxLimits = resolveMaxLimits(config);
				const { mcpArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
				const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);

				try {
					const result = await client.callTool(name, mcpArgs, signal);
					const { text, details } = formatToolOutput(name, redactedEndpoint, result, effectiveLimits);
					return { content: [{ type: "text", text }], details, isError: result.isError === true };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `Firecrawl MCP error: ${message}` }],
						isError: true,
						details: {
							tool: name,
							endpoint: redactedEndpoint,
							error: message,
						} satisfies McpErrorDetails,
					};
				}
			},
		});
	};

	registerTool(
		"firecrawl_scrape",
		"Firecrawl Scrape",
		"Scrape a single URL; best for known pages. Avoid for many URLs (use batch_scrape) or discovery (use search/map/crawl). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		scrapeParams,
	);
	registerTool(
		"firecrawl_batch_scrape",
		"Firecrawl Batch Scrape",
		"Scrape many known URLs in one job. Avoid for discovery (use map/search/crawl). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		batchScrapeParams,
	);
	registerTool(
		"firecrawl_check_batch_status",
		"Firecrawl Batch Status",
		"Check batch scrape status/results. Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		checkBatchStatusParams,
	);
	registerTool(
		"firecrawl_map",
		"Firecrawl Map",
		"Discover URLs on a site; use before scraping many pages. Avoid when you need page content (use scrape/batch). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		mapParams,
	);
	registerTool(
		"firecrawl_search",
		"Firecrawl Search",
		"Search the web and optionally scrape results; use to find relevant pages. Avoid if you already know URLs (use scrape/batch). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		searchParams,
	);
	registerTool(
		"firecrawl_crawl",
		"Firecrawl Crawl",
		"Crawl a site for broad coverage; use with small limits. Avoid for single pages or when output size is a concern (use scrape/map+batch). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		crawlParams,
	);
	registerTool(
		"firecrawl_check_crawl_status",
		"Firecrawl Crawl Status",
		"Check crawl status/results. Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		checkCrawlStatusParams,
	);
	registerTool(
		"firecrawl_extract",
		"Firecrawl Extract",
		"Extract structured data from URLs; best for specific fields. Avoid for full-page text (use scrape). Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		extractParams,
	);
}
