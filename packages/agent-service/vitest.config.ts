import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^stream\/promises$/, replacement: "node:stream/promises" },
			{ find: /^stream$/, replacement: "node:stream" },
			{ find: /^@mariozechner\/pi-ai$/, replacement: `${root}packages/ai/src/index.ts` },
			{ find: /^@mariozechner\/pi-ai\/(.*)$/, replacement: `${root}packages/ai/src/$1` },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: `${root}packages/agent/src/index.ts` },
			{ find: /^@mariozechner\/pi-agent-core\/(.*)$/, replacement: `${root}packages/agent/src/$1` },
			{ find: /^@mariozechner\/pi-coding-agent$/, replacement: `${root}packages/coding-agent/src/index.ts` },
			{ find: /^@mariozechner\/pi-coding-agent\/(.*)$/, replacement: `${root}packages/coding-agent/src/$1` },
			{ find: /^@mariozechner\/pi-tui$/, replacement: `${root}packages/tui/src/index.ts` },
			{ find: /^@mariozechner\/pi-tui\/(.*)$/, replacement: `${root}packages/tui/src/$1` },
		],
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
