/**
 * Production Hardening Utilities
 * Security, Performance, and Reliability helpers
 */

import type { TextChannel } from "discord.js";

// ============================================================================
// Configuration
// ============================================================================

export const CONFIG = {
	// Rate Limiting
	RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || "60000", 10), // 1 minute
	RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "10", 10),

	// Request Limits
	MAX_REQUEST_SIZE: parseInt(process.env.MAX_REQUEST_SIZE || "1048576", 10), // 1MB
	REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT || "30000", 10), // 30s

	// Circuit Breaker
	CIRCUIT_BREAKER_THRESHOLD: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "5", 10),
	CIRCUIT_BREAKER_TIMEOUT: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || "60000", 10), // 1 min

	// Retry Logic
	MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "3", 10),
	RETRY_DELAY: parseInt(process.env.RETRY_DELAY || "1000", 10), // 1s

	// Webhook Queue
	WEBHOOK_QUEUE_MAX_SIZE: parseInt(process.env.WEBHOOK_QUEUE_MAX_SIZE || "100", 10),
	WEBHOOK_PROCESS_INTERVAL: parseInt(process.env.WEBHOOK_PROCESS_INTERVAL || "1000", 10), // 1s

	// Memory Management
	MEMORY_CHECK_INTERVAL: parseInt(process.env.MEMORY_CHECK_INTERVAL || "300000", 10), // 5 min
	MEMORY_THRESHOLD_MB: parseInt(process.env.MEMORY_THRESHOLD_MB || "400", 10),

	// Error Reporting
	ERROR_CHANNEL_ID: process.env.ERROR_CHANNEL_ID,
} as const;

// ============================================================================
// Input Sanitization
// ============================================================================

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
	if (typeof input !== "string") return "";

	// Remove null bytes
	let sanitized = input.replace(/\0/g, "");

	// Limit length
	const MAX_INPUT_LENGTH = 10000;
	if (sanitized.length > MAX_INPUT_LENGTH) {
		sanitized = sanitized.substring(0, MAX_INPUT_LENGTH);
	}

	return sanitized.trim();
}

/**
 * Sanitize file paths to prevent directory traversal
 */
export function sanitizePath(path: string): string {
	if (typeof path !== "string") return "";

	// Remove null bytes and dangerous patterns
	let sanitized = path.replace(/\0/g, "");

	// Block path traversal attempts
	const dangerousPatterns = [
		/\.\.\//g, // ../
		/\.\.\\/g, // ..\
		/~\//g, // ~/
	];

	for (const pattern of dangerousPatterns) {
		sanitized = sanitized.replace(pattern, "");
	}

	return sanitized;
}

/**
 * Validate webhook payload
 */
export function validateWebhookPayload(payload: any): { valid: boolean; error?: string } {
	if (!payload || typeof payload !== "object") {
		return { valid: false, error: "Invalid payload format" };
	}

	// Check payload size
	const payloadSize = JSON.stringify(payload).length;
	if (payloadSize > CONFIG.MAX_REQUEST_SIZE) {
		return { valid: false, error: "Payload too large" };
	}

	// Check for required fields based on endpoint
	// This will be extended per endpoint

	return { valid: true };
}

// ============================================================================
// Circuit Breaker Pattern
// ============================================================================

interface CircuitState {
	failures: number;
	lastFailureTime: number;
	state: "closed" | "open" | "half-open";
}

const circuitBreakers = new Map<string, CircuitState>();

export class CircuitBreaker {
	private serviceName: string;

	constructor(serviceName: string) {
		this.serviceName = serviceName;
		if (!circuitBreakers.has(serviceName)) {
			circuitBreakers.set(serviceName, {
				failures: 0,
				lastFailureTime: 0,
				state: "closed",
			});
		}
	}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		const state = circuitBreakers.get(this.serviceName)!;

		// Check if circuit is open
		if (state.state === "open") {
			const timeSinceLastFailure = Date.now() - state.lastFailureTime;

			if (timeSinceLastFailure < CONFIG.CIRCUIT_BREAKER_TIMEOUT) {
				throw new Error(`Circuit breaker open for ${this.serviceName}`);
			}

			// Try half-open
			state.state = "half-open";
		}

		try {
			const result = await fn();

			// Success - reset failures
			if (state.state === "half-open") {
				state.state = "closed";
			}
			state.failures = 0;

			return result;
		} catch (error) {
			// Failure - increment counter
			state.failures++;
			state.lastFailureTime = Date.now();

			if (state.failures >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
				state.state = "open";
			}

			throw error;
		}
	}

	getState(): "closed" | "open" | "half-open" {
		return circuitBreakers.get(this.serviceName)?.state || "closed";
	}

	reset(): void {
		const state = circuitBreakers.get(this.serviceName);
		if (state) {
			state.failures = 0;
			state.state = "closed";
		}
	}
}

// ============================================================================
// Retry Logic with Exponential Backoff
// ============================================================================

export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number;
		initialDelay?: number;
		maxDelay?: number;
		backoffFactor?: number;
	} = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? CONFIG.MAX_RETRIES;
	const initialDelay = options.initialDelay ?? CONFIG.RETRY_DELAY;
	const maxDelay = options.maxDelay ?? 30000; // 30s
	const backoffFactor = options.backoffFactor ?? 2;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt === maxRetries) {
				break;
			}

			// Calculate delay with exponential backoff
			const delay = Math.min(initialDelay * backoffFactor ** attempt, maxDelay);

			// Add jitter (±25%)
			const jitter = delay * (0.75 + Math.random() * 0.5);

			await new Promise((resolve) => setTimeout(resolve, jitter));
		}
	}

	throw lastError || new Error("Retry failed");
}

// ============================================================================
// Webhook Queue
// ============================================================================

interface WebhookQueueItem {
	id: string;
	type: string;
	payload: any;
	timestamp: number;
	retries: number;
}

export class WebhookQueue {
	private queue: WebhookQueueItem[] = [];
	private processing = false;

	add(type: string, payload: any): boolean {
		if (this.queue.length >= CONFIG.WEBHOOK_QUEUE_MAX_SIZE) {
			return false; // Queue full
		}

		this.queue.push({
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			type,
			payload,
			timestamp: Date.now(),
			retries: 0,
		});

		return true;
	}

	async process(handler: (item: WebhookQueueItem) => Promise<void>): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return;
		}

		this.processing = true;

		try {
			const item = this.queue.shift();
			if (!item) return;

			try {
				await handler(item);
			} catch (error) {
				// Retry logic
				if (item.retries < CONFIG.MAX_RETRIES) {
					item.retries++;
					this.queue.push(item); // Re-queue
				}
				// Otherwise, drop the item (could log to error channel)
			}
		} finally {
			this.processing = false;
		}
	}

	size(): number {
		return this.queue.length;
	}

	clear(): void {
		this.queue = [];
	}
}

// ============================================================================
// Memory Leak Detection
// ============================================================================

let lastMemoryCheck = 0;
let memoryWarningCount = 0;

export function checkMemoryUsage(errorReporter?: (message: string) => Promise<void>): void {
	const now = Date.now();

	if (now - lastMemoryCheck < CONFIG.MEMORY_CHECK_INTERVAL) {
		return;
	}

	lastMemoryCheck = now;

	const usage = process.memoryUsage();
	const heapUsedMB = usage.heapUsed / 1024 / 1024;
	const rssUsedMB = usage.rss / 1024 / 1024;

	console.log(
		`[MEMORY] Heap: ${heapUsedMB.toFixed(2)}MB, RSS: ${rssUsedMB.toFixed(2)}MB, External: ${(usage.external / 1024 / 1024).toFixed(2)}MB`,
	);

	if (heapUsedMB > CONFIG.MEMORY_THRESHOLD_MB) {
		memoryWarningCount++;

		const warningMsg = `Memory usage high: ${heapUsedMB.toFixed(2)}MB (threshold: ${CONFIG.MEMORY_THRESHOLD_MB}MB)`;
		console.warn(`[MEMORY WARNING] ${warningMsg}`);

		if (errorReporter && memoryWarningCount % 3 === 0) {
			// Report every 3rd warning to avoid spam
			errorReporter(warningMsg).catch(() => {});
		}

		// Trigger garbage collection if available
		if (global.gc) {
			console.log("[MEMORY] Triggering garbage collection...");
			global.gc();
		}
	} else {
		memoryWarningCount = 0; // Reset on normal usage
	}
}

// ============================================================================
// HTTP Connection Pooling
// ============================================================================

import http from "http";
import https from "https";

export const httpAgent = new http.Agent({
	keepAlive: true,
	keepAliveMsecs: 30000,
	maxSockets: 50,
	maxFreeSockets: 10,
	timeout: CONFIG.REQUEST_TIMEOUT,
});

export const httpsAgent = new https.Agent({
	keepAlive: true,
	keepAliveMsecs: 30000,
	maxSockets: 50,
	maxFreeSockets: 10,
	timeout: CONFIG.REQUEST_TIMEOUT,
});

// ============================================================================
// Response Cache
// ============================================================================

interface CacheEntry<T> {
	value: T;
	timestamp: number;
	ttl: number;
}

export class ResponseCache<T = any> {
	private cache = new Map<string, CacheEntry<T>>();

	set(key: string, value: T, ttl: number = 300000): void {
		// Default 5 min TTL
		this.cache.set(key, {
			value,
			timestamp: Date.now(),
			ttl,
		});
	}

	get(key: string): T | null {
		const entry = this.cache.get(key);

		if (!entry) return null;

		const age = Date.now() - entry.timestamp;
		if (age > entry.ttl) {
			this.cache.delete(key);
			return null;
		}

		return entry.value;
	}

	has(key: string): boolean {
		return this.get(key) !== null;
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	// Cleanup expired entries
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > entry.ttl) {
				this.cache.delete(key);
			}
		}
	}
}

// ============================================================================
// Error Reporting
// ============================================================================

export async function reportError(client: any, error: Error, context: string): Promise<void> {
	if (!CONFIG.ERROR_CHANNEL_ID) return;

	try {
		const channel = await client.channels.fetch(CONFIG.ERROR_CHANNEL_ID);
		if (channel && "send" in channel) {
			const errorMsg = `**Error in ${context}**\n\`\`\`\n${error.message}\n\`\`\`\n\`\`\`\n${error.stack?.substring(0, 1500) || "No stack trace"}\n\`\`\``;
			await (channel as TextChannel).send(errorMsg.substring(0, 2000));
		}
	} catch (reportError) {
		// Silently fail - don't create error loop
		console.error("[ERROR REPORTING] Failed to report error:", reportError);
	}
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export class ShutdownHandler {
	private shutdownHandlers: Array<() => Promise<void>> = [];
	private shuttingDown = false;

	register(handler: () => Promise<void>): void {
		this.shutdownHandlers.push(handler);
	}

	async shutdown(signal: string): Promise<void> {
		if (this.shuttingDown) {
			console.log("[SHUTDOWN] Already shutting down, forcing exit...");
			process.exit(1);
		}

		this.shuttingDown = true;
		console.log(`[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

		// Set timeout for forced shutdown
		const forceTimeout = setTimeout(() => {
			console.error("[SHUTDOWN] Graceful shutdown timed out, forcing exit");
			process.exit(1);
		}, 30000); // 30 seconds

		try {
			// Run all shutdown handlers
			await Promise.all(this.shutdownHandlers.map((h) => h()));

			console.log("[SHUTDOWN] Graceful shutdown completed");
			clearTimeout(forceTimeout);
			process.exit(0);
		} catch (error) {
			console.error("[SHUTDOWN] Error during shutdown:", error);
			clearTimeout(forceTimeout);
			process.exit(1);
		}
	}
}

// ============================================================================
// Sensitive Data Filtering
// ============================================================================

const SENSITIVE_PATTERNS = [
	/([A-Za-z0-9_\-.]{30,})/g, // API keys/tokens (long alphanumeric strings)
	/(password|passwd|pwd|secret|token|key|api[-_]?key)[\s:=]["']?([^\s"']+)/gi,
	/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Bearer tokens
	/[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}/g, // Credit card numbers
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses (partial redaction)
];

export function sanitizeLogOutput(text: string): string {
	let sanitized = text;

	// Redact sensitive patterns
	for (const pattern of SENSITIVE_PATTERNS) {
		sanitized = sanitized.replace(pattern, (match) => {
			// Keep first 4 and last 4 characters for debugging
			if (match.length > 12) {
				return `${match.substring(0, 4)}...${match.substring(match.length - 4)}`;
			}
			return "***REDACTED***";
		});
	}

	return sanitized;
}
