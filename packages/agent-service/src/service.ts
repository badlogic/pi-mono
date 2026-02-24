import { type AgentServiceHttpServer, createAgentServiceHttpServer } from "./http.js";
import { AgentRuntimeRegistry, createDefaultBackendFactory } from "./registry.js";
import type { ServiceConfig } from "./types.js";

export class AgentService {
	private readonly registry: AgentRuntimeRegistry;
	private readonly httpServer: AgentServiceHttpServer;

	constructor(config: ServiceConfig) {
		const backendFactory = createDefaultBackendFactory({
			defaultCwd: config.defaultCwd,
			defaultAgentDir: config.defaultAgentDir,
			defaultSessionDir: config.defaultSessionDir,
			bashPolicy: config.bashPolicy,
		});
		this.registry = new AgentRuntimeRegistry(backendFactory);
		this.httpServer = createAgentServiceHttpServer(this.registry, config);
	}

	async listen(port: number, host?: string): Promise<void> {
		await this.httpServer.listen(port, host);
	}

	async close(): Promise<void> {
		await this.httpServer.close();
		this.registry.dispose();
	}

	getServer() {
		return this.httpServer.server;
	}

	getRegistry(): AgentRuntimeRegistry {
		return this.registry;
	}
}

export function createAgentService(config: ServiceConfig): AgentService {
	return new AgentService(config);
}
