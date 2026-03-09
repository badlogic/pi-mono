import "./app.css";
import { PiConsoleApp } from "./app-controller.js";
import { createAppServices } from "./storage.js";

async function main(): Promise<void> {
	const host = document.getElementById("app");
	if (!host) {
		throw new Error("App container not found");
	}

	const services = createAppServices();
	const app = new PiConsoleApp(host, services.storage, services.customProviders);
	await app.init();
}

void main();
