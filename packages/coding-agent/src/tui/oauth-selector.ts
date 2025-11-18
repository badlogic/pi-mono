import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { getOAuthProviders, type OAuthProviderInfo } from "../oauth/index.js";

/**
 * Component that renders an OAuth provider selector
 */
export class OAuthSelectorComponent extends Container {
	private listContainer: Container;
	private allProviders: OAuthProviderInfo[] = [];
	private selectedIndex: number = 0;
	private mode: "login" | "logout";
	private onSelectCallback: (providerId: string) => void;
	private onCancelCallback: () => void;

	constructor(mode: "login" | "logout", onSelect: (providerId: string) => void, onCancel: () => void) {
		super();

		this.mode = mode;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Load all OAuth providers
		this.loadProviders();

		// Add top border
		this.addChild(new Text(chalk.blue("─".repeat(80)), 0, 0));
		this.addChild(new Spacer(1));

		// Add title
		const title = mode === "login" ? "Select provider to login:" : "Select provider to logout:";
		this.addChild(new Text(chalk.bold(title), 0, 0));
		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new Text(chalk.blue("─".repeat(80)), 0, 0));

		// Initial render
		this.updateList();
	}

	private loadProviders(): void {
		this.allProviders = getOAuthProviders();
		this.allProviders = this.allProviders.filter((p) => p.available);
	}

	private updateList(): void {
		this.listContainer.clear();

		for (let i = 0; i < this.allProviders.length; i++) {
			const provider = this.allProviders[i];
			if (!provider) continue;

			const isSelected = i === this.selectedIndex;
			const isAvailable = provider.available;

			let line = "";
			if (isSelected) {
				const prefix = chalk.blue("→ ");
				const text = isAvailable ? chalk.blue(provider.name) : chalk.dim(provider.name);
				line = prefix + text;
			} else {
				const text = isAvailable ? `  ${provider.name}` : chalk.dim(`  ${provider.name}`);
				line = text;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Show "no providers" if empty
		if (this.allProviders.length === 0) {
			const message =
				this.mode === "login" ? "No OAuth providers available" : "No OAuth providers logged in. Use /login first.";
			this.listContainer.addChild(new Text(chalk.gray(`  ${message}`), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		}
		// Down arrow
		else if (keyData === "\x1b[B") {
			this.selectedIndex = Math.min(this.allProviders.length - 1, this.selectedIndex + 1);
			this.updateList();
		}
		// Enter
		else if (keyData === "\r") {
			const selectedProvider = this.allProviders[this.selectedIndex];
			if (selectedProvider?.available) {
				this.onSelectCallback(selectedProvider.id);
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			this.onCancelCallback();
		}
	}
}
