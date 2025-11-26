import type { Agent } from "@mariozechner/pi-agent-core";
import { ArangoAdapter } from "./db/arango-adapter.js";
import { HttpAdapter } from "./db/http-adapter.js";
import { Poller } from "./poller.js";
import type { ArangoBackendConfig, HttpBackendConfig, Logger, PollerSettings, PollerUiBridge } from "./types.js";

export interface PollerConfigBlock extends PollerSettings {
	backend: "arangojs" | "http";
	arango?: ArangoBackendConfig;
	http?: HttpBackendConfig;
}

function defaultLogger(): Logger {
	return {
		info: (m) => console.log(m),
		warn: (m) => console.warn(m),
		error: (m) => console.error(m),
		debug: (m) => console.debug(m),
	};
}

function createAdapter(cfg: PollerConfigBlock, logger: Logger) {
	if (cfg.backend === "arangojs") {
		if (!cfg.arango) throw new Error("[poller] missing arango config");
		return new ArangoAdapter(cfg.arango, logger);
	}
	if (cfg.backend === "http") {
		if (!cfg.http) throw new Error("[poller] missing http config");
		return new HttpAdapter(cfg.http, logger);
	}
	throw new Error(`[poller] unknown backend ${cfg.backend}`);
}

export interface PollerRuntime {
	poller: Poller;
	uiBridge: PollerUiBridge;
}

export async function createPollerRuntime(
	agent: Agent,
	config: PollerConfigBlock | undefined,
	logger: Logger = defaultLogger(),
): Promise<PollerRuntime | null> {
	if (!config || !config.enabled) return null;

	const backoff = config.backoff ?? {};
	const options = config.options ?? {};

	const settings: PollerSettings = {
		enabled: true,
		pollIntervalMs: config.pollIntervalMs ?? 5000,
		agentId: config.agentId,
		batchLimit: config.batchLimit ?? 25,
		leaseMs: config.leaseMs ?? 120_000,
		backoff: {
			initialMs: backoff.initialMs ?? 1000,
			factor: backoff.factor ?? 2,
			maxMs: backoff.maxMs ?? 30000,
			failureThreshold: backoff.failureThreshold ?? 3,
		},
		options: {
			lruDedupSize: options.lruDedupSize ?? 0,
			autoProcessNext: options.autoProcessNext ?? false,
		},
	};

	const adapter = createAdapter(config, logger);
	const poller = new Poller(agent, adapter, settings, logger);
	await poller.init();
	poller.start();

	const uiBridge: PollerUiBridge = {
		listInbox: (limit?: number) => poller.listInbox(limit),
		setEnabled: (enabled: boolean) => poller.setEnabled(enabled),
		setIntervalMs: (ms: number) => poller.setIntervalMs(ms),
		updateStatus: (id, status) => poller.updateStatus(id, status),
		getInboxCount: () => poller.getInboxCount(),
		isEnabled: () => poller.isEnabled(),
	};

	return { poller, uiBridge };
}
