import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";

const DEFAULT_PORT = 1455;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface CallbackResult {
	code: string;
	state: string;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
	<title>Authorization Successful</title>
	<style>
		body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff; }
		.container { text-align: center; padding: 2rem; }
		.success { color: #4ade80; font-size: 3rem; margin-bottom: 1rem; }
		h1 { margin: 0 0 1rem 0; }
		p { color: #888; }
	</style>
</head>
<body>
	<div class="container">
		<div class="success">✓</div>
		<h1>Authorization Successful</h1>
		<p>You can close this window and return to the terminal.</p>
	</div>
</body>
</html>`;

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html>
<head>
	<title>Authorization Failed</title>
	<style>
		body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff; }
		.container { text-align: center; padding: 2rem; }
		.error { color: #f87171; font-size: 3rem; margin-bottom: 1rem; }
		h1 { margin: 0 0 1rem 0; }
		p { color: #888; }
		.message { color: #f87171; margin-top: 1rem; }
	</style>
</head>
<body>
	<div class="container">
		<div class="error">✗</div>
		<h1>Authorization Failed</h1>
		<p>There was an error during authorization.</p>
		<p class="message">${message}</p>
	</div>
</body>
</html>`;

/**
 * Start a local HTTP server to receive OAuth callback
 * @param expectedState The state parameter to validate against
 * @param port The port to listen on (default: 1455)
 * @returns Promise that resolves with the authorization code when received
 */
export function startCallbackServer(expectedState: string, port: number = DEFAULT_PORT): Promise<CallbackResult> {
	return new Promise((resolve, reject) => {
		let server: Server | null = null;
		let timeoutHandle: NodeJS.Timeout | null = null;

		const cleanup = () => {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			if (server) {
				server.close();
				server = null;
			}
		};

		const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url || "/", `http://localhost:${port}`);

			// Handle OAuth callback path (OpenAI uses /auth/callback)
			if (url.pathname !== "/" && url.pathname !== "/auth/callback") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			const error = url.searchParams.get("error");
			const errorDescription = url.searchParams.get("error_description");

			// Handle OAuth errors
			if (error) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(ERROR_HTML(errorDescription || error));
				cleanup();
				reject(new Error(`OAuth error: ${errorDescription || error}`));
				return;
			}

			// Validate required parameters
			if (!code || !state) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(ERROR_HTML("Missing code or state parameter"));
				cleanup();
				reject(new Error("Missing code or state parameter in callback"));
				return;
			}

			// Validate state for CSRF protection
			if (state !== expectedState) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(ERROR_HTML("Invalid state parameter (possible CSRF attack)"));
				cleanup();
				reject(new Error("State parameter mismatch - possible CSRF attack"));
				return;
			}

			// Success
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(SUCCESS_HTML);
			cleanup();
			resolve({ code, state });
		};

		server = createServer(handleRequest);

		server.on("error", (err: NodeJS.ErrnoException) => {
			cleanup();
			if (err.code === "EADDRINUSE") {
				reject(new Error(`Port ${port} is already in use. Please close any other OAuth processes and try again.`));
			} else {
				reject(err);
			}
		});

		server.listen(port, "127.0.0.1", () => {
			// Set timeout
			timeoutHandle = setTimeout(() => {
				cleanup();
				reject(new Error("OAuth callback timed out. Please try again."));
			}, TIMEOUT_MS);
		});
	});
}
