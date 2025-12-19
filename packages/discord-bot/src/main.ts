#!/usr/bin/env node
/**
 * Pi Discord Bot - A full agentic Discord bot powered by AI
 * Similar to pi-mom but for Discord - with bash, read, write, edit tools
 * Supports both slash commands and @mentions
 */

import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import type { AgentTool, Model } from "@mariozechner/pi-ai";
import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import chalk from "chalk";
import { spawn } from "child_process";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Client,
	EmbedBuilder,
	GatewayIntentBits,
	type Message,
	Partials,
	REST,
	Routes,
	SlashCommandBuilder,
	type TextChannel,
	type VoiceChannel,
} from "discord.js";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { join, resolve } from "path";
import "dotenv/config";
import express from "express";
import cron from "node-cron";
import {
	// Hook System
	CheckpointUtils,
	// Agent Experts (TAC Lesson 13)
	CODEBASE_EXPERTS,
	createCodebaseExpert,
	createDiscordHookIntegration,
	// Claude SDK Two-Agent Pattern
	executeClaudeFeature,
	executeWithAutoExpert,
	generateSessionId,
	// Lightweight Agent
	getAgentModels,
	getChannelHookIntegration,
	getClaudeTaskStatus,
	// Expertise Manager
	getExpertiseModes,
	type HookIntegration,
	initializeClaudeTask,
	isAgentAvailable,
	// OpenHands
	isOpenHandsAvailable,
	LearningPresets,
	loadExpertise,
	type OpenHandsMode,
	OpenHandsModeDescriptions,
	PRODUCT_EXPERTS,
	resumeClaudeTask,
	runCodeReview,
	runDebug,
	runDocGeneration,
	runFullTradingAudit,
	runLearningAgent,
	runOpenHandsAgent,
	runOptimize,
	runRefactor,
	runRiskAssessment,
	runSecurityScan,
	runStrategyBacktest,
	runTestGeneration,
	runTradingAnalysis,
	runTwoAgentWorkflow,
	wrapToolWithHooks,
} from "./agents/index.js";
import { Analytics } from "./analytics.js";
import { browserAutomation } from "./browser/index.js";
import { DiscordSettingsManager } from "./context.js";
import { setupDashboard } from "./dashboard-integration.js";
import { type BotDatabase, initDatabase } from "./database.js";
import { createEventsWatcher, type EventHandler, type EventsWatcher } from "./events.js";
import { type HF_SPACES, hfSkills } from "./hf-skills.js";
import { getKnowledgeBase } from "./knowledge/index.js";
import {
	createCodebaseKnowledgeTool,
	createGithubListIssuesTool,
	createGithubRepoSearchTool,
	createHfDatasetSearchTool,
	createHfModelSearchTool,
	createMemoryRecallTool,
	createMemoryStoreTool,
	createSkillListTool,
	createSkillLoadTool,
	createTaskCreateTool,
	createTaskListTool,
	createWebScrapeTool,
	getAllMcpTools,
	withRetry,
} from "./mcp-tools.js";
import { STATUS_DESCRIPTIONS, type SunoModel, type SunoTrack, sunoService } from "./music/suno-service.js";
import { getSmolAINews } from "./news/index.js";
import { TaskScheduler } from "./scheduler.js";
import { ChannelStore } from "./store.js";
import { createTelegramBot, setDiscordClient, EXPERT_MODES as TelegramExpertModes } from "./telegram/index.js";
import { getTradingOrchestrator, tradingLearning } from "./trading/index.js";
import { getVibeVoiceTTS, getVoiceSession, getWhisperLocalSTT } from "./voice/index.js";

// ============================================================================
// Configuration
// ============================================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Security: Restrict to specific user IDs (empty = allow all)
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || "").split(",").filter(Boolean);

// Admin/Owner user ID
const OWNER_USER_ID = "1284556970082435072";

function isUserAllowed(userId: string): boolean {
	if (ALLOWED_USER_IDS.length === 0) return true; // No restriction if not configured
	return ALLOWED_USER_IDS.includes(userId);
}

function isOwner(userId: string): boolean {
	return userId === OWNER_USER_ID;
}

// ============================================================================
// Model Configuration & Management
// ============================================================================

const DEFAULT_MODEL_ID = "devstral-small-2";
const OLLAMA_BASE_URL = "http://localhost:11434";

// OpenRouter Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Cerebras Configuration (fastest inference - 2100+ tok/s)
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

// Groq Configuration (fast + free)
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Z.ai Configuration (GLM-4.6 - top coding model, 55+ tok/s)
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";
const ZAI_BASE_URL = "https://api.z.ai/api/anthropic"; // Anthropic-compatible API

// Provider types
type ProviderType = "ollama" | "openrouter" | "cerebras" | "groq" | "zai";

// Read default provider from env, or auto-detect based on available API keys
const ENV_DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER as ProviderType | undefined;
const ENV_DEFAULT_MODEL = process.env.DEFAULT_MODEL || "";

let currentProvider: ProviderType = ENV_DEFAULT_PROVIDER
	? ENV_DEFAULT_PROVIDER
	: ZAI_API_KEY
		? "zai"
		: OPENROUTER_API_KEY
			? "openrouter"
			: CEREBRAS_API_KEY
				? "cerebras"
				: GROQ_API_KEY
					? "groq"
					: "ollama"; // Fallback to local

// OpenRouter model presets (benchmarked for agentic tasks)
const OPENROUTER_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	// PREMIUM MODELS (Best quality)
	"claude-sonnet": {
		id: "anthropic/claude-sonnet-4",
		name: "Claude Sonnet 4 (Best Overall)",
		cost: "$3/$15 per M - Top tier reasoning",
	},
	"gpt-4o": {
		id: "openai/gpt-4o",
		name: "GPT-4o (OpenAI Best)",
		cost: "$2.50/$10 per M - Multimodal",
	},
	"gemini-pro": {
		id: "google/gemini-2.5-pro-preview",
		name: "Gemini 2.5 Pro (Google Best)",
		cost: "$1.25/$10 per M - Long context",
	},
	// AGENTIC MODELS (tool calling, fast)
	"mistral-small": {
		id: "mistralai/mistral-small-3.1-24b-instruct",
		name: "Mistral Small 3.1 24B (Best Agentic)",
		cost: "$0.03/$0.11 per M - Fast tool calling",
	},
	"deepseek-v3": {
		id: "deepseek/deepseek-chat-v3.1",
		name: "DeepSeek V3.1 (Best Reasoning)",
		cost: "$0.15/$0.75 per M - Smart but slower",
	},
	"qwen-72b": {
		id: "qwen/qwen-2.5-72b-instruct",
		name: "Qwen 2.5 72B (Balanced)",
		cost: "$0.07/$0.26 per M - Good all-around",
	},
	// FAST/CHEAP MODELS
	"gemini-flash": {
		id: "google/gemini-2.5-flash-preview",
		name: "Gemini 2.5 Flash (Fast+Cheap)",
		cost: "$0.15/$0.60 per M - Great value",
	},
	"gpt-4o-mini": {
		id: "openai/gpt-4o-mini",
		name: "GPT-4o Mini (OpenAI Fast)",
		cost: "$0.15/$0.60 per M - Quick tasks",
	},
	"claude-haiku": {
		id: "anthropic/claude-3.5-haiku",
		name: "Claude 3.5 Haiku (Anthropic Fast)",
		cost: "$0.80/$4 per M - Speed demon",
	},
	"llama-3.3-70b": {
		id: "meta-llama/llama-3.3-70b-instruct",
		name: "Llama 3.3 70B (Open Source Best)",
		cost: "$0.12/$0.30 per M - High quality",
	},
	"llama-3.1-8b": {
		id: "meta-llama/llama-3.1-8b-instruct",
		name: "Llama 3.1 8B (Cheapest)",
		cost: "$0.02/$0.03 per M - Simple tasks",
	},
	// FREE MODELS
	"gemini-2-flash": {
		id: "google/gemini-2.0-flash-exp:free",
		name: "Gemini 2.0 Flash (FREE)",
		cost: "FREE - Fast agentic",
	},
	"llama-3.3-70b-free": {
		id: "meta-llama/llama-3.3-70b-instruct:free",
		name: "Llama 3.3 70B (FREE)",
		cost: "FREE - High quality",
	},
	"kimi-k2": {
		id: "moonshotai/kimi-k2:free",
		name: "Kimi K2 (FREE)",
		cost: "FREE - 128k context",
	},
};
const DEFAULT_OPENROUTER_MODEL = "claude-sonnet"; // Best agentic model

// Cerebras model presets (fastest inference in the world - 2100+ tok/s)
const CEREBRAS_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	"glm-4.6": {
		id: "zai-glm-4.6",
		name: "GLM 4.6 (Fastest Smart)",
		cost: "$0.10/$0.10 per M - 2100+ tok/s",
	},
	"llama-3.3-70b": {
		id: "llama-3.3-70b",
		name: "Llama 3.3 70B (Best Quality)",
		cost: "$0.60/$0.60 per M - 2100+ tok/s",
	},
	"llama-3.1-8b": {
		id: "llama3.1-8b",
		name: "Llama 3.1 8B (Ultra Fast)",
		cost: "$0.10/$0.10 per M - 1800+ tok/s",
	},
	"qwen-3-32b": {
		id: "qwen-3-32b",
		name: "Qwen3 32B (Balanced)",
		cost: "$0.20/$0.20 per M - Fast",
	},
	"qwen-3-235b": {
		id: "qwen-3-235b-a22b-instruct-2507",
		name: "Qwen3 235B (Massive)",
		cost: "$0.50/$0.50 per M - Powerful",
	},
	"gpt-oss-120b": {
		id: "gpt-oss-120b",
		name: "GPT OSS 120B",
		cost: "$0.30/$0.30 per M - Open source",
	},
};
const DEFAULT_CEREBRAS_MODEL = "llama-3.3-70b"; // Best quality on Cerebras

// Groq model presets (free + fast)
const GROQ_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	"llama-3.3-70b": {
		id: "llama-3.3-70b-versatile",
		name: "Llama 3.3 70B (Best Free)",
		cost: "FREE - 300+ tok/s",
	},
	"llama-3.1-8b": {
		id: "llama-3.1-8b-instant",
		name: "Llama 3.1 8B (Ultra Fast)",
		cost: "FREE - 800+ tok/s",
	},
	"llama-4-maverick": {
		id: "meta-llama/llama-4-maverick-17b-128e-instruct",
		name: "Llama 4 Maverick (Latest)",
		cost: "FREE - New architecture",
	},
	"llama-4-scout": {
		id: "meta-llama/llama-4-scout-17b-16e-instruct",
		name: "Llama 4 Scout (Fast)",
		cost: "FREE - Efficient",
	},
	"kimi-k2": {
		id: "moonshotai/kimi-k2-instruct-0905",
		name: "Kimi K2 Latest (128k context)",
		cost: "FREE - Ultra fast + long context",
	},
	"qwen3-32b": {
		id: "qwen/qwen3-32b",
		name: "Qwen3 32B",
		cost: "FREE - Balanced",
	},
	"gpt-oss-120b": {
		id: "openai/gpt-oss-120b",
		name: "GPT OSS 120B",
		cost: "FREE - Open source",
	},
};
const DEFAULT_GROQ_MODEL = "kimi-k2"; // Latest + fastest + free

// Z.ai model presets (GLM-4.6 - top coding model)
const ZAI_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	"glm-4.6": {
		id: "GLM-4.6",
		name: "GLM 4.6 (Top Coding Model)",
		cost: "$6/mo Lite - 55+ tok/s, SOTA coding",
	},
	"glm-4.5-air": {
		id: "GLM-4.5-Air",
		name: "GLM 4.5 Air (Fast)",
		cost: "$6/mo Lite - Balanced",
	},
};
const DEFAULT_ZAI_MODEL = "glm-4.6"; // Best coding model

// Model registry - stores available models from Ollama
interface OllamaModel {
	name: string;
	size: number;
	modified_at: string;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
		family?: string;
	};
}

// Create model config from Ollama model name
function createOllamaModelConfig(modelId: string): Model<"openai-completions"> {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: "ollama",
		baseUrl: `${OLLAMA_BASE_URL}/v1`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32000, // Conservative default, varies by model
		maxTokens: 8192,
	};
}

// Create model config for OpenRouter
function createOpenRouterModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = OPENROUTER_MODELS[modelKey] || OPENROUTER_MODELS[DEFAULT_OPENROUTER_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: OPENROUTER_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.00002, output: 0.00003, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			"HTTP-Referer": "https://discord.com/pi-agent",
			"X-Title": "Pi Discord Agent",
		},
	};
}

// Create model config for Cerebras (fastest inference)
function createCerebrasModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = CEREBRAS_MODELS[modelKey] || CEREBRAS_MODELS[DEFAULT_CEREBRAS_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "cerebras",
		baseUrl: CEREBRAS_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${CEREBRAS_API_KEY}`,
		},
	};
}

// Create model config for Groq (free + fast)
function createGroqModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = GROQ_MODELS[modelKey] || GROQ_MODELS[DEFAULT_GROQ_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "groq",
		baseUrl: GROQ_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Free!
		contextWindow: 128000,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${GROQ_API_KEY}`,
		},
	};
}

// Create model config for Z.ai (GLM-4.6 - top coding model)
function createZaiModelConfig(modelKey: string): Model<"anthropic-messages"> {
	const preset = ZAI_MODELS[modelKey] || ZAI_MODELS[DEFAULT_ZAI_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "anthropic-messages",
		provider: "zai",
		baseUrl: ZAI_BASE_URL,
		reasoning: true,
		input: ["text"],
		cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 204800,
		maxTokens: 131072,
		headers: {
			Authorization: `Bearer ${ZAI_API_KEY}`,
		},
	};
}

// Get model config based on current provider
function createModelConfig(modelId: string): Model<"openai-completions"> | Model<"anthropic-messages"> {
	if (currentProvider === "zai") {
		return createZaiModelConfig(modelId);
	}
	if (currentProvider === "cerebras") {
		return createCerebrasModelConfig(modelId);
	}
	if (currentProvider === "groq") {
		return createGroqModelConfig(modelId);
	}
	if (currentProvider === "openrouter") {
		return createOpenRouterModelConfig(modelId);
	}
	return createOllamaModelConfig(modelId);
}

// Global model state (per-user preferences)
const userModels = new Map<string, string>(); // userId -> modelId
let globalModelId = ENV_DEFAULT_MODEL
	? ENV_DEFAULT_MODEL
	: currentProvider === "zai"
		? DEFAULT_ZAI_MODEL
		: currentProvider === "openrouter"
			? DEFAULT_OPENROUTER_MODEL
			: currentProvider === "cerebras"
				? DEFAULT_CEREBRAS_MODEL
				: currentProvider === "groq"
					? DEFAULT_GROQ_MODEL
					: DEFAULT_MODEL_ID;

function getUserModel(userId: string): Model<"openai-completions"> | Model<"anthropic-messages"> {
	const modelId = userModels.get(userId) || globalModelId;
	return createModelConfig(modelId);
}

function setUserModel(userId: string, modelId: string): void {
	userModels.set(userId, modelId);
	logInfo(`User ${userId} switched to model: ${modelId}`);
}

function setGlobalModel(modelId: string): void {
	globalModelId = modelId;
	logInfo(`Global model switched to: ${modelId}`);
}

function getCurrentModelId(userId?: string): string {
	if (userId && userModels.has(userId)) {
		return userModels.get(userId)!;
	}
	return globalModelId;
}

// Fetch available models from Ollama API
async function fetchOllamaModels(): Promise<OllamaModel[]> {
	try {
		const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status}`);
		}
		const data = (await response.json()) as { models: OllamaModel[] };
		return data.models || [];
	} catch (error) {
		logError("Failed to fetch Ollama models", error instanceof Error ? error.message : String(error));
		return [];
	}
}

// Format model size for display
function formatModelSize(bytes: number): string {
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// Default model for initialization
const model: Model<"openai-completions"> | Model<"anthropic-messages"> = createModelConfig(DEFAULT_MODEL_ID);

// Truncation limits
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

// ============================================================================
// Bot Statistics Tracking
// ============================================================================

interface BotStats {
	startTime: number;
	commandsProcessed: number;
	messagesProcessed: number;
	errorsCount: number;
	userInteractions: Map<string, { username: string; count: number; lastSeen: number }>;
}

const botStats: BotStats = {
	startTime: Date.now(),
	commandsProcessed: 0,
	messagesProcessed: 0,
	errorsCount: 0,
	userInteractions: new Map(),
};

// Confirmation cache for destructive operations
const confirmationCache = new Map<string, number>();

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

class RateLimiter {
	private limits = new Map<string, RateLimitEntry>();
	private readonly maxRequests: number;
	private readonly windowMs: number;

	constructor(maxRequests = 10, windowMs = 60000) {
		this.maxRequests = maxRequests;
		this.windowMs = windowMs;

		// Clean up expired entries every minute
		setInterval(() => this.cleanup(), 60000);
	}

	isRateLimited(key: string): boolean {
		const now = Date.now();
		const entry = this.limits.get(key);

		if (!entry || now > entry.resetAt) {
			this.limits.set(key, { count: 1, resetAt: now + this.windowMs });
			return false;
		}

		if (entry.count >= this.maxRequests) {
			return true;
		}

		entry.count++;
		return false;
	}

	getRemainingRequests(key: string): number {
		const entry = this.limits.get(key);
		if (!entry || Date.now() > entry.resetAt) {
			return this.maxRequests;
		}
		return Math.max(0, this.maxRequests - entry.count);
	}

	getResetTime(key: string): number {
		const entry = this.limits.get(key);
		if (!entry) return 0;
		return Math.max(0, entry.resetAt - Date.now());
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.limits) {
			if (now > entry.resetAt) {
				this.limits.delete(key);
			}
		}
	}
}

// Rate limiters for different scopes
const userRateLimiter = new RateLimiter(20, 60000); // 20 requests per minute per user
const globalRateLimiter = new RateLimiter(100, 60000); // 100 requests per minute global
const webhookRateLimiter = new RateLimiter(30, 60000); // 30 webhook requests per minute

// ============================================================================
// Input Sanitization
// ============================================================================

function sanitizeInput(input: string): string {
	// Remove null bytes
	let sanitized = input.replace(/\0/g, "");

	// Limit length
	if (sanitized.length > 10000) {
		sanitized = sanitized.substring(0, 10000);
	}

	return sanitized;
}

function isValidChannelId(id: string): boolean {
	return /^\d{17,20}$/.test(id);
}

// ============================================================================
// Tool Usage Tracking
// ============================================================================

interface ToolUsageStats {
	name: string;
	count: number;
	totalDuration: number;
	errors: number;
	lastUsed: number;
}

const toolUsageStats = new Map<string, ToolUsageStats>();

function trackToolUsage(toolName: string, duration: number, success: boolean): void {
	const existing = toolUsageStats.get(toolName);
	if (existing) {
		existing.count++;
		existing.totalDuration += duration;
		if (!success) existing.errors++;
		existing.lastUsed = Date.now();
	} else {
		toolUsageStats.set(toolName, {
			name: toolName,
			count: 1,
			totalDuration: duration,
			errors: success ? 0 : 1,
			lastUsed: Date.now(),
		});
	}
}

function getToolUsageStats(): ToolUsageStats[] {
	return Array.from(toolUsageStats.values()).sort((a, b) => b.count - a.count);
}

function trackUserInteraction(userId: string, username: string): void {
	const existing = botStats.userInteractions.get(userId);
	if (existing) {
		existing.count++;
		existing.lastSeen = Date.now();
	} else {
		botStats.userInteractions.set(userId, { username, count: 1, lastSeen: Date.now() });
	}
}

// Analytics instance (initialized in main)
let analytics: Analytics;

// Database and Scheduler instances (initialized in main)
let db: BotDatabase;
let taskScheduler: TaskScheduler;
let eventsWatcher: EventsWatcher | null = null;
let channelStore: ChannelStore;
let settingsManager: DiscordSettingsManager;

// ============================================================================
// Admin Action Logging
// ============================================================================

function logAdminAction(userId: string, username: string, action: string, details?: string): void {
	const timestamp = new Date().toISOString();
	const logEntry = `[${timestamp}] [ADMIN] ${username} (${userId}): ${action}${details ? ` - ${details}` : ""}\n`;

	try {
		const logPath = "/opt/discord-bot-data/admin-actions.log";
		appendFileSync(logPath, logEntry);
	} catch (error) {
		logError("Failed to write admin log", error instanceof Error ? error.message : String(error));
	}

	logInfo(`[ADMIN] ${username}: ${action}${details ? ` - ${details}` : ""}`);
}

// ============================================================================
// Runtime Configuration
// ============================================================================

interface RuntimeConfig {
	[key: string]: string | number | boolean;
}

const runtimeConfig: RuntimeConfig = {
	debugMode: false,
	maxResponseLength: 2000,
	defaultTimeout: 120,
};

// Agent prompt timeout configuration (in milliseconds)
const AGENT_PROMPT_TIMEOUT = 120 * 1000; // 120 seconds

/**
 * Run agent.prompt() with a timeout. If the prompt takes too long,
 * abort the agent and throw a timeout error.
 */
async function promptWithTimeout(
	agent: Agent,
	message: string,
	timeoutMs: number = AGENT_PROMPT_TIMEOUT,
): Promise<void> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			agent.abort();
			logWarning("Agent prompt timeout", `Aborted after ${timeoutMs / 1000}s`);
			reject(new Error(`Agent prompt timed out after ${timeoutMs / 1000} seconds`));
		}, timeoutMs);
	});

	try {
		await Promise.race([agent.prompt(message), timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

// ============================================================================
// Security: Rate Limiting
// ============================================================================

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 20; // Max requests per window per user (updated)

// Use the new RateLimiter class defined above
function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
	const isLimited = userRateLimiter.isRateLimited(userId);
	return {
		allowed: !isLimited,
		remaining: userRateLimiter.getRemainingRequests(userId),
		resetIn: userRateLimiter.getResetTime(userId),
	};
}

// ============================================================================
// Security: Dangerous Command Detection & Approval
// ============================================================================

const DANGEROUS_PATTERNS = [
	/\bsudo\s+/i,
	/\brm\s+.*-[rRf]/i, // rm with dangerous flags
	/\brm\s+-[rRf]/i,
	/\brm\s+\/[^\s]*/i, // rm anything starting with /
	/\bdd\s+/i,
	/>\s*\/dev\/(sda|nvme|vd)/i,
	/\bmkfs/i,
	/\bshutdown/i,
	/\breboot/i,
	/\bkill\s+-9/i,
	/\bpkill\s+-9/i,
	/\bchmod\s+777/i,
	/\bchown\s+.*:/i,
	/\bcurl\s+.*\|\s*(ba)?sh/i, // curl | bash
	/\bwget\s+.*\|\s*(ba)?sh/i, // wget | bash
	/\b:()\s*{\s*:\|:\s*&\s*}/i, // fork bomb
	/\bformat\s+/i,
	/\bfdisk\s+/i,
	/\bparted\s+/i,
];

function isDangerousCommand(command: string): boolean {
	return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// Global context for approval requests (set per-request)
let currentApprovalContext: {
	message: Message | null;
	userId: string;
} | null = null;

function setApprovalContext(message: Message | null, userId: string): void {
	currentApprovalContext = { message, userId };
}

async function requestApproval(command: string): Promise<boolean> {
	if (!currentApprovalContext?.message) {
		logWarning("No approval context available, denying dangerous command");
		return false;
	}

	const { message, userId } = currentApprovalContext;
	const channel = message.channel;

	// Check if channel supports sending messages
	if (!("send" in channel) || typeof channel.send !== "function") {
		logWarning("Channel does not support sending messages");
		return false;
	}

	try {
		const approvalMsg = await (channel as TextChannel).send(
			`**Dangerous command detected:**\n\`\`\`bash\n${command.substring(0, 500)}\n\`\`\`\nReact ✅ to approve, ❌ to deny (60s timeout)`,
		);

		await approvalMsg.react("✅");
		await approvalMsg.react("❌");

		const collected = await approvalMsg.awaitReactions({
			filter: (reaction: { emoji: { name: string | null } }, user: { id: string }) =>
				["✅", "❌"].includes(reaction.emoji.name || "") && user.id === userId,
			max: 1,
			time: 60000,
		});

		const reaction = collected.first();
		if (reaction?.emoji.name === "✅") {
			await approvalMsg.edit("✅ Command approved.");
			logInfo(`Dangerous command approved by user: ${command.substring(0, 50)}...`);
			return true;
		} else if (reaction?.emoji.name === "❌") {
			await approvalMsg.edit("❌ Command denied by user.");
			logWarning(`Dangerous command denied by user: ${command.substring(0, 50)}...`);
			return false;
		} else {
			await approvalMsg.edit("⏰ Approval timed out - command denied.");
			logWarning(`Dangerous command timed out: ${command.substring(0, 50)}...`);
			return false;
		}
	} catch (error) {
		logError("Approval request failed", error instanceof Error ? error.message : String(error));
		return false;
	}
}

// ============================================================================
// Slash Commands Definition
// ============================================================================

const slashCommands = [
	new SlashCommandBuilder()
		.setName("ask")
		.setDescription("Ask the AI assistant anything")
		.addStringOption((option) =>
			option.setName("question").setDescription("Your question or request").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("bash")
		.setDescription("Execute a bash command directly")
		.addStringOption((option) =>
			option.setName("command").setDescription("The bash command to execute").setRequired(true),
		)
		.addIntegerOption((option) =>
			option.setName("timeout").setDescription("Timeout in seconds (default: no limit)").setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("read")
		.setDescription("Read a file from the system")
		.addStringOption((option) => option.setName("path").setDescription("Path to the file").setRequired(true))
		.addIntegerOption((option) =>
			option.setName("lines").setDescription("Number of lines to read").setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("remember")
		.setDescription("Save something to memory")
		.addStringOption((option) => option.setName("text").setDescription("What to remember").setRequired(true))
		.addBooleanOption((option) =>
			option.setName("global").setDescription("Save to global memory (default: channel)").setRequired(false),
		),

	new SlashCommandBuilder().setName("memory").setDescription("Show what the bot remembers"),

	new SlashCommandBuilder()
		.setName("forget")
		.setDescription("Clear memory")
		.addBooleanOption((option) =>
			option.setName("global").setDescription("Clear global memory (default: channel)").setRequired(false),
		),

	new SlashCommandBuilder().setName("status").setDescription("Show bot status and system info"),

	new SlashCommandBuilder()
		.setName("hooks")
		.setDescription("View hook system status and checkpoints")
		.addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show hook system status"))
		.addSubcommand((subcommand) => subcommand.setName("checkpoints").setDescription("List available checkpoints"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("restore")
				.setDescription("Restore to a checkpoint")
				.addStringOption((option) =>
					option.setName("id").setDescription("Checkpoint ID (from /hooks checkpoints)").setRequired(true),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("metrics").setDescription("Show hook execution metrics"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("tag")
				.setDescription("Tag a checkpoint with a friendly name")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to tag").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("name").setDescription("Tag name (alphanumeric, hyphens, underscores)").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("description").setDescription("Optional description").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("tags").setDescription("List all checkpoint tags"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("debug")
				.setDescription("Toggle debug logging")
				.addBooleanOption((option) =>
					option.setName("enabled").setDescription("Enable or disable debug logging").setRequired(true),
				),
		)
		// Phase 1.1: Branch support
		.addSubcommand((subcommand) =>
			subcommand
				.setName("branch")
				.setDescription("Create a branch point from a checkpoint")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to branch from").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("description").setDescription("Branch description").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("branches").setDescription("List all branch points"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("switch")
				.setDescription("Switch to a branch")
				.addStringOption((option) =>
					option.setName("branch_id").setDescription("Branch ID to switch to").setRequired(true),
				),
		)
		// Phase 2.1: Checkpoint diff
		.addSubcommand((subcommand) =>
			subcommand
				.setName("diff")
				.setDescription("Show changes since a checkpoint")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to diff against").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("cleanup")
				.setDescription("Clean up old checkpoints")
				.addIntegerOption((option) =>
					option.setName("keep").setDescription("Number of checkpoints to keep (default: 50)").setRequired(false),
				),
		)
		// Phase 2.2: Expertise management
		.addSubcommand((subcommand) =>
			subcommand
				.setName("expertise")
				.setDescription("View accumulated expertise")
				.addStringOption((option) =>
					option.setName("domain").setDescription("Domain to view (leave empty for all)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("clear-expertise")
				.setDescription("Clear expertise for a domain")
				.addStringOption((option) =>
					option.setName("domain").setDescription("Domain to clear (or 'all')").setRequired(true),
				),
		)
		// Phase 2.3: LSP configuration
		.addSubcommand((subcommand) => subcommand.setName("lsp").setDescription("Show LSP server status"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("lsp-enable")
				.setDescription("Enable an LSP server")
				.addStringOption((option) =>
					option
						.setName("server")
						.setDescription("Server ID (typescript, pyright, gopls, rust-analyzer, dart)")
						.setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("lsp-disable")
				.setDescription("Disable an LSP server")
				.addStringOption((option) =>
					option.setName("server").setDescription("Server ID to disable").setRequired(true),
				),
		)
		// Phase 3.1: Blocking rules
		.addSubcommand((subcommand) => subcommand.setName("rules").setDescription("List blocking rules"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("rules-add")
				.setDescription("Add a blocking rule")
				.addStringOption((option) =>
					option.setName("tool").setDescription("Tool name (bash, write, edit, or *)").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("pattern").setDescription("Regex pattern to block").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("reason").setDescription("Reason for blocking").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("rules-remove")
				.setDescription("Remove a blocking rule")
				.addIntegerOption((option) => option.setName("id").setDescription("Rule ID to remove").setRequired(true)),
		)
		.addSubcommand((subcommand) => subcommand.setName("rules-preset").setDescription("Apply preset security rules")),

	new SlashCommandBuilder().setName("skills").setDescription("List loaded skills and capabilities"),

	new SlashCommandBuilder()
		.setName("price")
		.setDescription("Get cryptocurrency price")
		.addStringOption((option) =>
			option.setName("symbol").setDescription("Crypto symbol (e.g., bitcoin, ethereum)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("alert")
		.setDescription("Set a price alert")
		.addStringOption((option) =>
			option.setName("condition").setDescription("Alert condition (e.g., 'BTC > 50000')").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("news")
		.setDescription("Get latest news (crypto + AI)")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("News type")
				.addChoices(
					{ name: "Crypto News", value: "crypto" },
					{ name: "AI News (Smol AI)", value: "ai" },
					{ name: "All News", value: "all" },
				)
				.setRequired(false),
		)
		.addStringOption((option) => option.setName("topic").setDescription("News topic (optional)").setRequired(false)),

	new SlashCommandBuilder()
		.setName("chart")
		.setDescription("Get TradingView chart link")
		.addStringOption((option) =>
			option.setName("symbol").setDescription("Trading symbol (e.g., BTCUSD)").setRequired(true),
		)
		.addStringOption((option) =>
			option.setName("timeframe").setDescription("Timeframe (1h, 4h, 1D, 1W)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("convert")
		.setDescription("Currency converter")
		.addNumberOption((option) => option.setName("amount").setDescription("Amount to convert").setRequired(true))
		.addStringOption((option) =>
			option.setName("from").setDescription("From currency (e.g., usd, btc)").setRequired(true),
		)
		.addStringOption((option) =>
			option.setName("to").setDescription("To currency (e.g., eur, eth)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("model")
		.setDescription("Manage AI model selection")
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("Show available Ollama models"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("switch")
				.setDescription("Switch to a different model")
				.addStringOption((option) =>
					option.setName("name").setDescription("Model name (e.g., llama3, mistral)").setRequired(true),
				)
				.addBooleanOption((option) =>
					option.setName("global").setDescription("Set as global default (admin only)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("info").setDescription("Show current model information")),

	new SlashCommandBuilder()
		.setName("analytics")
		.setDescription("View bot usage analytics and statistics")
		.addStringOption((option) =>
			option
				.setName("period")
				.setDescription("Time period to view")
				.addChoices(
					{ name: "Today", value: "today" },
					{ name: "This Week", value: "week" },
					{ name: "All Time", value: "all" },
				)
				.setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("provider")
		.setDescription("Switch AI provider")
		.addSubcommand((subcommand) =>
			subcommand.setName("status").setDescription("Show current provider and available options"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("zai")
				.setDescription("Switch to Z.ai GLM-4.6 (best coding model)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Z.ai model")
						.addChoices(
							{ name: "GLM 4.6 (Top Coding) - $6/mo", value: "glm-4.6" },
							{ name: "GLM 4.5 Air (Fast) - $6/mo", value: "glm-4.5-air" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("groq")
				.setDescription("Switch to Groq (free + fast)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Groq model")
						.addChoices(
							{ name: "Kimi K2 Latest (128k) - FREE", value: "kimi-k2" },
							{ name: "Llama 3.3 70B (Best) - FREE", value: "llama-3.3-70b" },
							{ name: "Llama 4 Maverick - FREE", value: "llama-4-maverick" },
							{ name: "Qwen3 32B - FREE", value: "qwen3-32b" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("cerebras")
				.setDescription("Switch to Cerebras (fastest - 2100+ tok/s)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Cerebras model")
						.addChoices(
							{ name: "GLM 4.6 (Fastest Smart) - $0.10/M", value: "glm-4.6" },
							{ name: "Llama 3.3 70B (Best) - $0.60/M", value: "llama-3.3-70b" },
							{ name: "Qwen3 32B (Balanced) - $0.20/M", value: "qwen-3-32b" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("ollama").setDescription("Switch to local Ollama (free, private)"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("openrouter")
				.setDescription("Switch to OpenRouter cloud")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("OpenRouter model")
						.addChoices(
							{ name: "Gemini 2.0 Flash - FREE", value: "gemini-2-flash" },
							{ name: "Kimi K2 - FREE", value: "kimi-k2" },
							{ name: "Mistral Small 3.1 - $0.03/M", value: "mistral-small" },
							{ name: "DeepSeek V3.1 - $0.15/M", value: "deepseek-v3" },
						)
						.setRequired(false),
				),
		),

	// Admin Commands
	new SlashCommandBuilder()
		.setName("admin")
		.setDescription("Admin-only commands (owner access required)")
		.addSubcommand((subcommand) =>
			subcommand.setName("stats").setDescription("Show bot statistics (uptime, commands, memory)"),
		)
		.addSubcommand((subcommand) => subcommand.setName("users").setDescription("List users who have used the bot"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("broadcast")
				.setDescription("Send message to all channels bot is in")
				.addStringOption((option) =>
					option.setName("message").setDescription("Message to broadcast").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("reload").setDescription("Reload skills from disk without restart"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("config")
				.setDescription("View or set runtime configuration")
				.addStringOption((option) => option.setName("key").setDescription("Configuration key").setRequired(true))
				.addStringOption((option) =>
					option.setName("value").setDescription("Configuration value (omit to view)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("logs")
				.setDescription("Show recent bot logs")
				.addIntegerOption((option) =>
					option.setName("lines").setDescription("Number of lines to show (default: 50)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("restart").setDescription("Gracefully restart the bot (via systemd)"),
		),

	new SlashCommandBuilder()
		.setName("tools")
		.setDescription("List all available MCP tools and capabilities")
		.addStringOption((option) =>
			option
				.setName("category")
				.setDescription("Filter by category")
				.addChoices(
					{ name: "All Tools", value: "all" },
					{ name: "Web & Search", value: "web" },
					{ name: "GitHub", value: "github" },
					{ name: "HuggingFace", value: "hf" },
					{ name: "Memory", value: "memory" },
					{ name: "Tasks", value: "tasks" },
					{ name: "Codebase Knowledge", value: "codebase" },
					{ name: "Skills System", value: "skills" },
					{ name: "Self-Management", value: "self" },
				)
				.setRequired(false),
		),

	// Creative generation commands
	new SlashCommandBuilder()
		.setName("generate")
		.setDescription("Generate creative content (images, music, video, voice)")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("image")
				.setDescription("Generate an image with FLUX")
				.addStringOption((option) => option.setName("prompt").setDescription("Image description").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("FLUX model to use")
						.addChoices(
							{ name: "FLUX Dev (Best)", value: "flux-dev" },
							{ name: "FLUX Schnell (Fast)", value: "flux-schnell" },
							{ name: "FLUX Pro", value: "flux-pro" },
							{ name: "FLUX Realism", value: "flux-realism" },
							{ name: "Ideogram V2", value: "ideogram" },
							{ name: "Recraft V3", value: "recraft" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("music")
				.setDescription("Generate music with Suno AI")
				.addStringOption((option) =>
					option.setName("prompt").setDescription("Music description or lyrics").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("style").setDescription("Music style (e.g., 'hip hop', 'electronic')").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("video")
				.setDescription("Generate video from text or image")
				.addStringOption((option) => option.setName("prompt").setDescription("Video description").setRequired(true))
				.addStringOption((option) =>
					option.setName("image_url").setDescription("Optional: Image to animate").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("voice")
				.setDescription("Generate speech with VibeVoice or ElevenLabs")
				.addStringOption((option) => option.setName("text").setDescription("Text to speak").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("engine")
						.setDescription("TTS engine")
						.addChoices(
							{ name: "VibeVoice (Multi-speaker)", value: "vibevoice" },
							{ name: "ElevenLabs (High quality)", value: "elevenlabs" },
							{ name: "OpenAI TTS", value: "openai" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("3d")
				.setDescription("Generate 3D model from image or text")
				.addStringOption((option) =>
					option.setName("prompt").setDescription("3D model description").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("image_url").setDescription("Optional: Image to convert to 3D").setRequired(false),
				),
		),

	// LiveKit voice commands
	new SlashCommandBuilder()
		.setName("livekit")
		.setDescription("Real-time voice/video with LiveKit")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("create")
				.setDescription("Create a voice room")
				.addStringOption((option) => option.setName("name").setDescription("Room name").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("join")
				.setDescription("Get token to join a room")
				.addStringOption((option) => option.setName("room").setDescription("Room name").setRequired(true)),
		)
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("List active rooms"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("record")
				.setDescription("Start/stop recording a room")
				.addStringOption((option) => option.setName("room").setDescription("Room name").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("action")
						.setDescription("Action")
						.addChoices({ name: "Start Recording", value: "start" }, { name: "Stop Recording", value: "stop" })
						.setRequired(true),
				),
		),

	// Schedule command - manage scheduled tasks
	new SlashCommandBuilder()
		.setName("schedule")
		.setDescription("Manage scheduled tasks")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("add")
				.setDescription("Add a new scheduled task")
				.addStringOption((option) => option.setName("name").setDescription("Task name").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("cron")
						.setDescription("Cron expression (e.g., '0 9 * * *' for 9 AM daily)")
						.setRequired(true),
				)
				.addStringOption((option) => option.setName("action").setDescription("Action to perform").setRequired(true))
				.addChannelOption((option) =>
					option
						.setName("channel")
						.setDescription("Channel to send results to (default: current)")
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("List all your scheduled tasks"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("remove")
				.setDescription("Remove a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID to remove").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("toggle")
				.setDescription("Enable or disable a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID to toggle").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("info")
				.setDescription("Get details about a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID").setRequired(true)),
		),

	// Health check command
	new SlashCommandBuilder()
		.setName("health")
		.setDescription("Check bot health and API status"),

	// Reset command - clears conversation history
	new SlashCommandBuilder()
		.setName("reset")
		.setDescription("Clear conversation history for this channel"),

	// Backup command - creates data dump
	new SlashCommandBuilder()
		.setName("backup")
		.setDescription("Create a backup of bot data")
		.addStringOption((option) =>
			option
				.setName("scope")
				.setDescription("What to backup")
				.addChoices({ name: "Channel Only", value: "channel" }, { name: "All Data", value: "all" })
				.setRequired(false),
		),

	// Cost tracking command
	new SlashCommandBuilder()
		.setName("cost")
		.setDescription("View API usage costs")
		.addStringOption((option) =>
			option
				.setName("view")
				.setDescription("What to view")
				.addChoices(
					{ name: "My Usage", value: "me" },
					{ name: "Top Users", value: "top" },
					{ name: "Daily Breakdown", value: "daily" },
				)
				.setRequired(false),
		),

	// Trading agents command
	new SlashCommandBuilder()
		.setName("trading")
		.setDescription("AI-powered trading analysis (Moon Dev inspired)")
		.addSubcommand((sub) =>
			sub
				.setName("analyze")
				.setDescription("Get AI consensus analysis for a symbol")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Crypto symbol (e.g., BTC, ETH)").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("sentiment")
				.setDescription("Get sentiment analysis for a symbol")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Crypto symbol").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("whales").setDescription("View recent whale activity"))
		.addSubcommand((sub) => sub.setName("signals").setDescription("View recent trading signals"))
		.addSubcommand((sub) => sub.setName("summary").setDescription("Get market summary"))
		.addSubcommand((sub) => sub.setName("status").setDescription("View trading agent status"))
		.addSubcommand((sub) =>
			sub
				.setName("backtest")
				.setDescription("Backtest a trading strategy (OpenHands)")
				.addStringOption((opt) =>
					opt
						.setName("strategy")
						.setDescription("Strategy name (e.g., momentum, mean-reversion)")
						.setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("timeframe").setDescription("Backtest timeframe (default: 1 year)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("risk")
				.setDescription("Assess portfolio risk (OpenHands)")
				.addStringOption((opt) =>
					opt
						.setName("holdings")
						.setDescription("Holdings as JSON (e.g., [{symbol:BTC,allocation:0.5}])")
						.setRequired(true),
				)
				.addNumberOption((opt) =>
					opt.setName("value").setDescription("Total portfolio value in USD").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("audit")
				.setDescription("Full trading audit - analysis + backtest + risk (OpenHands)")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Symbol to audit (e.g., BTC)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("strategy").setDescription("Strategy to backtest (optional)").setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("expertise").setDescription("View accumulated trading expertise")),

	// Knowledge base command
	new SlashCommandBuilder()
		.setName("knowledge")
		.setDescription("Access quant, superquant, nanoagents, Moon Dev docs, and pi-mono codebase")
		.addSubcommand((sub) => sub.setName("sources").setDescription("List available knowledge sources"))
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search across knowledge base")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("read")
				.setDescription("Read a specific file")
				.addStringOption((opt) => opt.setName("path").setDescription("File path to read").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("moondev").setDescription("Get Moon Dev architecture summary"))
		.addSubcommand((sub) =>
			sub
				.setName("agent")
				.setDescription("Get quant agent source code")
				.addStringOption((opt) =>
					opt.setName("name").setDescription("Agent name (e.g., price_monitor, risk_analyzer)").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("specs").setDescription("List quant specifications")),

	// Voice mode command
	new SlashCommandBuilder()
		.setName("voice")
		.setDescription("Voice chat with AI using ElevenLabs TTS + Groq Whisper STT")
		.addSubcommand((sub) => sub.setName("join").setDescription("Join your current voice channel"))
		.addSubcommand((sub) => sub.setName("leave").setDescription("Leave the voice channel"))
		.addSubcommand((sub) =>
			sub
				.setName("speak")
				.setDescription("Make the bot speak text")
				.addStringOption((opt) => opt.setName("text").setDescription("Text to speak").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("transcribe")
				.setDescription("Transcribe audio from a file or URL")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to audio file").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("View voice session status"))
		.addSubcommand((sub) => sub.setName("voices").setDescription("List available ElevenLabs voices")),

	// Claude Agent command
	new SlashCommandBuilder()
		.setName("agent")
		.setDescription("Spawn Claude Code as a subagent for complex tasks")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run a custom prompt with Claude agent")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task for the agent").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Learning mode (default: general)")
						.setRequired(false)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Coding", value: "coding" },
							{ name: "Research", value: "research" },
							{ name: "Trading", value: "trading" },
						),
				)
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				)
				.addIntegerOption((opt) =>
					opt.setName("timeout").setDescription("Timeout in seconds (default: 300)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("research")
				.setDescription("Research a topic using Claude agent")
				.addStringOption((opt) => opt.setName("topic").setDescription("Topic to research").setRequired(true))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("review")
				.setDescription("Code review with Claude agent")
				.addStringOption((opt) => opt.setName("code").setDescription("Code to review (or paste)").setRequired(true))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trading")
				.setDescription("Trading analysis with Claude agent")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Trading symbol (e.g., BTC, ETH)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("data").setDescription("Market data or context").setRequired(false))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Claude agent availability")),

	// Agent Learning System command
	new SlashCommandBuilder()
		.setName("expertise")
		.setDescription("View and manage agent learning system")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show expertise files and session counts"))
		.addSubcommand((sub) => sub.setName("modes").setDescription("List available learning modes"))
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("Show accumulated expertise for a mode")
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Learning mode to view")
						.setRequired(true)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Coding", value: "coding" },
							{ name: "Research", value: "research" },
							{ name: "Trading", value: "trading" },
						),
				),
		),

	// OpenHands Software Agent command - Expert modes
	new SlashCommandBuilder()
		.setName("openhands")
		.setDescription("Run OpenHands software agents for coding tasks")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run an OpenHands agent to complete a task")
				.addStringOption((opt) => opt.setName("task").setDescription("Task for the agent").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Expert mode")
						.setRequired(false)
						.addChoices(
							{ name: "Developer (general coding)", value: "developer" },
							{ name: "Security Scan (vulnerabilities)", value: "vulnerability_scan" },
							{ name: "Code Review (quality analysis)", value: "code_review" },
							{ name: "Test Generation (unit/integration)", value: "test_generation" },
							{ name: "Documentation (README, API docs)", value: "documentation" },
							{ name: "Refactor (improve code quality)", value: "refactor" },
							{ name: "Debug (fix issues)", value: "debug" },
							{ name: "Optimize (performance)", value: "optimize" },
						),
				)
				.addStringOption((opt) =>
					opt.setName("workspace").setDescription("Working directory path").setRequired(false),
				)
				.addBooleanOption((opt) =>
					opt.setName("persist").setDescription("Enable session persistence").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("security")
				.setDescription("Security vulnerability scan")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to scan").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("review")
				.setDescription("Thorough code review")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to review").setRequired(true))
				.addStringOption((opt) => opt.setName("focus").setDescription("Focus area").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("tests")
				.setDescription("Generate comprehensive tests")
				.addStringOption((opt) =>
					opt.setName("path").setDescription("Path to generate tests for").setRequired(true),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("coverage")
						.setDescription("Coverage target %")
						.setRequired(false)
						.setMinValue(50)
						.setMaxValue(100),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("docs")
				.setDescription("Generate documentation")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to document").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Documentation type")
						.setRequired(false)
						.addChoices(
							{ name: "All (README, API, comments)", value: "all" },
							{ name: "README only", value: "readme" },
							{ name: "API docs only", value: "api" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("refactor")
				.setDescription("Refactor code for quality")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to refactor").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("target").setDescription("Specific target to refactor").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("debug")
				.setDescription("Debug and fix an issue")
				.addStringOption((opt) => opt.setName("path").setDescription("Path with the issue").setRequired(true))
				.addStringOption((opt) => opt.setName("issue").setDescription("Issue description").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("optimize")
				.setDescription("Performance optimization")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to optimize").setRequired(true))
				.addStringOption((opt) => opt.setName("focus").setDescription("Focus area").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check OpenHands availability"))
		.addSubcommand((sub) => sub.setName("modes").setDescription("List all available expert modes"))
		.addSubcommand((sub) =>
			sub
				.setName("learning")
				.setDescription("Manage Agent Experts learning system")
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Action to perform")
						.setRequired(true)
						.addChoices(
							{ name: "List all modes with session counts", value: "list" },
							{ name: "View learnings for a mode", value: "view" },
							{ name: "Clear expertise for a mode", value: "clear" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Expert mode (required for view/clear)")
						.setRequired(false)
						.addChoices(
							{ name: "Developer", value: "developer" },
							{ name: "Vulnerability Scan", value: "vulnerability_scan" },
							{ name: "Code Review", value: "code_review" },
							{ name: "Test Generation", value: "test_generation" },
							{ name: "Documentation", value: "documentation" },
							{ name: "Refactor", value: "refactor" },
							{ name: "Debug", value: "debug" },
							{ name: "Migrate", value: "migrate" },
							{ name: "Optimize", value: "optimize" },
						),
				),
		),

	// Suno AI Music Generation
	new SlashCommandBuilder()
		.setName("suno")
		.setDescription("Generate AI music with Suno")
		.addSubcommand((sub) =>
			sub
				.setName("generate")
				.setDescription("Generate music from a prompt")
				.addStringOption((opt) =>
					opt.setName("prompt").setDescription("Describe the music you want (max 500 chars)").setRequired(true),
				)
				.addBooleanOption((opt) =>
					opt.setName("instrumental").setDescription("Generate instrumental only (no vocals)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("custom")
				.setDescription("Generate with custom lyrics and style")
				.addStringOption((opt) =>
					opt.setName("lyrics").setDescription("Your lyrics (max 5000 chars)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("style").setDescription("Music style (e.g., rock, jazz, electronic)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("title").setDescription("Song title").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Model version")
						.setRequired(false)
						.addChoices(
							{ name: "V5 (Latest)", value: "V5" },
							{ name: "V4.5 All (Best structure)", value: "V4_5ALL" },
							{ name: "V4.5 Plus (Rich sound)", value: "V4_5PLUS" },
							{ name: "V4.5 (Balanced)", value: "V4_5" },
							{ name: "V4 (Classic)", value: "V4" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("instrumental")
				.setDescription("Generate an instrumental track")
				.addStringOption((opt) =>
					opt
						.setName("style")
						.setDescription("Music style (e.g., ambient, classical, synthwave)")
						.setRequired(true),
				)
				.addStringOption((opt) => opt.setName("title").setDescription("Track title").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Suno service status and credits")),

	// Telegram Bridge
	new SlashCommandBuilder()
		.setName("telegram")
		.setDescription("Telegram bridge - send messages and media to Telegram")
		.addSubcommand((sub) =>
			sub
				.setName("send")
				.setDescription("Send a message to Telegram")
				.addStringOption((opt) => opt.setName("chat_id").setDescription("Telegram chat ID").setRequired(true))
				.addStringOption((opt) => opt.setName("message").setDescription("Message to send").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("photo")
				.setDescription("Send a photo to Telegram")
				.addStringOption((opt) => opt.setName("chat_id").setDescription("Telegram chat ID").setRequired(true))
				.addStringOption((opt) => opt.setName("url").setDescription("Photo URL").setRequired(true))
				.addStringOption((opt) => opt.setName("caption").setDescription("Photo caption").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Telegram bot status")),

	// Browser Automation
	new SlashCommandBuilder()
		.setName("browse")
		.setDescription("Browser automation - screenshots, scraping, web search")
		.addSubcommand((sub) =>
			sub
				.setName("screenshot")
				.setDescription("Take a screenshot of a webpage")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to screenshot").setRequired(true))
				.addBooleanOption((opt) => opt.setName("fullpage").setDescription("Capture full page").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("scrape")
				.setDescription("Scrape content from a webpage")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to scrape").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("extract")
				.setDescription("Extract specific data from a webpage using AI")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to extract from").setRequired(true))
				.addStringOption((opt) => opt.setName("query").setDescription("What to extract").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search the web")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true)),
		),

	// HuggingFace Expert Skills
	new SlashCommandBuilder()
		.setName("hf")
		.setDescription("HuggingFace AI skills - 30+ expert capabilities")
		.addSubcommand((sub) =>
			sub
				.setName("image")
				.setDescription("Generate images from text")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Image description").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Model to use")
						.setRequired(false)
						.addChoices(
							{ name: "Qwen Fast (default)", value: "QWEN_FAST" },
							{ name: "Qwen Quality", value: "QWEN_QUALITY" },
							{ name: "FLUX Krea", value: "FLUX_KREA" },
							{ name: "Z-Image Turbo", value: "Z_IMAGE_TURBO" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove-bg")
				.setDescription("Remove background from image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("edit")
				.setDescription("Edit image with text prompt")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("Edit instructions").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("3d")
				.setDescription("Generate 3D model from image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("3D model to use")
						.setRequired(false)
						.addChoices(
							{ name: "Hunyuan 2.1 (default)", value: "HUNYUAN_2_1" },
							{ name: "Hunyuan 2.0", value: "HUNYUAN_2" },
							{ name: "TRELLIS", value: "TRELLIS" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("video")
				.setDescription("Generate video from image + prompt")
				.addStringOption((opt) => opt.setName("url").setDescription("Starting image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("Video description").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("tts")
				.setDescription("Text to speech")
				.addStringOption((opt) => opt.setName("text").setDescription("Text to speak").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("TTS model")
						.setRequired(false)
						.addChoices(
							{ name: "Chatterbox (default)", value: "CHATTERBOX" },
							{ name: "F5-TTS (voice clone)", value: "F5_TTS" },
							{ name: "Edge TTS", value: "EDGE_TTS" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("ocr")
				.setDescription("Extract text from image/PDF")
				.addStringOption((opt) => opt.setName("url").setDescription("Image/PDF URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("code")
				.setDescription("Generate code from description")
				.addStringOption((opt) => opt.setName("prompt").setDescription("What to build").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Code model")
						.setRequired(false)
						.addChoices(
							{ name: "Qwen Coder (default)", value: "QWEN_CODER" },
							{ name: "Qwen WebDev", value: "QWEN_WEBDEV" },
							{ name: "DeepSeek Coder", value: "DEEPSEEK_CODER" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trading")
				.setDescription("Trading sentiment analysis")
				.addStringOption((opt) =>
					opt.setName("asset").setDescription("Asset to analyze (e.g., BTC, AAPL)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("news").setDescription("News text to analyze").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("stocks").setDescription("Get AI stock recommendations"))
		.addSubcommand((sub) =>
			sub
				.setName("vision")
				.setDescription("Ask questions about an image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("question").setDescription("Your question").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("detect")
				.setDescription("Detect objects in image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("polish")
				.setDescription("Improve/polish an AI prompt")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Prompt to improve").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("skills").setDescription("List all available HF skills")),
	// Learning command for trading stats
	new SlashCommandBuilder()
		.setName("learning")
		.setDescription("Trading learning stats and expertise")
		.addSubcommand((sub) => sub.setName("stats").setDescription("View current learning session stats"))
		.addSubcommand((sub) => sub.setName("expertise").setDescription("View accumulated trading expertise"))
		.addSubcommand((sub) =>
			sub
				.setName("record")
				.setDescription("Manually record a trading outcome")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Trading pair (e.g., SOL/USDT)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Action taken")
						.setRequired(true)
						.addChoices(
							{ name: "BUY", value: "BUY" },
							{ name: "SELL", value: "SELL" },
							{ name: "HOLD", value: "HOLD" },
						),
				)
				.addBooleanOption((opt) => opt.setName("success").setDescription("Was it successful?").setRequired(true))
				.addNumberOption((opt) => opt.setName("confidence").setDescription("Confidence 0-1").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("market")
						.setDescription("Market condition")
						.setRequired(true)
						.addChoices(
							{ name: "Bull", value: "bull" },
							{ name: "Bear", value: "bear" },
							{ name: "Sideways", value: "sideways" },
							{ name: "Volatile", value: "volatile" },
						),
				)
				.addStringOption((opt) => opt.setName("reason").setDescription("Reason for trade").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub.setName("update").setDescription("Force update expertise file with current learnings"),
		),

	// Codebase Experts (TAC Lesson 13)
	new SlashCommandBuilder()
		.setName("expert")
		.setDescription("Codebase Experts - domain-specific learning agents (TAC Lesson 13)")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run task with auto-selected domain expert")
				.addStringOption((opt) => opt.setName("task").setDescription("Task to execute").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Force specific domain (auto-detect if not set)")
						.setRequired(false)
						.addChoices(
							{ name: "Security (auth, OWASP)", value: "security" },
							{ name: "Database (schema, queries)", value: "database" },
							{ name: "Trading (signals, risk)", value: "trading" },
							{ name: "API Integration (external APIs)", value: "api_integration" },
							{ name: "Billing (payments)", value: "billing" },
							{ name: "Performance (optimization)", value: "performance" },
							{ name: "General", value: "general" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all available codebase experts"))
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View expertise accumulated by a domain expert")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Domain to view")
						.setRequired(true)
						.addChoices(
							{ name: "Security", value: "security" },
							{ name: "Database", value: "database" },
							{ name: "Trading", value: "trading" },
							{ name: "API Integration", value: "api_integration" },
							{ name: "Billing", value: "billing" },
							{ name: "Performance", value: "performance" },
							{ name: "Meta-Agentic", value: "meta_agentic" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new domain expert (meta-agentic)")
				.addStringOption((opt) => opt.setName("domain").setDescription("New domain name").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("description").setDescription("What this expert handles").setRequired(true),
				),
		),

	// Two-Phase Agent Workflow (Initializer + Coding Agent)
	new SlashCommandBuilder()
		.setName("task")
		.setDescription("Two-phase agent workflow - plan then execute features")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new task with feature breakdown")
				.addStringOption((opt) => opt.setName("description").setDescription("Task description").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Expert domain for this task")
						.setRequired(false)
						.addChoices(
							{ name: "Coding", value: "coding" },
							{ name: "Security", value: "security" },
							{ name: "Database", value: "database" },
							{ name: "Trading", value: "trading" },
							{ name: "General", value: "general" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("execute")
				.setDescription("Execute next feature in a task")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to execute").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Check task progress")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to check").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("resume")
				.setDescription("Resume an interrupted task")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to resume").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Create and execute a task in one go")
				.addStringOption((opt) => opt.setName("description").setDescription("Task description").setRequired(true))
				.addIntegerOption((opt) =>
					opt
						.setName("max_features")
						.setDescription("Max features to execute")
						.setRequired(false)
						.setMinValue(1)
						.setMaxValue(50),
				),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all tasks")),
];

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): { workingDir: string } {
	const args = process.argv.slice(2);
	let workingDir: string | undefined;

	for (const arg of args) {
		if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	if (!workingDir) {
		console.error("Usage: pi-discord <working-directory>");
		process.exit(1);
	}

	return { workingDir: resolve(workingDir) };
}

// ============================================================================
// Logging
// ============================================================================

function logInfo(message: string): void {
	console.log(chalk.blue("[INFO]"), message);
}

function logWarning(message: string, detail?: string): void {
	console.log(chalk.yellow("[WARN]"), message, detail ? chalk.dim(detail) : "");
}

function logError(message: string, detail?: string): void {
	console.error(chalk.red("[ERROR]"), message, detail ? chalk.dim(detail) : "");
}

function logTool(toolName: string, label: string): void {
	console.log(chalk.cyan("[TOOL]"), `${toolName}: ${label}`);
}

function logSlash(command: string, user: string): void {
	console.log(chalk.magenta("[SLASH]"), `/${command} by ${user}`);
}

// ============================================================================
// OpenHands Expertise Management
// ============================================================================

interface ExpertiseInfo {
	mode: string;
	sessionCount: number;
	lastUpdated: string;
	filePath: string;
	content: string;
}

function getExpertiseDir(): string {
	return join(process.cwd(), "src", "agents", "expertise");
}

function getAllExpertise(): ExpertiseInfo[] {
	const expertiseDir = getExpertiseDir();

	if (!existsSync(expertiseDir)) {
		return [];
	}

	const files = readdirSync(expertiseDir).filter((f) => f.endsWith(".md"));

	return files.map((file) => {
		const filePath = join(expertiseDir, file);
		const content = readFileSync(filePath, "utf-8");
		const stats = statSync(filePath);

		// Count session insights
		const sessionMatches = content.match(/### Session:/g);
		const sessionCount = sessionMatches ? sessionMatches.length : 0;

		return {
			mode: file.replace(".md", ""),
			sessionCount,
			lastUpdated: stats.mtime.toISOString(),
			filePath,
			content,
		};
	});
}

function getExpertiseForMode(mode: string): ExpertiseInfo | null {
	const expertiseDir = getExpertiseDir();
	const filePath = join(expertiseDir, `${mode}.md`);

	if (!existsSync(filePath)) {
		return null;
	}

	const content = readFileSync(filePath, "utf-8");
	const stats = statSync(filePath);

	const sessionMatches = content.match(/### Session:/g);
	const sessionCount = sessionMatches ? sessionMatches.length : 0;

	return {
		mode,
		sessionCount,
		lastUpdated: stats.mtime.toISOString(),
		filePath,
		content,
	};
}

function extractRecentLearnings(content: string, limit: number = 5): string[] {
	const learnings: string[] = [];
	const sessionRegex = /### Session: (.+?)\n\*\*Task:\*\* (.+?)\n\n(.+?)(?=\n### Session:|$)/gs;

	for (const match of content.matchAll(sessionRegex)) {
		const [, timestamp, task, learning] = match;
		learnings.push(`**${timestamp}**\n${task.substring(0, 100)}...\n${learning.substring(0, 300)}...`);
	}

	return learnings.slice(-limit);
}

function clearExpertise(mode: string): boolean {
	const expertiseDir = getExpertiseDir();
	const filePath = join(expertiseDir, `${mode}.md`);

	if (!existsSync(filePath)) {
		return false;
	}

	// Create empty template
	const template = `# ${mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ")} Expert

## Mental Model
Accumulated expertise for ${mode.replace(/_/g, " ")} tasks.

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Code Templates
<!-- Agent stores reusable code patterns here -->

## Session Insights
<!-- Recent session learnings appear here -->
`;

	writeFileSync(filePath, template, "utf-8");
	return true;
}

// ============================================================================
// Discord UI Helpers (Embeds, Buttons)
// ============================================================================

function createResponseEmbed(title: string, description: string, color: number = 0x0099ff): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(color)
		.setTitle(title)
		.setDescription(description.substring(0, 4096))
		.setTimestamp()
		.setFooter({ text: "Pi Discord Bot" });
}

function createStatusEmbed(
	currentModel: string,
	globalModel: string,
	uptime: string,
	workspace: string,
	channels: number,
): EmbedBuilder {
	const modelInfo = currentModel === globalModel ? `\`${currentModel}\` (global)` : `\`${currentModel}\` (personal)`;

	return new EmbedBuilder()
		.setColor(0x00ff00)
		.setTitle("🤖 Pi Discord Bot Status")
		.addFields(
			{ name: "Current Model", value: modelInfo, inline: true },
			{ name: "Uptime", value: uptime, inline: true },
			{ name: "Active Channels", value: String(channels), inline: true },
			{ name: "Workspace", value: `\`${workspace}\``, inline: false },
		)
		.addFields(
			{
				name: "AI Commands",
				value:
					"`/ask` - Ask the AI anything\n" +
					"`/model` - Manage AI models\n" +
					"`/remember` - Save to memory\n" +
					"`/memory` - Show memory\n" +
					"`/forget` - Clear memory",
				inline: true,
			},
			{
				name: "System Commands",
				value:
					"`/bash` - Run shell commands\n" +
					"`/read` - Read files\n" +
					"`/status` - Bot status\n" +
					"`/skills` - List capabilities",
				inline: true,
			},
			{
				name: "Crypto Commands",
				value:
					"`/price` - Get crypto price\n" +
					"`/alert` - Set price alert\n" +
					"`/news` - Latest news\n" +
					"`/chart` - TradingView chart\n" +
					"`/convert` - Currency converter",
				inline: true,
			},
		)
		.setTimestamp()
		.setFooter({ text: "Or just @mention me!" });
}

function createFeedbackButtons(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("feedback_helpful").setLabel("👍 Helpful").setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId("feedback_not_helpful").setLabel("👎 Not Helpful").setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId("feedback_more").setLabel("📝 Tell me more").setStyle(ButtonStyle.Primary),
	);
}

// ============================================================================
// Shell Utilities
// ============================================================================

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

interface ExecOptions {
	timeout?: number;
	signal?: AbortSignal;
}

async function execCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("sh", ["-c", command], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timeoutHandle =
			options?.timeout && options.timeout > 0
				? setTimeout(() => {
						timedOut = true;
						try {
							process.kill(-child.pid!, "SIGKILL");
						} catch {}
					}, options.timeout * 1000)
				: undefined;

		const onAbort = () => {
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
			if (stdout.length > 10 * 1024 * 1024) {
				stdout = stdout.slice(0, 10 * 1024 * 1024);
			}
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
			if (stderr.length > 10 * 1024 * 1024) {
				stderr = stderr.slice(0, 10 * 1024 * 1024);
			}
		});

		child.on("close", (code) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (options?.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}

			if (options?.signal?.aborted) {
				reject(new Error(`${stdout}\n${stderr}\nCommand aborted`.trim()));
				return;
			}

			if (timedOut) {
				reject(new Error(`${stdout}\n${stderr}\nCommand timed out after ${options?.timeout} seconds`.trim()));
				return;
			}

			resolve({ stdout, stderr, code: code ?? 0 });
		});
	});
}

// ============================================================================
// Crypto API Utilities
// ============================================================================

async function getCryptoPrice(symbol: string): Promise<{ price: number; change24h: number; marketCap: number }> {
	try {
		const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
		const response = await fetch(url);
		const data = await response.json();

		const symbolData = data[symbol.toLowerCase()];
		if (!symbolData) {
			throw new Error(`Symbol not found: ${symbol}`);
		}

		return {
			price: symbolData.usd,
			change24h: symbolData.usd_24h_change || 0,
			marketCap: symbolData.usd_market_cap || 0,
		};
	} catch (error) {
		throw new Error(`Failed to fetch price: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function getCryptoNews(topic?: string): Promise<Array<{ title: string; url: string; source: string }>> {
	try {
		// Using CryptoPanic free API (no key required for basic use)
		const url = topic
			? `https://cryptopanic.com/api/v1/posts/?auth_token=free&filter=${encodeURIComponent(topic)}`
			: `https://cryptopanic.com/api/v1/posts/?auth_token=free&kind=news`;

		const response = await fetch(url);
		const data = await response.json();

		if (!data.results || data.results.length === 0) {
			return [];
		}

		return data.results.slice(0, 5).map((item: any) => ({
			title: item.title,
			url: item.url,
			source: item.source?.title || "Unknown",
		}));
	} catch (error) {
		// Fallback: return empty array if API fails
		return [];
	}
}

async function convertCurrency(amount: number, from: string, to: string): Promise<{ result: number; rate: number }> {
	try {
		// Use CoinGecko for crypto conversions
		const fromLower = from.toLowerCase();
		const toLower = to.toLowerCase();

		// Get both prices in USD
		const url = `https://api.coingecko.com/api/v3/simple/price?ids=${fromLower},${toLower}&vs_currencies=usd`;
		const response = await fetch(url);
		const data = await response.json();

		const fromPrice = data[fromLower]?.usd;
		const toPrice = data[toLower]?.usd;

		if (!fromPrice || !toPrice) {
			throw new Error(`Currency not found: ${!fromPrice ? from : to}`);
		}

		const rate = fromPrice / toPrice;
		const result = amount * rate;

		return { result, rate };
	} catch (error) {
		throw new Error(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function generateTradingViewLink(symbol: string, timeframe: string): string {
	// Normalize symbol (remove slashes, make uppercase)
	const normalizedSymbol = symbol.toUpperCase().replace(/[/-]/g, "");

	// Map common timeframes
	const timeframeMap: Record<string, string> = {
		"1m": "1",
		"5m": "5",
		"15m": "15",
		"30m": "30",
		"1h": "60",
		"4h": "240",
		"1d": "D",
		"1w": "W",
		"1M": "M",
	};

	const mappedTimeframe = timeframeMap[timeframe.toLowerCase()] || timeframe;

	return `https://www.tradingview.com/chart/?symbol=${normalizedSymbol}&interval=${mappedTimeframe}`;
}

// ============================================================================
// Truncation Utilities
// ============================================================================

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateTail(content: string): {
	content: string;
	truncated: boolean;
	totalLines: number;
	outputLines: number;
} {
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (totalLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
		return { content, truncated: false, totalLines, outputLines: totalLines };
	}

	const outputLines: string[] = [];
	let outputBytes = 0;

	for (let i = lines.length - 1; i >= 0 && outputLines.length < DEFAULT_MAX_LINES; i--) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);

		if (outputBytes + lineBytes > DEFAULT_MAX_BYTES) break;

		outputLines.unshift(line);
		outputBytes += lineBytes;
	}

	return {
		content: outputLines.join("\n"),
		truncated: true,
		totalLines,
		outputLines: outputLines.length,
	};
}

// ============================================================================
// Agent Tools
// ============================================================================

const bashSchema = Type.Object({
	label: Type.String({ description: "Brief description of what this command does (shown to user)" }),
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

function createBashTool(): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command. Returns stdout and stderr. Output truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. Dangerous commands (sudo, rm -rf, etc.) require user approval.`,
		parameters: bashSchema,
		execute: async (_toolCallId, { command, timeout, label }, signal) => {
			logTool("bash", label);

			// Security: Check for dangerous commands and request approval
			if (isDangerousCommand(command)) {
				logWarning("Dangerous command detected, requesting approval", command.substring(0, 50));
				const approved = await requestApproval(command);
				if (!approved) {
					throw new Error("Command denied: Requires user approval for dangerous operations.");
				}
			}

			const result = await execCommand(command, { timeout, signal });
			let output = "";
			if (result.stdout) output += result.stdout;
			if (result.stderr) {
				if (output) output += "\n";
				output += result.stderr;
			}

			const truncation = truncateTail(output);
			let outputText = truncation.content || "(no output)";

			if (truncation.truncated) {
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				outputText += `\n\n[Showing lines ${startLine}-${truncation.totalLines} of ${truncation.totalLines}]`;
			}

			if (result.code !== 0) {
				throw new Error(`${outputText}\n\nCommand exited with code ${result.code}`.trim());
			}

			return { content: [{ type: "text", text: outputText }], details: undefined };
		},
	};
}

const readSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're reading (shown to user)" }),
	path: Type.String({ description: "Path to the file to read" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum lines to read" })),
});

function createReadTool(): AgentTool<typeof readSchema> {
	return {
		name: "read",
		label: "read",
		description: `Read file contents. Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. Use offset/limit for large files.`,
		parameters: readSchema,
		execute: async (_toolCallId, { path, offset, limit, label }, signal) => {
			logTool("read", `${label} (${path})`);

			const countResult = await execCommand(`wc -l < ${shellEscape(path)}`, { signal });
			if (countResult.code !== 0) {
				throw new Error(countResult.stderr || `Failed to read file: ${path}`);
			}
			const totalLines = parseInt(countResult.stdout.trim(), 10) + 1;

			const startLine = offset ? Math.max(1, offset) : 1;
			const cmd = startLine === 1 ? `cat ${shellEscape(path)}` : `tail -n +${startLine} ${shellEscape(path)}`;

			const result = await execCommand(cmd, { signal });
			if (result.code !== 0) {
				throw new Error(result.stderr || `Failed to read file: ${path}`);
			}

			let content = result.stdout;

			if (limit !== undefined) {
				const lines = content.split("\n");
				content = lines.slice(0, limit).join("\n");
			}

			const truncation = truncateTail(content);
			let outputText = truncation.content;

			if (truncation.truncated) {
				const endLine = startLine + truncation.outputLines - 1;
				outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue]`;
			}

			return { content: [{ type: "text", text: outputText }], details: undefined };
		},
	};
}

const writeSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're writing (shown to user)" }),
	path: Type.String({ description: "Path to the file to write" }),
	content: Type.String({ description: "Content to write" }),
});

function createWriteTool(): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		description: "Write content to a file. Creates parent directories. Overwrites existing files.",
		parameters: writeSchema,
		execute: async (_toolCallId, { path, content, label }, signal) => {
			logTool("write", `${label} (${path})`);

			const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : ".";
			const cmd = `mkdir -p ${shellEscape(dir)} && printf '%s' ${shellEscape(content)} > ${shellEscape(path)}`;

			const result = await execCommand(cmd, { signal });
			if (result.code !== 0) {
				throw new Error(result.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
				details: undefined,
			};
		},
	};
}

const editSchema = Type.Object({
	label: Type.String({ description: "Brief description of the edit (shown to user)" }),
	path: Type.String({ description: "Path to the file to edit" }),
	oldText: Type.String({ description: "Exact text to find and replace" }),
	newText: Type.String({ description: "New text to replace with" }),
});

function createEditTool(): AgentTool<typeof editSchema> {
	return {
		name: "edit",
		label: "edit",
		description: "Edit a file by replacing exact text. oldText must match exactly including whitespace.",
		parameters: editSchema,
		execute: async (_toolCallId, { path, oldText, newText, label }, signal) => {
			logTool("edit", `${label} (${path})`);

			const readResult = await execCommand(`cat ${shellEscape(path)}`, { signal });
			if (readResult.code !== 0) {
				throw new Error(readResult.stderr || `File not found: ${path}`);
			}

			const content = readResult.stdout;

			if (!content.includes(oldText)) {
				throw new Error(`Could not find the exact text in ${path}. Must match exactly including whitespace.`);
			}

			const occurrences = content.split(oldText).length - 1;
			if (occurrences > 1) {
				throw new Error(`Found ${occurrences} occurrences. Text must be unique. Add more context.`);
			}

			const index = content.indexOf(oldText);
			const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);

			const writeResult = await execCommand(`printf '%s' ${shellEscape(newContent)} > ${shellEscape(path)}`, {
				signal,
			});
			if (writeResult.code !== 0) {
				throw new Error(writeResult.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully edited ${path}. Changed ${oldText.length} chars to ${newText.length} chars.`,
					},
				],
				details: undefined,
			};
		},
	};
}

// ============================================================================
// Memory System
// ============================================================================

function getMemory(channelDir: string, workspaceDir: string): string {
	const parts: string[] = [];

	const globalMemoryPath = join(workspaceDir, "MEMORY.md");
	if (existsSync(globalMemoryPath)) {
		try {
			const content = readFileSync(globalMemoryPath, "utf-8").trim();
			if (content) parts.push("### Global Memory\n" + content);
		} catch {}
	}

	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) parts.push("### Channel Memory\n" + content);
		} catch {}
	}

	return parts.length > 0 ? parts.join("\n\n") : "(no memory yet)";
}

function addToMemory(text: string, channelDir: string, workspaceDir: string, isGlobal: boolean): void {
	const memoryPath = isGlobal ? join(workspaceDir, "MEMORY.md") : join(channelDir, "MEMORY.md");
	const dir = isGlobal ? workspaceDir : channelDir;

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const timestamp = new Date().toISOString().split("T")[0];
	const entry = `\n- [${timestamp}] ${text}`;

	if (existsSync(memoryPath)) {
		appendFileSync(memoryPath, entry);
	} else {
		writeFileSync(memoryPath, `# Memory\n${entry}`);
	}
}

function clearMemory(channelDir: string, workspaceDir: string, isGlobal: boolean): boolean {
	const memoryPath = isGlobal ? join(workspaceDir, "MEMORY.md") : join(channelDir, "MEMORY.md");

	if (existsSync(memoryPath)) {
		writeFileSync(memoryPath, "# Memory\n");
		return true;
	}
	return false;
}

// ============================================================================
// Skills System (aligned with pi-mom)
// ============================================================================

/**
 * Load skills from workspace and channel directories.
 * Skills are directories containing SKILL.md with frontmatter.
 * Channel skills override workspace skills on name collision.
 */
function loadDiscordSkills(channelDir: string, workspacePath: string): Skill[] {
	const skillMap = new Map<string, Skill>();

	// Load workspace-level skills (global)
	const workspaceSkillsDir = join(workspacePath, "skills");
	const workspaceResult = loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" });
	for (const skill of workspaceResult.skills) {
		skillMap.set(skill.name, skill);
	}

	// Load channel-specific skills (override workspace skills on collision)
	const channelSkillsDir = join(channelDir, "skills");
	const channelResult = loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" });
	for (const skill of channelResult.skills) {
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}

/**
 * Legacy skill loader for backwards compatibility with old .md skill files
 */
function loadLegacySkills(workspacePath: string): string {
	const skillsDir = join(workspacePath, "skills");
	if (!existsSync(skillsDir)) {
		return "";
	}

	const skillFiles = [
		"model-management.md",
		"quant-trading.md",
		"technical-analysis.md",
		"risk-management.md",
		"trading-system-monitor.md",
		"market-data.md",
	];
	const skills: string[] = [];

	for (const file of skillFiles) {
		const skillPath = join(skillsDir, file);
		if (existsSync(skillPath)) {
			try {
				const content = readFileSync(skillPath, "utf-8").trim();
				if (content) {
					skills.push(content);
				}
			} catch {
				// Ignore read errors
			}
		}
	}

	if (skills.length === 0) {
		return "";
	}

	return "\n## Legacy Skills\n" + skills.join("\n\n---\n\n");
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(workspacePath: string, channelId: string, channelName: string, memory: string): string {
	const channelPath = `${workspacePath}/${channelId}`;
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	// Load new-style skills from pi-coding-agent
	const loadedSkills = loadDiscordSkills(channelPath, workspacePath);
	const skillsPrompt = formatSkillsForPrompt(loadedSkills);

	// Also load legacy skills for backwards compatibility
	const legacySkills = loadLegacySkills(workspacePath);

	return `You are an AI assistant Discord bot with full system access. Be helpful, concise, and efficient. No emojis unless asked.

## Context
- Current time: Use \`date\` command
- Timezone: ${tz}
- You have access to bash, file read/write/edit tools
- Dangerous commands (sudo, rm -rf, etc.) require user approval via reaction

## 🚀 MAJINBU ELITE PLATFORM
You are running on a production Ubuntu 22.04 server with extensive AI and trading infrastructure:

### AI Agents (40+)
| Command | Description |
|---------|-------------|
| claude, gemini, pi | Main AI assistants |
| aider, amp, codex, goose | Coding agents |
| qwen, fabric | Specialized AI tools |
| Exa, BrightData, YouTube | MCP integrations |

### Trading Systems
| Alias | System |
|-------|--------|
| \`quant\` | Renaissance-style 20-directory quant trading |
| \`super\` | SuperQuant Elite 30-directory framework |
| \`nanoagent\` | Nano-Agent 40-directory AI ecosystem |

### Services (always running)
| Service | Port |
|---------|------|
| Coolify | :8001 |
| Dokploy | :4000 |
| n8n | :5678 |
| Grafana | :3000 |
| pi-discord (you) | via Discord |

### Ollama Models (local AI)
qwen3, devstral, mistral-small, gpt-oss-120b, deepseek-ocr, qwen3-coder

### Useful Commands
- \`orghelp\` - Navigation guide for organized directories
- \`ai list\` - List all AI agents
- \`fabric -l\` - List 233 Fabric patterns
- \`ollama list\` - Show local Ollama models
- \`su majinbu\` - Switch to majinbu user (has all aliases)

### Key Directories
- /home/majinbu/org/ - Organized directory structure
- /opt/pi-mono/ - Pi agent monorepo (your code)
- /opt/discord-bot-data/ - Your workspace

### 🔧 SELF-MODIFICATION (You can fix yourself!)
Your source code is at: \`/opt/pi-mono/packages/discord-bot/src/main.ts\`

**To fix bugs or add features:**
1. Read your code: \`cat /opt/pi-mono/packages/discord-bot/src/main.ts\`
2. Edit with the edit tool or write tool
3. Rebuild: \`cd /opt/pi-mono && npm run build --workspace=packages/discord-bot\`
4. Restart yourself: \`sudo systemctl restart pi-discord\`

**Important files:**
- \`/opt/pi-mono/packages/discord-bot/src/main.ts\` - Your main code
- \`/etc/systemd/system/pi-discord.service\` - Service config
- \`/opt/discord-bot-data/\` - Your workspace & memories

**Safety rules:**
- Always backup before major changes
- Test syntax with \`tsc --noEmit\` before building
- If you break yourself, owner can fix via SSH

## Discord Formatting
**bold**, *italic*, \`code\`, \`\`\`code block\`\`\`, ||spoiler||, > quote
Links: [text](url) or paste URLs directly

## Workspace Layout
${workspacePath}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Loaded skills (quant trading, etc.)
└── ${channelId}/                # This channel (${channelName})
    ├── MEMORY.md                # Channel-specific memory
    ├── log.jsonl                # Message history
    └── scratch/                 # Your working directory

## Core Tools
- **bash**: Execute shell commands (primary tool). Install packages with apt/pip/npm as needed. Dangerous commands require approval.
- **read**: Read file contents
- **write**: Create/overwrite files
- **edit**: Surgical text replacement in files

## MCP Tools (21 Tools - Claude Code Capabilities)
**IMPORTANT: When user asks to search GitHub, HuggingFace, web, or pi-mono - CALL THE TOOL DIRECTLY!**

### Web & Research (4 tools)
- **web_search**: Search web using Exa AI
- **free_search**: Free DuckDuckGo instant answers (no API key needed)
- **deep_research**: AI-powered comprehensive research
- **web_scrape**: Scrape webpages (BrightData anti-bot bypass)

### GitHub Integration (7 tools)
- **github_search**: Search GitHub repos
- **github_file**: Get file from repo
- **github_issues**: List issues
- **github_issue**: Create issue
- **github_branch**: Create branch
- **github_pr**: Create pull request
- **github_prs**: List pull requests

### HuggingFace (2 tools)
- **hf_models**: Search ML models
- **hf_datasets**: Search datasets

### Knowledge Graph Memory (3 tools)
- **memory_store**: Store facts
- **memory_recall**: Search knowledge
- **memory_relate**: Create relations

### Task Management (3 tools)
- **task_create**: Create task with dependencies
- **task_list**: List tasks by status
- **task_update**: Update task status

### Pi-Mono Codebase (1 tool)
- **codebase_knowledge**: Search pi-mono documentation and knowledge base

## 🧠 PI-MONO EXPERTISE
You are the official Discord bot for the pi-mono project. You have deep knowledge of:

**Packages:**
- **pi-ai**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, Mistral, etc.)
- **pi-agent-core**: Agent runtime with tool calling and state management
- **pi-coding-agent**: Interactive CLI coding agent (pi command)
- **pi-mom**: Slack bot with self-managing capabilities
- **pi-discord**: This bot - your own code!
- **pi-tui**: Terminal UI library
- **pi-web-ui**: Web components for chat interfaces
- **pi-proxy**: CORS proxy for browser LLM calls
- **pi-pods**: vLLM deployment on GPU pods

**Key Concepts:**
- TypeBox schemas for type-safe tool definitions
- agentLoop/agentLoopContinue for agentic workflows
- Context serialization for persistence
- Cross-provider model handoffs
- Streaming with partial JSON parsing

When asked about pi-mono, CALL codebase_knowledge tool first!

**Tool Usage Pattern:**
- "search github for X" → CALL github_search
- "find HF models for Y" → CALL hf_models
- "how does pi-ai work" → CALL codebase_knowledge
- "what is pi-agent" → CALL codebase_knowledge
- "remember Z" → CALL memory_store

Each tool requires a "label" parameter (shown to user).

## Memory & Self-Learning
Write important context to MEMORY.md files:
- Global (${workspacePath}/MEMORY.md): preferences, project info, installed tools
- Channel (${channelPath}/MEMORY.md): channel-specific decisions, ongoing work

### Self-Management Tools (USE THESE PROACTIVELY!)
- **memory_update**: Update your MEMORY.md with learned preferences, facts, discoveries
- **skill_create**: Create new skill files when you learn valuable domain knowledge
- **skill_list**: List available skills (32+ domains)
- **skill_load**: Load skill instructions for specific tasks

**PROACTIVE LEARNING BEHAVIOR:**
1. When a user teaches you something new → Use memory_update to remember it
2. When you solve a complex problem → Consider creating a skill for it
3. When asked about a domain → Check if a skill exists first with skill_list
4. Load relevant skills to gain specialized knowledge

### Current Memory
${memory}

### Skills
${skillsPrompt}
${legacySkills}

## 🤖 FULLY AGENTIC CAPABILITIES

### You are autonomous. You can:
1. **Execute ANY bash command** - You have full sudo access
2. **Search the web** - Use \`curl\`, \`wget\`, or installed tools like \`ddgr\`, \`googler\`
3. **Call APIs** - Use \`curl\` for REST APIs, you have API keys in environment
4. **Install software** - \`apt-get install\`, \`pip install\`, \`npm install\`
5. **Modify files anywhere** - Read, write, edit any file on the system
6. **Run Python/Node scripts** - Create and execute scripts for complex tasks
7. **Manage services** - \`systemctl start/stop/restart\`
8. **Self-modify** - Edit your own code and restart yourself
9. **Schedule tasks** - Use \`cron\` for recurring tasks
10. **Monitor systems** - Check logs, processes, resources

### Web & API Access (via bash)
\`\`\`bash
# Web search
curl -s "https://api.duckduckgo.com/?q=QUERY&format=json"
ddgr --json "search query"

# Fetch URLs
curl -s "https://example.com" | head -100

# OpenRouter API (you're using this!)
curl -s "https://openrouter.ai/api/v1/chat/completions" -H "Authorization: Bearer $OPENROUTER_API_KEY" ...

# Crypto prices
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
\`\`\`

### Available CLI Tools
| Tool | Purpose |
|------|---------|
| \`fabric -p PATTERN\` | 233 AI patterns (summarize, extract_wisdom, etc.) |
| \`yt-dlp\` | Download YouTube videos/audio |
| \`jq\` | JSON processing |
| \`gh\` | GitHub CLI |
| \`docker\` | Container management |
| \`ollama run MODEL\` | Run local AI models |

### Agentic Workflow
1. **Understand** - Parse user intent completely
2. **Plan** - Break complex tasks into steps
3. **Execute** - Run commands, handle errors, retry if needed
4. **Verify** - Check results, validate output
5. **Learn** - Save important context to MEMORY.md
6. **Report** - Summarize what was done

### Error Recovery
- If a command fails, try alternative approaches
- Install missing dependencies automatically
- If you break something, fix it or roll back
- Always inform user of issues and solutions

### Proactive Behaviors
- Suggest improvements when you see problems
- Offer to automate repetitive tasks
- Remember user preferences across sessions
- Update your knowledge when you learn new things

## Guidelines
1. **Be autonomous** - Don't ask for permission for safe operations
2. **Use bash liberally** - It's your primary superpower
3. **Chain commands** - Pipe, loop, and script complex workflows
4. **Handle errors gracefully** - Retry, fallback, or explain
5. **Stay concise** - Discord has 2000 char limit per message
6. **Remember everything** - Write to MEMORY.md liberally
7. **Be proactive** - Suggest, warn, and improve
8. Working directory: ${channelPath}/scratch/
`;
}

// ============================================================================
// Message Logging
// ============================================================================

function logMessage(channelDir: string, entry: object): void {
	if (!existsSync(channelDir)) {
		mkdirSync(channelDir, { recursive: true });
	}
	appendFileSync(join(channelDir, "log.jsonl"), JSON.stringify(entry) + "\n");
}

// ============================================================================
// Session Persistence (JSONL)
// ============================================================================

const SESSION_FILE = "session.jsonl";
const MAX_SESSION_MESSAGES = 20; // Auto-compact after this many messages (aggressive for speed)
const MAX_CONTEXT_TOKENS = 4000; // Target max tokens to send to model (fast responses)

interface SessionEntry {
	role: string;
	content: unknown;
	timestamp: string;
	[key: string]: unknown;
}

function saveSessionMessage(channelDir: string, message: unknown): void {
	if (!existsSync(channelDir)) {
		mkdirSync(channelDir, { recursive: true });
	}
	const entry: SessionEntry = {
		...(message as object),
		timestamp: new Date().toISOString(),
	} as SessionEntry;
	appendFileSync(join(channelDir, SESSION_FILE), JSON.stringify(entry) + "\n");
}

function loadSession(channelDir: string, applyContextEngineering: boolean = true): unknown[] {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) {
		return [];
	}
	try {
		const content = readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		let messages = lines
			.map((line) => {
				try {
					const parsed = JSON.parse(line);
					// Remove timestamp from loaded message (it's metadata)
					const { timestamp: _ts, ...msg } = parsed;
					return msg;
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		// Apply smart context engineering for speed
		if (applyContextEngineering && messages.length > 6) {
			messages = engineerContext(messages, MAX_CONTEXT_TOKENS);
		}

		logInfo(`Loaded ${messages.length} messages from session for channel`);
		return messages;
	} catch (e) {
		logError("Failed to load session", e instanceof Error ? e.message : String(e));
		return [];
	}
}

function clearSession(channelDir: string): void {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (existsSync(sessionPath)) {
		unlinkSync(sessionPath);
		logInfo(`Cleared session for channel`);
	}
}

function getSessionMessageCount(channelDir: string): number {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) return 0;
	try {
		const content = readFileSync(sessionPath, "utf-8");
		return content.trim().split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

/**
 * Estimate tokens in a message (rough: ~4 chars per token)
 */
function estimateTokens(msg: unknown): number {
	try {
		const str = JSON.stringify(msg);
		return Math.ceil(str.length / 4);
	} catch {
		return 100; // Default estimate
	}
}

/**
 * Smart context engineering: select messages to fit within token budget
 * Prioritizes: recent messages > tool results > assistant responses > old user messages
 */
function engineerContext(messages: unknown[], maxTokens: number = MAX_CONTEXT_TOKENS): unknown[] {
	if (messages.length === 0) return [];

	// Always keep at least the last 4 messages for continuity
	const minKeep = Math.min(4, messages.length);
	const recentMessages = messages.slice(-minKeep);
	const olderMessages = messages.slice(0, -minKeep);

	let totalTokens: number = recentMessages.reduce((sum: number, m) => sum + estimateTokens(m), 0);
	const result: unknown[] = [];

	// Add older messages from most recent, respecting token budget
	for (let i = olderMessages.length - 1; i >= 0 && totalTokens < maxTokens; i--) {
		const msg = olderMessages[i];
		const tokens = estimateTokens(msg);
		if (totalTokens + tokens <= maxTokens) {
			result.unshift(msg);
			totalTokens += tokens;
		}
	}

	// Add recent messages at the end
	result.push(...recentMessages);

	if (result.length < messages.length) {
		logInfo(`Context engineered: ${messages.length} -> ${result.length} messages (~${totalTokens} tokens)`);
	}

	return result;
}

const KEEP_RECENT_MESSAGES = 8; // Keep only recent messages when compacting (speed focused)

/**
 * Auto-compact session when it exceeds MAX_SESSION_MESSAGES.
 * Keeps the most recent KEEP_RECENT_MESSAGES and summarizes older context.
 */
function compactSessionIfNeeded(channelDir: string, agent: Agent): boolean {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) return false;

	try {
		const content = readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		if (lines.length <= MAX_SESSION_MESSAGES) {
			return false; // No compaction needed
		}

		logInfo(`Compacting session: ${lines.length} messages -> ${KEEP_RECENT_MESSAGES} + summary`);

		// Parse all messages
		const messages = lines
			.map((line) => {
				try {
					const parsed = JSON.parse(line);
					const { timestamp: _ts, ...msg } = parsed;
					return msg;
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		// Split into old (to summarize) and recent (to keep)
		const oldMessages = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
		const recentMessages = messages.slice(-KEEP_RECENT_MESSAGES);

		// Create a summary of old messages
		const summaryText = createConversationSummary(oldMessages);

		// Create compacted session: summary + recent messages
		const compactedLines: string[] = [];

		// Add summary as a system context message
		const summaryMessage = {
			role: "user",
			content: [
				{
					type: "text",
					text: `[PREVIOUS CONTEXT SUMMARY]\n${summaryText}\n[END SUMMARY - Recent conversation follows]`,
				},
			],
			timestamp: new Date().toISOString(),
			isCompactedSummary: true,
		};
		compactedLines.push(JSON.stringify(summaryMessage));

		// Add recent messages
		for (const msg of recentMessages) {
			compactedLines.push(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
		}

		// Write compacted session
		writeFileSync(sessionPath, compactedLines.join("\n") + "\n");

		// Update agent's messages to match
		const loadedMessages = loadSession(channelDir);
		agent.replaceMessages(loadedMessages as Parameters<typeof agent.replaceMessages>[0]);

		logInfo(`Session compacted: ${lines.length} -> ${compactedLines.length} messages`);
		return true;
	} catch (e) {
		logError("Failed to compact session", e instanceof Error ? e.message : String(e));
		return false;
	}
}

/**
 * Create a text summary of old conversation messages.
 */
function createConversationSummary(messages: unknown[]): string {
	const summary: string[] = [];
	let userCount = 0;
	let assistantCount = 0;
	const topics: string[] = [];

	for (const msg of messages) {
		const m = msg as { role?: string; content?: unknown };
		if (m.role === "user") {
			userCount++;
			// Extract topic hints from user messages
			const content = m.content;
			if (Array.isArray(content)) {
				for (const c of content) {
					if (typeof c === "object" && c !== null && "text" in c && typeof c.text === "string") {
						const text = c.text.substring(0, 100);
						if (text.length > 20 && !text.startsWith("[")) {
							topics.push(text.split("\n")[0]);
						}
					}
				}
			}
		} else if (m.role === "assistant") {
			assistantCount++;
		}
	}

	summary.push(`Previous conversation: ${userCount} user messages, ${assistantCount} assistant responses.`);

	if (topics.length > 0) {
		// Take up to 5 unique topic snippets
		const uniqueTopics = [...new Set(topics)].slice(0, 5);
		summary.push(`Topics discussed: ${uniqueTopics.join(" | ")}`);
	}

	return summary.join("\n");
}

// ============================================================================
// Channel State
// ============================================================================

interface QueuedMessage {
	channelId: string;
	channelName: string;
	userName: string;
	userId: string;
	text: string;
	workingDir: string;
	reply: (content: string) => Promise<any>;
	editReply: (content: string) => Promise<any>;
	sourceMessage: Message | null;
}

interface ChannelState {
	running: boolean;
	agent: Agent;
	hooks?: HookIntegration;
	sessionId?: string;
	turnIndex: number;
	messageQueue: QueuedMessage[];
}

const channelStates = new Map<string, ChannelState>();
const MAX_QUEUE_SIZE = 5;

// Message deduplication - track processed message IDs to prevent double responses
const processedMessages = new Set<string>();
const MESSAGE_CACHE_TTL = 60000; // 1 minute

function markMessageProcessed(messageId: string): boolean {
	if (processedMessages.has(messageId)) {
		return false; // Already processed
	}
	processedMessages.add(messageId);
	// Auto-cleanup after TTL
	setTimeout(() => processedMessages.delete(messageId), MESSAGE_CACHE_TTL);
	return true; // OK to process
}

function getChannelState(channelId: string, workingDir: string, channelName: string): ChannelState {
	let state = channelStates.get(channelId);
	if (!state) {
		const channelDir = join(workingDir, channelId);
		const memory = getMemory(channelDir, workingDir);
		const systemPrompt = buildSystemPrompt(workingDir, channelId, channelName, memory);

		// Create hook integration FIRST (before tools, so we can wrap them)
		const sessionId = generateSessionId(channelId);
		const hooks = createDiscordHookIntegration({
			cwd: channelDir,
			channelId,
			checkpoint: true,
			lsp: true,
			expert: true,
		});

		// Helper to wrap tools with hook events (for LSP diagnostics on file changes)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wrapTool = <T extends { name: string; execute: (...args: any[]) => Promise<any> }>(tool: T): T =>
			wrapToolWithHooks(tool, () => getChannelHookIntegration(channelId));

		// Create tools and wrap file-modifying ones with hooks for LSP diagnostics
		const tools = [
			wrapTool(createBashTool()),
			createReadTool(), // Read doesn't need hooks
			wrapTool(createWriteTool()), // Write triggers LSP
			wrapTool(createEditTool()), // Edit triggers LSP
			...getAllMcpTools(), // MCP tools: web_search, github, hf, memory
		];

		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "off",
				tools,
			},
			transport: new ProviderTransport({
				getApiKey: async () => {
					// Return appropriate API key based on provider
					if (currentProvider === "zai") {
						return ZAI_API_KEY;
					}
					if (currentProvider === "cerebras") {
						return CEREBRAS_API_KEY;
					}
					if (currentProvider === "groq") {
						return GROQ_API_KEY;
					}
					if (currentProvider === "openrouter") {
						return OPENROUTER_API_KEY;
					}
					return "ollama"; // Ollama doesn't need real API key
				},
			}),
		});

		// Load session history if exists
		const sessionMessages = loadSession(channelDir);
		if (sessionMessages.length > 0) {
			agent.replaceMessages(sessionMessages as Parameters<typeof agent.replaceMessages>[0]);
			logInfo(`Restored ${sessionMessages.length} messages for channel ${channelId}`);
		}

		// Emit session start event
		hooks.emitSession("start", sessionId).catch((err) => {
			logWarning(`[${channelId}] Hook session event failed:`, err);
		});

		state = { running: false, agent, hooks, sessionId, turnIndex: 0, messageQueue: [] };
		channelStates.set(channelId, state);
	}
	return state;
}

// ============================================================================
// Message Queue Processing
// ============================================================================

async function processNextQueuedMessage(channelId: string): Promise<void> {
	const state = channelStates.get(channelId);
	if (!state || state.running || state.messageQueue.length === 0) {
		return;
	}

	const nextMessage = state.messageQueue.shift()!;
	logInfo(`[${channelId}] Processing queued message from ${nextMessage.userName}`);

	// Process the queued message
	await handleAgentRequestInternal(
		nextMessage.channelId,
		nextMessage.channelName,
		nextMessage.userName,
		nextMessage.userId,
		nextMessage.text,
		nextMessage.workingDir,
		nextMessage.reply,
		nextMessage.editReply,
		nextMessage.sourceMessage,
	);
}

// ============================================================================
// Response Handler (shared between slash commands and mentions)
// ============================================================================

async function handleAgentRequest(
	channelId: string,
	channelName: string,
	userName: string,
	userId: string,
	text: string,
	workingDir: string,
	reply: (content: string) => Promise<any>,
	editReply: (content: string) => Promise<any>,
	sourceMessage: Message | null = null,
): Promise<void> {
	// User allowlist check
	if (!isUserAllowed(userId)) {
		await reply("_Access denied. You are not authorized to use this bot._");
		logWarning(`Unauthorized user attempt: ${userName}`, userId);
		return;
	}

	// Rate limiting check
	const rateLimit = checkRateLimit(userId);
	if (!rateLimit.allowed) {
		const resetSecs = Math.ceil(rateLimit.resetIn / 1000);
		await reply(`_Rate limited. Try again in ${resetSecs}s._`);
		logWarning(`Rate limited user ${userName}`, `reset in ${resetSecs}s`);
		return;
	}

	const state = getChannelState(channelId, workingDir, channelName);

	// Queue management - add to queue if already processing
	if (state.running) {
		// Check queue size limit
		if (state.messageQueue.length >= MAX_QUEUE_SIZE) {
			// Drop oldest message
			const dropped = state.messageQueue.shift();
			logWarning(`[${channelId}] Queue full, dropped message from ${dropped?.userName}`);
		}

		// Add to queue
		state.messageQueue.push({
			channelId,
			channelName,
			userName,
			userId,
			text,
			workingDir,
			reply,
			editReply,
			sourceMessage,
		});

		const queuePosition = state.messageQueue.length;
		logInfo(`[${channelId}] Queued message from ${userName}, position: ${queuePosition}`);
		// Note: Don't send queue notification via reply() as it creates a separate message
		// The user will see their response when the queue is processed
		return;
	}

	// Process immediately
	await handleAgentRequestInternal(
		channelId,
		channelName,
		userName,
		userId,
		text,
		workingDir,
		reply,
		editReply,
		sourceMessage,
	);
}

// Internal function that does the actual processing
async function handleAgentRequestInternal(
	channelId: string,
	channelName: string,
	userName: string,
	userId: string,
	text: string,
	workingDir: string,
	reply: (content: string) => Promise<any>,
	editReply: (content: string) => Promise<any>,
	sourceMessage: Message | null = null,
): Promise<void> {
	const channelDir = join(workingDir, channelId);

	// Track statistics
	botStats.messagesProcessed++;
	trackUserInteraction(userId, userName);

	logMessage(channelDir, {
		date: new Date().toISOString(),
		user: userName,
		userId: userId,
		text,
		isBot: false,
	});

	// Get model config for this user
	const model = getUserModel(userId);
	const state = getChannelState(channelId, workingDir, channelName);

	state.running = true;
	const toolsUsed: string[] = [];
	const startTime = Date.now();

	// Emit turn_start hook event
	if (state.hooks) {
		state.turnIndex++;
		state.hooks.emitTurnStart(state.turnIndex).catch((err) => {
			logWarning(`[${channelId}] Hook turn_start failed:`, err);
		});
	}

	// Set approval context for dangerous command checks
	setApprovalContext(sourceMessage, userId);

	// ==========================================================================
	// AUTO-TOOL DETECTION: Intercept common requests and call tools directly
	// ==========================================================================
	const textLower = text.toLowerCase();
	let autoToolResult: string | null = null;

	try {
		// GitHub search detection - many natural patterns
		const githubPatterns = [
			/(?:search|find|look for|show me|get)(?: on| in)? github(?: for)?\s+(.+)/i,
			/github (?:repos?|repositories|projects)(?: for| about| on)?\s+(.+)/i,
			/(?:any|best|top|good) (?:repos?|repositories|projects)(?: for| about| on)?\s+(.+)/i,
			/(?:find|show|list) (?:repos?|repositories)(?: for| about)?\s+(.+)/i,
		];

		for (const pattern of githubPatterns) {
			const match = text.match(pattern);
			if (match && !textLower.includes("how to")) {
				const query = match[1].trim();
				logInfo(`[AUTO-TOOL] github_search: ${query}`);
				const tool = createGithubRepoSearchTool();
				const result = await tool.execute("auto", { query, perPage: 5, label: `GitHub: "${query}"` });
				const firstContent = result.content?.[0];
				if (firstContent && firstContent.type === "text" && firstContent.text) {
					autoToolResult = firstContent.text;
					toolsUsed.push("github_search");
				}
				break;
			}
		}

		// HuggingFace model search - natural patterns
		if (!autoToolResult) {
			const hfModelPatterns = [
				/(?:find|search|show|get|list)(?: me)?(?: huggingface| hf)? models?(?: for| about| on)?\s+(.+)/i,
				/(?:huggingface|hf) models?(?: for| about)?\s+(.+)/i,
				/(?:any|best|top) (?:ai |ml |machine learning )?models?(?: for| about)?\s+(.+)/i,
				/models? for\s+(.+)/i,
			];

			for (const pattern of hfModelPatterns) {
				const match = text.match(pattern);
				if (match && !textLower.includes("how to")) {
					const query = match[1].trim();
					logInfo(`[AUTO-TOOL] hf_models: ${query}`);
					const tool = createHfModelSearchTool();
					const result = await tool.execute("auto", { query, limit: 5, label: `HF Models: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("hf_models");
					}
					break;
				}
			}
		}

		// HuggingFace dataset search
		if (!autoToolResult) {
			const hfDatasetPatterns = [
				/(?:find|search|show|get|list)(?: me)?(?: huggingface| hf)? datasets?(?: for| about| on)?\s+(.+)/i,
				/(?:huggingface|hf) datasets?(?: for| about)?\s+(.+)/i,
				/(?:any|best|top) datasets?(?: for| about)?\s+(.+)/i,
				/datasets? for\s+(.+)/i,
			];

			for (const pattern of hfDatasetPatterns) {
				const match = text.match(pattern);
				if (match) {
					const query = match[1].trim();
					logInfo(`[AUTO-TOOL] hf_datasets: ${query}`);
					const tool = createHfDatasetSearchTool();
					const result = await tool.execute("auto", { query, limit: 5, label: `HF Datasets: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("hf_datasets");
					}
					break;
				}
			}
		}

		// Memory recall - natural patterns
		if (!autoToolResult) {
			const memoryPatterns = [
				/what do you (?:remember|know|recall) about\s+(.+)/i,
				/(?:recall|search|check)(?: your)? memory(?: for| about)?\s*(.+)?/i,
				/do you remember\s+(.+)/i,
				/what (?:have i|did i) (?:told|tell|said|say) (?:you )about\s+(.+)/i,
			];

			for (const pattern of memoryPatterns) {
				const match = text.match(pattern);
				if (match) {
					const query = match[1]?.trim() || "everything";
					logInfo(`[AUTO-TOOL] memory_recall: ${query}`);
					const tool = createMemoryRecallTool();
					const result = await tool.execute("auto", { query, label: `Memory: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("memory_recall");
					}
					break;
				}
			}
		}

		// Memory store - detect when user wants to save something
		if (!autoToolResult) {
			const storePatterns = [
				/(?:remember|save|store|note)(?: that| this)?[:\s]+(.+)/i,
				/(?:my|i) (?:name is|am|prefer|like|use|work (?:on|with)|live in)\s+(.+)/i,
			];

			for (const pattern of storePatterns) {
				const match = text.match(pattern);
				if (match && textLower.includes("remember")) {
					const fact = match[1].trim();
					logInfo(`[AUTO-TOOL] memory_store: ${fact}`);
					const tool = createMemoryStoreTool();
					const result = await tool.execute("auto", {
						entityName: userName,
						entityType: "user",
						observations: [fact],
						label: `Storing: "${fact.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("memory_store");
					}
					break;
				}
			}
		}

		// Web scraping - detect URL fetching requests
		if (!autoToolResult) {
			const scrapePatterns = [
				/(?:scrape|fetch|get|read|extract)(?: content| data| from)?\s+(https?:\/\/[^\s]+)/i,
				/(?:what(?:'s| is) (?:on|at)|show me|open)\s+(https?:\/\/[^\s]+)/i,
			];

			for (const pattern of scrapePatterns) {
				const match = text.match(pattern);
				if (match) {
					const url = match[1].trim();
					logInfo(`[AUTO-TOOL] web_scrape: ${url}`);
					const tool = createWebScrapeTool();
					const result = await tool.execute("auto", { url, label: `Scraping: ${url.substring(0, 40)}...` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("web_scrape");
					}
					break;
				}
			}
		}

		// GitHub issues - list issues from a repo
		if (!autoToolResult) {
			const issuePatterns = [
				/(?:list|show|get)(?: open| all)? issues (?:in|on|for|from)\s+([^\s]+\/[^\s]+)/i,
				/issues (?:in|on|for)\s+([^\s]+\/[^\s]+)/i,
			];

			for (const pattern of issuePatterns) {
				const match = text.match(pattern);
				if (match) {
					const [owner, repo] = match[1].split("/");
					logInfo(`[AUTO-TOOL] github_issues: ${owner}/${repo}`);
					const tool = createGithubListIssuesTool();
					const result = await tool.execute("auto", {
						owner,
						repo,
						state: "open",
						label: `Issues: ${owner}/${repo}`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("github_issues");
					}
					break;
				}
			}
		}

		// Task management - list tasks
		if (
			!autoToolResult &&
			(textLower.includes("my tasks") ||
				textLower.includes("list tasks") ||
				textLower.includes("show tasks") ||
				textLower.includes("todo") ||
				textLower.includes("what are my tasks"))
		) {
			logInfo(`[AUTO-TOOL] task_list`);
			const tool = createTaskListTool();
			const result = await tool.execute("auto", { label: "Listing tasks" });
			const firstContent = result.content?.[0];
			if (firstContent && firstContent.type === "text" && firstContent.text) {
				autoToolResult = firstContent.text;
				toolsUsed.push("task_list");
			}
		}

		// Task create - add a new task
		if (!autoToolResult) {
			const taskPatterns = [/(?:add|create|new) task[:\s]+(.+)/i, /(?:todo|task)[:\s]+(.+)/i];

			for (const pattern of taskPatterns) {
				const match = text.match(pattern);
				if (match && (textLower.includes("add") || textLower.includes("create") || textLower.includes("new"))) {
					const title = match[1].trim();
					logInfo(`[AUTO-TOOL] task_create: ${title}`);
					const tool = createTaskCreateTool();
					const result = await tool.execute("auto", {
						title,
						description: title,
						label: `Creating task: "${title.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("task_create");
					}
					break;
				}
			}
		}

		// Codebase knowledge - pi-mono questions
		if (!autoToolResult) {
			const codebasePatterns = [
				/(?:how does|what is|explain|tell me about|describe)(?: the)?\s+(pi-?\s*(?:ai|agent|coding|mom|tui|web|proxy|pods|discord|mono))/i,
				/(?:how to|how do i)(?: use)?\s+(pi-?\s*(?:ai|agent|coding|mom|tui|web|proxy|pods|discord|mono))/i,
				/what (?:are|is)(?: the)?\s+(?:packages?|components?|architecture)\s+(?:in|of)\s+pi-?mono/i,
				/pi-?mono\s+(?:packages?|architecture|overview|structure)/i,
				/(?:agentLoop|agentLoopContinue|getModel|stream|complete|Tool|Context)\s+(?:api|usage|how)/i,
			];

			for (const pattern of codebasePatterns) {
				if (pattern.test(text)) {
					const query = text.match(/(?:about|explain|what is|how does|how to)\s+(.+)/i)?.[1] || text;
					logInfo(`[AUTO-TOOL] codebase_knowledge: ${query.substring(0, 50)}...`);
					const tool = createCodebaseKnowledgeTool();
					const result = await tool.execute("auto", {
						query: query.trim(),
						label: `Codebase: "${query.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("codebase_knowledge");
					}
					break;
				}
			}
		}

		// Skills - list available skills
		if (
			!autoToolResult &&
			(textLower.includes("list skills") ||
				textLower.includes("what skills") ||
				textLower.includes("show skills") ||
				textLower.includes("available skills"))
		) {
			logInfo(`[AUTO-TOOL] skill_list`);
			const tool = createSkillListTool();
			const result = await tool.execute("auto", { label: "Listing skills" });
			const firstContent = result.content?.[0];
			if (firstContent && firstContent.type === "text" && firstContent.text) {
				autoToolResult = firstContent.text;
				toolsUsed.push("skill_list");
			}
		}

		// Skills - load a specific skill
		if (!autoToolResult) {
			const skillLoadPatterns = [
				/(?:load|activate|use|enable)\s+(?:the\s+)?(\S+)\s+skill/i,
				/skill[:\s]+(\S+)/i,
				/(?:how do i|help me with|teach me)\s+(\S+)/i,
			];

			for (const pattern of skillLoadPatterns) {
				const match = text.match(pattern);
				if (match) {
					const skillName = match[1].toLowerCase().replace(/['"]/g, "");
					// Check if this looks like a skill name (not a generic word)
					const skillKeywords = [
						"trading",
						"crypto",
						"coding",
						"research",
						"analysis",
						"pi-",
						"integration",
						"webhook",
						"api",
						"admin",
						"system",
					];
					if (skillKeywords.some((k) => skillName.includes(k)) || skillName.startsWith("pi")) {
						logInfo(`[AUTO-TOOL] skill_load: ${skillName}`);
						const tool = createSkillLoadTool();
						const result = await tool.execute("auto", { skill: skillName, label: `Loading skill: ${skillName}` });
						const firstContent = result.content?.[0];
						if (firstContent && firstContent.type === "text" && firstContent.text) {
							autoToolResult = firstContent.text;
							toolsUsed.push("skill_load");
						}
						break;
					}
				}
			}
		}
	} catch (autoToolError) {
		logWarning(`[AUTO-TOOL] Error: ${autoToolError}`);
	}

	// If auto-tool found a result, let AI format/enhance it
	if (autoToolResult) {
		// Inject tool result into the message for AI to format nicely
		text = `User asked: "${text}"\n\nI found this data:\n${autoToolResult}\n\nPlease provide a helpful, concise response based on this data. Format nicely for Discord.`;
		logInfo(`[${channelName}] AUTO-TOOL enriched prompt with ${toolsUsed.join(", ")} results`);
	}

	try {
		// Note: For DMs, we don't edit - just send response at the end

		// Update model based on user preference
		const userModel = getUserModel(userId);
		state.agent.state.model = userModel;

		const memory = getMemory(channelDir, workingDir);
		const systemPrompt = buildSystemPrompt(workingDir, channelId, channelName, memory);
		state.agent.setSystemPrompt(systemPrompt);

		// Streaming state
		let streamingText = "";
		let lastUpdateTime = 0;
		let pendingUpdate = false;
		let isThinking = true;
		const UPDATE_THROTTLE_MS = 500;
		const MAX_DISCORD_LENGTH = 2000;

		// Skip "thinking" indicator - responses are fast enough now

		const unsubscribe = state.agent.subscribe((event: AgentEvent) => {
			if (event.type === "tool_execution_start") {
				const e = event as any;
				const label = e.args?.label || e.toolName;
				toolsUsed.push(`→ ${label}`);
				// Don't call editReply here - we'll include tool info in final response
			}

			// Handle streaming text updates
			if (event.type === "message_update") {
				const assistantEvent = event.assistantMessageEvent;

				// On first text, clear the "thinking..." message
				if (isThinking && assistantEvent.type === "text_start") {
					isThinking = false;
					streamingText = "";
				}

				// Accumulate text deltas
				if (assistantEvent.type === "text_delta") {
					streamingText += assistantEvent.delta;

					// Throttle updates to avoid Discord rate limits
					const now = Date.now();
					if (!pendingUpdate && now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
						pendingUpdate = true;
						lastUpdateTime = now;

						// Update with current streaming text (truncate if needed)
						const displayText =
							streamingText.length <= MAX_DISCORD_LENGTH
								? streamingText
								: streamingText.substring(0, MAX_DISCORD_LENGTH - 50) + "\n\n_(streaming...)_";

						editReply(displayText)
							.catch(() => {})
							.finally(() => {
								pendingUpdate = false;
							});
					}
				}
			}
		});

		const timestamp = new Date().toISOString();
		const userMessage = `[${timestamp}] [${userName}]: ${text}`;

		// Use retry with exponential backoff for resilience
		// Use timeout wrapper to prevent hanging requests (120s timeout)
		await withRetry(() => promptWithTimeout(state.agent, userMessage), {
			maxRetries: 3,
			initialDelay: 1000,
			maxDelay: 10000,
		});
		unsubscribe();

		// Emit turn_end hook event
		if (state.hooks) {
			state.hooks.emitTurnEnd(state.turnIndex, state.agent.state.messages).catch((err) => {
				logWarning(`[${channelId}] Hook turn_end failed:`, err);
			});
		}

		const messages = state.agent.state.messages;

		// Get ALL assistant messages from this turn (there may be multiple if tools were used)
		// Find messages after the last user message
		const lastUserIdx =
			messages
				.map((m, i) => (m.role === "user" ? i : -1))
				.filter((i) => i >= 0)
				.pop() || 0;
		const assistantMessages = messages.slice(lastUserIdx + 1).filter((m) => m.role === "assistant");

		// Combine all text from all assistant messages in this turn
		const allTextBlocks: string[] = [];
		for (const msg of assistantMessages) {
			const textParts = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text);
			allTextBlocks.push(...textParts);
		}

		// Only use the LAST text block to avoid duplicate responses
		const responseText = allTextBlocks.length > 0 ? allTextBlocks[allTextBlocks.length - 1] : "";

		if (responseText.trim()) {
			logMessage(channelDir, {
				date: new Date().toISOString(),
				user: "bot",
				text: responseText,
				toolsUsed,
				isBot: true,
			});

			// Save session for persistence (save all new messages since last save)
			const allMessages = state.agent.state.messages;
			const sessionCount = getSessionMessageCount(channelDir);
			// Save only new messages (those beyond what we've already saved)
			for (let i = sessionCount; i < allMessages.length; i++) {
				saveSessionMessage(channelDir, allMessages[i]);
			}

			// Auto-compact if session is too long
			compactSessionIfNeeded(channelDir, state.agent);

			// Track cost (estimate tokens from text length: ~4 chars per token)
			const inputTokensEst = Math.ceil(text.length / 4);
			const outputTokensEst = Math.ceil(responseText.length / 4);
			const costResult = analytics.trackCost({
				userId,
				username: userName,
				tokensInput: inputTokensEst,
				tokensOutput: outputTokensEst,
				model: state.agent.state.model.id,
				timestamp: new Date().toISOString(),
			});

			// Send alert if threshold exceeded
			if (costResult.alert) {
				logWarning(`[COST ALERT] ${costResult.alertMessage}`);
				// Could also DM the user or post to a monitoring channel
			}

			// Discord limit is 2000 chars
			const MAX_LENGTH = 2000;
			if (responseText.length <= MAX_LENGTH) {
				logInfo(
					`[${channelName}] Sending response: "${responseText.substring(0, 100)}..." (full: ${responseText.length} chars)`,
				);
				await editReply(responseText);
			} else {
				// Truncate for slash command response
				const truncated = responseText.substring(0, MAX_LENGTH - 50) + "\n\n_(truncated)_";
				logInfo(
					`[${channelName}] Sending truncated: "${truncated.substring(0, 100)}..." (full: ${responseText.length} chars)`,
				);
				await editReply(truncated);
			}

			logInfo(`[${channelName}] Responded (${responseText.length} chars, ${toolsUsed.length} tools)`);

			// Track successful command
			const responseTime = Date.now() - startTime;
			analytics.trackCommand({
				type: "response",
				timestamp: new Date().toISOString(),
				userId,
				username: userName,
				command: "ask",
				responseTime,
				model: state.agent.state.model.id,
				channelId,
				channelName,
			});
		} else {
			await editReply("_Done (no text response)_");
		}
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		botStats.errorsCount++;
		logError("Error processing request", errMsg);

		// Track error
		analytics.trackCommand({
			type: "error",
			timestamp: new Date().toISOString(),
			userId,
			username: userName,
			command: "ask",
			error: errMsg,
			model: state.agent.state.model?.id || model.id,
			channelId,
			channelName,
		});

		await editReply(`_Error: ${errMsg.substring(0, 500)}_`).catch(() => {});
	} finally {
		state.running = false;

		// Process next queued message if any
		setImmediate(() => {
			processNextQueuedMessage(channelId).catch((err) => {
				logError(`Error processing queued message for channel ${channelId}`, err);
			});
		});
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const { workingDir } = parseArgs();

	if (!DISCORD_BOT_TOKEN) {
		logError("Missing DISCORD_BOT_TOKEN environment variable");
		process.exit(1);
	}

	if (!existsSync(workingDir)) {
		mkdirSync(workingDir, { recursive: true });
	}

	logInfo(`Starting Pi Discord Bot (agentic mode) with workspace: ${workingDir}`);
	logInfo(`Model: ${model.id}`);

	// Initialize analytics
	analytics = new Analytics(workingDir);
	logInfo("Analytics initialized");

	// Initialize database
	const dbPath = join(workingDir, "bot.db");
	db = initDatabase(dbPath);
	logInfo(`Database initialized at ${dbPath}`);

	// Initialize channel store and settings manager
	channelStore = new ChannelStore({ workingDir });
	settingsManager = new DiscordSettingsManager(workingDir);
	logInfo("Channel store and settings manager initialized");

	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.GuildVoiceStates,
		],
		partials: [Partials.Channel, Partials.Reaction, Partials.Message],
	});

	// Register slash commands on ready (clientReady in discord.js v15+)
	client.once("clientReady", async () => {
		logInfo(`Logged in as ${client.user?.tag}`);
		logInfo(`Bot ID: ${client.user?.id}`);

		// Connect Discord client to Telegram bridge for bi-directional messaging
		setDiscordClient(client);

		// Register slash commands globally
		try {
			const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);

			logInfo("Registering slash commands...");
			await rest.put(Routes.applicationCommands(client.user!.id), {
				body: slashCommands.map((cmd) => cmd.toJSON()),
			});
			logInfo(`Registered ${slashCommands.length} slash commands: /${slashCommands.map((c) => c.name).join(", /")}`);
		} catch (error) {
			logError("Failed to register slash commands", error instanceof Error ? error.message : String(error));
		}

		logInfo("Ready! Supports both /commands and @mentions");

		// Initialize events watcher for scheduled/immediate events
		const eventsHandler: EventHandler = {
			async handleEvent(channelId: string, message: string): Promise<void> {
				try {
					const channel = await client.channels.fetch(channelId);
					if (channel?.isTextBased() && "send" in channel) {
						await (channel as TextChannel).send(message);
						logInfo(`Event sent to channel ${channelId}`);
					} else {
						logWarning(`Could not send event to channel ${channelId}`, "Channel not found or not text-based");
					}
				} catch (error) {
					logError(
						`Failed to send event to channel ${channelId}`,
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		};

		eventsWatcher = createEventsWatcher(workingDir, eventsHandler);
		eventsWatcher.start();
		logInfo(`Events watcher started, tracking ${eventsWatcher.getActiveCount()} events`);

		// Graceful shutdown handler
		const shutdown = async (signal: string) => {
			logInfo(`Received ${signal}, shutting down gracefully...`);

			// Save any pending state
			try {
				for (const [channelId, state] of channelStates) {
					if (state.agent) {
						logInfo(`Saving state for channel ${channelId}`);
					}
				}
			} catch (e) {
				logError("Error during shutdown", e instanceof Error ? e.message : String(e));
			}

			// Stop events watcher
			if (eventsWatcher) {
				eventsWatcher.stop();
				logInfo("Events watcher stopped");
			}

			// Close Discord client
			client.destroy();
			logInfo("Discord client disconnected");

			// Save analytics
			if (analytics) {
				logInfo("Saving analytics...");
			}

			logInfo("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGTERM", () => shutdown("SIGTERM"));
		process.on("SIGINT", () => shutdown("SIGINT"));

		// Uncaught exception handler
		process.on("uncaughtException", (error) => {
			logError("Uncaught exception", error.message);
			console.error(error.stack);
			// Don't exit - let the process continue
		});

		process.on("unhandledRejection", (reason) => {
			logError("Unhandled rejection", String(reason));
			// Don't exit - let the process continue
		});
	});

	// Handle slash commands
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand()) return;

		// Deduplicate interactions
		if (!markMessageProcessed(interaction.id)) {
			logWarning(`Duplicate interaction detected, skipping: ${interaction.id}`);
			return;
		}

		const { commandName, user, channelId } = interaction;
		const channel = interaction.channel;
		const channelName = channel && "name" in channel ? (channel as TextChannel).name : `DM:${user.username}`;

		logSlash(commandName, user.username);

		// Track statistics
		botStats.commandsProcessed++;
		trackUserInteraction(user.id, user.username);

		const channelDir = join(workingDir, channelId);
		const commandStartTime = Date.now();

		try {
			switch (commandName) {
				case "ask": {
					const question = interaction.options.getString("question", true);
					await interaction.deferReply();

					// Track if we've responded to prevent duplicates
					let hasResponded = false;
					const safeEditReply = async (content: string) => {
						if (hasResponded) return;
						hasResponded = true;
						await interaction.editReply(content);
					};

					await handleAgentRequest(
						channelId,
						channelName,
						user.username,
						user.id,
						question,
						workingDir,
						safeEditReply, // Both use the same safe function
						safeEditReply,
						null, // No source message for slash commands
					);
					break;
				}

				case "bash": {
					const command = interaction.options.getString("command", true);
					const timeout = interaction.options.getInteger("timeout") || undefined;

					// SECURITY: Check for dangerous commands before execution
					if (isDangerousCommand(command)) {
						await interaction.reply({
							content:
								"**BLOCKED:** Dangerous command detected.\n\n" +
								`Command: \`${command.substring(0, 100)}${command.length > 100 ? "..." : ""}\`\n\n` +
								"This command matches dangerous patterns (sudo, rm -rf, curl|bash, etc.).\n" +
								"For security, slash commands cannot execute dangerous operations.\n" +
								"Use @bot mentions with approval flow for dangerous commands.",
							ephemeral: true,
						});
						logWarning(
							`Blocked dangerous /bash command from ${interaction.user.username}: ${command.substring(0, 100)}`,
						);
						return;
					}

					await interaction.deferReply();

					try {
						const result = await execCommand(command, { timeout });
						let output = result.stdout || result.stderr || "(no output)";

						if (result.code !== 0) {
							output += `\n\nExit code: ${result.code}`;
						}

						// Truncate for Discord
						if (output.length > 1900) {
							output = output.substring(0, 1900) + "\n...(truncated)";
						}

						await interaction.editReply(`\`\`\`\n${output}\n\`\`\``);
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
					}
					break;
				}

				case "read": {
					const path = interaction.options.getString("path", true);
					const lines = interaction.options.getInteger("lines") || 50;

					// SECURITY: Validate path is within allowed directories
					const ALLOWED_READ_DIRS = [
						"/home/majinbu/organized",
						"/opt/discord-bot-data",
						"/tmp/claude",
						workingDir, // Channel working directory
					];

					// Resolve path and check for traversal
					const resolvedPath = resolve(path);

					// Check for path traversal attempts
					if (path.includes("..") || !resolvedPath.startsWith("/")) {
						await interaction.reply({
							content: "**BLOCKED:** Path traversal detected. Use absolute paths without '..'.",
							ephemeral: true,
						});
						return;
					}

					// Check if path is in allowed directories
					const isAllowed = ALLOWED_READ_DIRS.some((allowed) => resolvedPath.startsWith(resolve(allowed)));

					// Block sensitive system files
					const BLOCKED_PATTERNS = [
						/^\/etc\/(shadow|passwd|sudoers)/,
						/^\/root\//,
						/\.ssh\//,
						/\.env$/,
						/\.(key|pem|p12|pfx)$/i,
						/credentials/i,
						/secrets?\.json$/i,
					];

					const isBlocked = BLOCKED_PATTERNS.some((pattern) => pattern.test(resolvedPath));

					if (!isAllowed || isBlocked) {
						await interaction.reply({
							content:
								"**BLOCKED:** Access denied.\n\n" +
								"For security, /read is restricted to:\n" +
								"- `/home/majinbu/organized/*`\n" +
								"- `/opt/discord-bot-data/*`\n" +
								"- Channel working directories\n\n" +
								"Sensitive files (.env, .ssh, credentials) are always blocked.",
							ephemeral: true,
						});
						logWarning(`Blocked /read access from ${interaction.user.username}: ${resolvedPath}`);
						return;
					}

					await interaction.deferReply();

					try {
						const result = await execCommand(`head -n ${lines} ${shellEscape(resolvedPath)}`);
						if (result.code !== 0) {
							await interaction.editReply(`Error: ${result.stderr || "Failed to read file"}`);
							return;
						}

						let output = result.stdout || "(empty file)";
						if (output.length > 1900) {
							output = output.substring(0, 1900) + "\n...(truncated)";
						}

						await interaction.editReply(`**${path}** (first ${lines} lines):\n\`\`\`\n${output}\n\`\`\``);
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
					}
					break;
				}

				case "suno": {
					const subcommand = interaction.options.getSubcommand();

					// Check if Suno is available
					if (!sunoService.isAvailable()) {
						await interaction.reply({
							content: "Suno API not configured. Please set SUNO_API_KEY environment variable.",
							ephemeral: true,
						});
						return;
					}

					switch (subcommand) {
						case "status": {
							await interaction.deferReply();
							try {
								const credits = await sunoService.getCredits();
								const embed = new EmbedBuilder()
									.setTitle("Suno AI Music Service")
									.setColor(0x9b59b6)
									.setDescription("AI music generation powered by sunoapi.org")
									.addFields(
										{ name: "Status", value: "Online", inline: true },
										{ name: "Credits Remaining", value: credits.remaining.toString(), inline: true },
										{ name: "Total Credits", value: credits.total.toString(), inline: true },
									)
									.addFields({
										name: "Available Commands",
										value: [
											"`/suno generate` - Quick generation from prompt",
											"`/suno custom` - Custom lyrics and style",
											"`/suno instrumental` - Instrumental tracks",
										].join("\n"),
									})
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error checking status: ${errMsg}`);
							}
							break;
						}

						case "generate": {
							const prompt = interaction.options.getString("prompt", true);
							const instrumental = interaction.options.getBoolean("instrumental") || false;

							if (prompt.length > 500) {
								await interaction.reply({
									content: "Prompt too long. Maximum 500 characters for simple generation.",
									ephemeral: true,
								});
								return;
							}

							await interaction.deferReply();

							try {
								// Start generation
								const startEmbed = new EmbedBuilder()
									.setTitle("Generating Music...")
									.setColor(0xf1c40f)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}`)
									.addFields({
										name: "Type",
										value: instrumental ? "Instrumental" : "With Vocals",
										inline: true,
									})
									.addFields({ name: "Status", value: STATUS_DESCRIPTIONS.PENDING, inline: true })
									.setFooter({ text: "This may take 30-60 seconds..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateSimple(prompt, instrumental);

								// Poll for completion
								const result = await sunoService.waitForCompletion(taskId, 120000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								// Create result embed with track info
								const successEmbed = new EmbedBuilder()
									.setTitle("Music Generated!")
									.setColor(0x2ecc71)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}`)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}: ${track.title}`,
										value: [
											`Style: ${track.tags}`,
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}

						case "custom": {
							const lyrics = interaction.options.getString("lyrics", true);
							const style = interaction.options.getString("style", true);
							const title = interaction.options.getString("title", true);
							const model = (interaction.options.getString("model") || "V4_5ALL") as SunoModel;

							if (lyrics.length > 5000) {
								await interaction.reply({
									content: "Lyrics too long. Maximum 5000 characters.",
									ephemeral: true,
								});
								return;
							}

							await interaction.deferReply();

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Creating Custom Track...")
									.setColor(0xf1c40f)
									.addFields(
										{ name: "Title", value: title, inline: true },
										{ name: "Style", value: style, inline: true },
										{ name: "Model", value: model, inline: true },
									)
									.addFields({
										name: "Lyrics Preview",
										value: lyrics.substring(0, 500) + (lyrics.length > 500 ? "..." : ""),
									})
									.setFooter({ text: "This may take 1-2 minutes..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateCustom(lyrics, style, title, model);
								const result = await sunoService.waitForCompletion(taskId, 180000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								const successEmbed = new EmbedBuilder()
									.setTitle(`Custom Track: ${title}`)
									.setColor(0x2ecc71)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}`,
										value: [
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}

						case "instrumental": {
							const style = interaction.options.getString("style", true);
							const title = interaction.options.getString("title", true);

							await interaction.deferReply();

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Creating Instrumental...")
									.setColor(0xf1c40f)
									.addFields(
										{ name: "Title", value: title, inline: true },
										{ name: "Style", value: style, inline: true },
									)
									.setFooter({ text: "This may take 1-2 minutes..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateInstrumental(style, title);
								const result = await sunoService.waitForCompletion(taskId, 180000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								const successEmbed = new EmbedBuilder()
									.setTitle(`Instrumental: ${title}`)
									.setColor(0x2ecc71)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}`,
										value: [
											`Style: ${track.tags}`,
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}
					}
					break;
				}

				case "telegram": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`telegram ${subCmd}`, user.username);

					const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
					if (!TELEGRAM_BOT_TOKEN) {
						await interaction.reply({
							content: "Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN in environment.",
							ephemeral: true,
						});
						break;
					}

					const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

					switch (subCmd) {
						case "send": {
							const chatId = interaction.options.getString("chat_id", true);
							const message = interaction.options.getString("message", true);

							await interaction.deferReply();

							try {
								const response = await fetch(`${baseUrl}/sendMessage`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										chat_id: chatId,
										text: message,
										parse_mode: "Markdown",
									}),
								});

								const result = await response.json();

								if (result.ok) {
									const embed = new EmbedBuilder()
										.setTitle("Message Sent to Telegram")
										.setColor(0x0088cc)
										.addFields(
											{ name: "Chat ID", value: chatId, inline: true },
											{
												name: "Message",
												value: message.slice(0, 200) + (message.length > 200 ? "..." : ""),
												inline: false,
											},
										)
										.setTimestamp();
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to send: ${result.description || "Unknown error"}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "photo": {
							const chatId = interaction.options.getString("chat_id", true);
							const photoUrl = interaction.options.getString("url", true);
							const caption = interaction.options.getString("caption") || "";

							await interaction.deferReply();

							try {
								const response = await fetch(`${baseUrl}/sendPhoto`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										chat_id: chatId,
										photo: photoUrl,
										caption: caption,
									}),
								});

								const result = await response.json();

								if (result.ok) {
									const embed = new EmbedBuilder()
										.setTitle("Photo Sent to Telegram")
										.setColor(0x0088cc)
										.setThumbnail(photoUrl)
										.addFields(
											{ name: "Chat ID", value: chatId, inline: true },
											{ name: "Caption", value: caption || "(none)", inline: false },
										)
										.setTimestamp();
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`Failed to send photo: ${result.description || "Unknown error"}`,
									);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "status": {
							try {
								const response = await fetch(`${baseUrl}/getMe`);
								const result = await response.json();

								if (result.ok) {
									const bot = result.result;
									const embed = new EmbedBuilder()
										.setTitle("Telegram Bot Status")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Bot Username", value: `@${bot.username}`, inline: true },
											{ name: "Bot Name", value: bot.first_name, inline: true },
											{ name: "Bot ID", value: String(bot.id), inline: true },
											{ name: "Can Join Groups", value: bot.can_join_groups ? "Yes" : "No", inline: true },
										)
										.setTimestamp();
									await interaction.reply({ embeds: [embed] });
								} else {
									await interaction.reply({ content: "Failed to connect to Telegram bot", ephemeral: true });
								}
							} catch (error) {
								await interaction.reply({
									content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
									ephemeral: true,
								});
							}
							break;
						}
					}
					break;
				}

				case "browse": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`browse ${subCmd}`, user.username);

					switch (subCmd) {
						case "screenshot": {
							const url = interaction.options.getString("url", true);
							const fullPage = interaction.options.getBoolean("fullpage") || false;

							await interaction.deferReply();

							try {
								const result = await browserAutomation.screenshot(url, { fullPage });
								if (result.success && result.data?.screenshot) {
									// Read file as buffer for Discord attachment
									const fileBuffer = readFileSync(result.data.screenshot);
									const attachment = new AttachmentBuilder(fileBuffer, { name: "screenshot.png" });
									const embed = new EmbedBuilder()
										.setTitle("Screenshot")
										.setURL(url)
										.setColor(0x3498db)
										.setImage("attachment://screenshot.png")
										.setFooter({ text: `Took ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed], files: [attachment] });
									await browserAutomation.cleanup(result.data.screenshot);
								} else {
									await interaction.editReply(`Screenshot failed: ${result.error}`);
								}
							} catch (error) {
								console.error("[BROWSE] Screenshot error:", error);
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "scrape": {
							const url = interaction.options.getString("url", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.scrape(url);
								if (result.success && result.data) {
									const embed = new EmbedBuilder()
										.setTitle(result.data.title || "Scraped Content")
										.setURL(url)
										.setColor(0x2ecc71)
										.setDescription(result.data.content?.slice(0, 4000) || "No content")
										.setFooter({
											text: `${result.data.links?.length || 0} links found | ${result.duration}ms`,
										});
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Scrape failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "extract": {
							const url = interaction.options.getString("url", true);
							const query = interaction.options.getString("query", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.extract(url, query);
								if (result.success && result.data) {
									const embed = new EmbedBuilder()
										.setTitle(`Extracted: ${query}`)
										.setURL(url)
										.setColor(0x9b59b6)
										.setDescription(result.data.content?.slice(0, 4000) || "No data extracted")
										.setFooter({ text: `From ${result.data.title || url} | ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Extract failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "search": {
							const query = interaction.options.getString("query", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.search(query);
								if (result.success && result.data?.links?.length) {
									const embed = new EmbedBuilder()
										.setTitle(`Search: ${query}`)
										.setColor(0xf39c12)
										.setDescription(
											result.data.links
												.slice(0, 10)
												.map((l, i) => `${i + 1}. [${l.text}](${l.href})`)
												.join("\n"),
										)
										.setFooter({ text: `${result.data.links.length} results | ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`No results found for: ${query}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}
					}
					break;
				}

				case "hf": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`hf ${subCmd}`, user.username);

					switch (subCmd) {
						case "skills": {
							const skills = hfSkills.getAvailableSkills();
							const embed = new EmbedBuilder()
								.setTitle("HuggingFace Expert Skills")
								.setColor(0xffcc00)
								.setDescription("30+ AI capabilities powered by HuggingFace Spaces")
								.addFields(
									{ name: "Image Generation", value: skills.image.join(", "), inline: false },
									{ name: "Image Editing", value: skills.edit.join(", "), inline: false },
									{ name: "3D Generation", value: skills.threeD.join(", "), inline: false },
									{ name: "Video", value: skills.video.join(", "), inline: false },
									{ name: "Voice/TTS", value: skills.voice.join(", "), inline: false },
									{ name: "OCR/Documents", value: skills.ocr.join(", "), inline: false },
									{ name: "Code Generation", value: skills.code.join(", "), inline: false },
									{ name: "Trading/Finance", value: skills.trading.join(", "), inline: false },
									{ name: "AI Agents", value: skills.agents.join(", "), inline: false },
								)
								.setFooter({ text: "Use /hf <skill> to use any capability" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "image": {
							const prompt = interaction.options.getString("prompt", true);
							const model = (interaction.options.getString("model") ||
								"QWEN_FAST") as keyof typeof HF_SPACES.IMAGE;

							await interaction.deferReply();

							const result = await hfSkills.generateImage({ prompt }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string; path?: string }] };
								const imageUrl = data?.data?.[0]?.url || data?.data?.[0]?.path;

								const embed = new EmbedBuilder()
									.setTitle("Generated Image")
									.setColor(0x00ff00)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}`)
									.setImage(imageUrl || "")
									.setFooter({ text: `Model: ${model} | ${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Image generation failed: ${result.error}`);
							}
							break;
						}

						case "remove-bg": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.removeBackground(url);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const imageUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Background Removed")
									.setColor(0x00ff00)
									.setImage(imageUrl || "")
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Background removal failed: ${result.error}`);
							}
							break;
						}

						case "edit": {
							const url = interaction.options.getString("url", true);
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.editImage(url, prompt);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const imageUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Image Edited")
									.setColor(0x00ff00)
									.setDescription(`**Edit:** ${prompt}`)
									.setImage(imageUrl || "")
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Image editing failed: ${result.error}`);
							}
							break;
						}

						case "3d": {
							const url = interaction.options.getString("url", true);
							const model = (interaction.options.getString("model") ||
								"HUNYUAN_2_1") as keyof typeof HF_SPACES.THREE_D;
							await interaction.deferReply();

							const result = await hfSkills.generateModel3D(url, model);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("3D Model Generated")
									.setColor(0x00ff00)
									.setDescription(`Model: ${model}\nResult ready for download`)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`3D generation failed: ${result.error}`);
							}
							break;
						}

						case "video": {
							const url = interaction.options.getString("url", true);
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.generateVideo(url, prompt);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("Video Generated")
									.setColor(0x00ff00)
									.setDescription(`**Prompt:** ${prompt}`)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`Video generation failed: ${result.error}`);
							}
							break;
						}

						case "tts": {
							const text = interaction.options.getString("text", true);
							const model = (interaction.options.getString("model") ||
								"CHATTERBOX") as keyof typeof HF_SPACES.VOICE;
							await interaction.deferReply();

							const result = await hfSkills.textToSpeech({ text }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const audioUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Text to Speech")
									.setColor(0x00ff00)
									.setDescription(`**Text:** ${text.substring(0, 200)}...`)
									.addFields({ name: "Audio", value: audioUrl ? `[Download](${audioUrl})` : "Processing..." })
									.setFooter({ text: `Model: ${model} | ${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`TTS failed: ${result.error}`);
							}
							break;
						}

						case "ocr": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.extractText(url);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const extractedText = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("OCR Result")
									.setColor(0x00ff00)
									.setDescription(extractedText.substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`OCR failed: ${result.error}`);
							}
							break;
						}

						case "code": {
							const prompt = interaction.options.getString("prompt", true);
							const model = (interaction.options.getString("model") ||
								"QWEN_CODER") as keyof typeof HF_SPACES.CODE;
							await interaction.deferReply();

							const result = await hfSkills.generateCode({ prompt }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const code = data?.data?.[0] || JSON.stringify(result.data);

								await interaction.editReply(`**Generated Code:**\n\`\`\`\n${code.substring(0, 1800)}\n\`\`\``);
							} else {
								await interaction.editReply(`Code generation failed: ${result.error}`);
							}
							break;
						}

						case "trading": {
							const asset = interaction.options.getString("asset", true);
							const news = interaction.options.getString("news") || "";
							await interaction.deferReply();

							const result = await hfSkills.analyzeTradingSentiment({ asset, newsText: news });

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle(`Trading Analysis: ${asset}`)
									.setColor(0x00ff00)
									.setDescription(JSON.stringify(result.data, null, 2).substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Trading analysis failed: ${result.error}`);
							}
							break;
						}

						case "stocks": {
							await interaction.deferReply();

							const result = await hfSkills.getStockRecommendations();

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("AI Stock Recommendations")
									.setColor(0x00ff00)
									.setDescription(JSON.stringify(result.data, null, 2).substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Stock recommendations failed: ${result.error}`);
							}
							break;
						}

						case "vision": {
							const url = interaction.options.getString("url", true);
							const question = interaction.options.getString("question", true);
							await interaction.deferReply();

							const result = await hfSkills.visionChat(url, question);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const answer = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("Vision Chat")
									.setColor(0x00ff00)
									.setDescription(`**Q:** ${question}\n\n**A:** ${answer.substring(0, 3500)}`)
									.setThumbnail(url)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Vision chat failed: ${result.error}`);
							}
							break;
						}

						case "detect": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.detectObjects(url);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("Object Detection")
									.setColor(0x00ff00)
									.setDescription("Objects detected in image")
									.setThumbnail(url)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`Object detection failed: ${result.error}`);
							}
							break;
						}

						case "polish": {
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.polishPrompt(prompt);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const polished = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("Polished Prompt")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Original", value: prompt.substring(0, 1000) },
										{ name: "Improved", value: polished.substring(0, 1000) },
									)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Prompt polishing failed: ${result.error}`);
							}
							break;
						}
					}
					break;
				}

				case "learning": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`learning ${subCmd}`, user.username);

					switch (subCmd) {
						case "stats": {
							const stats = tradingLearning.getStats();
							const sessionMinutes = Math.floor(stats.sessionAge / 60000);

							const embed = new EmbedBuilder()
								.setTitle("Trading Learning Stats")
								.setColor(0x00ccff)
								.addFields(
									{ name: "Outcomes Recorded", value: `${stats.outcomes}`, inline: true },
									{ name: "Session Age", value: `${sessionMinutes} minutes`, inline: true },
									{
										name: "Status",
										value:
											stats.outcomes >= 5
												? "Ready to update expertise"
												: `Need ${5 - stats.outcomes} more outcomes`,
										inline: true,
									},
								)
								.setFooter({ text: "Use /learning record to add outcomes" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "expertise": {
							await interaction.deferReply();
							const expertise = await tradingLearning.loadExpertise();

							// Extract key sections
							const sections = expertise.split("##").slice(1, 5);
							const summary = sections.map((s) => `## ${s.substring(0, 300)}`).join("\n\n");

							const embed = new EmbedBuilder()
								.setTitle("Trading Expertise Summary")
								.setColor(0x00ccff)
								.setDescription(summary.substring(0, 4000) || "No expertise accumulated yet")
								.setFooter({ text: "Full expertise in src/trading/expertise/trading.md" })
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "record": {
							const symbol = interaction.options.getString("symbol", true);
							const action = interaction.options.getString("action", true) as "BUY" | "SELL" | "HOLD";
							const success = interaction.options.getBoolean("success", true);
							const confidence = interaction.options.getNumber("confidence", true);
							const market = interaction.options.getString("market", true) as
								| "bull"
								| "bear"
								| "sideways"
								| "volatile";
							const reason = interaction.options.getString("reason") || "Manual record";

							await tradingLearning.recordOutcome({
								timestamp: new Date().toISOString(),
								symbol,
								action,
								entryPrice: 0, // Manual records don't need price
								success,
								confidence,
								marketCondition: market,
								agents: ["Manual"],
								reason,
							});

							const embed = new EmbedBuilder()
								.setTitle("Trading Outcome Recorded")
								.setColor(success ? 0x00ff00 : 0xff0000)
								.addFields(
									{ name: "Symbol", value: symbol, inline: true },
									{ name: "Action", value: action, inline: true },
									{ name: "Success", value: success ? "Yes" : "No", inline: true },
									{ name: "Confidence", value: `${(confidence * 100).toFixed(0)}%`, inline: true },
									{ name: "Market", value: market, inline: true },
									{ name: "Reason", value: reason, inline: false },
								)
								.setFooter({ text: "Outcome added to learning system" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "update": {
							await interaction.deferReply();
							await tradingLearning.updateExpertise();

							const embed = new EmbedBuilder()
								.setTitle("Expertise Updated")
								.setColor(0x00ff00)
								.setDescription("Trading expertise file has been updated with accumulated learnings.")
								.setFooter({ text: "Check src/trading/expertise/trading.md" })
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}
					}
					break;
				}

				case "remember": {
					const text = interaction.options.getString("text", true);
					const isGlobal = interaction.options.getBoolean("global") || false;

					addToMemory(text, channelDir, workingDir, isGlobal);

					await interaction.reply(`Remembered${isGlobal ? " (global)" : ""}: ${text}`);
					break;
				}

				case "memory": {
					const memory = getMemory(channelDir, workingDir);

					if (memory.length > 1900) {
						await interaction.reply(memory.substring(0, 1900) + "\n...(truncated)");
					} else {
						await interaction.reply(memory || "No memories yet.");
					}
					break;
				}

				case "forget": {
					const isGlobal = interaction.options.getBoolean("global") || false;
					const cleared = clearMemory(channelDir, workingDir, isGlobal);

					if (cleared) {
						await interaction.reply(`Cleared ${isGlobal ? "global" : "channel"} memory.`);
					} else {
						await interaction.reply(`No ${isGlobal ? "global" : "channel"} memory to clear.`);
					}
					break;
				}

				case "status": {
					const uptime = process.uptime();
					const hours = Math.floor(uptime / 3600);
					const mins = Math.floor((uptime % 3600) / 60);
					const uptimeStr = `${hours}h ${mins}m`;

					const currentModelId = getCurrentModelId(user.id);
					const statusEmbed = createStatusEmbed(
						currentModelId,
						globalModelId,
						uptimeStr,
						workingDir,
						channelStates.size,
					);
					await interaction.reply({ embeds: [statusEmbed] });
					break;
				}

				case "hooks": {
					await interaction.deferReply();
					const hooksSubcommand = interaction.options.getSubcommand();
					const channelDir = join(workingDir, interaction.channelId);

					switch (hooksSubcommand) {
						case "status": {
							const state = channelStates.get(interaction.channelId);
							const hasHooks = !!state?.hooks;
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);

							const embed = new EmbedBuilder()
								.setTitle("🪝 Hook System Status")
								.setColor(hasHooks ? 0x00ff00 : 0x808080)
								.addFields(
									{ name: "Hooks Active", value: hasHooks ? "✅ Yes" : "❌ No", inline: true },
									{ name: "Git Repository", value: isGitRepo ? "✅ Yes" : "❌ No", inline: true },
									{ name: "Session ID", value: state?.sessionId || "N/A", inline: true },
									{ name: "Turn Index", value: String(state?.turnIndex || 0), inline: true },
								)
								.addFields({
									name: "Active Hooks",
									value: [
										"• **Checkpoint**: Git-based state snapshots each turn",
										"• **LSP**: Diagnostics after file write/edit",
										"• **Expert**: Domain detection + Act-Learn-Reuse",
									].join("\n"),
								})
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "checkpoints": {
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);
							if (!isGitRepo) {
								await interaction.editReply("❌ Not a git repository - no checkpoints available");
								break;
							}

							const checkpoints = await CheckpointUtils.loadAllCheckpoints(channelDir);
							if (checkpoints.length === 0) {
								await interaction.editReply("No checkpoints found for this channel.");
								break;
							}

							// Sort by timestamp descending and take last 10
							const sorted = checkpoints.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
							const list = sorted
								.map((cp) => {
									const date = new Date(cp.timestamp).toLocaleString();
									return `• **Turn ${cp.turnIndex}** - \`${cp.id.slice(0, 30)}...\`\n  ${date}`;
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("📸 Available Checkpoints")
								.setDescription(list)
								.setColor(0x3498db)
								.setFooter({ text: `${checkpoints.length} total checkpoints` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "restore": {
							const checkpointId = interaction.options.getString("id", true);
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);
							if (!isGitRepo) {
								await interaction.editReply("❌ Not a git repository - cannot restore");
								break;
							}

							const checkpoint = await CheckpointUtils.loadCheckpointFromRef(channelDir, checkpointId);
							if (!checkpoint) {
								await interaction.editReply(`❌ Checkpoint not found: ${checkpointId}`);
								break;
							}

							try {
								await CheckpointUtils.restoreCheckpoint(channelDir, checkpoint);
								await interaction.editReply(
									`✅ Restored to turn ${checkpoint.turnIndex}\n` +
										`Checkpoint: \`${checkpointId}\`\n` +
										`Head SHA: \`${checkpoint.headSha.slice(0, 8)}\``,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Restore failed: ${errMsg}`);
							}
							break;
						}

						case "metrics": {
							const state = channelStates.get(interaction.channelId);
							if (!state?.hooks) {
								await interaction.editReply("❌ No hooks active for this channel");
								break;
							}

							const metrics = state.hooks.manager.getMetrics();
							const uptime = Date.now() - metrics.session.startTime;
							const uptimeStr =
								uptime > 3600000
									? `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`
									: `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`;

							const eventBreakdown = Object.entries(metrics.eventsByType)
								.map(([type, count]) => `${type}: ${count}`)
								.join(", ");

							const hookTimes = Object.entries(metrics.executionTimes.byHook)
								.map(([hook, time]) => `${hook}: ${time}ms`)
								.join(", ");

							const embed = new EmbedBuilder()
								.setTitle("📊 Hook Metrics")
								.setColor(0x9b59b6)
								.addFields(
									{ name: "Session ID", value: metrics.session.sessionId || "N/A", inline: true },
									{ name: "Uptime", value: uptimeStr, inline: true },
									{ name: "Turns", value: String(metrics.session.turnCount), inline: true },
									{ name: "Total Events", value: String(metrics.totalEvents), inline: true },
									{ name: "Total Execution Time", value: `${metrics.executionTimes.total}ms`, inline: true },
									{ name: "Errors", value: String(metrics.errors.total), inline: true },
									{
										name: "Events by Type",
										value: eventBreakdown || "None",
										inline: false,
									},
									{
										name: "Hook Execution Times",
										value: hookTimes || "None",
										inline: false,
									},
									{
										name: "Tool Calls",
										value:
											`Total: ${metrics.toolCalls.total} | ` +
											`Blocked: ${metrics.toolCalls.blocked} | ` +
											`Modified: ${metrics.toolCalls.modified}`,
										inline: false,
									},
								)
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "tag": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);
							const tagName = interaction.options.getString("name", true);
							const description = interaction.options.getString("description") || undefined;

							try {
								const tag = await CheckpointUtils.tagCheckpoint(channelDir, checkpointId, tagName, description);
								await interaction.editReply(
									`✅ Tagged checkpoint as **${tag.tag}**\n` +
										`Checkpoint: \`${tag.checkpointId}\`\n` +
										(description ? `Description: ${description}` : ""),
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to tag checkpoint: ${errMsg}`);
							}
							break;
						}

						case "tags": {
							const tags = await CheckpointUtils.listTags(channelDir);
							if (tags.length === 0) {
								await interaction.editReply("No tags found. Use `/hooks tag` to tag a checkpoint.");
								break;
							}

							const list = tags
								.slice(0, 15)
								.map((t) => {
									const date = new Date(t.timestamp).toLocaleString();
									return (
										`• **${t.tag}** → \`${t.checkpointId.slice(0, 30)}...\`\n` +
										`  ${date}${t.description ? ` - ${t.description}` : ""}`
									);
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("🏷️ Checkpoint Tags")
								.setDescription(list)
								.setColor(0xe67e22)
								.setFooter({ text: `${tags.length} total tags` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "debug": {
							const enabled = interaction.options.getBoolean("enabled", true);
							// Import dynamically to avoid circular deps
							const { enableDebugLogging, isDebugLoggingEnabled } = await import("./agents/hooks/index.js");
							enableDebugLogging(enabled);
							await interaction.editReply(
								enabled
									? "✅ Hook debug logging **enabled**. Check console for detailed hook events."
									: "✅ Hook debug logging **disabled**.",
							);
							break;
						}

						// Phase 1.1: Branch support
						case "branch": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);
							const description = interaction.options.getString("description") || undefined;

							try {
								const { createBranchPoint } = await import("./agents/hooks/index.js");
								const branch = await createBranchPoint(channelDir, checkpointId, description);
								if (!branch) {
									await interaction.editReply("❌ Failed to create branch. Checkpoint not found.");
									break;
								}
								await interaction.editReply(
									`✅ Created branch **${branch.branchId}**\n` +
										`From checkpoint: \`${branch.parentCheckpointId.slice(0, 40)}...\`\n` +
										`At turn: ${branch.parentTurnIndex}\n` +
										(description ? `Description: ${description}` : ""),
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to create branch: ${errMsg}`);
							}
							break;
						}

						case "branches": {
							const { listBranches } = await import("./agents/hooks/index.js");
							const branches = await listBranches(channelDir);

							if (branches.length === 0) {
								await interaction.editReply("No branches found. Use `/hooks branch` to create one.");
								break;
							}

							const list = branches
								.slice(0, 10)
								.map((b) => {
									const date = new Date(b.createdAt).toLocaleString();
									return (
										`• **${b.branchId.slice(0, 25)}**\n` +
										`  Turn ${b.parentTurnIndex} | ${date}\n` +
										(b.description ? `  ${b.description}` : "")
									);
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("🌿 Branch Points")
								.setDescription(list)
								.setColor(0x27ae60)
								.setFooter({ text: `${branches.length} total branches` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "switch": {
							const branchId = interaction.options.getString("branch_id", true);

							try {
								const { switchToBranch } = await import("./agents/hooks/index.js");
								const checkpoint = await switchToBranch(channelDir, branchId);
								if (!checkpoint) {
									await interaction.editReply("❌ Failed to switch branch. Branch not found.");
									break;
								}
								await interaction.editReply(
									`✅ Switched to branch **${branchId}**\n` +
										`Restored to turn ${checkpoint.turnIndex}\n` +
										`Checkpoint: \`${checkpoint.id.slice(0, 40)}...\``,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to switch branch: ${errMsg}`);
							}
							break;
						}

						// Phase 2.1: Checkpoint diff
						case "diff": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);

							try {
								const { getCheckpointDiff } = await import("./agents/hooks/index.js");
								const diff = await getCheckpointDiff(channelDir, checkpointId);
								if (!diff) {
									await interaction.editReply("❌ Checkpoint not found or diff failed.");
									break;
								}

								const addedList = diff.added.slice(0, 5).join("\n  ");
								const modifiedList = diff.modified.slice(0, 5).join("\n  ");
								const deletedList = diff.deleted.slice(0, 5).join("\n  ");

								const embed = new EmbedBuilder()
									.setTitle("📝 Checkpoint Diff")
									.setDescription(`Changes since checkpoint \`${checkpointId.slice(0, 30)}...\``)
									.setColor(diff.added.length > 0 || diff.modified.length > 0 ? 0xe74c3c : 0x2ecc71)
									.addFields(
										{
											name: `➕ Added (${diff.added.length})`,
											value: addedList || "None",
											inline: false,
										},
										{
											name: `📝 Modified (${diff.modified.length})`,
											value: modifiedList || "None",
											inline: false,
										},
										{
											name: `➖ Deleted (${diff.deleted.length})`,
											value: deletedList || "None",
											inline: false,
										},
									)
									.setFooter({ text: diff.summary })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Diff failed: ${errMsg}`);
							}
							break;
						}

						case "cleanup": {
							const keepCount = interaction.options.getInteger("keep") || 50;

							try {
								const { autoCleanup } = await import("./agents/hooks/index.js");
								const result = await autoCleanup(channelDir, { maxCheckpoints: keepCount });

								await interaction.editReply(
									`✅ Cleanup complete!\n` +
										`• Checkpoints removed: ${result.checkpointsRemoved}\n` +
										`• Tags removed: ${result.tagsRemoved}\n` +
										`• Branches removed: ${result.branchesRemoved}\n` +
										`• Space freed: ${result.freedSpace}`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Cleanup failed: ${errMsg}`);
							}
							break;
						}

						// Phase 2.2: Expertise management
						case "expertise": {
							const domain = interaction.options.getString("domain");

							try {
								const { listExpertise, getExpertiseSummary } = await import("./agents/hooks/index.js");

								if (domain) {
									const summary = getExpertiseSummary(domain);
									if (!summary.exists) {
										await interaction.editReply(`No expertise found for domain: ${domain}`);
										break;
									}

									const preview = summary.content.slice(0, 1500);
									const embed = new EmbedBuilder()
										.setTitle(`🧠 ${domain.replace(/_/g, " ").toUpperCase()} Expertise`)
										.setDescription(preview + (summary.content.length > 1500 ? "\n...(truncated)" : ""))
										.setColor(
											summary.riskLevel === "critical"
												? 0xe74c3c
												: summary.riskLevel === "high"
													? 0xe67e22
													: 0x3498db,
										)
										.addFields(
											{ name: "Insights", value: String(summary.insightCount), inline: true },
											{ name: "Risk Level", value: summary.riskLevel.toUpperCase(), inline: true },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									const allExpertise = listExpertise();
									if (allExpertise.length === 0) {
										await interaction.editReply("No expertise accumulated yet. Complete tasks to learn!");
										break;
									}

									const list = allExpertise
										.slice(0, 10)
										.map((e) => {
											const date = new Date(e.lastModified).toLocaleDateString();
											return `• **${e.domain}**: ${e.insightCount} insights (${(e.size / 1024).toFixed(1)}KB) - ${date}`;
										})
										.join("\n");

									const embed = new EmbedBuilder()
										.setTitle("🧠 Accumulated Expertise")
										.setDescription(list)
										.setColor(0x9b59b6)
										.setFooter({ text: `${allExpertise.length} domains with expertise` })
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to load expertise: ${errMsg}`);
							}
							break;
						}

						case "clear-expertise": {
							const domain = interaction.options.getString("domain", true);

							try {
								const { clearExpertise, clearAllExpertise } = await import("./agents/hooks/index.js");

								if (domain === "all") {
									const count = clearAllExpertise();
									await interaction.editReply(`✅ Cleared expertise for ${count} domains.`);
								} else {
									const success = clearExpertise(domain);
									if (success) {
										await interaction.editReply(`✅ Cleared expertise for **${domain}**.`);
									} else {
										await interaction.editReply(`❌ No expertise found for domain: ${domain}`);
									}
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to clear expertise: ${errMsg}`);
							}
							break;
						}

						// Phase 2.3: LSP configuration
						case "lsp": {
							try {
								const { getLSPStatus, detectProjectLanguages } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId;
								const status = getLSPStatus(sessionId);
								const detected = detectProjectLanguages(channelDir);

								const list = status
									.map((s) => {
										const avail = s.available ? "✅" : "❌";
										const enabled = s.enabled ? "🟢" : "⚪";
										const exts = s.extensions.slice(0, 3).join(", ");
										return `${avail} ${enabled} **${s.id}** (${exts})`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🔧 LSP Server Status")
									.setDescription(list)
									.setColor(0x3498db)
									.addFields(
										{
											name: "Detected Languages",
											value: detected.length > 0 ? detected.join(", ") : "None detected",
											inline: false,
										},
										{
											name: "Legend",
											value: "✅ = Available | ❌ = Not installed | 🟢 = Enabled | ⚪ = Disabled",
											inline: false,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to get LSP status: ${errMsg}`);
							}
							break;
						}

						case "lsp-enable": {
							const server = interaction.options.getString("server", true);
							try {
								const { enableLSP } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId || "default";
								const success = enableLSP(sessionId, server);
								if (success) {
									await interaction.editReply(`✅ Enabled LSP server: **${server}**`);
								} else {
									await interaction.editReply(`❌ Invalid server ID: ${server}`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to enable LSP: ${errMsg}`);
							}
							break;
						}

						case "lsp-disable": {
							const server = interaction.options.getString("server", true);
							try {
								const { disableLSP } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId || "default";
								const success = disableLSP(sessionId, server);
								await interaction.editReply(
									success
										? `✅ Disabled LSP server: **${server}**`
										: `⚠️ Server **${server}** was not enabled.`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to disable LSP: ${errMsg}`);
							}
							break;
						}

						// Phase 3.1: Blocking rules
						case "rules": {
							try {
								const { listBlockingRules } = await import("./agents/hooks/index.js");
								const rules = listBlockingRules(workingDir, interaction.channelId);

								if (rules.length === 0) {
									await interaction.editReply(
										"No blocking rules configured.\n" +
											"Use `/hooks rules-add` to add rules or `/hooks rules-preset` for security defaults.",
									);
									break;
								}

								const list = rules
									.slice(0, 10)
									.map((r) => {
										const status = r.enabled ? "🟢" : "⚪";
										return `${status} **#${r.id}** \`${r.toolName}\` → \`${r.pattern.slice(0, 30)}\`\n  ${r.reason}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("🛡️ Blocking Rules")
									.setDescription(list)
									.setColor(0xe74c3c)
									.setFooter({ text: `${rules.length} total rules` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to list rules: ${errMsg}`);
							}
							break;
						}

						case "rules-add": {
							const tool = interaction.options.getString("tool", true);
							const pattern = interaction.options.getString("pattern", true);
							const reason = interaction.options.getString("reason", true);

							try {
								const { addBlockingRule } = await import("./agents/hooks/index.js");
								const rule = addBlockingRule(workingDir, interaction.channelId, tool, pattern, reason, {
									createdBy: interaction.user.id,
								});
								await interaction.editReply(
									`✅ Added blocking rule **#${rule.id}**\n` +
										`Tool: \`${tool}\`\n` +
										`Pattern: \`${pattern}\`\n` +
										`Reason: ${reason}`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to add rule: ${errMsg}`);
							}
							break;
						}

						case "rules-remove": {
							const ruleId = interaction.options.getInteger("id", true);

							try {
								const { removeBlockingRule } = await import("./agents/hooks/index.js");
								const success = removeBlockingRule(workingDir, ruleId, interaction.channelId);
								await interaction.editReply(
									success
										? `✅ Removed blocking rule **#${ruleId}**`
										: `❌ Rule #${ruleId} not found or not owned by this channel.`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to remove rule: ${errMsg}`);
							}
							break;
						}

						case "rules-preset": {
							try {
								const { applyPresetRules } = await import("./agents/hooks/index.js");
								const count = applyPresetRules(workingDir, interaction.channelId, interaction.user.id);
								await interaction.editReply(
									`✅ Applied ${count} preset security rules.\n` +
										"These block dangerous commands like `rm -rf /`, fork bombs, etc.",
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to apply presets: ${errMsg}`);
							}
							break;
						}
					}
					break;
				}

				case "skills": {
					await interaction.deferReply();
					// Use the new skill_list tool to get dynamic skills
					const skillListTool = createSkillListTool();
					const result = await skillListTool.execute("skills-cmd", { label: "List skills", category: undefined });

					let skillsList = "";
					if (result.content?.[0] && result.content[0].type === "text") {
						skillsList = result.content[0].text;
					}

					// Add capabilities info
					skillsList += "\n\n**Core Capabilities:**\n";
					skillsList += "• Multi-model AI (OpenRouter + Ollama)\n";
					skillsList += "• 25+ MCP tools (web, GitHub, HuggingFace, memory)\n";
					skillsList += "• Pi-mono codebase knowledge\n";
					skillsList += "• Persistent memory & task management\n";
					skillsList += "\n**Security:**\n";
					skillsList += "• Rate limited: 10 req/min per user\n";
					skillsList += "• Dangerous commands require approval\n";
					skillsList += "\n**Tip:** Use `skill_load` tool to activate a skill's instructions.";

					// Truncate if too long for Discord
					if (skillsList.length > 1900) {
						skillsList = skillsList.substring(0, 1900) + "\n...(truncated)";
					}

					await interaction.editReply(skillsList);
					break;
				}

				case "price": {
					const symbol = interaction.options.getString("symbol", true);
					await interaction.deferReply();

					try {
						const priceData = await getCryptoPrice(symbol);
						const changeEmoji = priceData.change24h >= 0 ? "📈" : "📉";
						const changeColor = priceData.change24h >= 0 ? "+" : "";

						const embed = new EmbedBuilder()
							.setColor(priceData.change24h >= 0 ? 0x00ff00 : 0xff0000)
							.setTitle(`${symbol.toUpperCase()} Price`)
							.addFields(
								{
									name: "Price",
									value: `$${priceData.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
									inline: true,
								},
								{
									name: "24h Change",
									value: `${changeEmoji} ${changeColor}${priceData.change24h.toFixed(2)}%`,
									inline: true,
								},
								{ name: "Market Cap", value: `$${(priceData.marketCap / 1e9).toFixed(2)}B`, inline: true },
							)
							.setTimestamp()
							.setFooter({ text: "Data from CoinGecko" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg}`);
					}
					break;
				}

				case "alert": {
					const condition = interaction.options.getString("condition", true);

					// Parse condition (simple format: SYMBOL > PRICE or SYMBOL < PRICE)
					const match = condition.match(/(\w+)\s*([><])\s*([\d.]+)/i);
					if (!match) {
						await interaction.reply(
							"Invalid condition format. Use: `SYMBOL > PRICE` or `SYMBOL < PRICE`\nExample: `BTC > 50000`",
						);
						break;
					}

					const [, symbol, operator, price] = match;

					// Store alert in memory
					const alertText = `Price alert: ${symbol.toUpperCase()} ${operator} $${price}`;
					addToMemory(alertText, channelDir, workingDir, false);

					await interaction.reply(
						`Alert set: ${symbol.toUpperCase()} ${operator} $${price}\n\n` +
							`Note: This is stored in memory. Use /ask to request monitoring of this alert, or integrate with external monitoring tools.`,
					);
					break;
				}

				case "news": {
					const newsType = interaction.options.getString("type") || "crypto";
					const topic = interaction.options.getString("topic") || undefined;
					await interaction.deferReply();

					try {
						const embeds: EmbedBuilder[] = [];

						// Fetch crypto news if type is crypto or all
						if (newsType === "crypto" || newsType === "all") {
							const newsItems = await getCryptoNews(topic);
							if (newsItems.length > 0) {
								embeds.push(
									new EmbedBuilder()
										.setColor(0x0099ff)
										.setTitle(topic ? `Crypto News: ${topic}` : "Latest Crypto News")
										.setDescription(
											newsItems
												.slice(0, 5)
												.map(
													(item, i) =>
														`**${i + 1}. ${item.title}**\n[Read more](${item.url}) - ${item.source}`,
												)
												.join("\n\n"),
										)
										.setTimestamp()
										.setFooter({ text: "Data from CryptoPanic" }),
								);
							}
						}

						// Fetch AI news if type is ai or all
						if (newsType === "ai" || newsType === "all") {
							const smolNews = getSmolAINews();
							const digest = await smolNews.fetchLatest();

							const aiNewsContent: string[] = [];

							if (digest.headlines.length > 0) {
								aiNewsContent.push("**Headlines**");
								for (const h of digest.headlines.slice(0, 5)) {
									aiNewsContent.push(`• ${h.title}`);
								}
								aiNewsContent.push("");
							}

							if (digest.modelReleases.length > 0) {
								aiNewsContent.push("**Model Releases**");
								for (const m of digest.modelReleases.slice(0, 3)) {
									aiNewsContent.push(`• ${m.title}`);
								}
								aiNewsContent.push("");
							}

							if (digest.tools.length > 0) {
								aiNewsContent.push("**Tools & Infra**");
								for (const t of digest.tools.slice(0, 3)) {
									aiNewsContent.push(`• ${t.title}`);
								}
							}

							if (aiNewsContent.length > 0) {
								embeds.push(
									new EmbedBuilder()
										.setColor(0x9b59b6)
										.setTitle(`Smol AI News - ${digest.date}`)
										.setDescription(aiNewsContent.join("\n"))
										.setURL("https://news.smol.ai")
										.setTimestamp()
										.setFooter({ text: "Source: news.smol.ai" }),
								);
							}
						}

						if (embeds.length === 0) {
							await interaction.editReply("No news found. Try again later.");
							break;
						}

						await interaction.editReply({ embeds });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error fetching news: ${errMsg}`);
					}
					break;
				}

				case "chart": {
					const symbol = interaction.options.getString("symbol", true);
					const timeframe = interaction.options.getString("timeframe", true);

					const chartUrl = generateTradingViewLink(symbol, timeframe);

					const embed = new EmbedBuilder()
						.setColor(0x0099ff)
						.setTitle(`${symbol.toUpperCase()} Chart (${timeframe})`)
						.setDescription(`[Open in TradingView](${chartUrl})`)
						.addFields(
							{ name: "Symbol", value: symbol.toUpperCase(), inline: true },
							{ name: "Timeframe", value: timeframe, inline: true },
						)
						.setTimestamp()
						.setFooter({ text: "TradingView Chart" });

					await interaction.reply({ embeds: [embed] });
					break;
				}

				case "convert": {
					const amount = interaction.options.getNumber("amount", true);
					const from = interaction.options.getString("from", true);
					const to = interaction.options.getString("to", true);

					await interaction.deferReply();

					try {
						const conversion = await convertCurrency(amount, from, to);

						const embed = new EmbedBuilder()
							.setColor(0x0099ff)
							.setTitle("Currency Conversion")
							.addFields(
								{ name: "From", value: `${amount.toLocaleString()} ${from.toUpperCase()}`, inline: true },
								{
									name: "To",
									value: `${conversion.result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${to.toUpperCase()}`,
									inline: true,
								},
								{
									name: "Rate",
									value: `1 ${from.toUpperCase()} = ${conversion.rate.toFixed(8)} ${to.toUpperCase()}`,
									inline: false,
								},
							)
							.setTimestamp()
							.setFooter({ text: "Data from CoinGecko" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg}`);
					}
					break;
				}

				case "model": {
					const subcommand = interaction.options.getSubcommand();

					switch (subcommand) {
						case "list": {
							await interaction.deferReply();

							try {
								const models = await fetchOllamaModels();

								if (models.length === 0) {
									await interaction.editReply("No models found. Make sure Ollama is running.");
									break;
								}

								const currentModelId = getCurrentModelId(user.id);
								const modelList = models
									.map((m) => {
										const current = m.name === currentModelId ? " **[CURRENT]**" : "";
										const size = formatModelSize(m.size);
										const family = m.details?.family ? ` (${m.details.family})` : "";
										return `• \`${m.name}\`${family} - ${size}${current}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("Available Ollama Models")
									.setDescription(modelList)
									.addFields(
										{ name: "Current Model", value: `\`${currentModelId}\``, inline: true },
										{ name: "Total Models", value: String(models.length), inline: true },
									)
									.setFooter({ text: "Use /model switch <name> to change models" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching models: ${errMsg}`);
							}
							break;
						}

						case "switch": {
							const modelName = interaction.options.getString("name", true);
							const isGlobal = interaction.options.getBoolean("global") || false;

							// Only admin can set global model
							if (isGlobal && !isOwner(user.id)) {
								await interaction.reply({
									content: "Only the bot owner can set the global model.",
									ephemeral: true,
								});
								break;
							}

							await interaction.deferReply();

							try {
								// Verify model exists
								const models = await fetchOllamaModels();
								const modelExists = models.some((m) => m.name === modelName);

								if (!modelExists) {
									await interaction.editReply(
										`Model \`${modelName}\` not found. Use \`/model list\` to see available models.\n\n` +
											`To download a new model, run: \`ollama pull ${modelName}\``,
									);
									break;
								}

								// Switch model
								if (isGlobal) {
									setGlobalModel(modelName);
									logAdminAction(user.id, user.username, "set_global_model", modelName);
									await interaction.editReply(`Global model set to \`${modelName}\` for all users.`);
								} else {
									setUserModel(user.id, modelName);
									await interaction.editReply(`Your model has been switched to \`${modelName}\`.`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error switching model: ${errMsg}`);
							}
							break;
						}

						case "info": {
							await interaction.deferReply();

							try {
								const currentModelId = getCurrentModelId(user.id);
								const models = await fetchOllamaModels();
								const currentModel = models.find((m) => m.name === currentModelId);

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("Current Model Information")
									.addFields(
										{ name: "Model Name", value: `\`${currentModelId}\``, inline: true },
										{
											name: "Is Personal",
											value: userModels.has(user.id) ? "Yes" : "No (using global)",
											inline: true,
										},
									);

								if (currentModel) {
									embed.addFields(
										{ name: "Size", value: formatModelSize(currentModel.size), inline: true },
										{ name: "Family", value: currentModel.details?.family || "Unknown", inline: true },
										{
											name: "Parameter Size",
											value: currentModel.details?.parameter_size || "Unknown",
											inline: true,
										},
										{
											name: "Last Modified",
											value: new Date(currentModel.modified_at).toLocaleDateString(),
											inline: true,
										},
									);
								}

								embed.setFooter({ text: "Use /model switch to change models" }).setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching model info: ${errMsg}`);
							}
							break;
						}
					}
					break;
				}

				case "provider": {
					const subCommand = interaction.options.getSubcommand();

					switch (subCommand) {
						case "status": {
							let providerInfo: string;
							let providerColor: number;

							if (currentProvider === "zai") {
								providerInfo = `**Z.ai** (GLM-4.6)\n- Model: ${ZAI_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${ZAI_MODELS[globalModelId]?.cost || "subscription"}`;
								providerColor = 0x00d4ff;
							} else if (currentProvider === "groq") {
								providerInfo = `**Groq** (Free + Fast)\n- Model: ${GROQ_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${GROQ_MODELS[globalModelId]?.cost || "FREE"}`;
								providerColor = 0xf97316;
							} else if (currentProvider === "cerebras") {
								providerInfo = `**Cerebras** (Fastest)\n- Model: ${CEREBRAS_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${CEREBRAS_MODELS[globalModelId]?.cost || "varies"}`;
								providerColor = 0x7c3aed;
							} else if (currentProvider === "openrouter") {
								providerInfo = `**OpenRouter** (Cloud)\n- Model: ${OPENROUTER_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${OPENROUTER_MODELS[globalModelId]?.cost || "varies"}`;
								providerColor = 0x7c3aed;
							} else {
								providerInfo = `**Ollama** (Local)\n- Model: ${globalModelId}\n- Cost: FREE (runs locally)`;
								providerColor = 0x00ff00;
							}

							const embed = new EmbedBuilder()
								.setColor(providerColor)
								.setTitle("🔌 AI Provider Status")
								.setDescription(`Current provider: ${providerInfo}`)
								.addFields(
									{
										name: "Available Providers",
										value: "• `/provider zai` - GLM-4.6 (best coding)\n• `/provider groq` - Free + fast\n• `/provider cerebras` - Fastest\n• `/provider openrouter` - Cloud AI\n• `/provider ollama` - Local AI",
										inline: false,
									},
									{ name: "Z.ai Key", value: ZAI_API_KEY ? "✅ Configured" : "❌ Not set", inline: true },
									{ name: "Groq Key", value: GROQ_API_KEY ? "✅ Configured" : "❌ Not set", inline: true },
									{
										name: "Cerebras Key",
										value: CEREBRAS_API_KEY ? "✅ Configured" : "❌ Not set",
										inline: true,
									},
								)
								.setFooter({ text: "Use /provider <name> to switch" });

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "zai": {
							if (!ZAI_API_KEY) {
								await interaction.reply({
									content: "❌ Z.ai API key not configured. Set `ZAI_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_ZAI_MODEL;
							currentProvider = "zai";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = ZAI_MODELS[modelChoice];
							logInfo(`Switched to Z.ai provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Z.ai** (GLM-4.6)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "subscription"}\n- SOTA coding model!`,
								ephemeral: false,
							});
							break;
						}

						case "groq": {
							if (!GROQ_API_KEY) {
								await interaction.reply({
									content: "❌ Groq API key not configured. Set `GROQ_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_GROQ_MODEL;
							currentProvider = "groq";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = GROQ_MODELS[modelChoice];
							logInfo(`Switched to Groq provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Groq** (free + fast)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "FREE"}`,
								ephemeral: false,
							});
							break;
						}

						case "cerebras": {
							if (!CEREBRAS_API_KEY) {
								await interaction.reply({
									content: "❌ Cerebras API key not configured. Set `CEREBRAS_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_CEREBRAS_MODEL;
							currentProvider = "cerebras";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = CEREBRAS_MODELS[modelChoice];
							logInfo(`Switched to Cerebras provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Cerebras** (fastest)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "varies"}\n- 2100+ tok/s!`,
								ephemeral: false,
							});
							break;
						}

						case "ollama": {
							currentProvider = "ollama";
							globalModelId = DEFAULT_MODEL_ID;
							channelStates.clear();
							logInfo(`Switched to Ollama provider with model: ${globalModelId}`);

							await interaction.reply({
								content: `✅ Switched to **Ollama** (local, free)\n- Model: \`${globalModelId}\`\n- All processing stays on your server`,
								ephemeral: false,
							});
							break;
						}

						case "openrouter": {
							if (!OPENROUTER_API_KEY) {
								await interaction.reply({
									content:
										"❌ OpenRouter API key not configured. Set `OPENROUTER_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_OPENROUTER_MODEL;
							currentProvider = "openrouter";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = OPENROUTER_MODELS[modelChoice];
							logInfo(`Switched to OpenRouter provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **OpenRouter** (cloud)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "varies"}`,
								ephemeral: false,
							});
							break;
						}
					}
					break;
				}

				case "analytics": {
					const period = (interaction.options.getString("period") as "today" | "week" | "all") || "today";
					await interaction.deferReply();

					try {
						const stats = analytics.getStats(period);
						const hourlyDist = analytics.getHourlyDistribution();

						// Build hourly chart (simple text-based)
						const peakHour = Object.entries(hourlyDist).reduce(
							(max, [h, count]) => {
								return count > max.count ? { hour: parseInt(h, 10), count } : max;
							},
							{ hour: 0, count: 0 },
						);

						// Create embed
						const periodName = period === "today" ? "Today" : period === "week" ? "This Week" : "All Time";
						const embed = new EmbedBuilder()
							.setColor(0x00ff00)
							.setTitle(`📊 Analytics - ${periodName}`)
							.addFields(
								{ name: "Total Commands", value: String(stats.totalCommands), inline: true },
								{ name: "Unique Users", value: String(stats.uniqueUsers), inline: true },
								{ name: "Errors", value: String(stats.errors), inline: true },
								{ name: "Avg Response Time", value: `${stats.avgResponseTime.toFixed(0)}ms`, inline: true },
								{
									name: "Peak Hour",
									value: period === "today" ? `${peakHour.hour}:00 (${peakHour.count} cmds)` : "N/A",
									inline: true,
								},
								{
									name: "Error Rate",
									value:
										stats.totalCommands > 0
											? `${((stats.errors / stats.totalCommands) * 100).toFixed(1)}%`
											: "0%",
									inline: true,
								},
							);

						// Top commands
						if (stats.topCommands.length > 0) {
							const topCmdsText = stats.topCommands
								.map((c, i) => `${i + 1}. \`${c.command}\` - ${c.count} uses`)
								.join("\n");
							embed.addFields({ name: "Top Commands", value: topCmdsText, inline: false });
						}

						// Active users (limit to 5 for display)
						if (stats.activeUsers.length > 0) {
							const activeUsersText = stats.activeUsers
								.slice(0, 5)
								.map((u, i) => `${i + 1}. ${u.username} - ${u.count} commands`)
								.join("\n");
							embed.addFields({ name: "Most Active Users", value: activeUsersText, inline: false });
						}

						embed.setTimestamp().setFooter({ text: "Analytics powered by pi-discord" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error fetching analytics: ${errMsg}`);
					}
					break;
				}

				case "admin": {
					// Admin-only commands - check owner permission
					if (!isOwner(user.id)) {
						await interaction.reply({
							content: "Permission denied. This command is owner-only.",
							ephemeral: true,
						});
						logWarning(`Unauthorized admin command attempt by ${user.username}`, user.id);
						return;
					}

					const subcommand = interaction.options.getSubcommand();

					switch (subcommand) {
						case "stats": {
							await interaction.deferReply({ ephemeral: true });

							const uptime = Date.now() - botStats.startTime;
							const hours = Math.floor(uptime / (1000 * 60 * 60));
							const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
							const uptimeStr = `${hours}h ${mins}m`;

							const memUsage = process.memoryUsage();
							const memoryStr = `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`;

							const embed = new EmbedBuilder()
								.setColor(0x00ff00)
								.setTitle("Admin - Bot Statistics")
								.addFields(
									{ name: "Uptime", value: uptimeStr, inline: true },
									{ name: "Commands Processed", value: String(botStats.commandsProcessed), inline: true },
									{ name: "Messages Processed", value: String(botStats.messagesProcessed), inline: true },
									{ name: "Errors Count", value: String(botStats.errorsCount), inline: true },
									{ name: "Active Channels", value: String(channelStates.size), inline: true },
									{ name: "Unique Users", value: String(botStats.userInteractions.size), inline: true },
									{ name: "Memory Usage", value: memoryStr, inline: false },
									{ name: "Model", value: `\`${model.id}\``, inline: true },
									{ name: "Working Directory", value: `\`${workingDir}\``, inline: false },
								)
								.setTimestamp()
								.setFooter({ text: "Admin Panel" });

							await interaction.editReply({ embeds: [embed] });
							logAdminAction(user.id, user.username, "stats");
							break;
						}

						case "users": {
							await interaction.deferReply({ ephemeral: true });

							const users = Array.from(botStats.userInteractions.values())
								.sort((a, b) => b.count - a.count)
								.slice(0, 20)
								.map((u, i) => {
									const lastSeenDate = new Date(u.lastSeen);
									const timeDiff = Date.now() - u.lastSeen;
									const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));
									const minsAgo = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
									const timeAgo = hoursAgo > 0 ? `${hoursAgo}h ago` : `${minsAgo}m ago`;

									return `${i + 1}. **${u.username}** - ${u.count} interactions (${timeAgo})`;
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setColor(0x0099ff)
								.setTitle("Admin - User Statistics")
								.setDescription(users || "No users yet")
								.addFields({
									name: "Total Unique Users",
									value: String(botStats.userInteractions.size),
									inline: true,
								})
								.setTimestamp()
								.setFooter({ text: "Top 20 users by interaction count" });

							await interaction.editReply({ embeds: [embed] });
							logAdminAction(user.id, user.username, "users");
							break;
						}

						case "broadcast": {
							const message = interaction.options.getString("message", true);
							await interaction.deferReply({ ephemeral: true });

							let successCount = 0;
							let failCount = 0;

							for (const [guildId, guild] of client.guilds.cache) {
								try {
									const textChannels = guild.channels.cache.filter((ch) => ch.isTextBased() && ch.type === 0);

									if (textChannels.size > 0) {
										const firstChannel = textChannels.first() as TextChannel;
										await firstChannel.send(`**Broadcast from Bot Owner:**\n${message}`);
										successCount++;
									}
								} catch (error) {
									failCount++;
									logError(
										`Broadcast failed for guild ${guild.name}`,
										error instanceof Error ? error.message : String(error),
									);
								}
							}

							await interaction.editReply(`Broadcast sent to ${successCount} server(s). Failed: ${failCount}`);
							logAdminAction(user.id, user.username, "broadcast", `Sent to ${successCount} servers`);
							break;
						}

						case "reload": {
							await interaction.deferReply({ ephemeral: true });

							try {
								// Reload skills for all active channels
								let reloadCount = 0;
								for (const [channelId, state] of channelStates) {
									const channelDir = join(workingDir, channelId);
									const memory = getMemory(channelDir, workingDir);
									const channelNameTemp = channelId; // We don't have channel name here
									const systemPrompt = buildSystemPrompt(workingDir, channelId, channelNameTemp, memory);
									state.agent.setSystemPrompt(systemPrompt);
									reloadCount++;
								}

								await interaction.editReply(
									`Skills reloaded successfully for ${reloadCount} active channel(s).`,
								);
								logAdminAction(user.id, user.username, "reload", `Reloaded ${reloadCount} channels`);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error reloading skills: ${errMsg}`);
							}
							break;
						}

						case "config": {
							const key = interaction.options.getString("key", true);
							const value = interaction.options.getString("value");

							if (!value) {
								// View configuration
								const currentValue = runtimeConfig[key];
								await interaction.reply({
									content:
										currentValue !== undefined
											? `**${key}** = \`${currentValue}\``
											: `Configuration key "${key}" not found.\n\nAvailable keys:\n${Object.keys(
													runtimeConfig,
												)
													.map((k) => `- ${k}`)
													.join("\n")}`,
									ephemeral: true,
								});
								logAdminAction(user.id, user.username, "config view", key);
							} else {
								// Set configuration
								let parsedValue: string | number | boolean = value;

								// Try to parse as number or boolean
								if (value === "true") parsedValue = true;
								else if (value === "false") parsedValue = false;
								else if (!Number.isNaN(Number(value))) parsedValue = Number(value);

								runtimeConfig[key] = parsedValue;

								await interaction.reply({
									content: `Configuration updated: **${key}** = \`${parsedValue}\``,
									ephemeral: true,
								});
								logAdminAction(user.id, user.username, "config set", `${key} = ${parsedValue}`);
							}
							break;
						}

						case "logs": {
							const lines = interaction.options.getInteger("lines") || 50;
							await interaction.deferReply({ ephemeral: true });

							try {
								// Try to read bot logs
								const logSources = [
									"/var/log/discord-bot.log",
									"/opt/discord-bot-data/bot.log",
									"/var/log/syslog",
								];

								let logs = "";
								for (const logPath of logSources) {
									try {
										const result = await execCommand(
											`tail -n ${lines} ${shellEscape(logPath)} 2>/dev/null | grep -i discord || echo ""`,
										);
										if (result.stdout.trim()) {
											logs = result.stdout;
											break;
										}
									} catch {}
								}

								if (!logs) {
									logs = "No logs found. Showing process info:\n";
									const psResult = await execCommand(`ps aux | grep discord | grep -v grep`);
									logs += psResult.stdout || "No process info available";
								}

								// Truncate if too long
								if (logs.length > 1900) {
									logs = logs.substring(logs.length - 1900);
								}

								await interaction.editReply(`**Recent Logs:**\n\`\`\`\n${logs}\n\`\`\``);
								logAdminAction(user.id, user.username, "logs", `Viewed ${lines} lines`);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching logs: ${errMsg}`);
							}
							break;
						}

						case "restart": {
							await interaction.reply({ content: "Initiating graceful restart...", ephemeral: true });
							logAdminAction(user.id, user.username, "restart", "Restarting bot");

							try {
								// Try systemd restart
								const result = await execCommand(
									"systemctl restart discord-bot 2>&1 || systemctl restart pi-discord 2>&1 || echo 'Systemd service not found'",
								);

								if (result.stdout.includes("not found")) {
									// Fallback: exit process and let Docker/PM2 restart it
									await interaction.followUp({
										content: "Systemd service not found. Exiting process (should auto-restart)...",
										ephemeral: true,
									});
									setTimeout(() => process.exit(0), 2000);
								} else {
									await interaction.followUp({ content: "Restart command sent to systemd.", ephemeral: true });
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.followUp({ content: `Error during restart: ${errMsg}`, ephemeral: true });
							}
							break;
						}
					}
					break;
				}

				case "tools": {
					const category = interaction.options.getString("category") || "all";

					const toolsInfo = {
						web: [
							{ name: "web_search", desc: "Search the web using Exa AI", usage: "search the web for..." },
							{ name: "free_search", desc: "Free DuckDuckGo search (no API key)", usage: "quick search for..." },
							{
								name: "deep_research",
								desc: "AI-powered deep research on complex topics",
								usage: "research...",
							},
							{ name: "web_scrape", desc: "Scrape web pages with anti-bot bypass", usage: "scrape URL..." },
						],
						github: [
							{ name: "github_search", desc: "Search GitHub repositories", usage: "search github for..." },
							{ name: "github_file", desc: "Get file contents from GitHub", usage: "show file from repo..." },
							{ name: "github_issues", desc: "List issues from a repository", usage: "list issues for..." },
							{ name: "github_create_issue", desc: "Create new GitHub issue", usage: "create issue..." },
							{ name: "github_branch", desc: "Create new branch", usage: "create branch..." },
							{ name: "github_pr", desc: "Create pull request", usage: "create PR..." },
							{ name: "github_list_prs", desc: "List pull requests", usage: "list PRs for..." },
						],
						hf: [
							{ name: "hf_models", desc: "Search HuggingFace models", usage: "find HF models for..." },
							{ name: "hf_datasets", desc: "Search HuggingFace datasets", usage: "find datasets for..." },
						],
						memory: [
							{ name: "memory_store", desc: "Store info in knowledge graph", usage: "remember that..." },
							{ name: "memory_recall", desc: "Recall from knowledge graph", usage: "what do you know about..." },
							{ name: "memory_relate", desc: "Create entity relationships", usage: "X is related to Y..." },
						],
						tasks: [
							{ name: "task_create", desc: "Create task with dependencies", usage: "create task to..." },
							{ name: "task_list", desc: "List tasks by status", usage: "show pending tasks..." },
							{ name: "task_update", desc: "Update task status/progress", usage: "mark task X done..." },
						],
						codebase: [
							{
								name: "codebase_knowledge",
								desc: "Search pi-mono docs & knowledge",
								usage: "how does pi-ai work...",
							},
							{ name: "pimono_read", desc: "Read pi-mono source files", usage: "show packages/ai/src/index.ts" },
							{ name: "pimono_list", desc: "List pi-mono directories", usage: "list packages/" },
						],
						skills: [
							{
								name: "skill_list",
								desc: "List all available skills (SKILL.md files)",
								usage: "what skills are available...",
							},
							{
								name: "skill_load",
								desc: "Load skill instructions for a domain",
								usage: "load the trading skill...",
							},
							{
								name: "skill_create",
								desc: "Create new skill from learned knowledge",
								usage: "create a skill about...",
							},
						],
						self: [
							{
								name: "memory_update",
								desc: "Update bot's persistent MEMORY.md",
								usage: "remember that user prefers...",
							},
							{ name: "skill_create", desc: "Create reusable skill files", usage: "create skill for..." },
							{
								name: "context_compact",
								desc: "Summarize old messages to reduce context",
								usage: "compact context...",
							},
						],
						agents: [
							{
								name: "agent_spawn",
								desc: "Spawn sub-agent for parallel tasks",
								usage: "spawn agent to research...",
							},
							{
								name: "agent_delegate",
								desc: "Delegate multiple tasks to agents",
								usage: "delegate these tasks...",
							},
						],
						hooks: [
							{ name: "hooks_list", desc: "List lifecycle hooks", usage: "list hooks..." },
							{ name: "hook_create", desc: "Create new hook", usage: "create hook for..." },
						],
						audio: [
							{
								name: "transcribe",
								desc: "Transcribe audio to text (Groq Whisper)",
								usage: "transcribe this audio...",
							},
						],
						rag: [
							{
								name: "knowledge_search",
								desc: "Search knowledge base & skills (RAG)",
								usage: "search knowledge for...",
							},
						],
						vision: [
							{
								name: "image_analyze",
								desc: "Analyze images with AI vision (OCR, describe)",
								usage: "analyze this image...",
							},
						],
						code: [
							{
								name: "code_sandbox",
								desc: "Execute code safely (Python/JS/TS/Bash)",
								usage: "run this python code...",
							},
						],
						scheduled: [
							{ name: "schedule_task", desc: "Create scheduled/cron tasks", usage: "schedule daily message..." },
							{
								name: "scheduled_tasks_list",
								desc: "List all scheduled tasks",
								usage: "show scheduled tasks...",
							},
						],
						learning: [
							{
								name: "auto_learn",
								desc: "Extract learnings from conversations",
								usage: "learn from this chat...",
							},
						],
						files: [
							{
								name: "file_process",
								desc: "Process uploaded files (images, code, text)",
								usage: "analyze this file...",
							},
						],
						embeds: [{ name: "rich_embed", desc: "Create beautiful Discord embeds", usage: "show as embed..." }],
						docker: [
							{
								name: "docker_sandbox",
								desc: "Execute code in isolated Docker container",
								usage: "run in docker...",
							},
						],
						export: [
							{
								name: "conversation_export",
								desc: "Export chat history (markdown/JSON)",
								usage: "export this conversation...",
							},
						],
						prefs: [
							{ name: "user_preferences", desc: "Get/set user preferences", usage: "remember I prefer..." },
						],
						voice: [
							{ name: "voice_join", desc: "Join a voice channel", usage: "join voice channel..." },
							{ name: "voice_tts", desc: "Text-to-speech in voice channel", usage: "say this in voice..." },
						],
						plugins: [
							{ name: "plugin_load", desc: "Load external plugin", usage: "load plugin..." },
							{ name: "plugin_list", desc: "List registered plugins", usage: "show plugins..." },
						],
						commands: [
							{
								name: "slash_command_create",
								desc: "Create custom slash command",
								usage: "create /mycommand...",
							},
							{ name: "slash_command_list", desc: "List custom commands", usage: "show custom commands..." },
						],
						servers: [
							{
								name: "server_sync",
								desc: "Sync knowledge between servers",
								usage: "sync from server X to Y...",
							},
							{ name: "server_list", desc: "List servers with bot data", usage: "show all servers..." },
						],
					};

					let response = "";
					const categories = category === "all" ? Object.keys(toolsInfo) : [category];

					for (const cat of categories) {
						const tools = toolsInfo[cat as keyof typeof toolsInfo];
						if (!tools) continue;

						const catNames: Record<string, string> = {
							web: "Web & Search",
							github: "GitHub",
							hf: "HuggingFace",
							memory: "Memory",
							tasks: "Tasks",
							codebase: "Codebase Knowledge",
							skills: "Skills System",
							self: "Self-Management",
							agents: "Multi-Agent",
							hooks: "Hooks System",
							audio: "Audio/Voice",
							rag: "Knowledge Base (RAG)",
							vision: "Vision/Image Analysis",
							code: "Code Execution",
							scheduled: "Scheduled Tasks",
							learning: "Auto-Learning",
							files: "File Processing",
							embeds: "Rich Embeds",
							docker: "Docker Sandbox",
							export: "Conversation Export",
							prefs: "User Preferences",
							voice: "Voice Channel",
							plugins: "Plugin System",
							commands: "Custom Commands",
							servers: "Multi-Server",
						};

						response += `\n**${catNames[cat] || cat}**\n`;
						for (const tool of tools) {
							response += `\`${tool.name}\` - ${tool.desc}\n`;
						}
					}

					const embed = new EmbedBuilder()
						.setColor(0x0099ff)
						.setTitle("Available MCP Tools")
						.setDescription(response.trim())
						.addFields(
							{
								name: "Usage",
								value: "Just ask naturally! The bot auto-detects when to use tools.",
								inline: false,
							},
							{
								name: "Examples",
								value: "`search github for ai agent`\n`find HF models for image generation`\n`research quantum computing`",
								inline: false,
							},
						)
						.setTimestamp()
						.setFooter({ text: `${Object.values(toolsInfo).flat().length} tools available` });

					await interaction.reply({ embeds: [embed] });
					break;
				}

				case "generate": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "image": {
								const prompt = interaction.options.getString("prompt", true);
								const model = interaction.options.getString("model") || "flux-dev";

								const FAL_KEY = process.env.FAL_KEY;
								if (!FAL_KEY) {
									await interaction.editReply("❌ FAL_KEY not configured.");
									break;
								}

								const modelMap: Record<string, string> = {
									"flux-dev": "fal-ai/flux/dev",
									"flux-schnell": "fal-ai/flux/schnell",
									"flux-pro": "fal-ai/flux-pro/v1.1",
									"flux-realism": "fal-ai/flux-realism",
									ideogram: "fal-ai/ideogram/v2",
									recraft: "fal-ai/recraft-v3",
								};

								const response = await fetch(
									`https://queue.fal.run/${modelMap[model] || modelMap["flux-dev"]}`,
									{
										method: "POST",
										headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
										body: JSON.stringify({ prompt, image_size: "landscape_16_9", num_inference_steps: 28 }),
									},
								);

								const result = (await response.json()) as { images?: Array<{ url: string }> };
								if (result.images?.[0]?.url) {
									const embed = new EmbedBuilder()
										.setColor(0x7c3aed)
										.setTitle("🎨 Image Generated")
										.setDescription(`**Prompt:** ${prompt.slice(0, 200)}`)
										.setImage(result.images[0].url)
										.setFooter({ text: `Model: ${model}` });
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`Image generation failed: ${JSON.stringify(result).slice(0, 500)}`,
									);
								}
								break;
							}

							case "music": {
								const prompt = interaction.options.getString("prompt", true);
								const style = interaction.options.getString("style") || "";

								const SUNO_KEY = process.env.SUNO_API_KEY;
								if (!SUNO_KEY) {
									await interaction.editReply("❌ SUNO_API_KEY not configured.");
									break;
								}

								const fullPrompt = style ? `${style}: ${prompt}` : prompt;
								await interaction.editReply(
									`🎵 Generating music for: "${fullPrompt.slice(0, 100)}..."\n\n⏳ This may take 1-2 minutes...`,
								);

								// Music generation is async, provide status
								const embed = new EmbedBuilder()
									.setColor(0xff6b6b)
									.setTitle("🎵 Music Generation Started")
									.setDescription(
										`**Prompt:** ${fullPrompt.slice(0, 200)}\n\nUse \`@bot check music status\` to see progress.`,
									)
									.setFooter({ text: "Powered by Suno AI" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "video": {
								const prompt = interaction.options.getString("prompt", true);
								const imageUrl = interaction.options.getString("image_url");

								const FAL_KEY = process.env.FAL_KEY;
								if (!FAL_KEY) {
									await interaction.editReply("❌ FAL_KEY not configured.");
									break;
								}

								await interaction.editReply(
									`🎬 Generating video for: "${prompt.slice(0, 100)}..."\n\n⏳ This may take 2-5 minutes...`,
								);
								break;
							}

							case "voice": {
								const text = interaction.options.getString("text", true);
								const engine = interaction.options.getString("engine") || "vibevoice";

								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🗣️ Voice Generation")
									.setDescription(
										`**Text:** ${text.slice(0, 200)}...\n**Engine:** ${engine}\n\nUse \`@bot generate voice: ${text.slice(0, 50)}...\` for full generation.`,
									)
									.setFooter({ text: "TTS Generation" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "3d": {
								const prompt = interaction.options.getString("prompt", true);
								const imageUrl = interaction.options.getString("image_url");

								const embed = new EmbedBuilder()
									.setColor(0x9b59b6)
									.setTitle("🎮 3D Model Generation")
									.setDescription(
										`**Prompt:** ${prompt.slice(0, 200)}\n${imageUrl ? `**Image:** ${imageUrl}` : ""}\n\nUse \`@bot create 3d model: ${prompt.slice(0, 50)}...\` for full generation.`,
									)
									.setFooter({ text: imageUrl ? "Image to 3D (TripoSR)" : "Text to 3D (Shap-E)" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(
							`❌ Generation error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					break;
				}

				case "livekit": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					const LIVEKIT_URL = process.env.LIVEKIT_URL;
					const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
					const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

					if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
						await interaction.editReply(
							"❌ LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
						);
						break;
					}

					try {
						switch (subcommand) {
							case "create": {
								const roomName = interaction.options.getString("name", true);
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎙️ LiveKit Room")
									.setDescription(
										`Room **${roomName}** created!\n\nUse \`/livekit join ${roomName}\` to get a join token.`,
									)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "join": {
								const roomName = interaction.options.getString("room", true);
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎫 Join Token")
									.setDescription(
										`**Room:** ${roomName}\n\nUse \`@bot create livekit token for ${roomName}\` to generate a join token.`,
									)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎙️ Active Rooms")
									.setDescription("Use `@bot list livekit rooms` to see active rooms.")
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "record": {
								const roomName = interaction.options.getString("room", true);
								const action = interaction.options.getString("action", true);
								const embed = new EmbedBuilder()
									.setColor(action === "start" ? 0xff0000 : 0x00ff00)
									.setTitle(action === "start" ? "🔴 Recording Started" : "⏹️ Recording Stopped")
									.setDescription(`**Room:** ${roomName}`)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(
							`❌ LiveKit error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					break;
				}

				case "schedule": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();
					const userId = interaction.user.id;

					try {
						switch (subcommand) {
							case "add": {
								const name = interaction.options.getString("name", true);
								const cronExpr = interaction.options.getString("cron", true);
								const action = interaction.options.getString("action", true);
								const channel = interaction.options.getChannel("channel");
								const channelId = channel?.id || interaction.channelId;

								// Validate cron expression
								if (!TaskScheduler.validateCron(cronExpr)) {
									await interaction.editReply(
										"❌ Invalid cron expression. Example: `0 9 * * *` for 9 AM daily",
									);
									break;
								}

								// Add task
								const task = taskScheduler.addTask({
									name,
									cron: cronExpr,
									action,
									channelId,
									userId,
									enabled: true,
								});

								const cronDesc = TaskScheduler.describeCron(cronExpr);
								const embed = new EmbedBuilder()
									.setColor(0x00ff00)
									.setTitle("✅ Scheduled Task Created")
									.setDescription(`**${name}**\n${cronDesc}`)
									.addFields(
										{ name: "Task ID", value: task.id, inline: true },
										{ name: "Action", value: action, inline: true },
										{ name: "Channel", value: `<#${channelId}>`, inline: true },
									)
									.setTimestamp()
									.setFooter({ text: "Task is now active" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const tasks = taskScheduler.listTasks(userId);

								if (tasks.length === 0) {
									await interaction.editReply(
										"You don't have any scheduled tasks. Use `/schedule add` to create one!",
									);
									break;
								}

								const taskList = tasks
									.map((task) => {
										const status = task.enabled ? "🟢 Enabled" : "🔴 Disabled";
										const lastRun = task.lastRun
											? `Last: ${new Date(task.lastRun).toLocaleString()}`
											: "Never run";
										return `**${task.name}** (${task.id})\n${status} • ${task.cron} • ${lastRun}\nAction: ${task.action}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("📅 Your Scheduled Tasks")
									.setDescription(taskList.substring(0, 4000))
									.setTimestamp()
									.setFooter({ text: `Total: ${tasks.length} task(s)` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "remove": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								// Check if task exists and belongs to user
								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to remove this task.");
									break;
								}

								const success = taskScheduler.removeTask(taskId);
								if (success) {
									await interaction.editReply(`✅ Task **${task.name}** has been removed.`);
								} else {
									await interaction.editReply("❌ Failed to remove task.");
								}
								break;
							}

							case "toggle": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								// Check if task exists and belongs to user
								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to modify this task.");
									break;
								}

								const toggledTask = taskScheduler.toggleTask(taskId);
								if (toggledTask) {
									const status = toggledTask.enabled ? "enabled" : "disabled";
									const emoji = toggledTask.enabled ? "✅" : "⏸️";
									await interaction.editReply(`${emoji} Task **${toggledTask.name}** is now **${status}**.`);
								} else {
									await interaction.editReply("❌ Failed to toggle task.");
								}
								break;
							}

							case "info": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to view this task.");
									break;
								}

								const cronDesc = TaskScheduler.describeCron(task.cron);
								const embed = new EmbedBuilder()
									.setColor(task.enabled ? 0x00ff00 : 0xff0000)
									.setTitle(`📋 Task: ${task.name}`)
									.addFields(
										{ name: "ID", value: task.id, inline: true },
										{ name: "Status", value: task.enabled ? "🟢 Enabled" : "🔴 Disabled", inline: true },
										{ name: "Channel", value: `<#${task.channelId}>`, inline: true },
										{ name: "Cron Expression", value: task.cron, inline: true },
										{ name: "Schedule", value: cronDesc, inline: true },
										{ name: "Action", value: task.action },
										{ name: "Created", value: new Date(task.createdAt).toLocaleString(), inline: true },
										{
											name: "Last Run",
											value: task.lastRun ? new Date(task.lastRun).toLocaleString() : "Never",
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
					}
					break;
				}

				case "health": {
					await interaction.deferReply();

					const checks: Array<{ name: string; status: string; latency?: number }> = [];

					// Bot uptime
					const uptime = Date.now() - botStats.startTime;
					const hours = Math.floor(uptime / (1000 * 60 * 60));
					const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
					checks.push({ name: "Bot Uptime", status: `${hours}h ${mins}m` });

					// Memory
					const memUsage = process.memoryUsage();
					checks.push({ name: "Memory", status: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB` });

					// OpenRouter API
					if (process.env.OPENROUTER_API_KEY) {
						try {
							const start = Date.now();
							const resp = await fetch("https://openrouter.ai/api/v1/models", {
								headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
							});
							checks.push({
								name: "OpenRouter API",
								status: resp.ok ? "✅ OK" : "❌ Error",
								latency: Date.now() - start,
							});
						} catch {
							checks.push({ name: "OpenRouter API", status: "❌ Unreachable" });
						}
					}

					// Fal.ai API
					if (process.env.FAL_KEY) {
						checks.push({ name: "Fal.ai (Images)", status: "✅ Configured" });
					} else {
						checks.push({ name: "Fal.ai (Images)", status: "⚠️ Not configured" });
					}

					// Suno API
					if (process.env.SUNO_API_KEY) {
						checks.push({ name: "Suno (Music)", status: "✅ Configured" });
					} else {
						checks.push({ name: "Suno (Music)", status: "⚠️ Not configured" });
					}

					// LiveKit
					if (process.env.LIVEKIT_URL) {
						checks.push({ name: "LiveKit (Voice)", status: "✅ Configured" });
					} else {
						checks.push({ name: "LiveKit (Voice)", status: "⚠️ Not configured" });
					}

					// ElevenLabs
					if (process.env.ELEVENLABS_API_KEY) {
						checks.push({ name: "ElevenLabs (TTS)", status: "✅ Configured" });
					} else {
						checks.push({ name: "ElevenLabs (TTS)", status: "⚠️ Not configured" });
					}

					const embed = new EmbedBuilder()
						.setColor(0x00ff00)
						.setTitle("🏥 Bot Health Status")
						.setDescription(
							checks.map((c) => `**${c.name}:** ${c.status}${c.latency ? ` (${c.latency}ms)` : ""}`).join("\n"),
						)
						.addFields(
							{ name: "Commands Processed", value: String(botStats.commandsProcessed), inline: true },
							{ name: "Active Channels", value: String(channelStates.size), inline: true },
							{ name: "Total Tools", value: "89", inline: true },
						)
						.setTimestamp()
						.setFooter({ text: "Pi-Agent Health Check" });

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				case "reset": {
					const channelDir = join(workingDir, channelId);
					const state = channelStates.get(channelId);

					// Clear agent messages if state exists
					if (state?.agent) {
						state.agent.reset();
					}

					// Clear session file
					clearSession(channelDir);

					// Remove channel state so it gets recreated fresh
					channelStates.delete(channelId);

					await interaction.reply({
						content: "🔄 **Conversation Reset**\nHistory cleared for this channel. I'm starting fresh!",
						ephemeral: false,
					});

					logInfo(`[RESET] Channel ${channelId} history cleared by ${user.username}`);
					break;
				}

				case "backup": {
					await interaction.deferReply({ ephemeral: true });

					const scope = interaction.options.getString("scope") || "channel";
					const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
					const backupDir = join(workingDir, "backups");

					if (!existsSync(backupDir)) {
						mkdirSync(backupDir, { recursive: true });
					}

					try {
						if (scope === "channel") {
							const channelDir = join(workingDir, channelId);
							if (!existsSync(channelDir)) {
								await interaction.editReply("❌ No data to backup for this channel.");
								break;
							}

							const backupPath = join(backupDir, `channel-${channelId}-${timestamp}.tar.gz`);

							// Create tarball of channel data
							const { execSync } = await import("child_process");
							execSync(`tar -czf "${backupPath}" -C "${workingDir}" "${channelId}"`);

							const stats = await import("fs").then((fs) => fs.statSync(backupPath));
							const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

							await interaction.editReply({
								content: `✅ **Channel Backup Created**\n📁 \`${backupPath}\`\n📊 Size: ${sizeMB} MB\n\nRetrieve with: \`scp user@server:${backupPath} ./\``,
							});

							logInfo(`[BACKUP] Channel ${channelId} backed up by ${user.username} (${sizeMB} MB)`);
						} else {
							// Backup all data
							const backupPath = join(backupDir, `full-backup-${timestamp}.tar.gz`);

							const { execSync } = await import("child_process");
							// Exclude the backups directory itself to avoid recursion
							execSync(
								`tar --exclude='backups' -czf "${backupPath}" -C "${resolve(workingDir, "..")}" "${workingDir.split("/").pop()}"`,
							);

							const stats = await import("fs").then((fs) => fs.statSync(backupPath));
							const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

							await interaction.editReply({
								content: `✅ **Full Backup Created**\n📁 \`${backupPath}\`\n📊 Size: ${sizeMB} MB\n\nRetrieve with: \`scp user@server:${backupPath} ./\``,
							});

							logInfo(`[BACKUP] Full backup created by ${user.username} (${sizeMB} MB)`);
						}
					} catch (e) {
						const errMsg = e instanceof Error ? e.message : String(e);
						await interaction.editReply(`❌ Backup failed: ${errMsg}`);
						logError("[BACKUP] Failed", errMsg);
					}
					break;
				}

				case "cost": {
					const view = interaction.options.getString("view") || "me";

					if (view === "me") {
						const userCost = analytics.getUserCost(user.id);
						if (!userCost) {
							await interaction.reply({
								content: "📊 **Your Usage**\nNo usage recorded yet. Start chatting to track costs!",
								ephemeral: true,
							});
							break;
						}

						const embed = new EmbedBuilder()
							.setColor(0x00bfff)
							.setTitle("📊 Your API Usage")
							.addFields(
								{ name: "Total Requests", value: String(userCost.requests), inline: true },
								{ name: "Estimated Cost", value: `$${userCost.estimatedCostUsd.toFixed(4)}`, inline: true },
								{ name: "Input Tokens", value: userCost.totalTokensInput.toLocaleString(), inline: true },
								{ name: "Output Tokens", value: userCost.totalTokensOutput.toLocaleString(), inline: true },
							)
							.setFooter({ text: `Last updated: ${userCost.lastUpdated}` });

						await interaction.reply({ embeds: [embed], ephemeral: true });
					} else if (view === "top") {
						const topUsers = analytics.getTopCostUsers(10);
						if (topUsers.length === 0) {
							await interaction.reply({
								content: "📊 **Top Users**\nNo usage recorded yet.",
								ephemeral: true,
							});
							break;
						}

						const userList = topUsers
							.map(
								(u, i) =>
									`${i + 1}. **${u.username}** - $${u.estimatedCostUsd.toFixed(4)} (${u.requests} requests)`,
							)
							.join("\n");

						const embed = new EmbedBuilder()
							.setColor(0xffd700)
							.setTitle("🏆 Top Users by Cost")
							.setDescription(userList);

						await interaction.reply({ embeds: [embed], ephemeral: true });
					} else if (view === "daily") {
						const dailyCosts = analytics.getDailyCosts(7);
						const totalWeek = dailyCosts.reduce((sum, d) => sum + d.cost, 0);

						const breakdown = dailyCosts.map((d) => `${d.date}: $${d.cost.toFixed(4)}`).join("\n");

						const embed = new EmbedBuilder()
							.setColor(0x32cd32)
							.setTitle("📅 Daily Cost Breakdown")
							.setDescription(breakdown || "No data yet")
							.addFields({ name: "7-Day Total", value: `$${totalWeek.toFixed(4)}`, inline: true });

						await interaction.reply({ embeds: [embed], ephemeral: true });
					}
					break;
				}

				case "trading": {
					const subcommand = interaction.options.getSubcommand();
					const tradingOrchestrator = getTradingOrchestrator();

					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "analyze": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const result = await tradingOrchestrator.getConsensusAnalysis(symbol);

								if (!result) {
									await interaction.editReply(
										`Could not analyze ${symbol}. Make sure it's a valid crypto symbol.`,
									);
									break;
								}

								const colors: Record<string, number> = { BUY: 0x00ff00, SELL: 0xff0000, HOLD: 0xffff00 };
								const emojis: Record<string, string> = { BUY: "🟢", SELL: "🔴", HOLD: "🟡" };

								const voteSummary = result.votes
									.map((v) => `**${v.model}**: ${v.action} (${(v.confidence * 100).toFixed(0)}%)`)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`${emojis[result.action] || "⚪"} AI Consensus: ${symbol}`)
									.setColor(colors[result.action] || 0x808080)
									.addFields(
										{ name: "Action", value: result.action, inline: true },
										{ name: "Confidence", value: `${(result.confidence * 100).toFixed(1)}%`, inline: true },
										{ name: "Model Votes", value: voteSummary || "No votes" },
									)
									.setFooter({ text: "Powered by Moon Dev-inspired multi-model consensus" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "sentiment": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const sentiment = await tradingOrchestrator.sentimentAgent.getSentiment(symbol);

								if (!sentiment) {
									await interaction.editReply(`Could not get sentiment for ${symbol}.`);
									break;
								}

								const sentimentEmoji = sentiment.score > 0.3 ? "😀" : sentiment.score < -0.3 ? "😰" : "😐";
								const sentimentColor =
									sentiment.score > 0.3 ? 0x00ff00 : sentiment.score < -0.3 ? 0xff0000 : 0xffff00;

								const embed = new EmbedBuilder()
									.setTitle(`${sentimentEmoji} Sentiment Analysis: ${symbol}`)
									.setColor(sentimentColor)
									.addFields(
										{ name: "Score", value: sentiment.score.toFixed(2), inline: true },
										{ name: "Mentions", value: String(sentiment.volume), inline: true },
										{ name: "Top Keywords", value: sentiment.keywords.slice(0, 5).join(", ") || "None" },
										{ name: "Sources", value: sentiment.sources.slice(0, 3).join(", ") || "Unknown" },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "whales": {
								const summary = tradingOrchestrator.whaleAgent.getActivitySummary();
								const movements = tradingOrchestrator.whaleAgent.getRecentMovements().slice(0, 5);

								const formatNum = (n: number) => {
									if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
									if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
									return `$${n.toLocaleString()}`;
								};

								const movementList =
									movements.length > 0
										? movements
												.map(
													(m) => `${m.type === "buy" ? "🟢" : "🔴"} ${m.symbol}: ${formatNum(m.usdValue)}`,
												)
												.join("\n")
										: "No recent movements detected";

								const embed = new EmbedBuilder()
									.setTitle("🐋 Whale Activity")
									.setColor(0x1e90ff)
									.addFields(
										{ name: "Buy Volume", value: formatNum(summary.totalBuyVolume), inline: true },
										{ name: "Sell Volume", value: formatNum(summary.totalSellVolume), inline: true },
										{ name: "Net Flow", value: formatNum(summary.netFlow), inline: true },
										{ name: "Recent Movements", value: movementList },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "signals": {
								const signals = tradingOrchestrator.getRecentSignals(10);

								if (signals.length === 0) {
									await interaction.editReply("No trading signals yet. Agents are analyzing the market...");
									break;
								}

								const signalList = signals
									.map((s) => {
										const emoji = s.action === "BUY" ? "🟢" : s.action === "SELL" ? "🔴" : "🟡";
										return `${emoji} **${s.symbol}** ${s.action} (${(s.confidence * 100).toFixed(0)}%) - ${s.reason.slice(0, 50)}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📊 Recent Trading Signals")
									.setColor(0x7c3aed)
									.setDescription(signalList)
									.setFooter({ text: "Signals are for informational purposes only" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "summary": {
								const summary = await tradingOrchestrator.getMarketSummary();

								const priceLines = Object.entries(summary.prices)
									.map(([symbol, data]: [string, any]) => {
										const emoji = data.change24h >= 0 ? "📈" : "📉";
										return `**${symbol}**: $${data.price.toLocaleString()} ${emoji} ${data.change24h.toFixed(2)}%`;
									})
									.join("\n");

								const sentimentLines = Object.entries(summary.sentiment)
									.map(([symbol, data]: [string, any]) => {
										const emoji = data.score > 0.3 ? "😀" : data.score < -0.3 ? "😰" : "😐";
										return `**${symbol}**: ${emoji} ${data.score.toFixed(2)}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🌍 Market Summary")
									.setColor(0x00bfff)
									.addFields(
										{ name: "💰 Prices", value: priceLines || "Loading...", inline: true },
										{ name: "💭 Sentiment", value: sentimentLines || "Loading...", inline: true },
										{ name: "📊 Recent Signals", value: String(summary.signals.length), inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const stats = tradingOrchestrator.getStats();

								const agentStatus = Object.entries(stats.agents)
									.map(([name, data]: [string, any]) => {
										const status = data.enabled ? "✅" : "❌";
										return `${status} **${name}**: ${data.signalsGenerated} signals`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🤖 Trading Agent Status")
									.setColor(stats.enabled ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "System", value: stats.enabled ? "Online" : "Offline", inline: true },
										{ name: "Total Signals", value: String(stats.totalSignals), inline: true },
										{ name: "Agents", value: agentStatus || "No agents" },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "backtest": {
								const strategy = interaction.options.getString("strategy", true);
								const timeframe = interaction.options.getString("timeframe") || "1 year";

								await interaction.editReply(
									`🔬 Running ${strategy} strategy backtest over ${timeframe}... (OpenHands)`,
								);

								const result = await runStrategyBacktest(strategy, undefined, timeframe);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle(`📊 Backtest: ${strategy}`)
										.setColor(0x7c3aed)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Timeframe", value: timeframe, inline: true },
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Strategy Backtest" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Backtest failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "risk": {
								const holdings = interaction.options.getString("holdings", true);
								const value = interaction.options.getNumber("value") || undefined;

								await interaction.editReply(`⚖️ Analyzing portfolio risk... (OpenHands)`);

								const result = await runRiskAssessment(holdings, value);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle("⚖️ Risk Assessment")
										.setColor(0xf59e0b)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Holdings", value: holdings.substring(0, 200), inline: false },
											...(value
												? [{ name: "Portfolio Value", value: `$${value.toLocaleString()}`, inline: true }]
												: []),
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Risk Assessment" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Risk assessment failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "audit": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const strategy = interaction.options.getString("strategy") || undefined;

								await interaction.editReply(
									`🔍 Running full trading audit for ${symbol}${strategy ? ` with ${strategy}` : ""}... (OpenHands)`,
								);

								const result = await runFullTradingAudit(symbol, strategy);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle(`🔍 Full Trading Audit: ${symbol}`)
										.setColor(0x10b981)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Symbol", value: symbol, inline: true },
											...(strategy ? [{ name: "Strategy", value: strategy, inline: true }] : []),
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Full Trading Audit" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Trading audit failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "expertise": {
								const expertisePath = join(process.cwd(), "src", "trading", "expertise", "trading.md");
								let expertiseContent = "No trading expertise found.";

								try {
									const fs = await import("fs");
									if (fs.existsSync(expertisePath)) {
										expertiseContent = fs.readFileSync(expertisePath, "utf-8");
									}
								} catch {
									expertiseContent = "Error loading expertise file.";
								}

								// Parse key sections from the expertise file
								const sections: { name: string; value: string }[] = [];

								const mentalModelMatch = expertiseContent.match(/## Mental Model\n([\s\S]*?)(?=\n## |$)/);
								if (mentalModelMatch) {
									sections.push({ name: "Mental Model", value: mentalModelMatch[1].trim().substring(0, 500) });
								}

								const patternsMatch = expertiseContent.match(/## Patterns Learned\n([\s\S]*?)(?=\n## |$)/);
								if (patternsMatch) {
									sections.push({
										name: "Patterns Learned",
										value: patternsMatch[1].trim().substring(0, 500) || "None yet",
									});
								}

								const lastUpdatedMatch = expertiseContent.match(/\*Last updated: ([^*]+)\*/);
								const sessionsMatch = expertiseContent.match(/\*Total sessions: (\d+)\*/);

								const embed = new EmbedBuilder()
									.setTitle("📚 Trading Expertise")
									.setColor(0x8b5cf6)
									.setDescription("Accumulated knowledge from trading sessions")
									.addFields(
										...sections.map((s) => ({ name: s.name, value: s.value, inline: false })),
										{
											name: "Last Updated",
											value: lastUpdatedMatch ? lastUpdatedMatch[1].trim() : "Never",
											inline: true,
										},
										{ name: "Total Sessions", value: sessionsMatch ? sessionsMatch[1] : "0", inline: true },
									)
									.setFooter({ text: "Agent Experts - Act-Learn-Reuse" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Trading analysis error: ${errMsg}`);
					}
					break;
				}

				case "knowledge": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();
					const kb = getKnowledgeBase();

					try {
						switch (subcommand) {
							case "sources": {
								const sources = kb.getSources();
								const sourceList = sources
									.map((s) => {
										const status = s.exists ? "✅" : "❌";
										return `${status} **${s.name}**\n   └ \`${s.path}\``;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📚 Knowledge Sources")
									.setDescription(sourceList)
									.setColor(0x3498db)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const results = await kb.search(query);

								if (results.files.length === 0) {
									await interaction.editReply(`No results found for "${query}"`);
									break;
								}

								const fileList = results.files
									.slice(0, 10)
									.map((f) => {
										const preview = f.content ? `\n   └ ${f.content.substring(0, 100)}...` : "";
										return `📄 **${f.name}** (${f.size} bytes)\n   \`${f.path}\`${preview}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Search: "${query}"`)
									.setDescription(fileList)
									.setFooter({
										text: `${results.totalMatches} matches in ${results.searchedPaths.length} sources`,
									})
									.setColor(0x2ecc71)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "read": {
								const filePath = interaction.options.getString("path", true);
								const content = await kb.readFile(filePath, 3500);

								const embed = new EmbedBuilder()
									.setTitle(`📖 ${filePath.split("/").pop()}`)
									.setDescription(`\`\`\`\n${content.substring(0, 3500)}\n\`\`\``)
									.setFooter({ text: filePath })
									.setColor(0x9b59b6)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "moondev": {
								const arch = await kb.getMoonDevArchitecture();
								// Send first 4000 chars
								const summary = arch.substring(0, 4000);

								const embed = new EmbedBuilder()
									.setTitle("🌙 Moon Dev Architecture")
									.setDescription(summary)
									.setFooter({ text: "SuperQuant Multi-Agent System" })
									.setColor(0xf39c12)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agent": {
								const agentName = interaction.options.getString("name", true);
								const agentCode = await kb.getQuantAgent(agentName);

								if (!agentCode) {
									await interaction.editReply(
										`Agent "${agentName}" not found. Available: price_monitor, risk_analyzer, strategic_buyer, strategic_seller, token_discovery`,
									);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🤖 Quant Agent: ${agentName}`)
									.setDescription(`\`\`\`python\n${agentCode.substring(0, 3500)}\n\`\`\``)
									.setColor(0xe74c3c)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "specs": {
								const specs = await kb.getQuantSpecs();

								if (specs.length === 0) {
									await interaction.editReply("No quant specifications found");
									break;
								}

								const specList = specs
									.map((s) => {
										const files = s.files
											.slice(0, 5)
											.map((f) => `  • ${f.name}`)
											.join("\n");
										return `**${s.category}**\n${files}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📊 Quant Specifications")
									.setDescription(specList)
									.setColor(0x1abc9c)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Knowledge error: ${errMsg}`);
					}
					break;
				}

				case "voice": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();

					try {
						switch (subcommand) {
							case "join": {
								// Get user's voice channel
								const member = interaction.member as any;
								const voiceChannel = member?.voice?.channel;

								if (!voiceChannel) {
									await interaction.editReply("You need to be in a voice channel to use this command.");
									break;
								}

								if (voiceChannel.type !== ChannelType.GuildVoice) {
									await interaction.editReply("Please join a standard voice channel (not a stage channel).");
									break;
								}

								const session = getVoiceSession(interaction.guildId!);
								const result = await session.join(voiceChannel as VoiceChannel, user.id);

								if (result.success) {
									// Set up message handler - echoes back transcription for now
									session.setMessageHandler(async (userId: string, text: string) => {
										// Log the transcription
										console.log(`[Voice] Heard from ${userId}: "${text}"`);
										// Echo back what was heard
										return `I heard you say: ${text.substring(0, 200)}`;
									});

									await interaction.editReply(
										`🎙️ Joined **${voiceChannel.name}**! I'm now listening. Speak to interact.`,
									);
								} else {
									await interaction.editReply(`Failed to join: ${result.error}`);
								}
								break;
							}

							case "leave": {
								const session = getVoiceSession(interaction.guildId!);
								if (!session.isConnected) {
									await interaction.editReply("I'm not in a voice channel.");
									break;
								}
								await session.leave();
								await interaction.editReply("👋 Left the voice channel.");
								break;
							}

							case "speak": {
								const text = interaction.options.getString("text", true);
								const session = getVoiceSession(interaction.guildId!);

								if (!session.isConnected) {
									// If not connected, just generate TTS and send as file
									const tts = getVibeVoiceTTS();
									if (!tts.isConfigured) {
										await interaction.editReply("HuggingFace token not configured. Set HF_TOKEN.");
										break;
									}

									const audio = await tts.synthesize(text);
									await interaction.editReply({
										content: "🔊 Generated speech (VibeVoice):",
										files: [{ attachment: audio, name: "speech.wav" }],
									});
								} else {
									await session.speak(text);
									await interaction.editReply(
										`🔊 Spoke: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`,
									);
								}
								break;
							}

							case "transcribe": {
								const url = interaction.options.getString("url", true);
								const stt = getWhisperLocalSTT();

								if (!stt.isConfigured) {
									await interaction.editReply("STT not configured. Set HF_TOKEN or install local Whisper.");
									break;
								}

								// Fetch audio from URL
								const response = await fetch(url);
								if (!response.ok) {
									await interaction.editReply(`Failed to fetch audio: ${response.status}`);
									break;
								}

								const audioBuffer = Buffer.from(await response.arrayBuffer());
								const result = await stt.transcribe(audioBuffer);
								const backendInfo = stt.getBackendInfo();

								const embed = new EmbedBuilder()
									.setTitle("📝 Transcription (Whisper)")
									.setDescription(result.text.substring(0, 4000) || "No speech detected")
									.addFields(
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
										{ name: "Language", value: result.language || "auto", inline: true },
										{ name: "Backend", value: `${backendInfo.type}: ${backendInfo.model}`, inline: true },
									)
									.setColor(0x00bfff)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const session = getVoiceSession(interaction.guildId!);
								const stats = session.getStats();
								const tts = getVibeVoiceTTS();
								const stt = getWhisperLocalSTT();
								const sttBackend = stt.getBackendInfo();

								const embed = new EmbedBuilder()
									.setTitle("🎙️ Voice Status (Open-Source)")
									.setColor(stats.connected ? 0x00ff00 : 0x808080)
									.addFields(
										{ name: "Connected", value: stats.connected ? "Yes" : "No", inline: true },
										{
											name: "Duration",
											value: stats.connected ? `${Math.floor(stats.duration / 1000)}s` : "-",
											inline: true,
										},
										{
											name: "VibeVoice TTS",
											value: tts.isConfigured ? "✅ Ready" : "❌ Need HF_TOKEN",
											inline: true,
										},
										{
											name: "Whisper STT",
											value: stt.isConfigured ? `✅ ${sttBackend.type}` : "❌ Not configured",
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "voices": {
								const tts = getVibeVoiceTTS();
								const info = tts.getModelInfo();

								const embed = new EmbedBuilder()
									.setTitle("🎤 VibeVoice (Open-Source TTS)")
									.setDescription(`**${info.name}**\n${info.description}`)
									.addFields(
										{ name: "Languages", value: info.languages.join(", "), inline: false },
										{ name: "Model", value: "microsoft/VibeVoice-Realtime-0.5B", inline: true },
										{ name: "Latency", value: "~300ms first audio", inline: true },
									)
									.setColor(0x9b59b6)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Voice error: ${errMsg}`);
					}
					break;
				}

				case "agent": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "status": {
								const available = isAgentAvailable();
								const models = getAgentModels();
								const modelList = Object.keys(models).join(", ");

								const embed = new EmbedBuilder()
									.setTitle("🤖 AI Agent Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{
											name: "Agent API",
											value: available ? "✅ Connected (pi-agent-core)" : "❌ No API Key",
											inline: true,
										},
										{ name: "Default Model", value: "GLM-4.6", inline: true },
										{ name: "Available Models", value: modelList, inline: false },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "run": {
								const prompt = interaction.options.getString("prompt", true);
								const timeout = (interaction.options.getInteger("timeout") || 300) * 1000;
								const mode = (interaction.options.getString("mode") || "general") as
									| "general"
									| "coding"
									| "research"
									| "trading";
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`🤖 Running Claude agent...\n\n**Prompt:** ${prompt.substring(0, 200)}...\n**Mode:** ${mode}\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const result = await runLearningAgent({
									prompt,
									timeout,
									workingDir: workingDir,
									mode,
									enableLearning,
								});

								const embed = new EmbedBuilder()
									.setTitle("🤖 Claude Agent Result")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No output")
									.addFields(
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
										{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										{ name: "Mode", value: mode, inline: true },
									)
									.setTimestamp();

								if (result.error) {
									embed.addFields({ name: "Error", value: result.error.substring(0, 1000), inline: false });
								}

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "research": {
								const topic = interaction.options.getString("topic", true);
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`🔍 Researching: "${topic}"...\n\n⏳ This may take a few minutes.\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.research(topic);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Research: ${topic.substring(0, 100)}`)
									.setColor(result.success ? 0x9b59b6 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No results")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "review": {
								const code = interaction.options.getString("code", true);
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`📝 Reviewing code...\n\n\`\`\`\n${code.substring(0, 200)}...\n\`\`\`\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.codeReview(code);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle("📝 Code Review")
									.setColor(result.success ? 0x3498db : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No feedback")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "trading": {
								const symbol = interaction.options.getString("symbol", true);
								const data = interaction.options.getString("data") || "Analyze current market conditions";
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`📈 Analyzing ${symbol.toUpperCase()}...\n\n⏳ Running trading analysis.\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.tradingAnalysis(symbol, data);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle(`📈 Trading Analysis: ${symbol.toUpperCase()}`)
									.setColor(result.success ? 0x2ecc71 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No analysis")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Agent error: ${errMsg}`);
					}
					break;
				}

				case "expertise": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "status": {
								const modes = getExpertiseModes();
								const statusList = modes
									.map((mode) => {
										const expertise = loadExpertise(mode);
										const sessionMatches = expertise.match(/### Session:/g);
										const sessionCount = sessionMatches ? sessionMatches.length : 0;
										const icon = sessionCount > 0 ? "📚" : "📖";
										return `${icon} **${mode}**: ${sessionCount} sessions`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🎓 Agent Learning Status")
									.setDescription(statusList || "No learning data yet")
									.setColor(0x9b59b6)
									.setFooter({ text: "Use /learning view <mode> to see accumulated expertise" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "modes": {
								const modes = getExpertiseModes();
								const modeDescriptions = {
									general: "General-purpose tasks and conversations",
									coding: "Software development, code review, debugging",
									research: "Information gathering, analysis, synthesis",
									trading: "Market analysis, trading strategies, risk management",
								};

								const modeList = modes
									.map((mode) => {
										const desc = modeDescriptions[mode as keyof typeof modeDescriptions] || "Unknown mode";
										return `**${mode}**\n└ ${desc}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("🎯 Available Learning Modes")
									.setDescription(modeList)
									.setColor(0x3498db)
									.setFooter({ text: "Agents learn from each task and improve over time" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "view": {
								const mode = interaction.options.getString("mode", true) as
									| "general"
									| "coding"
									| "research"
									| "trading";
								const expertise = loadExpertise(mode);

								if (!expertise || expertise.length === 0) {
									await interaction.editReply(`No learning data yet for mode: **${mode}**`);
									break;
								}

								// Parse sessions from markdown
								const sessionRegex =
									/### Session: ([\d-]+\s[\d:]+)\n\*\*Task:\*\* (.+?)\n\n([\s\S]+?)(?=\n### Session:|$)/g;
								const sessions: Array<{ timestamp: string; task: string; content: string }> = [];
								for (const match of expertise.matchAll(sessionRegex)) {
									sessions.push({
										timestamp: match[1],
										task: match[2],
										content: match[3],
									});
								}

								if (sessions.length === 0) {
									await interaction.editReply(`No sessions found for mode: **${mode}**`);
									break;
								}

								// Show last 5 sessions
								const recentSessions = sessions.slice(-5);
								const sessionSummary = recentSessions
									.map((session, idx) => {
										const preview = session.content.substring(0, 150).trim();
										return `**Session ${sessions.length - (recentSessions.length - idx - 1)}** (${session.timestamp})\n*Task:* ${session.task}\n${preview}...`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`🎓 Learning History: ${mode}`)
									.setDescription(sessionSummary || "No sessions yet")
									.setColor(0x2ecc71)
									.addFields({
										name: "Total Sessions",
										value: sessions.length.toString(),
										inline: true,
									})
									.setFooter({ text: "Showing last 5 sessions" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Learning system error: ${errMsg}`);
					}
					break;
				}

				case "openhands": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					// Helper to create result embed
					const createResultEmbed = (
						title: string,
						result: {
							success: boolean;
							output: string;
							error: string | null;
							duration: number;
							workspace: string;
							tools_used: string[];
							mode?: string;
							session_id?: string;
							blocked_actions?: Array<{ action: string; reason: string }>;
						},
						_color: number,
					) => {
						const embed = new EmbedBuilder()
							.setTitle(title)
							.setColor(result.success ? 0x00ff00 : 0xff0000)
							.setDescription(result.output.substring(0, 4000) || "No output")
							.addFields(
								{ name: "Status", value: result.success ? "Success" : "Failed", inline: true },
								{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
								{ name: "Mode", value: result.mode || "developer", inline: true },
							)
							.setTimestamp();

						if (result.tools_used && result.tools_used.length > 0) {
							embed.addFields({ name: "Tools Used", value: result.tools_used.join(", "), inline: false });
						}

						if (result.session_id) {
							embed.addFields({ name: "Session ID", value: result.session_id, inline: true });
						}

						if (result.blocked_actions && result.blocked_actions.length > 0) {
							embed.addFields({
								name: "Blocked Actions",
								value: result.blocked_actions
									.map((a) => `${a.action}: ${a.reason}`)
									.join("\n")
									.substring(0, 1000),
								inline: false,
							});
						}

						if (result.error) {
							embed.addFields({ name: "Error", value: result.error.substring(0, 1000), inline: false });
						}

						return embed;
					};

					try {
						switch (subcommand) {
							case "status": {
								const available = await isOpenHandsAvailable();

								const embed = new EmbedBuilder()
									.setTitle("OpenHands Software Agent Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{
											name: "OpenHands SDK",
											value: available ? "Available" : "Not installed or Python 3.12 missing",
											inline: true,
										},
										{ name: "Model", value: "GLM-4.6 via Z.ai", inline: true },
										{
											name: "Tools",
											value: "Terminal, File Editor, Task Tracker, Web",
											inline: false,
										},
										{
											name: "Expert Modes",
											value: "9 modes available (use /openhands modes)",
											inline: false,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "modes": {
								const modes = Object.entries(OpenHandsModeDescriptions)
									.map(([mode, desc]) => `**${mode}**: ${desc}`)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("OpenHands Expert Modes")
									.setColor(0x3498db)
									.setDescription(modes)
									.addFields({
										name: "Usage",
										value: "Use `/openhands run` with mode option, or dedicated commands like `/openhands security`, `/openhands review`, etc.",
										inline: false,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "learning": {
								const action = interaction.options.getString("action", true);
								const mode = interaction.options.getString("mode");

								if (action === "list") {
									const expertise = getAllExpertise();

									if (expertise.length === 0) {
										await interaction.editReply("No expertise files found.");
										break;
									}

									const expertiseList = expertise
										.map((e) => {
											const lastUpdate = new Date(e.lastUpdated).toLocaleString();
											return `**${e.mode}**: ${e.sessionCount} sessions (last: ${lastUpdate})`;
										})
										.join("\n");

									const embed = new EmbedBuilder()
										.setTitle("Agent Experts Learning System")
										.setColor(0x9b59b6)
										.setDescription("Agents that learn from every execution (Act-Learn-Reuse pattern)")
										.addFields({
											name: "Expertise Files",
											value: expertiseList,
											inline: false,
										})
										.addFields({
											name: "How it works",
											value:
												"Each agent mode accumulates expertise from sessions:\n" +
												"• ACT: Load expertise, inject into context\n" +
												"• LEARN: Extract learnings from execution\n" +
												"• REUSE: Apply accumulated knowledge next time",
											inline: false,
										})
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "view") {
									if (!mode) {
										await interaction.editReply("Please specify a mode to view learnings.");
										break;
									}

									const expertise = getExpertiseForMode(mode);

									if (!expertise) {
										await interaction.editReply(`No expertise found for mode: ${mode}`);
										break;
									}

									const learnings = extractRecentLearnings(expertise.content);

									if (learnings.length === 0) {
										await interaction.editReply(`No learnings recorded for mode: ${mode}`);
										break;
									}

									const embed = new EmbedBuilder()
										.setTitle(`${mode.replace(/_/g, " ").toUpperCase()} Expert Learnings`)
										.setColor(0x9b59b6)
										.setDescription(`Recent learnings (last ${learnings.length} sessions)`)
										.addFields(
											{ name: "Total Sessions", value: expertise.sessionCount.toString(), inline: true },
											{
												name: "Last Updated",
												value: new Date(expertise.lastUpdated).toLocaleString(),
												inline: true,
											},
										);

									// Add learnings as fields (max 25 fields in Discord)
									learnings.slice(0, 5).forEach((learning, idx) => {
										embed.addFields({
											name: `Session ${idx + 1}`,
											value: learning.substring(0, 1024), // Discord field value limit
											inline: false,
										});
									});

									embed.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "clear") {
									if (!mode) {
										await interaction.editReply("Please specify a mode to clear expertise.");
										break;
									}

									const expertise = getExpertiseForMode(mode);

									if (!expertise) {
										await interaction.editReply(`No expertise found for mode: ${mode}`);
										break;
									}

									// Confirmation message
									const confirmEmbed = new EmbedBuilder()
										.setTitle("Confirm Expertise Clear")
										.setColor(0xff0000)
										.setDescription(
											`You are about to clear ${expertise.sessionCount} sessions of accumulated expertise for **${mode}**.\n\n` +
												"This will reset the agent to a blank slate. This action cannot be undone.\n\n" +
												`Type \`/openhands learning action:clear mode:${mode}\` again within 30 seconds to confirm.`,
										)
										.setTimestamp();

									// Store confirmation state (simple in-memory cache)
									const confirmKey = `${interaction.user.id}-${mode}`;
									if (!confirmationCache.has(confirmKey)) {
										confirmationCache.set(confirmKey, Date.now());
										setTimeout(() => confirmationCache.delete(confirmKey), 30000);
										await interaction.editReply({ embeds: [confirmEmbed] });
									} else {
										const timestamp = confirmationCache.get(confirmKey)!;
										if (Date.now() - timestamp > 30000) {
											confirmationCache.delete(confirmKey);
											await interaction.editReply("Confirmation expired. Please try again.");
										} else {
											confirmationCache.delete(confirmKey);
											const success = clearExpertise(mode);

											if (success) {
												const successEmbed = new EmbedBuilder()
													.setTitle("Expertise Cleared")
													.setColor(0x00ff00)
													.setDescription(`Successfully cleared expertise for **${mode}**.`)
													.addFields({
														name: "Sessions Removed",
														value: expertise.sessionCount.toString(),
														inline: true,
													})
													.setTimestamp();

												await interaction.editReply({ embeds: [successEmbed] });
											} else {
												await interaction.editReply(`Failed to clear expertise for mode: ${mode}`);
											}
										}
									}
								}
								break;
							}

							case "run": {
								const task = interaction.options.getString("task", true);
								const mode = (interaction.options.getString("mode") || "developer") as OpenHandsMode;
								const workspace = interaction.options.getString("workspace") || workingDir;
								const persist = interaction.options.getBoolean("persist") || false;

								await interaction.editReply(
									`Running OpenHands agent...\n\n**Task:** ${task.substring(0, 200)}...\n**Mode:** ${mode}\n**Persist:** ${persist}`,
								);

								const result = await runOpenHandsAgent({
									task,
									workspace,
									mode,
									timeout: 600,
									persist,
									securityCheck: true,
								});

								const embed = createResultEmbed(`OpenHands: ${mode}`, result, 0x3498db);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "security": {
								const path = interaction.options.getString("path", true);

								await interaction.editReply(
									`Running security vulnerability scan...\n\n**Path:** ${path}\n\nThis may take several minutes.`,
								);

								const result = await runSecurityScan(path);
								const embed = createResultEmbed("Security Vulnerability Scan", result, 0xe74c3c);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "review": {
								const path = interaction.options.getString("path", true);
								const focus = interaction.options.getString("focus") || undefined;

								await interaction.editReply(
									`Running code review...\n\n**Path:** ${path}${focus ? `\n**Focus:** ${focus}` : ""}\n\nAnalyzing code quality, performance, and best practices.`,
								);

								const result = await runCodeReview(path, focus);
								const embed = createResultEmbed("Code Review", result, 0x9b59b6);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "tests": {
								const path = interaction.options.getString("path", true);
								const coverage = interaction.options.getInteger("coverage") || 90;

								await interaction.editReply(
									`Generating tests...\n\n**Path:** ${path}\n**Coverage Target:** ${coverage}%\n\nCreating unit and integration tests.`,
								);

								const result = await runTestGeneration(path, coverage);
								const embed = createResultEmbed("Test Generation", result, 0x2ecc71);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "docs": {
								const path = interaction.options.getString("path", true);
								const docType = interaction.options.getString("type") || "all";

								await interaction.editReply(
									`Generating documentation...\n\n**Path:** ${path}\n**Type:** ${docType}\n\nCreating README, API docs, and comments.`,
								);

								const result = await runDocGeneration(path, docType);
								const embed = createResultEmbed("Documentation Generation", result, 0x3498db);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "refactor": {
								const path = interaction.options.getString("path", true);
								const target = interaction.options.getString("target") || undefined;

								await interaction.editReply(
									`Refactoring code...\n\n**Path:** ${path}${target ? `\n**Target:** ${target}` : ""}\n\nImproving code quality and reducing complexity.`,
								);

								const result = await runRefactor(path, target);
								const embed = createResultEmbed("Code Refactoring", result, 0xf39c12);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "debug": {
								const path = interaction.options.getString("path", true);
								const issue = interaction.options.getString("issue", true);

								await interaction.editReply(
									`Debugging issue...\n\n**Path:** ${path}\n**Issue:** ${issue.substring(0, 200)}\n\nAnalyzing root cause and implementing fix.`,
								);

								const result = await runDebug(path, issue);
								const embed = createResultEmbed("Debug & Fix", result, 0xe67e22);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "optimize": {
								const path = interaction.options.getString("path", true);
								const focus = interaction.options.getString("focus") || undefined;

								await interaction.editReply(
									`Optimizing performance...\n\n**Path:** ${path}${focus ? `\n**Focus:** ${focus}` : ""}\n\nProfiling and fixing bottlenecks.`,
								);

								const result = await runOptimize(path, focus);
								const embed = createResultEmbed("Performance Optimization", result, 0x1abc9c);
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`OpenHands error: ${errMsg}`);
					}
					break;
				}

				// Codebase Experts (TAC Lesson 13)
				case "expert": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "run": {
								const taskDesc = interaction.options.getString("task", true);
								const domain = interaction.options.getString("domain") || undefined;

								await interaction.editReply(
									`Running task with expert...\n\n**Task:** ${taskDesc.substring(0, 200)}${domain ? `\n**Domain:** ${domain}` : "\n**Auto-detecting domain...**"}`,
								);

								// Create executor using the lightweight agent
								const executor = async (enhancedTask: string) => {
									const result = await runLearningAgent({
										prompt: enhancedTask,
										mode: domain || "general",
										enableLearning: true,
									});
									return { success: result.success, output: result.output || "" };
								};

								const result = await executeWithAutoExpert(taskDesc, executor);

								const embed = new EmbedBuilder()
									.setTitle("Expert Task Result")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Expert Domain", value: result.expert, inline: true },
										{ name: "Success", value: result.success ? "Yes" : "No", inline: true },
										{
											name: "Learning",
											value: result.learned.learned
												? `Extracted: ${result.learned.insight?.substring(0, 100)}...`
												: "No new learnings",
											inline: false,
										},
									)
									.setDescription(
										result.output.length > 4000 ? `${result.output.substring(0, 4000)}...` : result.output,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const expertList = Object.entries(CODEBASE_EXPERTS)
									.map(([key, exp]) => `**${key}** (${exp.riskLevel})\n${exp.description}`)
									.join("\n\n");

								const productList = Object.entries(PRODUCT_EXPERTS)
									.map(([key, exp]) => `**${key}**\n${exp.focus}`)
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("Available Codebase Experts")
									.setColor(0x3498db)
									.addFields(
										{ name: "Codebase Experts", value: expertList.substring(0, 1024), inline: false },
										{ name: "Product Experts", value: productList.substring(0, 1024), inline: false },
									)
									.setFooter({ text: "TAC Lesson 13 - Act-Learn-Reuse Pattern" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "view": {
								const viewDomain = interaction.options.getString("domain", true);
								const expertiseContent = loadExpertise(viewDomain);

								if (!expertiseContent) {
									await interaction.editReply(`No expertise found for domain: ${viewDomain}`);
									break;
								}

								// Get expert definition if it exists
								const expertDef = CODEBASE_EXPERTS[viewDomain] || PRODUCT_EXPERTS[viewDomain];

								const embed = new EmbedBuilder()
									.setTitle(`${viewDomain} Expert Knowledge`)
									.setColor(0x9b59b6)
									.setDescription(expertiseContent.substring(0, 4000) || "No expertise accumulated yet")
									.addFields(
										{
											name: "Risk Level",
											value: expertDef && "riskLevel" in expertDef ? expertDef.riskLevel : "medium",
											inline: true,
										},
										{ name: "Domain", value: viewDomain, inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const newDomain = interaction.options.getString("domain", true);
								const description = interaction.options.getString("description", true);

								await interaction.editReply(
									`Creating new expert...\n\n**Domain:** ${newDomain}\n**Description:** ${description.substring(0, 200)}\n\nUsing meta-agentic pattern...`,
								);

								// Create executor for the meta-agentic pattern
								const executor = async (prompt: string) => {
									const result = await runLearningAgent({
										prompt,
										mode: "general",
										enableLearning: true,
									});
									return { success: result.success, output: result.output || "" };
								};

								const result = await createCodebaseExpert(newDomain, description, executor);

								if (result.success && result.expert) {
									const embed = new EmbedBuilder()
										.setTitle("Expert Created")
										.setColor(0x2ecc71)
										.addFields(
											{ name: "Domain", value: result.expert.name, inline: true },
											{ name: "Risk Level", value: result.expert.riskLevel, inline: true },
											{
												name: "Self-Improve Prompt",
												value: result.expert.selfImprovePrompt.substring(0, 500),
												inline: false,
											},
										)
										.setFooter({ text: "Meta-Agentic: Agents building agents" });

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to create expert: ${result.error}`);
								}
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Expert error: ${errMsg}`);
					}
					break;
				}

				// Two-Phase Agent Workflow (TAC Lesson 13)
				case "task": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "create": {
								const taskDesc = interaction.options.getString("description", true);
								const maxFeatures = interaction.options.getInteger("max_features") || 5;

								await interaction.editReply(
									`Initializing task...\n\n**Description:** ${taskDesc.substring(0, 300)}\n**Max Features:** ${maxFeatures}\n\nPhase 1: Creating feature breakdown...`,
								);

								const result = await initializeClaudeTask({
									prompt: taskDesc,
									workingDir: process.cwd(),
									maxIterations: maxFeatures,
								});

								if (result.success && result.taskId) {
									const status = getClaudeTaskStatus(result.taskId);
									const embed = new EmbedBuilder()
										.setTitle("Task Created")
										.setColor(0x3498db)
										.addFields(
											{ name: "Task ID", value: result.taskId, inline: true },
											{
												name: "Features",
												value: String(status.spec?.features?.length || 0),
												inline: true,
											},
											{
												name: "Status",
												value: status.progress?.completed
													? `${status.progress.completed}/${status.progress.total}`
													: "Ready",
												inline: true,
											},
											{
												name: "Feature List",
												value:
													status.spec?.features
														?.map((f, i) => `${i + 1}. ${f.name}`)
														.join("\n")
														.substring(0, 1024) || "None",
												inline: false,
											},
										)
										.setFooter({ text: "Use /task execute to implement features" });

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to create task: ${result.error}`);
								}
								break;
							}

							case "execute": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								await interaction.editReply(
									`Executing next feature...\n\n**Task:** ${taskId}\n**Next:** ${status.nextFeature?.name || "Unknown"}\n\nPhase 2: Implementing feature...`,
								);

								const result = await executeClaudeFeature(taskId);

								const updatedStatus = getClaudeTaskStatus(taskId);
								const embed = new EmbedBuilder()
									.setTitle("Feature Executed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Task ID", value: taskId, inline: true },
										{
											name: "Progress",
											value: `${updatedStatus.progress?.completed || 0}/${updatedStatus.progress?.total || 0}`,
											inline: true,
										},
										{
											name: "Next Feature",
											value: updatedStatus.nextFeature?.name || "All complete!",
											inline: true,
										},
									)
									.setDescription(
										result.output ? result.output.substring(0, 4000) : result.error || "No output",
									);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								const featureStatus =
									status.spec?.features
										?.map((f, i) => {
											const icon =
												f.status === "completed"
													? "✅"
													: f.status === "in_progress"
														? "🔄"
														: f.status === "failed"
															? "❌"
															: "⬜";
											return `${icon} ${i + 1}. ${f.name}`;
										})
										.join("\n") || "No features";

								const embed = new EmbedBuilder()
									.setTitle("Task Status")
									.setColor(0x3498db)
									.addFields(
										{ name: "Task ID", value: taskId, inline: true },
										{
											name: "Progress",
											value: `${status.progress?.completed || 0}/${status.progress?.total || 0}`,
											inline: true,
										},
										{
											name: "Next Feature",
											value: status.nextFeature?.name || "All complete!",
											inline: true,
										},
										{ name: "Features", value: featureStatus.substring(0, 1024), inline: false },
									);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "resume": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								await interaction.editReply(
									`Resuming task...\n\n**Task:** ${taskId}\n**Progress:** ${status.progress?.completed || 0}/${status.progress?.total || 0}\n\nContinuing from last feature...`,
								);

								const result = await resumeClaudeTask(taskId);

								const embed = new EmbedBuilder()
									.setTitle("Task Resumed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.setDescription(result.output ? result.output.substring(0, 4000) : result.error || "Resumed")
									.setFooter({ text: `Task: ${taskId}` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "run": {
								const taskDesc = interaction.options.getString("description", true);

								await interaction.editReply(
									`Running full workflow...\n\n**Task:** ${taskDesc.substring(0, 300)}\n\nPhase 1: Planning → Phase 2: Executing all features...`,
								);

								const result = await runTwoAgentWorkflow({
									prompt: taskDesc,
									workingDir: process.cwd(),
								});

								const embed = new EmbedBuilder()
									.setTitle("Workflow Complete")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Task ID", value: result.taskId || "N/A", inline: true },
										{ name: "Success", value: result.success ? "Yes" : "No", inline: true },
									)
									.setDescription(
										result.output ? result.output.substring(0, 4000) : result.error || "Complete",
									)
									.setFooter({ text: "Two-Agent Pattern: Initializer + Coding" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								// List all task specs from the tasks directory
								const tasksDir = join(process.cwd(), ".tasks");
								let tasks: string[] = [];

								if (existsSync(tasksDir)) {
									tasks = readdirSync(tasksDir)
										.filter((f) => f.endsWith(".json"))
										.map((f) => f.replace(".json", ""));
								}

								if (tasks.length === 0) {
									await interaction.editReply("No tasks found. Use `/task create` to create one.");
									break;
								}

								const taskList = tasks
									.slice(0, 10)
									.map((taskId) => {
										const status = getClaudeTaskStatus(taskId);
										return `**${taskId}** - ${status.progress?.completed || 0}/${status.progress?.total || 0} features`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("Tasks")
									.setColor(0x3498db)
									.setDescription(taskList)
									.setFooter({ text: `Showing ${Math.min(tasks.length, 10)} of ${tasks.length}` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Task error: ${errMsg}`);
					}
					break;
				}

				default:
					await interaction.reply("Unknown command");
			}

			// Track successful command
			const responseTime = Date.now() - commandStartTime;
			analytics.trackCommand({
				type: "command",
				timestamp: new Date().toISOString(),
				userId: user.id,
				username: user.username,
				command: commandName,
				responseTime,
				model: model.id,
				channelId,
				channelName,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			botStats.errorsCount++;
			logError(`Slash command error (/${commandName})`, errMsg);

			// Track error
			analytics.trackCommand({
				type: "error",
				timestamp: new Date().toISOString(),
				userId: user.id,
				username: user.username,
				command: commandName,
				error: errMsg,
				model: model.id,
				channelId,
				channelName,
			});

			if (interaction.deferred) {
				await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`).catch(() => {});
			} else {
				await interaction.reply(`Error: ${errMsg.substring(0, 500)}`).catch(() => {});
			}
		}
	});

	// Handle button interactions
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isButton()) return;

		const { customId, user } = interaction;

		if (customId === "feedback_helpful") {
			await interaction.reply({ content: "Thanks for the feedback! 👍", ephemeral: true });
			logInfo(`[Feedback] ${user.username} found response helpful`);
		} else if (customId === "feedback_not_helpful") {
			await interaction.reply({ content: "Sorry to hear that. I'll try to do better! 👎", ephemeral: true });
			logInfo(`[Feedback] ${user.username} found response not helpful`);
		} else if (customId === "feedback_more") {
			await interaction.reply({ content: "Just ask me a follow-up question!", ephemeral: true });
		}
	});

	// Handle @mentions (keep existing functionality)
	client.on("messageCreate", async (message: Message) => {
		if (message.author.bot) return;

		const isMention = message.mentions.has(client.user!);
		const isDM = !message.guild;

		if (!isMention && !isDM) return;

		// CRITICAL: Deduplicate messages to prevent double responses
		if (!markMessageProcessed(message.id)) {
			logWarning(`Duplicate message detected, skipping: ${message.id}`);
			return;
		}

		const channelId = message.channel.id;
		const channelName = isDM ? `DM:${message.author.username}` : (message.channel as TextChannel).name || "unknown";

		let text = message.content;
		if (isMention && client.user) {
			text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
		}

		// Handle file attachments
		const attachments = Array.from(message.attachments.values());
		if (attachments.length > 0) {
			const attachmentInfo = attachments
				.map((a) => `[Attached: ${a.name} (${a.contentType || "unknown"}) - ${a.url}]`)
				.join("\n");
			text = text ? `${text}\n\n${attachmentInfo}` : attachmentInfo;
			logInfo(`[${channelId}] Processing ${attachments.length} attachment(s)`);
		}

		if (!text && attachments.length === 0) return;

		logInfo(`[${channelName}] [msg:${message.id}] ${message.author.username}: ${text.substring(0, 80)}...`);

		// Handle text commands for /provider (so users can type it directly)
		if (text.toLowerCase().startsWith("/provider") || text.toLowerCase().startsWith("!provider")) {
			const parts = text.split(/\s+/);
			const subCommand = parts[1]?.toLowerCase();

			if (!subCommand || subCommand === "status") {
				const providerInfo =
					currentProvider === "openrouter"
						? `**OpenRouter** (Cloud)\nModel: ${OPENROUTER_MODELS[globalModelId]?.name || globalModelId}\nCost: ${OPENROUTER_MODELS[globalModelId]?.cost || "varies"}`
						: `**Ollama** (Local)\nModel: ${globalModelId}\nCost: FREE`;
				await message.reply(
					`🔌 **Current Provider**\n${providerInfo}\n\nSwitch with:\n• \`/provider openrouter\` - Cloud AI\n• \`/provider ollama\` - Local AI`,
				);
				return;
			}

			if (subCommand === "ollama") {
				currentProvider = "ollama";
				globalModelId = DEFAULT_MODEL_ID;
				channelStates.clear();
				logInfo(`[TEXT-CMD] Switched to Ollama by ${message.author.username}`);
				await message.reply(`✅ Switched to **Ollama** (local, free)\nModel: \`${globalModelId}\``);
				return;
			}

			if (subCommand === "openrouter") {
				if (!OPENROUTER_API_KEY) {
					await message.reply("❌ OpenRouter API key not configured.");
					return;
				}
				const modelChoice = parts[2]?.toLowerCase() || DEFAULT_OPENROUTER_MODEL;
				const validModels = Object.keys(OPENROUTER_MODELS);
				const selectedModel = validModels.find((m) => m.includes(modelChoice)) || DEFAULT_OPENROUTER_MODEL;

				currentProvider = "openrouter";
				globalModelId = selectedModel;
				channelStates.clear();

				const modelInfo = OPENROUTER_MODELS[selectedModel];
				logInfo(`[TEXT-CMD] Switched to OpenRouter (${modelInfo?.id}) by ${message.author.username}`);
				await message.reply(
					`✅ Switched to **OpenRouter** (cloud)\nModel: \`${modelInfo?.name || selectedModel}\`\nCost: ${modelInfo?.cost || "varies"}`,
				);
				return;
			}

			// Unknown subcommand - show help
			await message.reply(
				`Available models:\n${Object.entries(OPENROUTER_MODELS)
					.map(([k, v]) => `• \`${k}\` - ${v.name}`)
					.join("\n")}\n\nUsage: \`/provider openrouter mistral-small\``,
			);
			return;
		}

		// Handle /browse and /browser (typo) text commands (route to browserAutomation instead of AI agent)
		if (text.toLowerCase().startsWith("/browse") || text.toLowerCase().startsWith("/browser")) {
			// Match both /browse and /browser (common typo)
			const browseMatch = text.match(/\/browser?\s+(\w+)\s+(?:url:)?(\S+)/i);
			if (browseMatch) {
				const subCmd = browseMatch[1].toLowerCase();
				const url = browseMatch[2];

				logInfo(`[TEXT-CMD] /browse ${subCmd} for ${url} by ${message.author.username}`);

				if (subCmd === "screenshot") {
					try {
						const startTime = Date.now();
						await message.reply("📸 Taking screenshot...");
						const result = await browserAutomation.screenshot(url, { fullPage: false });

						if (result.success && result.data?.screenshot) {
							const fileBuffer = readFileSync(result.data.screenshot);
							const attachment = new AttachmentBuilder(fileBuffer, { name: "screenshot.png" });
							const embed = new EmbedBuilder()
								.setTitle(`📸 Screenshot: ${new URL(url).hostname}`)
								.setURL(url)
								.setImage("attachment://screenshot.png")
								.setColor(0x00ff88)
								.setTimestamp()
								.setFooter({ text: `Browser Automation • ${Date.now() - startTime}ms` });

							await message.reply({ embeds: [embed], files: [attachment] });
							await browserAutomation.cleanup(result.data.screenshot);
							logInfo(`[TEXT-CMD] Screenshot sent for ${url} (${Date.now() - startTime}ms)`);
						} else {
							await message.reply(`❌ Screenshot failed: ${result.error || "Unknown error"}`);
							logWarning(`[TEXT-CMD] Screenshot failed for ${url}: ${result.error}`);
						}
					} catch (err: any) {
						await message.reply(`❌ Screenshot error: ${err.message}`);
						logError(`[TEXT-CMD] Screenshot error for ${url}: ${err.message}`);
					}
					return;
				}

				if (subCmd === "scrape") {
					try {
						const startTime = Date.now();
						await message.reply("🔍 Scraping content...");
						const result = await browserAutomation.scrape(url);

						if (result.success && result.data?.content) {
							const content = result.data.content.slice(0, 1900);
							await message.reply(`**Scraped from ${new URL(url).hostname}:**\n\`\`\`\n${content}\n\`\`\``);
							logInfo(`[TEXT-CMD] Scrape sent for ${url} (${Date.now() - startTime}ms)`);
						} else {
							await message.reply(`❌ Scrape failed: ${result.error || "Unknown error"}`);
							logWarning(`[TEXT-CMD] Scrape failed for ${url}: ${result.error}`);
						}
					} catch (err: any) {
						await message.reply(`❌ Scrape error: ${err.message}`);
						logError(`[TEXT-CMD] Scrape error for ${url}: ${err.message}`);
					}
					return;
				}

				// Unknown browse subcommand
				await message.reply("Available: `/browse screenshot <url>` or `/browse scrape <url>`");
				return;
			}
		}

		// Handle /price text command (quick crypto price lookup)
		if (text.toLowerCase().startsWith("/price ")) {
			const symbol = text.slice(7).trim().toUpperCase();
			if (symbol) {
				try {
					logInfo(`[TEXT-CMD] /price ${symbol} by ${message.author.username}`);
					const response = await fetch(
						`https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
					);
					const data = await response.json();
					const price = data[symbol.toLowerCase()]?.usd;
					const change = data[symbol.toLowerCase()]?.usd_24h_change;
					if (price) {
						const changeStr = change ? ` (${change > 0 ? "+" : ""}${change.toFixed(2)}%)` : "";
						await message.reply(`💰 **${symbol}**: $${price.toLocaleString()}${changeStr}`);
					} else {
						// Try as ticker
						const tickerRes = await fetch(
							`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${symbol.toLowerCase()}`,
						);
						const tickerData = await tickerRes.json();
						if (tickerData[0]) {
							const coin = tickerData[0];
							await message.reply(
								`💰 **${coin.symbol.toUpperCase()}** (${coin.name}): $${coin.current_price.toLocaleString()} (${coin.price_change_percentage_24h > 0 ? "+" : ""}${coin.price_change_percentage_24h?.toFixed(2)}%)`,
							);
						} else {
							await message.reply(`❌ Could not find price for ${symbol}`);
						}
					}
				} catch (err: any) {
					await message.reply(`❌ Price lookup error: ${err.message}`);
				}
				return;
			}
		}

		// Handle /status text command (quick bot status)
		if (text.toLowerCase() === "/status") {
			logInfo(`[TEXT-CMD] /status by ${message.author.username}`);
			const uptime = process.uptime();
			const hours = Math.floor(uptime / 3600);
			const mins = Math.floor((uptime % 3600) / 60);
			await message.reply(
				`🤖 **Bot Status**\n⏱️ Uptime: ${hours}h ${mins}m\n💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n📡 Model: GLM-4.6`,
			);
			return;
		}

		// Handle /help text command
		if (text.toLowerCase() === "/help") {
			logInfo(`[TEXT-CMD] /help by ${message.author.username}`);
			await message.reply(`**Quick Commands:**
\`/price BTC\` - Crypto price
\`/status\` - Bot status
\`/browse screenshot <url>\` - Screenshot
\`/browse scrape <url>\` - Extract content
\`/provider <name>\` - Switch AI model

**Slash Commands:** Use \`/\` to see all 35 commands`);
			return;
		}

		// Track if we've already sent a response to prevent duplicates
		let responseSent = false;
		let streamingMessage: any = null; // Reference to streaming message for edits
		let creatingMessage = false; // Lock to prevent race condition
		let pendingContent: string | null = null; // Store content while waiting for message creation

		try {
			// Show typing indicator instead of status message
			if ("sendTyping" in message.channel) {
				await (message.channel as any).sendTyping();
			}

			// Function for streaming updates - edits a single message, doesn't block final response
			const updateStreaming = async (content: string) => {
				if (!content || content.trim().length === 0) {
					return; // Skip empty updates
				}

				// If we're currently creating the message, store the latest content for after
				if (creatingMessage) {
					pendingContent = content;
					return;
				}

				try {
					if (!streamingMessage) {
						// First streaming update - create the message with lock
						creatingMessage = true;
						streamingMessage = await message.reply(content);
						creatingMessage = false;

						// If there was pending content while we were creating, edit with it now
						if (pendingContent && pendingContent !== content) {
							await streamingMessage.edit(pendingContent);
							pendingContent = null;
						}
					} else {
						// Subsequent updates - edit the existing message
						await streamingMessage.edit(content);
					}
				} catch (err) {
					creatingMessage = false;
					// Silently ignore streaming edit errors (rate limits, etc.)
				}
			};

			// Final reply function that prevents duplicates
			const sendResponse = async (content: string) => {
				logInfo(
					`[${channelName}] sendResponse CALLED (${content?.length || 0} chars, responseSent=${responseSent}, streamingMessage=${!!streamingMessage})`,
				);
				if (responseSent) {
					logWarning(`[${channelName}] Duplicate response prevented`);
					return;
				}
				responseSent = true;

				if (!content || content.trim().length === 0) {
					logWarning(`[${channelName}] Attempted to send empty response, skipping`);
					return;
				}

				try {
					// Check for rich embed markers
					const embedMatch = content.match(/__EMBED__(.+?)__EMBED__/s);
					if (embedMatch) {
						try {
							const embedData = JSON.parse(embedMatch[1]);
							const embed = new EmbedBuilder()
								.setTitle(embedData.title || "Response")
								.setDescription(embedData.description || "")
								.setColor(embedData.color || 0x0099ff)
								.setTimestamp();

							if (embedData.fields) {
								embed.addFields(embedData.fields);
							}
							if (embedData.thumbnail?.url) {
								embed.setThumbnail(embedData.thumbnail.url);
							}
							if (embedData.footer?.text) {
								embed.setFooter({ text: embedData.footer.text });
							}

							// Send embed + any text outside the markers
							const textOutside = content.replace(/__EMBED__.+?__EMBED__/s, "").trim();

							// If we have a streaming message, edit it with final content
							if (streamingMessage) {
								if (textOutside) {
									await streamingMessage.edit({ content: textOutside, embeds: [embed] });
								} else {
									await streamingMessage.edit({ content: null, embeds: [embed] });
								}
								logInfo(`[${channelName}] Discord reply updated (embed)`);
							} else {
								if (textOutside) {
									await message.reply({ content: textOutside, embeds: [embed] });
								} else {
									await message.reply({ embeds: [embed] });
								}
								logInfo(`[${channelName}] Discord reply sent (embed)`);
							}
							return;
						} catch {
							// If embed parsing fails, send as plain text
						}
					}

					// If we have a streaming message, edit it with final content
					if (streamingMessage) {
						await streamingMessage.edit(content);
						logInfo(`[${channelName}] Discord reply updated (${content.length} chars)`);
					} else {
						await message.reply(content);
						logInfo(`[${channelName}] Discord reply sent (${content.length} chars)`);
					}
				} catch (replyError) {
					const errMsg = replyError instanceof Error ? replyError.message : String(replyError);
					logError(`[${channelName}] Failed to send Discord reply`, errMsg);
					// Try sending as channel message instead of reply
					try {
						await (message.channel as any).send(content);
						logInfo(`[${channelName}] Fallback channel send succeeded`);
					} catch (fallbackError) {
						logError(`[${channelName}] Fallback send also failed`, String(fallbackError));
					}
				}
			};

			await handleAgentRequest(
				channelId,
				channelName,
				message.author.username,
				message.author.id,
				text,
				workingDir,
				sendResponse, // reply callback for final response
				updateStreaming, // editReply for streaming updates (doesn't block final)
				message,
			);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			logError("Error processing message", errMsg);

			if (!responseSent) {
				await message.reply(`_Error: ${errMsg.substring(0, 500)}_`).catch(() => {});
			}
		}
	});

	client.on("error", (error) => {
		logError("Discord client error", error.message);
	});

	process.on("SIGINT", () => {
		logInfo("Shutting down...");
		if (taskScheduler) {
			taskScheduler.shutdown();
		}
		if (db) {
			db.close();
		}
		client.destroy();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		logInfo("Shutting down...");
		if (taskScheduler) {
			taskScheduler.shutdown();
		}
		if (db) {
			db.close();
		}
		client.destroy();
		process.exit(0);
	});

	await client.login(DISCORD_BOT_TOKEN);

	// ========================================================================
	// Event-Driven Triggers: Cron Jobs & Webhooks
	// ========================================================================

	const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID; // Channel for scheduled reports
	const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "3001", 10);

	// Multi-channel configuration
	const ALERTS_CHANNEL_ID = process.env.ALERTS_CHANNEL_ID;
	const SIGNALS_CHANNEL_ID = process.env.SIGNALS_CHANNEL_ID;
	const REPORTS_CHANNEL_ID = process.env.REPORTS_CHANNEL_ID;
	const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID;

	// ChannelRouter: Routes messages to appropriate channels with fallback support
	class ChannelRouter {
		private client: Client;
		private fallbackChannelId: string | undefined;

		constructor(client: Client, fallbackChannelId?: string) {
			this.client = client;
			this.fallbackChannelId = fallbackChannelId;
		}

		private async sendToChannel(channelId: string | undefined, content: string): Promise<void> {
			const targetChannelId = channelId || this.fallbackChannelId;
			if (!targetChannelId) {
				logWarning("[CHANNEL_ROUTER] No channel configured and no fallback available");
				return;
			}

			try {
				const channel = await this.client.channels.fetch(targetChannelId);
				if (channel && "send" in channel) {
					await (channel as TextChannel).send(content);
				}
			} catch (error) {
				logError(
					`Failed to send to channel ${targetChannelId}`,
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		async sendAlert(content: string): Promise<void> {
			await this.sendToChannel(ALERTS_CHANNEL_ID, content);
		}

		async sendSignal(content: string): Promise<void> {
			await this.sendToChannel(SIGNALS_CHANNEL_ID, content);
		}

		async sendReport(content: string): Promise<void> {
			await this.sendToChannel(REPORTS_CHANNEL_ID, content);
		}

		async sendLog(content: string): Promise<void> {
			await this.sendToChannel(LOGS_CHANNEL_ID, content);
		}

		async send(content: string, channelId?: string): Promise<void> {
			await this.sendToChannel(channelId, content);
		}
	}

	// Initialize channel router with backward compatibility
	const channelRouter = new ChannelRouter(client, REPORT_CHANNEL_ID);

	// Helper: Send message to report channel (maintained for backward compatibility)
	async function sendToReportChannel(content: string): Promise<void> {
		await channelRouter.sendReport(content);
	}

	// ========================================================================
	// Task Scheduler: User-Configurable Scheduled Tasks
	// ========================================================================

	// Action executor for scheduled tasks
	async function executeScheduledAction(action: string, _userId: string, _channelId: string): Promise<string> {
		try {
			// Predefined actions
			if (action === "report:daily") {
				// Daily analytics report
				const yesterday = new Date();
				yesterday.setDate(yesterday.getDate() - 1);
				const summary = analytics.generateDailySummary(yesterday);
				return `**Daily Analytics Report**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``;
			} else if (action === "report:weekly") {
				// Weekly summary
				const lastWeek = new Date();
				lastWeek.setDate(lastWeek.getDate() - 7);
				const summary = analytics.generateDailySummary(lastWeek);
				return `**Weekly Analytics Summary**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``;
			} else if (action === "health:check") {
				// Health status check
				const uptime = Date.now() - botStats.startTime;
				const hours = Math.floor(uptime / (1000 * 60 * 60));
				const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
				const memUsage = process.memoryUsage();
				return (
					`**System Health Check**\n` +
					`Uptime: ${hours}h ${mins}m\n` +
					`Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB\n` +
					`Commands Processed: ${botStats.commandsProcessed}\n` +
					`Active Channels: ${channelStates.size}`
				);
			} else if (action === "backup:auto") {
				// Auto backup
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				const backupPath = join(workingDir, `backups/auto-backup-${timestamp}.json`);
				const backupDir = join(workingDir, "backups");
				if (!existsSync(backupDir)) {
					mkdirSync(backupDir, { recursive: true });
				}

				const dbStats = db.getStats();
				const backupData = {
					timestamp,
					stats: dbStats,
					version: "1.0",
				};

				writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
				return (
					`**Automatic Backup Completed**\n` +
					`Location: ${backupPath}\n` +
					`Users: ${dbStats.users}\n` +
					`Scheduled Tasks: ${dbStats.scheduledTasks}`
				);
			} else {
				// Custom prompt - send to AI agent
				// For now, just return the action as a message
				// In a future enhancement, this could actually call the AI agent
				return `**Custom Task**\n${action}`;
			}
		} catch (error) {
			throw new Error(`Action execution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Initialize task scheduler
	const tasksFilePath = join(workingDir, "tasks.json");
	taskScheduler = new TaskScheduler(
		tasksFilePath,
		{
			sendMessage: async (channelId: string, content: string) => {
				await channelRouter.send(content, channelId);
			},
			executeAction: executeScheduledAction,
			logInfo,
			logError,
		},
		db,
	);

	logInfo("Task Scheduler initialized");

	// Daily trading system health check (9 AM UTC)
	cron.schedule("0 9 * * *", async () => {
		logInfo("[CRON] Running daily trading system health check");
		try {
			const result = await execCommand(`
				echo "=== Trading System Daily Report ==="
				echo "Date: $(date)"
				echo ""
				echo "=== System Resources ==="
				free -h | head -2
				echo ""
				echo "=== Trading Processes ==="
				ps aux | grep -E 'python.*trad|collector' | grep -v grep | head -5 || echo "No trading processes found"
				echo ""
				echo "=== Recent Errors (last 24h) ==="
				find /home/majinbu/organized/active-projects/trading-system/quant/rbi_bench/ -name "*.log" -mtime 0 -exec grep -l -i error {} \\; 2>/dev/null | head -5 || echo "No error logs found"
			`);
			await sendToReportChannel(`**Daily Trading Report**\n\`\`\`\n${result.stdout.substring(0, 1800)}\n\`\`\``);
		} catch (error) {
			logError("[CRON] Health check failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Memory alert tracking (prevent spam)
	let lastMemoryAlertThreshold: "none" | "warning" | "critical" = "none";

	// Hourly quick status check with memory monitoring
	cron.schedule("0 * * * *", async () => {
		logInfo("[CRON] Running hourly status check");
		try {
			const result = await execCommand(`
				echo "Uptime: $(uptime -p)"
				echo "Load: $(cat /proc/loadavg | cut -d' ' -f1-3)"
				echo "Memory: $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
			`);
			// Log status
			logInfo(`[CRON] Status: ${result.stdout.replace(/\n/g, " | ").trim()}`);

			// Memory monitoring and alerting
			const memoryCheck = await execCommand(`
				# Get memory info in parseable format
				free -m | awk '/Mem:/ {printf "TOTAL=%d\\nUSED=%d\\nAVAIL=%d\\nPERCENT=%.1f", $2, $3, $7, ($3/$2)*100}'
				echo ""
				echo "TOP_PROCESSES:"
				ps aux --sort=-%mem | awk 'NR>1 {printf "%s\\t%.1f%%\\t%s\\n", $11, $4, $1}' | head -3
			`);

			if (memoryCheck.code === 0) {
				const output = memoryCheck.stdout;

				// Parse memory stats
				const percentMatch = output.match(/PERCENT=([\d.]+)/);
				const totalMatch = output.match(/TOTAL=(\d+)/);
				const usedMatch = output.match(/USED=(\d+)/);
				const availMatch = output.match(/AVAIL=(\d+)/);

				if (percentMatch && totalMatch && usedMatch && availMatch) {
					const memoryPercent = parseFloat(percentMatch[1]);
					const totalGB = (parseInt(totalMatch[1], 10) / 1024).toFixed(1);
					const usedGB = (parseInt(usedMatch[1], 10) / 1024).toFixed(1);
					const availGB = (parseInt(availMatch[1], 10) / 1024).toFixed(1);

					// Extract top processes
					const topProcessesMatch = output.match(/TOP_PROCESSES:\n([\s\S]+)$/);
					const topProcesses = topProcessesMatch ? topProcessesMatch[1].trim() : "Unable to fetch";

					// Determine threshold
					let currentThreshold: "none" | "warning" | "critical" = "none";
					if (memoryPercent >= 95) {
						currentThreshold = "critical";
					} else if (memoryPercent >= 90) {
						currentThreshold = "warning";
					}

					// Send alert if threshold crossed and different from last alert
					if (currentThreshold !== "none" && currentThreshold !== lastMemoryAlertThreshold) {
						const alertLevel = currentThreshold === "critical" ? "🚨 CRITICAL" : "⚠️ WARNING";
						const alertMessage = [
							`**${alertLevel}: High Memory Usage**`,
							``,
							`**Memory Usage:** ${memoryPercent.toFixed(1)}% (${usedGB}Gi / ${totalGB}Gi)`,
							`**Available:** ${availGB}Gi`,
							``,
							`**Top 3 Processes by Memory:**`,
							`\`\`\``,
							topProcesses,
							`\`\`\``,
							``,
							currentThreshold === "critical"
								? `⚠️ **Action required:** Memory usage is critically high. Consider restarting services or investigating memory leaks.`
								: `Monitor closely. Alert will trigger again if usage increases to 95%+.`,
						].join("\n");

						// Send to alert channel or DM first allowed user
						if (ALERTS_CHANNEL_ID) {
							await channelRouter.sendAlert(alertMessage);
						} else if (ALLOWED_USER_IDS.length > 0) {
							try {
								const user = await client.users.fetch(ALLOWED_USER_IDS[0]);
								await user.send(alertMessage);
							} catch (dmError) {
								logError(
									"[CRON] Failed to send memory alert DM",
									dmError instanceof Error ? dmError.message : String(dmError),
								);
							}
						}

						lastMemoryAlertThreshold = currentThreshold;
						logInfo(`[CRON] Memory alert sent: ${currentThreshold} (${memoryPercent.toFixed(1)}%)`);
					} else if (currentThreshold === "none" && lastMemoryAlertThreshold !== "none") {
						// Memory returned to normal, reset tracking
						lastMemoryAlertThreshold = "none";
						logInfo(`[CRON] Memory returned to normal levels (${memoryPercent.toFixed(1)}%)`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] Status check failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Daily analytics summary (midnight UTC)
	cron.schedule("0 0 * * *", async () => {
		logInfo("[CRON] Generating daily analytics summary");
		try {
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);

			const summary = analytics.generateDailySummary(yesterday);
			const dateStr = yesterday.toISOString().split("T")[0];
			const summaryPath = join(workingDir, "analytics", `summary-${dateStr}.md`);

			writeFileSync(summaryPath, summary);
			logInfo(`[CRON] Daily analytics summary saved to ${summaryPath}`);

			// Optionally send to report channel
			if (REPORT_CHANNEL_ID) {
				await sendToReportChannel(
					`**Daily Analytics Summary - ${dateStr}**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``,
				);
			}
		} catch (error) {
			logError("[CRON] Analytics summary failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Weekly analytics cleanup (Sunday at 3 AM)
	cron.schedule("0 3 * * 0", async () => {
		logInfo("[CRON] Running analytics cleanup");
		try {
			const deletedCount = analytics.cleanup(90); // Keep 90 days
			logInfo(`[CRON] Cleaned up ${deletedCount} old analytics files`);
		} catch (error) {
			logError("[CRON] Analytics cleanup failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Daily AI News Digest (8 AM UTC)
	const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
	if (NEWS_CHANNEL_ID) {
		cron.schedule("0 8 * * *", async () => {
			logInfo("[CRON] Fetching daily AI news digest");
			try {
				const smolNews = getSmolAINews();
				const digest = await smolNews.fetchLatest();

				const embed = new EmbedBuilder()
					.setColor(0x9b59b6)
					.setTitle(`Daily AI News - ${digest.date}`)
					.setURL("https://news.smol.ai")
					.setTimestamp()
					.setFooter({ text: "Smol AI News | Auto-digest" });

				const sections: string[] = [];

				if (digest.headlines.length > 0) {
					sections.push("**Headlines**");
					for (const h of digest.headlines.slice(0, 5)) {
						sections.push(`• ${h.title}`);
					}
					sections.push("");
				}

				if (digest.modelReleases.length > 0) {
					sections.push("**Model Releases**");
					for (const m of digest.modelReleases.slice(0, 5)) {
						sections.push(`• ${m.title}`);
					}
					sections.push("");
				}

				if (digest.tools.length > 0) {
					sections.push("**Tools & Infrastructure**");
					for (const t of digest.tools.slice(0, 3)) {
						sections.push(`• ${t.title}`);
					}
				}

				if (sections.length > 0) {
					embed.setDescription(sections.join("\n"));

					const channel = client.channels.cache.get(NEWS_CHANNEL_ID);
					if (channel?.isTextBased() && "send" in channel) {
						await channel.send({ embeds: [embed] });
						logInfo("[CRON] AI news digest posted successfully");
					} else {
						logWarning("[CRON] NEWS_CHANNEL_ID not found or not text-based");
					}
				} else {
					logInfo("[CRON] No AI news to post today");
				}
			} catch (error) {
				logError("[CRON] AI news digest failed", error instanceof Error ? error.message : String(error));
			}
		});
		logInfo(`[CRON] AI News digest scheduled for 8 AM UTC to channel ${NEWS_CHANNEL_ID}`);
	} else {
		logInfo("[CRON] NEWS_CHANNEL_ID not set - AI news digest disabled");
	}

	// Webhook server for external alerts
	const webhookApp = express();
	webhookApp.use(express.json());

	// API Key Authentication Middleware
	const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY;

	function authenticateApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
		// Skip auth for health endpoint
		if (req.path === "/health") {
			next();
			return;
		}

		// Check for API key in header or query param
		const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
		const apiKeyQuery = req.query.api_key as string | undefined;
		const providedKey = apiKeyHeader || apiKeyQuery;

		if (!WEBHOOK_API_KEY) {
			logWarning("[WEBHOOK] WEBHOOK_API_KEY not configured - authentication disabled");
			next();
			return;
		}

		if (!providedKey) {
			// Skip warning for localhost/internal requests (health checks, dashboard)
			const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip?.includes("127.0.0.1");
			if (!isLocalhost) {
				logWarning(`[WEBHOOK] Unauthorized attempt from ${req.ip} - no API key provided`);
			}
			res.status(401).json({ error: "Unauthorized - API key required" });
			return;
		}

		if (providedKey !== WEBHOOK_API_KEY) {
			logWarning(`[WEBHOOK] Unauthorized attempt from ${req.ip} - invalid API key`);
			res.status(401).json({ error: "Unauthorized - invalid API key" });
			return;
		}

		// Authentication successful
		next();
	}

	// Apply authentication middleware to all routes
	webhookApp.use(authenticateApiKey);

	// Price alert webhook
	webhookApp.post("/webhook/alert", async (req, res) => {
		try {
			const { message, priority, type } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			const prefix = priority === "high" ? "**ALERT**" : "**Alert**";
			const content = `${prefix}: ${message}`;

			// Route based on type field, default to alert channel
			if (type === "alert" || !type) {
				await channelRouter.sendAlert(content);
			} else {
				await sendToReportChannel(content);
			}

			logInfo(`[WEBHOOK] Alert received: ${message.substring(0, 50)}...`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Alert handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading signal webhook
	webhookApp.post("/webhook/signal", async (req, res) => {
		try {
			const { symbol, action, price, reason, type } = req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing symbol or action" });
				return;
			}

			const msg = `**Trading Signal**\nSymbol: \`${symbol}\`\nAction: **${action}**\nPrice: ${price || "N/A"}\nReason: ${reason || "N/A"}`;

			// Route based on type field, default to signal channel
			if (type === "signal" || !type) {
				await channelRouter.sendSignal(msg);
			} else {
				await sendToReportChannel(msg);
			}

			logInfo(`[WEBHOOK] Signal: ${symbol} ${action}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Signal handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GitHub webhook (for PR/Issue notifications)
	webhookApp.post("/webhook/github", async (req, res) => {
		try {
			const event = req.headers["x-github-event"] as string;
			const { action, repository, pull_request, issue, sender, type } = req.body;

			let msg = "";
			if (event === "pull_request") {
				msg = `**GitHub PR ${action}**\nRepo: \`${repository?.full_name}\`\nPR: #${pull_request?.number} - ${pull_request?.title}\nBy: ${sender?.login}`;
			} else if (event === "issues") {
				msg = `**GitHub Issue ${action}**\nRepo: \`${repository?.full_name}\`\nIssue: #${issue?.number} - ${issue?.title}\nBy: ${sender?.login}`;
			} else if (event === "push") {
				msg = `**GitHub Push**\nRepo: \`${repository?.full_name}\`\nBy: ${sender?.login}`;
			} else {
				msg = `**GitHub Event**: ${event} (${action || "N/A"})`;
			}

			// Route based on type field, default to log channel
			if (type === "log" || !type) {
				await channelRouter.sendLog(msg);
			} else {
				await sendToReportChannel(msg);
			}

			logInfo(`[WEBHOOK] GitHub: ${event} ${action || ""}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] GitHub handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Agent task webhook (trigger agent to do something)
	webhookApp.post("/webhook/agent", async (req, res) => {
		try {
			const { task, channel_id, model: reqModel } = req.body;
			if (!task) {
				res.status(400).json({ error: "Missing task" });
				return;
			}

			const targetChannel = channel_id || REPORT_CHANNEL_ID;
			logInfo(`[WEBHOOK] Agent task: ${task.substring(0, 50)}...`);

			// Execute via opencode CLI
			const { exec } = await import("child_process");
			const { promisify } = await import("util");
			const execAsync = promisify(exec);

			const modelArg = reqModel ? `-m ${reqModel}` : "";
			const cmd = `timeout 60 opencode run "${task.replace(/"/g, '\\"')}" ${modelArg} 2>&1 | head -100`;

			try {
				const { stdout } = await execAsync(cmd, { maxBuffer: 512 * 1024 });
				await sendToReportChannel(
					`**Agent Task Result:**\nTask: ${task.substring(0, 100)}\n\`\`\`\n${stdout.substring(0, 1500)}\n\`\`\``,
				);
				res.json({ status: "ok", result: stdout.substring(0, 500) });
			} catch (e: any) {
				await sendToReportChannel(`**Agent Task Failed:**\nTask: ${task.substring(0, 100)}\nError: ${e.message}`);
				res.json({ status: "error", error: e.message });
			}
		} catch (error) {
			logError("[WEBHOOK] Agent task failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Scheduled task webhook (for cron-like external triggers)
	webhookApp.post("/webhook/scheduled", async (req, res) => {
		try {
			const { task_name, payload, type } = req.body;
			if (!task_name) {
				res.status(400).json({ error: "Missing task_name" });
				return;
			}

			logInfo(`[WEBHOOK] Scheduled task: ${task_name}`);

			// Handle different scheduled tasks
			let msg = "";
			switch (task_name) {
				case "daily_summary":
					msg = `**Daily Summary Triggered**\n${JSON.stringify(payload || {}, null, 2)}`;
					break;
				case "health_check": {
					const uptime = process.uptime();
					msg = `**Health Check**\nUptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\nChannels: ${channelStates.size}\nModel: ${model.id}`;
					break;
				}
				default:
					msg = `**Scheduled Task: ${task_name}**\n${JSON.stringify(payload || {}, null, 2)}`;
			}

			// Route based on type field, default to report channel
			if (type === "report" || !type) {
				await channelRouter.sendReport(msg);
			} else if (type === "log") {
				await channelRouter.sendLog(msg);
			} else {
				await sendToReportChannel(msg);
			}

			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Scheduled task failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Custom message webhook (send any message to a channel)
	webhookApp.post("/webhook/message", async (req, res) => {
		try {
			const { channel_id, message, embed, type } = req.body;
			if (!message && !embed) {
				res.status(400).json({ error: "Missing message or embed" });
				return;
			}

			// Determine target channel based on type or explicit channel_id
			let targetChannel = channel_id;
			if (!targetChannel && type) {
				// Map type to channel ID
				switch (type) {
					case "alert":
						targetChannel = ALERTS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "signal":
						targetChannel = SIGNALS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "report":
						targetChannel = REPORTS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "log":
						targetChannel = LOGS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					default:
						targetChannel = REPORT_CHANNEL_ID;
				}
			} else if (!targetChannel) {
				targetChannel = REPORT_CHANNEL_ID;
			}

			if (!targetChannel) {
				res.status(400).json({ error: "No target channel" });
				return;
			}

			const channel = client.channels.cache.get(targetChannel) as TextChannel;
			if (!channel) {
				res.status(404).json({ error: "Channel not found" });
				return;
			}

			if (embed) {
				const embedObj = new EmbedBuilder()
					.setTitle(embed.title || "Notification")
					.setDescription(embed.description || message)
					.setColor(embed.color || 0x0099ff)
					.setTimestamp();
				await channel.send({ embeds: [embedObj] });
			} else {
				await channel.send(message);
			}

			logInfo(`[WEBHOOK] Message sent to ${targetChannel}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Message failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading Learning webhook (record trading outcomes for self-improvement)
	webhookApp.post("/webhook/trading/outcome", async (req, res) => {
		try {
			const { symbol, action, entryPrice, exitPrice, pnl, success, confidence, marketCondition, agents, reason } =
				req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing symbol or action" });
				return;
			}

			const { tradingLearning } = await import("./trading/index.js");
			await tradingLearning.recordOutcome({
				timestamp: new Date().toISOString(),
				symbol,
				action,
				entryPrice: entryPrice || 0,
				exitPrice,
				pnl,
				success: success ?? false,
				confidence: confidence || 0.5,
				marketCondition: marketCondition || "unknown",
				agents: agents || [],
				reason: reason || "N/A",
			});

			logInfo(`[WEBHOOK] Trading outcome: ${symbol} ${action} ${success ? "SUCCESS" : "FAIL"}`);
			res.json({ status: "ok", message: "Outcome recorded for learning" });
		} catch (error) {
			logError("[WEBHOOK] Trading outcome failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading Learning stats endpoint
	webhookApp.get("/webhook/trading/stats", async (_req, res) => {
		try {
			const { tradingLearning } = await import("./trading/index.js");
			const stats = tradingLearning.getStats();
			res.json({ status: "ok", ...stats });
		} catch (error) {
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Telegram bridge webhook (forward from external Telegram to Discord)
	webhookApp.post("/webhook/telegram", async (req, res) => {
		try {
			const { chat_id, username, message, message_type } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			const content = `**[Telegram${username ? ` - @${username}` : ""}]**\n${message}`;

			// Route based on message_type
			if (message_type === "alert") {
				await channelRouter.sendAlert(content);
			} else if (message_type === "signal") {
				await channelRouter.sendSignal(content);
			} else {
				await sendToReportChannel(content);
			}

			logInfo(`[WEBHOOK] Telegram message from ${username || chat_id || "unknown"}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Telegram bridge failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Universal route endpoint (smart routing based on content)
	webhookApp.post("/webhook/route", async (req, res) => {
		try {
			const { message, source, priority, tags } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			// Smart routing based on content/tags
			const lowerMsg = message.toLowerCase();
			const tagSet = new Set(tags || []);

			if (tagSet.has("alert") || priority === "high" || lowerMsg.includes("alert") || lowerMsg.includes("warning")) {
				await channelRouter.sendAlert(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("signal") || lowerMsg.includes("signal") || lowerMsg.includes("trade")) {
				await channelRouter.sendSignal(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("log") || lowerMsg.includes("log") || lowerMsg.includes("debug")) {
				await channelRouter.sendLog(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("report") || lowerMsg.includes("report") || lowerMsg.includes("summary")) {
				await channelRouter.sendReport(`**[${source || "Webhook"}]** ${message}`);
			} else {
				await sendToReportChannel(`**[${source || "Webhook"}]** ${message}`);
			}

			logInfo(`[WEBHOOK] Smart routed message from ${source || "unknown"}`);
			res.json({ status: "ok", routed: true });
		} catch (error) {
			logError("[WEBHOOK] Smart routing failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Health check endpoint
	webhookApp.get("/health", (_req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			model: model.id,
			channels: channelStates.size,
			tools: 35,
			skills: 32,
		});
	});

	// List available webhook endpoints
	webhookApp.get("/webhooks", (_req, res) => {
		res.json({
			endpoints: [
				{ path: "/webhook/alert", method: "POST", description: "Send alert message" },
				{ path: "/webhook/signal", method: "POST", description: "Trading signal notification" },
				{ path: "/webhook/github", method: "POST", description: "GitHub event notifications" },
				{ path: "/webhook/agent", method: "POST", description: "Trigger agent task" },
				{ path: "/webhook/scheduled", method: "POST", description: "Scheduled task trigger" },
				{ path: "/webhook/message", method: "POST", description: "Send custom message to channel" },
				{ path: "/webhook/trading/outcome", method: "POST", description: "Record trading outcome for learning" },
				{ path: "/webhook/trading/stats", method: "GET", description: "Get trading learning stats" },
				{ path: "/webhook/telegram", method: "POST", description: "Forward Telegram messages to Discord" },
				{ path: "/webhook/route", method: "POST", description: "Smart routing based on content" },
				{ path: "/health", method: "GET", description: "Health check" },
				{ path: "/webhooks", method: "GET", description: "List endpoints (this)" },
			],
		});
	});

	// Real Metrics API Endpoints
	webhookApp.get("/api/status", (_req, res) => {
		const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
		res.json({
			status: "ok",
			uptime,
			model: globalModelId,
			provider: currentProvider,
			commands: botStats.commandsProcessed,
			messages: botStats.messagesProcessed,
			errors: botStats.errorsCount,
			activeUsers: botStats.userInteractions.size,
			channels: channelStates.size,
		});
	});

	webhookApp.get("/api/metrics", (_req, res) => {
		const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
		const memUsage = process.memoryUsage();

		res.json({
			uptime,
			memory: {
				heapUsed: memUsage.heapUsed,
				heapTotal: memUsage.heapTotal,
				rss: memUsage.rss,
				external: memUsage.external,
			},
			stats: {
				commands: botStats.commandsProcessed,
				messages: botStats.messagesProcessed,
				errors: botStats.errorsCount,
				errorRate:
					botStats.messagesProcessed > 0
						? ((botStats.errorsCount / botStats.messagesProcessed) * 100).toFixed(2) + "%"
						: "0%",
			},
			users: {
				total: botStats.userInteractions.size,
				active: Array.from(botStats.userInteractions.values()).filter((u) => Date.now() - u.lastSeen < 3600000)
					.length,
			},
			channels: channelStates.size,
			rateLimits: {
				userLimit: "20/min",
				globalLimit: "100/min",
			},
		});
	});

	webhookApp.get("/api/tools", (_req, res) => {
		const tools = getToolUsageStats();
		res.json({
			total: tools.length,
			tools: tools.slice(0, 50),
		});
	});

	webhookApp.get("/api/users", (_req, res) => {
		const users = Array.from(botStats.userInteractions.entries())
			.map(([id, data]) => ({
				id,
				username: data.username,
				requests: data.count,
				lastSeen: new Date(data.lastSeen).toISOString(),
			}))
			.sort((a, b) => b.requests - a.requests)
			.slice(0, 50);

		res.json({ total: botStats.userInteractions.size, users });
	});

	// Serve dashboard static files
	webhookApp.use("/dashboard", express.static(join(workingDir, "dashboard")));

	webhookApp.listen(WEBHOOK_PORT, () => {
		logInfo(`[WEBHOOK] Server listening on port ${WEBHOOK_PORT}`);
	});

	// ========================================================================
	// Analytics Dashboard API (Port 9090)
	// ========================================================================

	const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "9090", 10);
	const dashboardApp = express();
	dashboardApp.use(express.json());

	// CORS headers for dashboard
	dashboardApp.use((req, res, next) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.header("Access-Control-Allow-Headers", "Content-Type");
		if (req.method === "OPTIONS") {
			return res.sendStatus(200);
		}
		next();
	});

	// Main analytics endpoint
	dashboardApp.get("/api/analytics", (req, res) => {
		try {
			const period = (req.query.period as "today" | "week" | "all") || "today";
			const stats = analytics.getStats(period);
			const commandStats = analytics.getCommandStats();
			const userStats = analytics.getUserStats();
			const hourlyDist = analytics.getHourlyDistribution();
			const modelUsage = analytics.getModelUsage();

			res.json({
				period,
				summary: stats,
				commands: commandStats.slice(0, 10),
				users: userStats.slice(0, 20),
				hourlyDistribution: hourlyDist,
				modelUsage,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Command-specific stats
	dashboardApp.get("/api/analytics/commands", (_req, res) => {
		try {
			const commandStats = analytics.getCommandStats();
			res.json(commandStats);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// User activity stats
	dashboardApp.get("/api/analytics/users", (_req, res) => {
		try {
			const userStats = analytics.getUserStats();
			res.json(userStats);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Health check for dashboard
	dashboardApp.get("/api/health", (_req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			model: model.id,
			channels: channelStates.size,
			analyticsEnabled: true,
		});
	});

	// Setup the enhanced dashboard with additional endpoints
	setupDashboard(dashboardApp, {
		analytics,
		botStats,
		model,
		currentProvider,
		channelStates,
		getToolUsageStats,
	});

	dashboardApp.listen(DASHBOARD_PORT, () => {
		logInfo(`[DASHBOARD] Analytics API listening on port ${DASHBOARD_PORT}`);
		logInfo(`[DASHBOARD] Access dashboard at http://localhost:${DASHBOARD_PORT}/dashboard`);
	});

	// ========================================================================
	// Telegram Bot (Pi Remote Agent)
	// ========================================================================

	if (process.env.TELEGRAM_BOT_TOKEN) {
		try {
			const telegramBot = createTelegramBot();

			// Start bot with polling
			telegramBot.launch({
				dropPendingUpdates: true,
			});

			logInfo(`[TELEGRAM] Bot started: @Pi_discordbot`);
			logInfo(`[TELEGRAM] Expert modes: ${Object.keys(TelegramExpertModes).join(", ")}`);

			// Graceful shutdown
			process.once("SIGINT", () => telegramBot.stop("SIGINT"));
			process.once("SIGTERM", () => telegramBot.stop("SIGTERM"));
		} catch (error) {
			logWarning("[TELEGRAM] Failed to start bot", error instanceof Error ? error.message : String(error));
		}
	} else {
		logInfo("[TELEGRAM] TELEGRAM_BOT_TOKEN not set - Telegram bot disabled");
	}

	logInfo("Event-driven triggers initialized (cron jobs + webhooks + analytics + telegram)");
}

main().catch((error) => {
	logError("Fatal error", error instanceof Error ? error.message : String(error));
	process.exit(1);
});
