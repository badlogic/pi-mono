import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts"],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 85,
			},
		},
		testTimeout: 5000,
	},
});
