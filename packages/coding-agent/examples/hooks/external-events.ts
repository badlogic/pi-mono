import * as fs from "node:fs";
import * as path from "node:path";
import type { HookAPI } from "@mariozechner/pi-coding-agent";

const EVENTS_DIR = process.env.PI_EXTERNAL_EVENTS_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "pi-external-events");

export default function (pi: HookAPI) {
	fs.mkdirSync(EVENTS_DIR, { recursive: true });

	fs.watch(EVENTS_DIR, (eventType, filename) => {
		if (eventType !== "rename" || !filename?.endsWith(".json")) return;

		const filepath = path.join(EVENTS_DIR, filename);
		try {
			if (!fs.existsSync(filepath)) return;
			const data = JSON.parse(fs.readFileSync(filepath, "utf-8")) as { type?: string; [key: string]: unknown };
			fs.unlinkSync(filepath);

			const type = data.type ?? "unknown";
			if (type === "test_failed") {
				pi.send(`Test failed in ${data.file ?? "unknown file"}: ${data.error ?? "no details"}`);
			} else if (type === "type_error") {
				pi.send(`Type error in ${data.file ?? "unknown"}: ${data.message ?? "no details"}`);
			} else if (type === "build_complete") {
				pi.send(`Build ${data.status ?? "finished"}${data.url ? `: ${data.url}` : ""}`);
			} else {
				pi.send(`External event (${type}): ${JSON.stringify(data)}`);
			}
		} catch {}
	});
}
