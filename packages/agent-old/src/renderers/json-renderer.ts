import type { AgentEvent, AgentEventReceiver } from "../agent.js";

export class JsonRenderer implements AgentEventReceiver {
	async on(event: AgentEvent): Promise<void> {
		console.log(JSON.stringify(event));
	}
}
