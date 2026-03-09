import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: {
			"@mariozechner/pi-ai": fileURLToPath(new URL("../../ai/src/index.ts", import.meta.url)),
			"@mariozechner/pi-agent-core": fileURLToPath(new URL("../../agent/src/index.ts", import.meta.url)),
			"@mariozechner/pi-tui": fileURLToPath(new URL("../../tui/src/index.ts", import.meta.url)),
			"@mariozechner/pi-web-ui": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
			"@mariozechner/pi-web-ui/app.css": fileURLToPath(new URL("../src/app.css", import.meta.url)),
		},
	},
	server: {
		host: "0.0.0.0",
		port: 4173,
	},
	preview: {
		host: "0.0.0.0",
		port: 4173,
	},
});
