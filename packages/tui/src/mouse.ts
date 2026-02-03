/**
 * Mouse event parsing for SGR mouse protocol.
 *
 * The SGR mouse protocol uses the format: \x1b[<B;X;YM (press) or \x1b[<B;X;Ym (release)
 * where:
 * - B is the button/modifier code
 * - X is the column (1-indexed)
 * - Y is the row (1-indexed)
 * - M = press, m = release
 */

export type MouseButton = "left" | "middle" | "right" | "scroll-up" | "scroll-down" | "unknown";
export type MouseEventType = "press" | "release";

export interface MouseEvent {
	button: MouseButton;
	type: MouseEventType;
	col: number; // 1-indexed terminal column
	row: number; // 1-indexed terminal row
}

/**
 * SGR mouse event pattern: \x1b[<B;X;Y[Mm]
 * - B is button/modifier code (0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down)
 * - X is column (1-indexed)
 * - Y is row (1-indexed)
 * - M = press, m = release
 */
const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/**
 * Check if the given input data looks like an SGR mouse event.
 * This is a quick check that can be used before attempting to parse.
 */
export function isMouseEvent(data: string): boolean {
	return data.startsWith("\x1b[<") && (data.endsWith("M") || data.endsWith("m"));
}

/**
 * Parse an SGR mouse event from terminal input.
 *
 * @param data - The raw input string to parse
 * @returns Parsed MouseEvent or null if not a valid mouse event
 */
export function parseMouseEvent(data: string): MouseEvent | null {
	const match = data.match(SGR_MOUSE_PATTERN);
	if (!match) {
		return null;
	}

	const buttonCode = parseInt(match[1], 10);
	const col = parseInt(match[2], 10);
	const row = parseInt(match[3], 10);
	const isPress = match[4] === "M";

	// Decode button from code
	// Lower 2 bits encode button (0=left, 1=middle, 2=right)
	// Bit 6 (64) indicates scroll wheel
	const button = decodeButton(buttonCode);
	const type: MouseEventType = isPress ? "press" : "release";

	return { button, type, col, row };
}

/**
 * Decode the button code from SGR mouse protocol.
 *
 * Button codes:
 * - 0: left button
 * - 1: middle button
 * - 2: right button
 * - 64: scroll up (wheel)
 * - 65: scroll down (wheel)
 *
 * Modifier bits can also be present but we ignore them for now.
 */
function decodeButton(code: number): MouseButton {
	// Scroll wheel events have bit 6 set
	if (code & 64) {
		// Bit 0 distinguishes scroll up (64) vs scroll down (65)
		return code & 1 ? "scroll-down" : "scroll-up";
	}

	// Lower 2 bits encode the button
	const buttonBits = code & 3;
	switch (buttonBits) {
		case 0:
			return "left";
		case 1:
			return "middle";
		case 2:
			return "right";
		default:
			return "unknown";
	}
}
