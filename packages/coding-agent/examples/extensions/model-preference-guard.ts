/**
 * Model Preference Guard Extension
 *
 * Guards against unintended model usage by letting you select preferred
 * LLM + provider combinations. When starting a conversation, checks if
 * the current model is in your saved preferences and prompts for
 * confirmation if not.
 *
 * Commands:
 *   /model-pref        - Open picker to manage preferences
 *   /model-pref list   - Show current allowed models
 *   /model-pref toggle - Enable/disable guard without deleting preferences
 *   /model-pref add    - Open model picker to add more
 *   /model-pref remove - Open model picker to remove
 *
 * Config: ~/.pi/agent/model-preferences.json
 *
 * Usage: pi -e ./model-preference-guard.ts
 *   Or place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ─── Types ──────────────────────────────────────────────────────────────

interface ModelPreference {
	provider: string;
	model: string;
}

interface PreferenceConfig {
	enabled: boolean;
	allowedModels: ModelPreference[];
}

// ─── Config File ────────────────────────────────────────────────────────

const CONFIG_FILENAME = "model-preferences.json";

function getConfigPath(): string {
	return join(getAgentDir(), CONFIG_FILENAME);
}

function loadConfig(): PreferenceConfig {
	const configPath = getConfigPath();
	if (!existsSync(configPath)) {
		return { enabled: true, allowedModels: [] };
	}
	try {
		const content = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(content);
		return {
			enabled: parsed.enabled !== false,
			allowedModels: Array.isArray(parsed.allowedModels) ? parsed.allowedModels : [],
		};
	} catch {
		return { enabled: true, allowedModels: [] };
	}
}

function saveConfig(config: PreferenceConfig): void {
	writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatModel(pref: ModelPreference): string {
	return `${pref.provider}/${pref.model}`;
}

function isModelAllowed(current: { provider: string; id: string }, config: PreferenceConfig): boolean {
	if (!config.enabled) return true;
	if (config.allowedModels.length === 0) return true; // No preferences = no guard
	return config.allowedModels.some(
		(p) => p.provider === current.provider && p.model === current.id,
	);
}

// ─── Multi-Select Picker ────────────────────────────────────────────────

interface PickerItem {
	value: string;       // "provider/model"
	label: string;       // "provider/model"
	checked: boolean;    // currently selected
	available: boolean;  // has API key configured
}

async function showModelPicker(
	ctx: ExtensionContext,
	title: string,
	allModels: Array<{ provider: string; id: string; available: boolean }>,
	initialChecked: Set<string>,
): Promise<Set<string> | null> {
	// Build items: pre-checked models first, then unchecked
	const items: PickerItem[] = allModels.map((m) => ({
		value: `${m.provider}/${m.id}`,
		label: `${m.provider}/${m.id}`,
		checked: initialChecked.has(`${m.provider}/${m.id}`),
		available: m.available,
	}));

	// Sort: checked first, then available, then by value
	items.sort((a, b) => {
		if (a.checked !== b.checked) return a.checked ? -1 : 1;
		if (a.available !== b.available) return a.available ? -1 : 1;
		return a.value.localeCompare(b.value);
	});

	const result = await ctx.ui.custom<Set<string> | null>((tui, theme, _kb, done) => {
		let cursorIndex = 0;
		let scrollOffset = 0;
		const maxVisible = Math.min(items.length, 20);
		let cachedLines: string[] | undefined;

		function refresh() {
			cachedLines = undefined;
			tui.requestRender();
		}

		function toggle(index: number) {
			const item = items[index];
			item.checked = !item.checked;
			refresh();
		}

		function submit() {
			const selected = new Set<string>();
			for (const item of items) {
				if (item.checked) selected.add(item.value);
			}
			done(selected);
		}

		function handleInput(data: string) {
			if (matchesKey(data, Key.up)) {
				cursorIndex = Math.max(0, cursorIndex - 1);
				if (cursorIndex < scrollOffset) scrollOffset = cursorIndex;
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				cursorIndex = Math.min(items.length - 1, cursorIndex + 1);
				if (cursorIndex >= scrollOffset + maxVisible) scrollOffset = cursorIndex - maxVisible + 1;
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				submit();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				done(null);
				return;
			}
			// Space also toggles
			if (data === " ") {
				toggle(cursorIndex);
				if (cursorIndex < items.length - 1) {
					cursorIndex++;
					if (cursorIndex >= scrollOffset + maxVisible) scrollOffset = cursorIndex - maxVisible + 1;
				}
				refresh();
				return;
			}
			// 'a' = select all, 'n' = select none
			if (data === "a") {
				for (const item of items) item.checked = true;
				refresh();
				return;
			}
			if (data === "n") {
				for (const item of items) item.checked = false;
				refresh();
				return;
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;

			const lines: string[] = [];
			const rw = Math.max(1, width);

			lines.push(theme.fg("accent", "─".repeat(rw)));
			lines.push(theme.fg("text", theme.bold(` ${title}`)));
			lines.push(theme.fg("dim", ` ${items.filter((i) => i.checked).length}/${items.length} selected`));
			lines.push("");

			const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);

			for (let i = 0; i < visibleItems.length; i++) {
				const globalIdx = scrollOffset + i;
				const item = visibleItems[i];
				const isSelected = globalIdx === cursorIndex;
				const checkbox = item.checked ? "☑" : "☐";
				const avail = item.available ? "" : theme.fg("warning", " ⚠ no key");

				const label = `${checkbox} ${item.label}${avail}`;

				// Wrap long lines
				const prefixWidth = 2;
				const contentWidth = Math.max(1, rw - prefixWidth);
				const wrapped = wrapTextWithAnsi(label, contentWidth);
				for (let j = 0; j < wrapped.length; j++) {
					const p = j === 0 ? (isSelected ? theme.fg("accent", "> ") : "  ") : "  ";
					const c = isSelected ? "accent" : item.checked ? "success" : "text";
					lines.push(`${p}${theme.fg(c, wrapped[j])}`);
				}
			}

			// Scroll indicator
			if (items.length > maxVisible) {
				const scrollInfo = ` ${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, items.length)} of ${items.length}`;
				lines.push(theme.fg("dim", scrollInfo));
			}

			lines.push("");
			lines.push(theme.fg("dim", "  Space toggle • a=select all • n=select none • Enter to confirm • Esc cancel"));
			lines.push(theme.fg("accent", "─".repeat(rw)));

			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => { cachedLines = undefined; },
			handleInput,
		};
	});

	return result;
}

// ─── Extension ──────────────────────────────────────────────────────────

export default function modelPreferenceGuard(pi: ExtensionAPI) {
	let config = loadConfig();
	let hintShown = false;

	// ── /model-pref command ──────────────────────────────────────────

	pi.registerCommand("model-pref", {
		description: "Manage model preferences (guard against unintended model usage)",
		handler: async (args, ctx) => {
			const sub = args?.trim().toLowerCase();

			if (sub === "list") {
				if (config.allowedModels.length === 0) {
					ctx.ui.notify("No model preferences saved. All models allowed.", "info");
				} else {
					const list = config.allowedModels.map((m) => `  • ${formatModel(m)}`).join("\n");
					ctx.ui.notify(
						`Guard: ${config.enabled ? "ON" : "OFF"}\nAllowed models:\n${list}`,
						"info",
					);
				}
				return;
			}

			if (sub === "toggle") {
				config.enabled = !config.enabled;
				saveConfig(config);
				ctx.ui.notify(`Model guard ${config.enabled ? "enabled" : "disabled"}`, "info");
				updateStatus(ctx, config);
				return;
			}

			if (sub === "add" || sub === "remove") {
				// Get all available models
				const allModels = ctx.modelRegistry.getAvailable().map((m) => ({
					provider: m.provider,
					id: m.id,
					available: true,
				}));

				if (allModels.length === 0) {
					ctx.ui.notify("No models available. Check your API keys.", "warning");
					return;
				}

				const currentSet = new Set(config.allowedModels.map(formatModel));
				const title = sub === "add" ? "Select models to ADD to preferences" : "Select models to REMOVE from preferences";

				const result = await showModelPicker(ctx, title, allModels, currentSet);
				if (!result) {
					ctx.ui.notify("Cancelled", "info");
					return;
				}

				if (sub === "add") {
					// Add newly checked models that weren't in the list
					const newModels: ModelPreference[] = [];
					for (const val of result) {
						if (!currentSet.has(val)) {
							const [provider, ...modelParts] = val.split("/");
							newModels.push({ provider, model: modelParts.join("/") });
						}
					}
					if (newModels.length > 0) {
						config.allowedModels.push(...newModels);
						saveConfig(config);
						ctx.ui.notify(`Added ${newModels.length} model(s): ${newModels.map(formatModel).join(", ")}`, "info");
					} else {
						ctx.ui.notify("No new models added", "info");
					}
				} else {
					// Remove: keep only models that are still in the result set
					const before = config.allowedModels.length;
					config.allowedModels = config.allowedModels.filter((m) => result.has(formatModel(m)));
					const removed = before - config.allowedModels.length;
					if (removed > 0) {
						saveConfig(config);
						ctx.ui.notify(`Removed ${removed} model(s)`, "info");
					} else {
						ctx.ui.notify("No models removed", "info");
					}
				}
				return;
			}

			// No subcommand or unknown → full picker
			if (config.allowedModels.length === 0) {
				// First time: show all available models, none checked
				const allModels = ctx.modelRegistry.getAvailable().map((m) => ({
					provider: m.provider,
					id: m.id,
					available: true,
				}));

				if (allModels.length === 0) {
					ctx.ui.notify("No models available. Check your API keys.", "warning");
					return;
				}

				ctx.ui.notify("No preferences set yet. Pick your preferred models:", "info");
				const result = await showModelPicker(
					ctx,
					"Select your PREFERRED models",
					allModels,
					new Set(),
				);

				if (!result || result.size === 0) {
					ctx.ui.notify("No models selected. All models remain allowed.", "info");
					return;
				}

				config.allowedModels = [...result].map((val) => {
					const [provider, ...modelParts] = val.split("/");
					return { provider, model: modelParts.join("/") };
				});
				saveConfig(config);
				config = loadConfig();
				ctx.ui.notify(
					`Saved ${config.allowedModels.length} preferred model(s):\n${config.allowedModels.map((m) => `  • ${formatModel(m)}`).join("\n")}`,
					"info",
				);
				return;
			}

			// Existing preferences: show toggle view
			const allModels = ctx.modelRegistry.getAvailable().map((m) => ({
				provider: m.provider,
				id: m.id,
				available: true,
			}));

			const currentSet = new Set(config.allowedModels.map(formatModel));
			const result = await showModelPicker(
				ctx,
				"Toggle model preferences (checked = allowed)",
				allModels,
				currentSet,
			);

			if (!result) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			config.allowedModels = [...result].map((val) => {
				const [provider, ...modelParts] = val.split("/");
				return { provider, model: modelParts.join("/") };
			});
			saveConfig(config);
			ctx.ui.notify(
				`Updated preferences: ${config.allowedModels.length} model(s) allowed`,
				"info",
			);
		},
	});

	// ── Session start: load config, show hint if first time ──────────

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		hintShown = false;

		// Show hint if no preferences saved and guard hasn't been disabled
		if (config.enabled && config.allowedModels.length === 0 && !hintShown) {
			hintShown = true;
			ctx.ui.notify(
				"💡 No model preferences set. Run /model-pref to choose preferred models.",
				"info",
			);
		}

		updateStatus(ctx, config);
	});

	// ── Input: check model against preferences before agent runs ────

	pi.on("input", async (event, ctx) => {
		// Only check interactive typed input
		if (event.source !== "interactive") return;

		// Skip in non-TUI mode
		if (ctx.mode !== "tui") return;

		// Reload config to pick up changes
		config = loadConfig();

		// Skip if guard is disabled
		if (!config.enabled) return;

		// Skip if no preferences saved
		if (config.allowedModels.length === 0) return;

		const model = ctx.model;
		if (!model) return;

		if (isModelAllowed({ provider: model.provider, id: model.id }, config)) {
			return; // Model is in the allowed list, continue normally
		}

		// Model NOT in allowed list → confirm with user
		const modelName = `${model.provider}/${model.id}`;
		const allowed = config.allowedModels.map(formatModel).join(", ");

		const ok = await ctx.ui.confirm(
			"⚠️  Model Not Preferred",
			`Current model: ${modelName}\n\nThis model is NOT in your preferred list:\n${allowed}\n\nContinue with ${modelName}?`,
		);

		if (!ok) {
			// User declined — block the agent entirely
			return { action: "handled" };
		}

		// User confirmed — continue with the un-preferred model
		return { action: "continue" };
	});

	// ── Model select: show status on change ──────────────────────────

	pi.on("model_select", async (event, ctx) => {
		config = loadConfig();

		if (event.source === "restore") return;

		const model = event.model;
		if (!model) return;

		const modelName = `${model.provider}/${model.id}`;

		if (config.enabled && config.allowedModels.length > 0) {
			if (isModelAllowed({ provider: model.provider, id: model.id }, config)) {
				ctx.ui.notify(`✅ ${modelName} — in preferred models`, "info");
			} else {
				ctx.ui.notify(`⚠️  ${modelName} — NOT in preferred models`, "warning");
			}
		}

		updateStatus(ctx, config);
	});
}

function updateStatus(ctx: ExtensionContext, config: PreferenceConfig) {
	if (!config.enabled) {
		ctx.ui.setStatus("model-guard", ctx.ui.theme.fg("dim", "guard:off"));
	} else if (config.allowedModels.length === 0) {
		ctx.ui.setStatus("model-guard", ctx.ui.theme.fg("dim", "guard:—"));
	} else {
		ctx.ui.setStatus(
			"model-guard",
			ctx.ui.theme.fg("accent", `guard:${config.allowedModels.length}`),
		);
	}
}
