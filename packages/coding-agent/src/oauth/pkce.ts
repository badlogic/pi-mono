import { createHash, randomBytes } from "crypto";

export interface PKCEPair {
	verifier: string;
	challenge: string;
}

/**
 * Generate PKCE code verifier and challenge
 * Uses SHA-256 for the challenge method
 */
export function generatePKCE(): PKCEPair {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
	return randomBytes(16).toString("base64url");
}
