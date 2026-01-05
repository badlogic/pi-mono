export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	idToken?: string;
	accountId?: string;
	enterpriseUrl?: string;
	projectId?: string;
	email?: string;
};

export type OAuthProvider = "anthropic" | "github-copilot" | "google-gemini-cli" | "google-antigravity" | "openai";

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
};

export interface OAuthProviderInfo {
	id: OAuthProvider;
	name: string;
	available: boolean;
}
