import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@fugue/shared": resolve(__dirname, "../fugue-shared/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		testTimeout: 15000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts", "src/server.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
			},
		},
	},
});
