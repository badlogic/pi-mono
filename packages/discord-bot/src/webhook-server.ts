/**
 * Hardened Webhook Server with Security & Reliability
 */

import { timingSafeEqual } from "crypto";
import type { Client, TextChannel } from "discord.js";
import express from "express";
import helmet from "helmet";
import {
	CircuitBreaker,
	CONFIG,
	retryWithBackoff,
	sanitizeInput,
	sanitizeLogOutput,
	validateWebhookPayload,
	WebhookQueue,
} from "./hardening-utils.js";

// Auth rate limiter: tracks failed attempts per IP
const authFailures = new Map<string, { count: number; firstAttempt: number }>();
const AUTH_RATE_LIMIT = 5; // max failures
const AUTH_RATE_WINDOW = 60000; // 1 minute

function isAuthRateLimited(ip: string): boolean {
	const now = Date.now();
	const record = authFailures.get(ip);

	if (!record) return false;

	// Reset if window expired
	if (now - record.firstAttempt > AUTH_RATE_WINDOW) {
		authFailures.delete(ip);
		return false;
	}

	return record.count >= AUTH_RATE_LIMIT;
}

function recordAuthFailure(ip: string): void {
	const now = Date.now();
	const record = authFailures.get(ip);

	if (!record || now - record.firstAttempt > AUTH_RATE_WINDOW) {
		authFailures.set(ip, { count: 1, firstAttempt: now });
	} else {
		record.count++;
	}
}

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		const bufA = Buffer.from(a, "utf8");
		const bufB = Buffer.from(b, "utf8");
		return timingSafeEqual(bufA, bufB);
	} catch {
		return false;
	}
}

const webhookQueue = new WebhookQueue();
const apiCircuitBreaker = new CircuitBreaker("external-api");

// ============================================================================
// Helper Functions
// ============================================================================

function logInfo(message: string): void {
	console.log(`[WEBHOOK] ${message}`);
}

function logWarning(message: string): void {
	console.warn(`[WEBHOOK] ${sanitizeLogOutput(message)}`);
}

function logError(message: string, detail?: string): void {
	console.error(`[WEBHOOK ERROR] ${sanitizeLogOutput(message)}`, detail ? sanitizeLogOutput(detail) : "");
}

// Send message to report channel
async function sendToReportChannel(client: Client, content: string): Promise<void> {
	const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
	if (!REPORT_CHANNEL_ID) return;

	try {
		const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
		if (channel && "send" in channel) {
			await (channel as TextChannel).send(content.substring(0, 2000));
		}
	} catch (error) {
		logError("Failed to send to report channel", error instanceof Error ? error.message : String(error));
	}
}

// ============================================================================
// Webhook Server Setup
// ============================================================================

export function createWebhookServer(client: Client): express.Application {
	const app = express();

	// Security: Helmet for HTTP headers
	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
				},
			},
			hsts: {
				maxAge: 31536000,
				includeSubDomains: true,
				preload: true,
			},
		}),
	);

	// Security: Request size limit
	app.use(
		express.json({
			limit: `${CONFIG.MAX_REQUEST_SIZE}b`,
		}),
	);

	// Security: Disable X-Powered-By
	app.disable("x-powered-by");

	// Request timeout middleware
	app.use((req, res, next) => {
		req.setTimeout(CONFIG.REQUEST_TIMEOUT);
		res.setTimeout(CONFIG.REQUEST_TIMEOUT);
		next();
	});

	// Request logging middleware
	app.use((req, res, next) => {
		const start = Date.now();
		res.on("finish", () => {
			const duration = Date.now() - start;
			logInfo(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
		});
		next();
	});

	// API Key Authentication Middleware
	const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY;

	function authenticateApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
		// Skip auth for health endpoint
		if (req.path === "/health") {
			next();
			return;
		}

		const clientIP = req.ip || "unknown";

		// SECURITY: Rate limit auth failures to prevent brute force
		if (isAuthRateLimited(clientIP)) {
			logWarning(`Rate limited auth attempt from ${clientIP}`);
			res.status(429).json({ error: "Too many failed attempts, try again later" });
			return;
		}

		// SECURITY: Only accept API key via header (not query string to prevent logging/leakage)
		const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

		if (!WEBHOOK_API_KEY) {
			logWarning("WEBHOOK_API_KEY not configured - authentication disabled");
			next();
			return;
		}

		if (!apiKeyHeader) {
			recordAuthFailure(clientIP);
			logWarning(`Unauthorized attempt from ${clientIP} - no API key provided`);
			res.status(401).json({ error: "Unauthorized - API key required in X-API-Key header" });
			return;
		}

		// SECURITY: Use constant-time comparison to prevent timing attacks
		if (!secureCompare(apiKeyHeader, WEBHOOK_API_KEY)) {
			recordAuthFailure(clientIP);
			logWarning(`Unauthorized attempt from ${clientIP} - invalid API key`);
			res.status(401).json({ error: "Unauthorized - invalid API key" });
			return;
		}

		next();
	}

	// Apply authentication middleware
	app.use(authenticateApiKey);

	// ========================================================================
	// Webhook Endpoints
	// ========================================================================

	// Price alert webhook
	app.post("/webhook/alert", async (req, res) => {
		try {
			// Validate payload
			const validation = validateWebhookPayload(req.body);
			if (!validation.valid) {
				res.status(400).json({ error: validation.error });
				return;
			}

			const { message, priority } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message field" });
				return;
			}

			// Sanitize input
			const sanitizedMessage = sanitizeInput(message);
			const sanitizedPriority = priority ? sanitizeInput(priority) : "normal";

			// Add to queue
			const queued = webhookQueue.add("alert", {
				message: sanitizedMessage,
				priority: sanitizedPriority,
			});

			if (!queued) {
				res.status(503).json({ error: "Queue full, try again later" });
				return;
			}

			logInfo(`Alert queued: ${sanitizedMessage.substring(0, 50)}...`);
			res.json({ status: "queued", queueSize: webhookQueue.size() });
		} catch (error) {
			logError("Alert webhook error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading signal webhook
	app.post("/webhook/signal", async (req, res) => {
		try {
			// Validate payload
			const validation = validateWebhookPayload(req.body);
			if (!validation.valid) {
				res.status(400).json({ error: validation.error });
				return;
			}

			const { symbol, action, price, reason } = req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing required fields: symbol, action" });
				return;
			}

			// Sanitize inputs
			const sanitizedData = {
				symbol: sanitizeInput(symbol),
				action: sanitizeInput(action),
				price: price ? sanitizeInput(String(price)) : "N/A",
				reason: reason ? sanitizeInput(reason) : "N/A",
			};

			// Add to queue
			const queued = webhookQueue.add("signal", sanitizedData);

			if (!queued) {
				res.status(503).json({ error: "Queue full, try again later" });
				return;
			}

			logInfo(`Signal queued: ${sanitizedData.symbol} ${sanitizedData.action}`);
			res.json({ status: "queued", queueSize: webhookQueue.size() });
		} catch (error) {
			logError("Signal webhook error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Health check endpoint (unauthenticated)
	app.get("/health", (_req, res) => {
		const memUsage = process.memoryUsage();
		res.json({
			status: "ok",
			uptime: process.uptime(),
			memory: {
				heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
				heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
				rss: Math.round(memUsage.rss / 1024 / 1024),
			},
			queueSize: webhookQueue.size(),
			circuitBreaker: apiCircuitBreaker.getState(),
			timestamp: new Date().toISOString(),
		});
	});

	// Metrics endpoint (authenticated)
	app.get("/metrics", (_req, res) => {
		const memUsage = process.memoryUsage();
		res.json({
			uptime: process.uptime(),
			memory: {
				heapUsed: memUsage.heapUsed,
				heapTotal: memUsage.heapTotal,
				external: memUsage.external,
				arrayBuffers: memUsage.arrayBuffers,
				rss: memUsage.rss,
			},
			queueSize: webhookQueue.size(),
			circuitBreaker: apiCircuitBreaker.getState(),
			config: {
				maxQueueSize: CONFIG.WEBHOOK_QUEUE_MAX_SIZE,
				requestTimeout: CONFIG.REQUEST_TIMEOUT,
				maxRequestSize: CONFIG.MAX_REQUEST_SIZE,
			},
		});
	});

	// 404 handler
	app.use((_req, res) => {
		res.status(404).json({ error: "Not found" });
	});

	// Global error handler
	app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		logError("Express error", err.message);
		res.status(500).json({ error: "Internal server error" });
	});

	// ========================================================================
	// Queue Processing
	// ========================================================================

	// Process webhook queue periodically
	setInterval(async () => {
		await webhookQueue.process(async (item) => {
			try {
				if (item.type === "alert") {
					const { message, priority } = item.payload;
					const prefix = priority === "high" ? "**ALERT**" : "**Alert**";
					await retryWithBackoff(() => sendToReportChannel(client, `${prefix}: ${message}`));
				} else if (item.type === "signal") {
					const { symbol, action, price, reason } = item.payload;
					const msg = `**Trading Signal**\nSymbol: \`${symbol}\`\nAction: **${action}**\nPrice: ${price}\nReason: ${reason}`;
					await retryWithBackoff(() => sendToReportChannel(client, msg));
				}
			} catch (error) {
				logError(`Failed to process queue item ${item.id}`, error instanceof Error ? error.message : String(error));
				throw error; // Re-throw to trigger retry logic
			}
		});
	}, CONFIG.WEBHOOK_PROCESS_INTERVAL);

	return app;
}

export { webhookQueue };
