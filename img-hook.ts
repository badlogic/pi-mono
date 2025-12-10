import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { HookAPI } from "./packages/coding-agent/src/index.js";

export default function (pi: HookAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const desktop = path.join(os.homedir(), "Desktop");
		const seen = new Set(fs.readdirSync(desktop).filter((f) => f.endsWith(".png")));

		ctx.ui.notify(`Watching ${desktop} for new .png files`, "info");

		fs.watch(desktop, (event, file) => {
			if (!file?.endsWith(".png") || event !== "rename" || seen.has(file)) return;

			setTimeout(() => {
				const filePath = path.join(desktop, file);
				if (!fs.existsSync(filePath)) return;

				seen.add(file);
				const content = fs.readFileSync(filePath);
				const stats = fs.statSync(filePath);

				pi.send(`Use \`sag\` (no say!) to describe the image. Make it concise and hilarious`, [
					{
						id: crypto.randomUUID(),
						type: "image",
						fileName: file,
						mimeType: "image/png",
						size: stats.size,
						content: content.toString("base64"),
					},
				]);
			}, 500);
		});
	});
}
