/**
 * Tab Bar Component
 *
 * A horizontal tab bar for switching between views/panels.
 * Renders as: "Label:  Tab1   Tab2   Tab3  (tab to cycle)"
 *
 * Navigation:
 * - Tab / Arrow Right: Next tab (wraps around)
 * - Shift+Tab / Arrow Left: Previous tab (wraps around)
 */

import { Key, matchesKey } from "../keys.js";
import type { Component } from "../tui.js";

/** Tab definition */
export interface Tab {
	/** Unique identifier for the tab */
	id: string;
	/** Display label shown in the tab bar */
	label: string;
}

/** Theme for styling the tab bar */
export interface TabBarTheme {
	/** Style for the label prefix (e.g., "Settings:") */
	label: (text: string) => string;
	/** Style for the currently active tab */
	activeTab: (text: string) => string;
	/** Style for inactive tabs */
	inactiveTab: (text: string) => string;
	/** Style for the hint text (e.g., "(tab to cycle)") */
	hint: (text: string) => string;
}

/**
 * Horizontal tab bar component.
 *
 * @example
 * ```ts
 * const tabs = [
 *   { id: "config", label: "Config" },
 *   { id: "tools", label: "Tools" },
 * ];
 * const tabBar = new TabBar("Settings", tabs, theme);
 * tabBar.onTabChange = (tab) => console.log(`Switched to ${tab.id}`);
 * ```
 */
export class TabBar implements Component {
	private tabs: Tab[];
	private activeIndex: number = 0;
	private theme: TabBarTheme;
	private label: string;

	/** Callback fired when the active tab changes */
	public onTabChange?: (tab: Tab, index: number) => void;

	constructor(label: string, tabs: Tab[], theme: TabBarTheme, initialIndex: number = 0) {
		this.label = label;
		this.tabs = tabs;
		this.theme = theme;
		this.activeIndex = this.tabs.length === 0 ? 0 : Math.max(0, Math.min(initialIndex, this.tabs.length - 1));
	}

	/** Get the currently active tab */
	getActiveTab(): Tab {
		if (this.tabs.length === 0) {
			return { id: "", label: "" };
		}
		const safeIndex = Math.max(0, Math.min(this.activeIndex, this.tabs.length - 1));
		return this.tabs[safeIndex];
	}

	/** Get the index of the currently active tab */
	getActiveIndex(): number {
		return this.activeIndex;
	}

	/** Set the active tab by index (clamped to valid range) */
	setActiveIndex(index: number): void {
		if (this.tabs.length === 0) {
			return;
		}
		const newIndex = Math.max(0, Math.min(index, this.tabs.length - 1));
		if (newIndex !== this.activeIndex) {
			this.activeIndex = newIndex;
			this.onTabChange?.(this.tabs[this.activeIndex], this.activeIndex);
		}
	}

	/** Move to the next tab (wraps to first tab after last) */
	nextTab(): void {
		if (this.tabs.length === 0) {
			return;
		}
		this.setActiveIndex((this.activeIndex + 1) % this.tabs.length);
	}

	/** Move to the previous tab (wraps to last tab before first) */
	prevTab(): void {
		if (this.tabs.length === 0) {
			return;
		}
		this.setActiveIndex((this.activeIndex - 1 + this.tabs.length) % this.tabs.length);
	}

	invalidate(): void {
		// No cached state to invalidate
	}

	/**
	 * Handle keyboard input for tab navigation.
	 * @returns true if the input was handled, false otherwise
	 */
	handleInput(data: string): boolean {
		if (this.tabs.length === 0) {
			return false;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.nextTab();
			return true;
		}
		if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
			this.prevTab();
			return true;
		}
		return false;
	}

	/** Render the tab bar as a single line */
	render(_width: number): string[] {
		if (this.tabs.length === 0) {
			return [this.theme.label(`${this.label}:`)];
		}
		const parts: string[] = [];

		// Label prefix
		parts.push(this.theme.label(`${this.label}:`));
		parts.push(" ");

		// Tab buttons
		for (let i = 0; i < this.tabs.length; i++) {
			const tab = this.tabs[i];
			if (i === this.activeIndex) {
				parts.push(this.theme.activeTab(tab.label));
			} else {
				parts.push(this.theme.inactiveTab(tab.label));
			}
			if (i < this.tabs.length - 1) {
				parts.push(" ");
			}
		}

		// Navigation hint
		parts.push(" ");
		parts.push(this.theme.hint("(Tab/←/→)"));

		return [parts.join("")];
	}
}
