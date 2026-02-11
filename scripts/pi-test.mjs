#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(scriptDir, "../packages/coding-agent/src/cli.ts");

const args = process.argv.slice(2);
const forwardArgs = [];
let noEnv = false;

for (const arg of args) {
	if (arg === "--no-env") {
		noEnv = true;
		continue;
	}
	forwardArgs.push(arg);
}

const env = { ...process.env };

if (noEnv) {
	const envVarsToUnset = [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_OAUTH_TOKEN",
		"OPENAI_API_KEY",
		"GEMINI_API_KEY",
		"GROQ_API_KEY",
		"CEREBRAS_API_KEY",
		"XAI_API_KEY",
		"OPENROUTER_API_KEY",
		"ZAI_API_KEY",
		"MISTRAL_API_KEY",
		"MINIMAX_API_KEY",
		"MINIMAX_CN_API_KEY",
		"AI_GATEWAY_API_KEY",
		"OPENCODE_API_KEY",
		"COPILOT_GITHUB_TOKEN",
		"GH_TOKEN",
		"GITHUB_TOKEN",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"GOOGLE_CLOUD_PROJECT",
		"GCLOUD_PROJECT",
		"GOOGLE_CLOUD_LOCATION",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_REGION",
		"AWS_DEFAULT_REGION",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE",
		"AZURE_OPENAI_API_KEY",
		"AZURE_OPENAI_BASE_URL",
		"AZURE_OPENAI_RESOURCE_NAME",
	];

	for (const key of envVarsToUnset) {
		delete env[key];
	}
	console.log("Running without API keys...");
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["tsx", cliPath, ...forwardArgs], {
	stdio: "inherit",
	env,
});

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
