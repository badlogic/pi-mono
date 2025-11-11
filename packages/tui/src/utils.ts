import stringWidth from "string-width";

/**
 * Calculate the visible width of a string in terminal columns.
 * This correctly handles:
 * - ANSI escape codes (ignored)
 * - Emojis and wide characters (counted as 2 columns)
 * - Combining characters (counted correctly)
 * - Tabs (replaced with 3 spaces for consistent width)
 */
export function visibleWidth(str: string): number {
	// Replace tabs with 3 spaces before measuring
	const normalized = str.replace(/\t/g, "   ");
	return stringWidth(normalized);
}
