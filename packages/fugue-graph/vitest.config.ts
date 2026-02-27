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
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts"],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 80,
			},
		},
	},
});
