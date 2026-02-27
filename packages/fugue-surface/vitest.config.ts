import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@fugue/shared": resolve(__dirname, "../fugue-shared/src/index.ts"),
			"@fugue/core": resolve(__dirname, "../fugue-core/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.{ts,tsx}"],
		environment: "jsdom",
		globals: true,
		setupFiles: ["./test/setup.ts"],
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/main.tsx"],
			thresholds: {
				lines: 70,
				functions: 70,
				branches: 60,
			},
		},
	},
});
