import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@fugue/shared": resolve(__dirname, "../fugue-shared/src/index.ts"),
			"@fugue/graph": resolve(__dirname, "../fugue-graph/src/index.ts"),
			"@fugue/events": resolve(__dirname, "../fugue-events/src/index.ts"),
			"@neuralwatt/pi-ai": resolve(__dirname, "../ai/src/index.ts"),
			"@neuralwatt/pi-agent-core": resolve(__dirname, "../agent/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
			},
		},
	},
});
