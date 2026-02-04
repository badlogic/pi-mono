/**
 * PWA Nutrition Label Scanner
 *
 * Uses a single prompt to generate a PWA and write it to disk.
 */

import { getModel } from "@mariozechner/pi-ai";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const PROMPT = `Make an app to scan the nutrition label (macros and ingredients list) of any food packaging using the camera. The label could be in any language. Use AI to extract calories, protein, fat, carbs and each ingredient and translate them to English. While doing so show a funny progress bar. Then display to the user an aggregated health score together with a funny witty verdict of the health value of the food from the point of view of Bryan Johnson. Below that show calories, protein, fat, carbs, and below that the ingredient list. Next to each ingredient show a health score from 0-10, 10 being the best. Below each ingredient explain in one sentence in easy language what it is.`;
const OUTPUT_DIR = "examples/sdk/pwa-nutrition-scanner";

const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
const model = getModel("openai", "gpt-5.2-codex");
if (!model) {
	throw new Error("Model not found: openai/gpt-5.2-codex");
}

const { session } = await createAgentSession({
	model,
	authStorage,
	modelRegistry,
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt(`${PROMPT}

Create a PWA and write all files to ${OUTPUT_DIR}. Use tools to create directories and write files.
Include a complete, runnable project with:
- package.json with scripts
- index.html
- src/main.ts (or main.js) with UI logic
- src/styles.css
- public/manifest.webmanifest
- public/icons (generate placeholder icons as SVG or PNG)
- service worker (register it)

Assume a Vite setup unless you prefer another minimal bundler. Keep dependencies minimal.
After writing files, print a short summary and the exact command to run the app.`);
