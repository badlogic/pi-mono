#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

export function createCorsProxy() {
	const app = new Hono();

	// Enable CORS for all origins
	app.use("*", cors());

	// Proxy all requests
	app.all("*", async (c) => {
		const url = new URL(c.req.url);
		const targetUrl = url.searchParams.get("url");

		if (!targetUrl) {
			return c.json({ error: "Missing 'url' query parameter" }, 400);
		}

		try {
			// Forward the request
			const headers = new Headers();
			c.req.raw.headers.forEach((value, key) => {
				// Skip host and origin headers
				if (key.toLowerCase() !== "host" && key.toLowerCase() !== "origin") {
					headers.set(key, value);
				}
			});

			const response = await fetch(targetUrl, {
				method: c.req.method,
				headers,
				body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.raw.clone().arrayBuffer() : undefined,
			});

			// Forward response headers
			const responseHeaders = new Headers();
			response.headers.forEach((value, key) => {
				// Skip CORS headers (we handle them)
				if (!key.toLowerCase().startsWith("access-control-")) {
					responseHeaders.set(key, value);
				}
			});

			// Return proxied response
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders,
			});
		} catch (error) {
			console.error("Proxy error:", error);
			return c.json({ error: error instanceof Error ? error.message : "Proxy request failed" }, 502);
		}
	});

	return app;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const app = createCorsProxy();
	const port = Number.parseInt(process.argv[2] || "3001", 10);

	console.log(`🔌 CORS proxy running on http://localhost:${port}`);
	console.log(`Usage: http://localhost:${port}?url=<target-url>`);

	serve({
		fetch: app.fetch,
		port,
	});
}
