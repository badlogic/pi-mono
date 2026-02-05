import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@mariozechner/pi-agent-core": resolve(__dirname, "../agent/src/index.ts"),
			"@mariozechner/pi-ai": resolve(__dirname, "../ai/src/index.ts"),
			"@mariozechner/pi-coding-agent": resolve(__dirname, "../coding-agent/src/index.ts"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
	},
});
