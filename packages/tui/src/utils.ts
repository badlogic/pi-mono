import stringWidth from "string-width";

/**
 * Calculate the visible width of a string in terminal columns.
 * This correctly handles:
 * - ANSI escape codes (ignored)
 * - Emojis and wide characters (counted as 2 columns)
 * - Combining characters (counted correctly)
 */
export function visibleWidth(str: string): number {
	return stringWidth(str);
}
