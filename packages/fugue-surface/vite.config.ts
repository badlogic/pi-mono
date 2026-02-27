import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 3000,
		proxy: {
			"/trpc": "http://localhost:3001",
			"/auth": "http://localhost:3001",
		},
	},
	build: {
		outDir: "dist",
		target: "es2020",
	},
});
