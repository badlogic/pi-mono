import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@fugue/shared": resolve(__dirname, "../fugue-shared/src/index.ts"),
			"@fugue/graph": resolve(__dirname, "../fugue-graph/src/index.ts"),
			"@fugue/events": resolve(__dirname, "../fugue-events/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts", "src/server.ts"],
			thresholds: {
				lines: 85,
				functions: 85,
				branches: 75,
			},
		},
	},
});
