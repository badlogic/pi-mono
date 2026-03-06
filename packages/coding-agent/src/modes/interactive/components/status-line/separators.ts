import type { StatusLineSeparatorStyle } from "./types.js";

export interface SeparatorDef {
	left: string;
	right: string;
	endCaps?: {
		left: string;
		right: string;
		useBgAsFg?: boolean;
	};
}

export function getSeparator(style: StatusLineSeparatorStyle): SeparatorDef {
	switch (style) {
		case "powerline":
			return {
				left: "▶",
				right: "◀",
				endCaps: {
					left: "◀",
					right: "▶",
					useBgAsFg: true,
				},
			};
		case "powerline-thin":
			return {
				left: "›",
				right: "‹",
				endCaps: {
					left: "◀",
					right: "▶",
					useBgAsFg: true,
				},
			};
		case "slash":
			return { left: "/", right: "\\" };
		case "pipe":
			return { left: "|", right: "|" };
		case "block":
			return { left: "█", right: "█" };
		case "none":
			return { left: " ", right: " " };
		case "ascii":
			return { left: ">", right: "<" };
		default:
			return {
				left: "›",
				right: "‹",
				endCaps: {
					left: "◀",
					right: "▶",
					useBgAsFg: true,
				},
			};
	}
}
