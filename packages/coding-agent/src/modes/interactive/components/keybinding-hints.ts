/**
 * Utilities for formatting keybinding hints in the UI.
 */

import { type EditorAction, getEditorKeybindings, type KeyId } from "@mariozechner/pi-tui";
import type { AppAction, KeybindingsManager } from "../../../core/keybindings.js";
import { theme } from "../theme/theme.js";

/**
 * Format keys array as display string (e.g., ["ctrl+c", "escape"] -> "ctrl+c/escape").
 */
function formatKeys(keys: KeyId[]): string {
	if (keys.length === 0) return "";
	if (keys.length === 1) return keys[0]!;
	return keys.join("/");
}

/**
 * Get display string for an editor action.
 */
export function editorKey(action: EditorAction): string {
	return formatKeys(getEditorKeybindings().getKeys(action));
}

/**
 * Get display string for an app action.
 */
export function appKey(keybindings: KeybindingsManager, action: AppAction): string {
	return formatKeys(keybindings.getKeys(action));
}

/**
 * Format a keybinding hint with consistent styling: dim key, muted description.
 * Looks up the key from editor keybindings automatically.
 *
 * @param action - Editor action name (e.g., "selectConfirm", "expandTools")
 * @param description - Description text (e.g., "to expand", "cancel")
 * @returns Formatted string with dim key and muted description
 */
export function keyHint(action: EditorAction, description: string): string {
	return theme.fg("dim", editorKey(action)) + theme.fg("muted", ` ${description}`);
}

/**
 * Format a keybinding hint for app-level actions.
 * Requires the KeybindingsManager instance.
 *
 * @param keybindings - KeybindingsManager instance
 * @param action - App action name (e.g., "interrupt", "externalEditor")
 * @param description - Description text
 * @returns Formatted string with dim key and muted description
 */
export function appKeyHint(keybindings: KeybindingsManager, action: AppAction, description: string): string {
	return theme.fg("dim", appKey(keybindings, action)) + theme.fg("muted", ` ${description}`);
}

/**
 * Format a raw key string with description (for non-configurable keys like ↑↓).
 *
 * @param key - Raw key string
 * @param description - Description text
 * @returns Formatted string with dim key and muted description
 */
export function rawKeyHint(key: string, description: string): string {
	return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}
