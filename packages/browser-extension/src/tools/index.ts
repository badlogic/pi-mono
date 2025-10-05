import {
	BashRenderer,
	CalculateRenderer,
	createJavaScriptReplTool,
	GetCurrentTimeRenderer,
	javascriptReplTool,
	registerToolRenderer,
} from "@mariozechner/pi-web-ui";
import "./browser-javascript.js"; // Import for side effects (registers renderer)

// Register all built-in tool renderers
registerToolRenderer("calculate", new CalculateRenderer());
registerToolRenderer("get_current_time", new GetCurrentTimeRenderer());
registerToolRenderer("bash", new BashRenderer());

// Re-export for convenience
export { createJavaScriptReplTool, javascriptReplTool };
export { browserJavaScriptTool } from "./browser-javascript.js";
