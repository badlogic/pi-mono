/**
 * Shared utilities for headless OAuth flows.
 * Used when localhost callback server isn't reachable (SSH, remote environments).
 */

/**
 * Parse OAuth code and state from a redirect URL.
 * Used in headless mode where user pastes the failed localhost redirect URL.
 *
 * @param url - The full redirect URL from the browser's address bar
 * @param expectedPath - Expected path (e.g., "/oauth2callback" or "/oauth-callback")
 * @returns Parsed code and state
 * @throws Error if URL is invalid or missing required parameters
 */
export function parseOAuthRedirectUrl(url: string, expectedPath: string): { code: string; state: string } {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new Error("Invalid URL. Please paste the complete URL from your browser's address bar.");
	}

	// Verify it looks like the expected callback URL
	if (!parsed.pathname.endsWith(expectedPath)) {
		throw new Error(
			`Unexpected URL path. Expected a URL containing "${expectedPath}". ` +
				"Please paste the URL from your browser after the failed redirect.",
		);
	}

	const code = parsed.searchParams.get("code");
	const state = parsed.searchParams.get("state");
	const error = parsed.searchParams.get("error");

	if (error) {
		throw new Error(`OAuth error: ${error}`);
	}

	if (!code) {
		throw new Error("Missing 'code' parameter in URL. Please paste the complete redirect URL.");
	}

	if (!state) {
		throw new Error("Missing 'state' parameter in URL. Please paste the complete redirect URL.");
	}

	return { code, state };
}

/**
 * Instructions shown to user in headless mode.
 */
export const HEADLESS_INSTRUCTIONS =
	"After authorizing, your browser will show a connection error. " +
	"Copy the full URL from your browser's address bar and paste it below.";
