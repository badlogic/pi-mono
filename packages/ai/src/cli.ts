#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { loginAnthropic } from "./utils/oauth/anthropic.js";
import { loginGitHubCopilot } from "./utils/oauth/github-copilot.js";
import { loginAntigravity } from "./utils/oauth/google-antigravity.js";
import { loginGeminiCli } from "./utils/oauth/google-gemini-cli.js";
import { getOAuthProviders } from "./utils/oauth/index.js";
import type { OAuthCredentials, OAuthProvider } from "./utils/oauth/types.js";

const AUTH_FILE = "auth.json";
const PROVIDERS = getOAuthProviders();

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
	return new Promise((resolve) => rl.question(question, resolve));
}

function loadAuth(): Record<string, { type: "oauth" } & OAuthCredentials> {
	if (!existsSync(AUTH_FILE)) return {};
	try {
		return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
	} catch {
		return {};
	}
}

function saveAuth(auth: Record<string, { type: "oauth" } & OAuthCredentials>): void {
	writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), "utf-8");
}

async function login(provider: OAuthProvider): Promise<void> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	const promptFn = (msg: string) => prompt(rl, `${msg} `);

	try {
		let credentials: OAuthCredentials;

		switch (provider) {
			case "anthropic":
				credentials = await loginAnthropic(
					(url) => {
						console.log(`\nOpen this URL in your browser:\n${url}\n`);
					},
					async () => {
						return await promptFn("Paste the authorization code:");
					},
				);
				break;

			case "github-copilot":
				credentials = await loginGitHubCopilot({
					onAuth: (url, instructions) => {
						console.log(`\nOpen this URL in your browser:\n${url}`);
						if (instructions) console.log(instructions);
						console.log();
					},
					onPrompt: async (p) => {
						return await promptFn(`${p.message}${p.placeholder ? ` (${p.placeholder})` : ""}:`);
					},
					onProgress: (msg) => console.log(msg),
				});
				break;

			case "google-gemini-cli":
				credentials = await loginGeminiCli(
					(info) => {
						console.log(`\nOpen this URL in your browser:\n${info.url}`);
						if (info.instructions) console.log(info.instructions);
						console.log();
					},
					(msg) => console.log(msg),
				);
				break;

			case "google-antigravity":
				credentials = await loginAntigravity(
					(info) => {
						console.log(`\nOpen this URL in your browser:\n${info.url}`);
						if (info.instructions) console.log(info.instructions);
						console.log();
					},
					(msg) => console.log(msg),
				);
				break;
		}

		const auth = loadAuth();
		auth[provider] = { type: "oauth", ...credentials };
		saveAuth(auth);

		console.log(`\nCredentials saved to ${AUTH_FILE}`);
	} finally {
		rl.close();
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "help" || command === "--help" || command === "-h") {
		console.log(`Usage: npx @mariozechner/pi-ai <command> [provider]

Commands:
  login [provider]  Login to an OAuth provider
  list              List available providers

Providers:
  anthropic         Anthropic (Claude Pro/Max)
  github-copilot    GitHub Copilot
  google-gemini-cli Google Gemini CLI
  google-antigravity Antigravity (Gemini 3, Claude, GPT-OSS)

Examples:
  npx @mariozechner/pi-ai login              # interactive provider selection
  npx @mariozechner/pi-ai login anthropic    # login to specific provider
  npx @mariozechner/pi-ai list               # list providers
`);
		return;
	}

	if (command === "list") {
		console.log("Available OAuth providers:\n");
		for (const p of PROVIDERS) {
			console.log(`  ${p.id.padEnd(20)} ${p.name}`);
		}
		return;
	}

	if (command === "login") {
		let provider = args[1] as OAuthProvider | undefined;

		if (!provider) {
			const rl = createInterface({ input: process.stdin, output: process.stdout });
			console.log("Select a provider:\n");
			for (let i = 0; i < PROVIDERS.length; i++) {
				console.log(`  ${i + 1}. ${PROVIDERS[i].name}`);
			}
			console.log();

			const choice = await prompt(rl, "Enter number (1-4): ");
			rl.close();

			const index = parseInt(choice, 10) - 1;
			if (index < 0 || index >= PROVIDERS.length) {
				console.error("Invalid selection");
				process.exit(1);
			}
			provider = PROVIDERS[index].id;
		}

		if (!PROVIDERS.some((p) => p.id === provider)) {
			console.error(`Unknown provider: ${provider}`);
			console.error(`Use 'npx @mariozechner/pi-ai list' to see available providers`);
			process.exit(1);
		}

		console.log(`Logging in to ${provider}...`);
		await login(provider);
		return;
	}

	console.error(`Unknown command: ${command}`);
	console.error(`Use 'npx @mariozechner/pi-ai --help' for usage`);
	process.exit(1);
}

main().catch((err) => {
	console.error("Error:", err.message);
	process.exit(1);
});
