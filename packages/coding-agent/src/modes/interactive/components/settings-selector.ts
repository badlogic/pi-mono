import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Transport } from "@mariozechner/pi-ai";
import {
	Container,
	getCapabilities,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import type { StatusLinePreset, StatusLineSeparatorStyle } from "../../../core/status-line-settings.js";
import { getSelectListTheme, getSettingsListTheme, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

const THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Maximum reasoning (~32k tokens)",
};

export interface SettingsConfig {
	autoCompact: boolean;
	autoCompactTriggerPercent: number | undefined;
	temperature: number | undefined;
	topP: number | undefined;
	presencePenalty: number | undefined;
	repetitionPenalty: number | undefined;
	statusLinePreset: StatusLinePreset;
	statusLineSeparator: StatusLineSeparatorStyle;
	statusLineShowHookStatus: boolean;
	anthropicFineGrainedToolStreaming: boolean;
	subagentTmuxLinkedWindows: boolean;
	asyncExecutionEnabled: boolean;
	asyncMaxJobs: number;
	bashMaxTimeoutSeconds: number | undefined;
	showImages: boolean;
	autoResizeImages: boolean;
	blockImages: boolean;
	enableSkillCommands: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	transport: Transport;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
	currentTheme: string;
	availableThemes: string[];
	hideThinkingBlock: boolean;
	collapseChangelog: boolean;
	doubleEscapeAction: "fork" | "tree" | "none";
	showHardwareCursor: boolean;
	editorPaddingX: number;
	autocompleteMaxVisible: number;
	quietStartup: boolean;
	clearOnShrink: boolean;
}

export interface SettingsCallbacks {
	onAutoCompactChange: (enabled: boolean) => void;
	onAutoCompactTriggerPercentChange: (percent: number | undefined) => void;
	onTemperatureChange: (temperature: number | undefined) => void;
	onTopPChange: (topP: number | undefined) => void;
	onPresencePenaltyChange: (penalty: number | undefined) => void;
	onRepetitionPenaltyChange: (penalty: number | undefined) => void;
	onStatusLinePresetChange: (preset: StatusLinePreset) => void;
	onStatusLineSeparatorChange: (separator: StatusLineSeparatorStyle) => void;
	onStatusLineShowHookStatusChange: (enabled: boolean) => void;
	onAnthropicFineGrainedToolStreamingChange: (enabled: boolean) => void;
	onSubagentTmuxLinkedWindowsChange: (enabled: boolean) => void;
	onAsyncExecutionEnabledChange: (enabled: boolean) => void;
	onAsyncMaxJobsChange: (maxJobs: number) => void;
	onBashMaxTimeoutSecondsChange: (timeoutSeconds: number | undefined) => void;
	onShowImagesChange: (enabled: boolean) => void;
	onAutoResizeImagesChange: (enabled: boolean) => void;
	onBlockImagesChange: (blocked: boolean) => void;
	onEnableSkillCommandsChange: (enabled: boolean) => void;
	onSteeringModeChange: (mode: "all" | "one-at-a-time") => void;
	onFollowUpModeChange: (mode: "all" | "one-at-a-time") => void;
	onTransportChange: (transport: Transport) => void;
	onThinkingLevelChange: (level: ThinkingLevel) => void;
	onThemeChange: (theme: string) => void;
	onThemePreview?: (theme: string) => void;
	onHideThinkingBlockChange: (hidden: boolean) => void;
	onCollapseChangelogChange: (collapsed: boolean) => void;
	onDoubleEscapeActionChange: (action: "fork" | "tree" | "none") => void;
	onShowHardwareCursorChange: (enabled: boolean) => void;
	onEditorPaddingXChange: (padding: number) => void;
	onAutocompleteMaxVisibleChange: (maxVisible: number) => void;
	onQuietStartupChange: (enabled: boolean) => void;
	onClearOnShrinkChange: (enabled: boolean) => void;
	onCancel: () => void;
}

/**
 * A submenu component for selecting from a list of options.
 */
class SelectSubmenu extends Container {
	private selectList: SelectList;

	constructor(
		title: string,
		description: string,
		options: SelectItem[],
		currentValue: string,
		onSelect: (value: string) => void,
		onCancel: () => void,
		onSelectionChange?: (value: string) => void,
	) {
		super();

		// Title
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

		// Description
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}

		// Spacer
		this.addChild(new Spacer(1));

		// Select list
		this.selectList = new SelectList(options, Math.min(options.length, 10), getSelectListTheme());

		// Pre-select current value
		const currentIndex = options.findIndex((o) => o.value === currentValue);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};

		this.selectList.onCancel = onCancel;

		if (onSelectionChange) {
			this.selectList.onSelectionChange = (item) => {
				onSelectionChange(item.value);
			};
		}

		this.addChild(this.selectList);

		// Hint
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0));
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

/**
 * Main settings selector component.
 */
export class SettingsSelectorComponent extends Container {
	private settingsList: SettingsList;

	constructor(config: SettingsConfig, callbacks: SettingsCallbacks) {
		super();

		const supportsImages = getCapabilities().images;
		const autoCompactPercentValues = ["default", ...Array.from({ length: 40 }, (_, i) => String(60 + i))];
		const currentTemperatureValue = config.temperature === undefined ? "default" : String(config.temperature);
		const temperatureValues = ["default", ...Array.from({ length: 21 }, (_, i) => String(i / 10))];
		if (currentTemperatureValue !== "default" && !temperatureValues.includes(currentTemperatureValue)) {
			temperatureValues.push(currentTemperatureValue);
		}
		const currentTopPValue = config.topP === undefined ? "default" : String(config.topP);
		const topPValues = ["default", ...Array.from({ length: 10 }, (_, i) => String((i + 1) / 10))];
		if (currentTopPValue !== "default" && !topPValues.includes(currentTopPValue)) {
			topPValues.push(currentTopPValue);
		}
		const penaltyValues = ["default", "-2", "-1.5", "-1", "-0.5", "0", "0.5", "1", "1.5", "2"];
		const currentPresencePenaltyValue =
			config.presencePenalty === undefined ? "default" : String(config.presencePenalty);
		if (currentPresencePenaltyValue !== "default" && !penaltyValues.includes(currentPresencePenaltyValue)) {
			penaltyValues.push(currentPresencePenaltyValue);
		}
		const repetitionPenaltyValues = ["default", "0", "0.5", "0.8", "1", "1.1", "1.2", "1.5", "2"];
		const currentRepetitionPenaltyValue =
			config.repetitionPenalty === undefined ? "default" : String(config.repetitionPenalty);
		if (
			currentRepetitionPenaltyValue !== "default" &&
			!repetitionPenaltyValues.includes(currentRepetitionPenaltyValue)
		) {
			repetitionPenaltyValues.push(currentRepetitionPenaltyValue);
		}
		const currentBashMaxTimeoutValue =
			config.bashMaxTimeoutSeconds === undefined ? "default" : String(config.bashMaxTimeoutSeconds);
		const bashMaxTimeoutValues = ["default", "30", "60", "120", "300", "600", "1800", "3600", "7200"];
		if (currentBashMaxTimeoutValue !== "default" && !bashMaxTimeoutValues.includes(currentBashMaxTimeoutValue)) {
			bashMaxTimeoutValues.push(currentBashMaxTimeoutValue);
		}

		const items: SettingItem[] = [
			{
				id: "autocompact",
				label: "Auto-compact",
				description: "Automatically compact context when it gets too large",
				currentValue: config.autoCompact ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "autocompact-trigger-percent",
				label: "Auto-compact at %",
				description: "Trigger compaction at context usage percentage (default uses reserve tokens only)",
				currentValue:
					config.autoCompactTriggerPercent === undefined ? "default" : String(config.autoCompactTriggerPercent),
				values: autoCompactPercentValues,
			},
			{
				id: "steering-mode",
				label: "Steering mode",
				description:
					"Enter while streaming queues steering messages. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.",
				currentValue: config.steeringMode,
				values: ["one-at-a-time", "all"],
			},
			{
				id: "follow-up-mode",
				label: "Follow-up mode",
				description:
					"Alt+Enter queues follow-up messages until agent stops. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.",
				currentValue: config.followUpMode,
				values: ["one-at-a-time", "all"],
			},
			{
				id: "transport",
				label: "Transport",
				description: "Preferred transport for providers that support multiple transports",
				currentValue: config.transport,
				values: ["sse", "websocket", "auto"],
			},
			{
				id: "temperature",
				label: "Temperature",
				description: "Sampling temperature for providers that support it",
				currentValue: currentTemperatureValue,
				values: temperatureValues,
			},
			{
				id: "top-p",
				label: "Top-p",
				description: "Nucleus sampling probability mass for providers that support it",
				currentValue: currentTopPValue,
				values: topPValues,
			},
			{
				id: "presence-penalty",
				label: "Presence penalty",
				description: "Bias against reusing already-present concepts on providers that support it",
				currentValue: currentPresencePenaltyValue,
				values: penaltyValues,
			},
			{
				id: "repetition-penalty",
				label: "Repetition penalty",
				description: "Bias against repeating the same tokens on providers that support it",
				currentValue: currentRepetitionPenaltyValue,
				values: repetitionPenaltyValues,
			},
			{
				id: "status-line-preset",
				label: "Status line preset",
				description: "Top status-line layout preset",
				currentValue: config.statusLinePreset,
				values: ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"],
			},
			{
				id: "status-line-separator",
				label: "Status line separator",
				description: "Separator style for the top status-line",
				currentValue: config.statusLineSeparator,
				values: ["powerline", "powerline-thin", "slash", "pipe", "block", "none", "ascii"],
			},
			{
				id: "status-line-hooks",
				label: "Status line hook text",
				description: "Show extension status text below the top status-line",
				currentValue: config.statusLineShowHookStatus ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "anthropic-fine-grained-tool-streaming",
				label: "Anthropic tool streaming beta",
				description:
					"Enable fine-grained tool streaming for Anthropic-compatible providers. Off by default because some endpoints can emit malformed tool text.",
				currentValue: config.anthropicFineGrainedToolStreaming ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "subagent-tmux-linked-windows",
				label: "Link tmux subagents",
				description:
					"When pi is already running inside tmux, also link each subagent window into the current tmux session while keeping a dedicated attachable session.",
				currentValue: config.subagentTmuxLinkedWindows ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "async-execution",
				label: "Background bash",
				description: "Allow `bash` tool async jobs and enable `await` / `cancel_job` helpers",
				currentValue: config.asyncExecutionEnabled ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "async-max-jobs",
				label: "Background jobs max",
				description: "Maximum concurrent background bash jobs",
				currentValue: String(config.asyncMaxJobs),
				values: ["10", "25", "50", "100", "200", "500", "1000"],
			},
			{
				id: "bash-max-timeout",
				label: "Bash timeout cap (s)",
				description: "Global maximum timeout for bash tool (`default` keeps per-call timeout unbounded)",
				currentValue: currentBashMaxTimeoutValue,
				values: bashMaxTimeoutValues,
			},
			{
				id: "hide-thinking",
				label: "Hide thinking",
				description: "Hide thinking blocks in assistant responses",
				currentValue: config.hideThinkingBlock ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "collapse-changelog",
				label: "Collapse changelog",
				description: "Show condensed changelog after updates",
				currentValue: config.collapseChangelog ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "quiet-startup",
				label: "Quiet startup",
				description: "Disable verbose printing at startup",
				currentValue: config.quietStartup ? "true" : "false",
				values: ["true", "false"],
			},
			{
				id: "double-escape-action",
				label: "Double-escape action",
				description: "Action when pressing Escape twice with empty editor",
				currentValue: config.doubleEscapeAction,
				values: ["tree", "fork", "none"],
			},
			{
				id: "thinking",
				label: "Thinking level",
				description: "Reasoning depth for thinking-capable models",
				currentValue: config.thinkingLevel,
				submenu: (currentValue, done) =>
					new SelectSubmenu(
						"Thinking Level",
						"Select reasoning depth for thinking-capable models",
						config.availableThinkingLevels.map((level) => ({
							value: level,
							label: level,
							description: THINKING_DESCRIPTIONS[level],
						})),
						currentValue,
						(value) => {
							callbacks.onThinkingLevelChange(value as ThinkingLevel);
							done(value);
						},
						() => done(),
					),
			},
			{
				id: "theme",
				label: "Theme",
				description: "Color theme for the interface",
				currentValue: config.currentTheme,
				submenu: (currentValue, done) =>
					new SelectSubmenu(
						"Theme",
						"Select color theme",
						config.availableThemes.map((t) => ({
							value: t,
							label: t,
						})),
						currentValue,
						(value) => {
							callbacks.onThemeChange(value);
							done(value);
						},
						() => {
							// Restore original theme on cancel
							callbacks.onThemePreview?.(currentValue);
							done();
						},
						(value) => {
							// Preview theme on selection change
							callbacks.onThemePreview?.(value);
						},
					),
			},
		];

		// Only show image toggle if terminal supports it
		if (supportsImages) {
			// Insert after autocompact
			items.splice(1, 0, {
				id: "show-images",
				label: "Show images",
				description: "Render images inline in terminal",
				currentValue: config.showImages ? "true" : "false",
				values: ["true", "false"],
			});
		}

		// Image auto-resize toggle (always available, affects both attached and read images)
		items.splice(supportsImages ? 2 : 1, 0, {
			id: "auto-resize-images",
			label: "Auto-resize images",
			description: "Resize large images to 2000x2000 max for better model compatibility",
			currentValue: config.autoResizeImages ? "true" : "false",
			values: ["true", "false"],
		});

		// Block images toggle (always available, insert after auto-resize-images)
		const autoResizeIndex = items.findIndex((item) => item.id === "auto-resize-images");
		items.splice(autoResizeIndex + 1, 0, {
			id: "block-images",
			label: "Block images",
			description: "Prevent images from being sent to LLM providers",
			currentValue: config.blockImages ? "true" : "false",
			values: ["true", "false"],
		});

		// Skill commands toggle (insert after block-images)
		const blockImagesIndex = items.findIndex((item) => item.id === "block-images");
		items.splice(blockImagesIndex + 1, 0, {
			id: "skill-commands",
			label: "Skill commands",
			description: "Register skills as /skill:name commands",
			currentValue: config.enableSkillCommands ? "true" : "false",
			values: ["true", "false"],
		});

		// Hardware cursor toggle (insert after skill-commands)
		const skillCommandsIndex = items.findIndex((item) => item.id === "skill-commands");
		items.splice(skillCommandsIndex + 1, 0, {
			id: "show-hardware-cursor",
			label: "Show hardware cursor",
			description: "Show the terminal cursor while still positioning it for IME support",
			currentValue: config.showHardwareCursor ? "true" : "false",
			values: ["true", "false"],
		});

		// Editor padding toggle (insert after show-hardware-cursor)
		const hardwareCursorIndex = items.findIndex((item) => item.id === "show-hardware-cursor");
		items.splice(hardwareCursorIndex + 1, 0, {
			id: "editor-padding",
			label: "Editor padding",
			description: "Horizontal padding for input editor (0-3)",
			currentValue: String(config.editorPaddingX),
			values: ["0", "1", "2", "3"],
		});

		// Autocomplete max visible toggle (insert after editor-padding)
		const editorPaddingIndex = items.findIndex((item) => item.id === "editor-padding");
		items.splice(editorPaddingIndex + 1, 0, {
			id: "autocomplete-max-visible",
			label: "Autocomplete max items",
			description: "Max visible items in autocomplete dropdown (3-20)",
			currentValue: String(config.autocompleteMaxVisible),
			values: ["3", "5", "7", "10", "15", "20"],
		});

		// Clear on shrink toggle (insert after autocomplete-max-visible)
		const autocompleteIndex = items.findIndex((item) => item.id === "autocomplete-max-visible");
		items.splice(autocompleteIndex + 1, 0, {
			id: "clear-on-shrink",
			label: "Clear on shrink",
			description: "Clear empty rows when content shrinks (may cause flicker)",
			currentValue: config.clearOnShrink ? "true" : "false",
			values: ["true", "false"],
		});

		// Add borders
		this.addChild(new DynamicBorder());

		this.settingsList = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, newValue) => {
				switch (id) {
					case "autocompact":
						callbacks.onAutoCompactChange(newValue === "true");
						break;
					case "autocompact-trigger-percent":
						callbacks.onAutoCompactTriggerPercentChange(
							newValue === "default" ? undefined : parseInt(newValue, 10),
						);
						break;
					case "show-images":
						callbacks.onShowImagesChange(newValue === "true");
						break;
					case "auto-resize-images":
						callbacks.onAutoResizeImagesChange(newValue === "true");
						break;
					case "block-images":
						callbacks.onBlockImagesChange(newValue === "true");
						break;
					case "skill-commands":
						callbacks.onEnableSkillCommandsChange(newValue === "true");
						break;
					case "steering-mode":
						callbacks.onSteeringModeChange(newValue as "all" | "one-at-a-time");
						break;
					case "follow-up-mode":
						callbacks.onFollowUpModeChange(newValue as "all" | "one-at-a-time");
						break;
					case "transport":
						callbacks.onTransportChange(newValue as Transport);
						break;
					case "temperature":
						callbacks.onTemperatureChange(newValue === "default" ? undefined : parseFloat(newValue));
						break;
					case "top-p":
						callbacks.onTopPChange(newValue === "default" ? undefined : parseFloat(newValue));
						break;
					case "presence-penalty":
						callbacks.onPresencePenaltyChange(newValue === "default" ? undefined : parseFloat(newValue));
						break;
					case "repetition-penalty":
						callbacks.onRepetitionPenaltyChange(newValue === "default" ? undefined : parseFloat(newValue));
						break;
					case "status-line-preset":
						callbacks.onStatusLinePresetChange(newValue as StatusLinePreset);
						break;
					case "status-line-separator":
						callbacks.onStatusLineSeparatorChange(newValue as StatusLineSeparatorStyle);
						break;
					case "status-line-hooks":
						callbacks.onStatusLineShowHookStatusChange(newValue === "true");
						break;
					case "anthropic-fine-grained-tool-streaming":
						callbacks.onAnthropicFineGrainedToolStreamingChange(newValue === "true");
						break;
					case "subagent-tmux-linked-windows":
						callbacks.onSubagentTmuxLinkedWindowsChange(newValue === "true");
						break;
					case "async-execution":
						callbacks.onAsyncExecutionEnabledChange(newValue === "true");
						break;
					case "async-max-jobs":
						callbacks.onAsyncMaxJobsChange(parseInt(newValue, 10));
						break;
					case "bash-max-timeout":
						callbacks.onBashMaxTimeoutSecondsChange(newValue === "default" ? undefined : parseInt(newValue, 10));
						break;
					case "hide-thinking":
						callbacks.onHideThinkingBlockChange(newValue === "true");
						break;
					case "collapse-changelog":
						callbacks.onCollapseChangelogChange(newValue === "true");
						break;
					case "quiet-startup":
						callbacks.onQuietStartupChange(newValue === "true");
						break;
					case "double-escape-action":
						callbacks.onDoubleEscapeActionChange(newValue as "fork" | "tree" | "none");
						break;
					case "show-hardware-cursor":
						callbacks.onShowHardwareCursorChange(newValue === "true");
						break;
					case "editor-padding":
						callbacks.onEditorPaddingXChange(parseInt(newValue, 10));
						break;
					case "autocomplete-max-visible":
						callbacks.onAutocompleteMaxVisibleChange(parseInt(newValue, 10));
						break;
					case "clear-on-shrink":
						callbacks.onClearOnShrinkChange(newValue === "true");
						break;
				}
			},
			callbacks.onCancel,
			{ enableSearch: true },
		);

		this.addChild(this.settingsList);
		this.addChild(new DynamicBorder());
	}

	getSettingsList(): SettingsList {
		return this.settingsList;
	}
}
