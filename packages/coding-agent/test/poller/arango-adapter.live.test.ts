import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { ArangoAdapter } from "../../dist/poller/db/arango-adapter.js";
import type { ArangoBackendConfig, Logger } from "../../src/poller/types.js";

function loadArangoConfig(): ArangoBackendConfig | null {
	const settingsDir = process.env.PI_CODING_AGENT_DIR ?? "./packages/coding-agent/src/poller";
	const settingsPath = resolve(settingsDir, "settings.json");
	try {
		const raw = readFileSync(settingsPath, "utf-8");
		const json = JSON.parse(raw) as { poller?: { arango?: ArangoBackendConfig } };
		return json.poller?.arango ?? null;
	} catch {
		return null;
	}
}

const logger: Logger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

const cfg = loadArangoConfig();

// Live Arango test is only run when settings.json with poller.arango exists.
const maybeDescribe = cfg ? describe : describe.skip;

maybeDescribe("ArangoAdapter (live)", () => {
	it("connects and lists inbox without error", async () => {
		if (!cfg) {
			throw new Error("Arango config missing");
		}

		const adapter = new ArangoAdapter(cfg, logger);
		await adapter.init();
		const inbox = await adapter.listInbox("ProjectA", 5);
		expect(Array.isArray(inbox)).toBe(true);
	});
});
