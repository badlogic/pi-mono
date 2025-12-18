/**
 * Rate Limiter Utility
 * Prevents API rate limit errors by throttling requests
 */

// ============================================================================
// Types
// ============================================================================

interface RateLimitConfig {
	maxRequests: number; // Max requests per window
	windowMs: number; // Time window in milliseconds
	minIntervalMs?: number; // Minimum time between requests
}

interface RateLimitState {
	requests: number[];
	lastRequest: number;
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
	private limits = new Map<string, RateLimitConfig>();
	private states = new Map<string, RateLimitState>();

	/**
	 * Register a rate limit for an API
	 */
	register(apiName: string, config: RateLimitConfig): void {
		this.limits.set(apiName, config);
		this.states.set(apiName, { requests: [], lastRequest: 0 });
	}

	/**
	 * Check if request is allowed (non-blocking)
	 */
	canRequest(apiName: string): boolean {
		const config = this.limits.get(apiName);
		if (!config) return true; // No limit registered

		const state = this.states.get(apiName)!;
		const now = Date.now();

		// Clean old requests outside window
		state.requests = state.requests.filter((t) => now - t < config.windowMs);

		// Check request count
		if (state.requests.length >= config.maxRequests) {
			return false;
		}

		// Check minimum interval
		if (config.minIntervalMs && now - state.lastRequest < config.minIntervalMs) {
			return false;
		}

		return true;
	}

	/**
	 * Record a request
	 */
	recordRequest(apiName: string): void {
		const state = this.states.get(apiName);
		if (!state) return;

		const now = Date.now();
		state.requests.push(now);
		state.lastRequest = now;
	}

	/**
	 * Wait until request is allowed (blocking)
	 */
	async waitForSlot(apiName: string): Promise<void> {
		const config = this.limits.get(apiName);
		if (!config) return;

		while (!this.canRequest(apiName)) {
			// Calculate wait time
			const state = this.states.get(apiName)!;
			const now = Date.now();

			// Either wait for window to clear or for min interval
			const oldestRequest = state.requests[0] || 0;
			const windowWait = Math.max(0, oldestRequest + config.windowMs - now);
			const intervalWait = config.minIntervalMs ? Math.max(0, state.lastRequest + config.minIntervalMs - now) : 0;

			const waitTime = Math.max(windowWait, intervalWait, 100); // At least 100ms
			await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 5000)));
		}
	}

	/**
	 * Execute with rate limiting
	 */
	async execute<T>(apiName: string, fn: () => Promise<T>): Promise<T> {
		await this.waitForSlot(apiName);
		this.recordRequest(apiName);
		return fn();
	}

	/**
	 * Get rate limit status
	 */
	getStatus(apiName: string): {
		remaining: number;
		resetIn: number;
		lastRequest: number;
	} | null {
		const config = this.limits.get(apiName);
		const state = this.states.get(apiName);
		if (!config || !state) return null;

		const now = Date.now();
		const validRequests = state.requests.filter((t) => now - t < config.windowMs);
		const oldestRequest = validRequests[0] || now;

		return {
			remaining: config.maxRequests - validRequests.length,
			resetIn: Math.max(0, oldestRequest + config.windowMs - now),
			lastRequest: state.lastRequest,
		};
	}

	/**
	 * Get all registered APIs
	 */
	listApis(): string[] {
		return Array.from(this.limits.keys());
	}
}

// ============================================================================
// Singleton with Pre-configured APIs
// ============================================================================

export const rateLimiter = new RateLimiter();

// CoinGecko: 10-30 calls/minute for free tier
rateLimiter.register("coingecko", {
	maxRequests: 10,
	windowMs: 60000, // 1 minute
	minIntervalMs: 3000, // 3 seconds between calls
});

// CoinGlass: 10 calls/minute estimated
rateLimiter.register("coinglass", {
	maxRequests: 10,
	windowMs: 60000,
	minIntervalMs: 5000,
});

// CryptoPanic: 20 calls/minute estimated
rateLimiter.register("cryptopanic", {
	maxRequests: 20,
	windowMs: 60000,
	minIntervalMs: 2000,
});

// OpenRouter: 200 requests/minute
rateLimiter.register("openrouter", {
	maxRequests: 100, // Conservative
	windowMs: 60000,
	minIntervalMs: 500,
});

// Groq: 30 requests/minute for free tier
rateLimiter.register("groq", {
	maxRequests: 25,
	windowMs: 60000,
	minIntervalMs: 2000,
});

// ============================================================================
// Convenience Exports
// ============================================================================

export const RateLimiterUtils = {
	rateLimiter,
	canRequest: (api: string) => rateLimiter.canRequest(api),
	execute: <T>(api: string, fn: () => Promise<T>) => rateLimiter.execute(api, fn),
	getStatus: (api: string) => rateLimiter.getStatus(api),
};
