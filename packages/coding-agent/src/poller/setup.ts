import type { Agent } from "@mariozechner/pi-agent-core";
import { ArangoAdapter } from "./db/arango-adapter.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { HttpAdapter } from "./db/http-adapter.js";
import { Poller } from "./poller.js";
import type { PollerSettings, PollerUiBridge } from "./types.js";

interface PollerRuntime {
	poller: Poller;
	uiBridge: PollerUiBridge;
}

export async function createPollerRuntime(
	agent: Agent,
	settings: PollerSettings | undefined,
	onInboxChange?: (count: number) => void,
): Promise<PollerRuntime | null> {
	if (!settings) return null;

	const adapter = buildAdapter(settings);
	if (!adapter) return null;

	const poller = new Poller(agent, adapter, settings, onInboxChange);
	await poller.init();

	const uiBridge: PollerUiBridge = {
		listInbox: (limit?: number) => poller.listInbox(limit),
		setEnabled: (enabled: boolean) => poller.setEnabled(enabled),
		setIntervalMs: (ms: number) => poller.setIntervalMs(ms),
		updateStatus: (id, status) => poller.updateStatus(id, status),
		getInboxCount: () => poller.getInboxCount(),
		isEnabled: () => poller.isEnabled(),
	};

	poller.start();

	return { poller, uiBridge };
}

function buildAdapter(settings: PollerSettings): DatabaseAdapter | null {
	const backend = settings.backend ?? "http";
	if (backend === "arangojs") {
		if (!settings.arango) return null;
		return new ArangoAdapter(settings.arango);
	}
	if (backend === "http") {
		if (!settings.http) return null;
		return new HttpAdapter(settings.http);
	}
	return null;
}
