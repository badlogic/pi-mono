import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { AppAction, KeybindingsManager } from "../../../core/keybindings.js";
import { type ThemeColor, theme } from "../theme/theme.js";
import { appKey } from "./keybinding-hints.js";

type ModelLike =
	| {
			provider?: string;
			apiProvider?: string;
			id?: string;
			modelId?: string;
			name?: string;
			reasoning?: boolean;
	  }
	| undefined;

export interface TopBarOptions {
	getModel: () => ModelLike;
	getThinkingLevel: () => string;
	keybindings: KeybindingsManager;
}

function shortenProvider(input: string): string {
	return input
		.replace(/^anthropic$/i, "claude")
		.replace(/^openai$/i, "openai")
		.replace(/^google$/i, "google")
		.replace(/^zai$/i, "z.ai")
		.replace(/^openrouter$/i, "orouter");
}

function shortenModelName(input: string): string {
	return input
		.replace(/^anthropic\//, "")
		.replace(/^openai\//, "")
		.replace(/^google\//, "")
		.replace(/^zai\//, "")
		.replace(/^openrouter\//, "")
		.replace(/^claude-/, "")
		.replace(/^models\//, "");
}

function capitalizeKey(key: string): string {
	return key
		.split("/")
		.map((k) =>
			k
				.split("+")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join("/");
}

export class TopBar implements Component {
	constructor(private options: TopBarOptions) {}

	private getAppKeyDisplay(action: AppAction): string {
		return capitalizeKey(appKey(this.options.keybindings, action));
	}

	private getProviderModel(): { provider: string; model: string } {
		const model = this.options.getModel();
		if (!model) {
			return { provider: "no-provider", model: "no-model" };
		}

		const provider = model.provider ?? model.apiProvider ?? "unknown";
		const rawModel = model.id ?? model.modelId ?? model.name ?? "unknown-model";

		return {
			provider: shortenProvider(String(provider)),
			model: shortenModelName(String(rawModel)),
		};
	}

	render(width: number): string[] {
		const model = this.options.getModel();
		const parts: string[] = [];

		if (model?.reasoning) {
			const level = this.options.getThinkingLevel();
			const colorKey = `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}` as ThemeColor;

			parts.push(
				theme.fg("muted", this.getAppKeyDisplay("cycleThinkingLevel")) +
					theme.fg("dim", " Thinking: ") +
					theme.fg(colorKey, level),
			);
		}

		parts.push(theme.fg("muted", this.getAppKeyDisplay("selectModel")) + theme.fg("dim", " Model"));

		const leftString = ` ${parts.join(theme.fg("dim", " · "))}`;
		const pm = this.getProviderModel();

		const rightCandidates = [theme.fg("dim", `${pm.provider}/${pm.model} `), theme.fg("dim", `${pm.model} `), ""];

		const maxRightWidth = Math.max(0, width - visibleWidth(leftString));
		const rightString = rightCandidates.find((candidate) => visibleWidth(candidate) <= maxRightWidth) ?? "";

		const leftWidth = visibleWidth(leftString);
		const rightWidth = visibleWidth(rightString);
		const spaces = Math.max(0, width - leftWidth - rightWidth);

		return [leftString + " ".repeat(spaces) + rightString];
	}

	invalidate(): void {}
}
