/**
 * Unique marker used by input-like components to denote the cursor position.
 *
 * We intentionally use a rarely-used SGR parameter (999) to avoid ambiguity with
 * regular inverse-video styling (SGR 7).
 */
export const CURSOR_MARKER = "\x1b[7;999m";

/**
 * End marker for the cursor styling (disable inverse video).
 */
export const CURSOR_MARKER_END = "\x1b[27m";
