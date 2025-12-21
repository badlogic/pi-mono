// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.js";
// Components
export { Box } from "./components/box.js";
export { Editor, type EditorTheme } from "./components/editor.js";
export { Image, type ImageOptions, type ImageTheme } from "./components/image.js";
export { Input } from "./components/input.js";
export { Loader } from "./components/loader.js";
export { type DefaultTextStyle, Markdown, type MarkdownTheme } from "./components/markdown.js";
export { type SelectItem, SelectList, type SelectListTheme } from "./components/select-list.js";
export { Spacer } from "./components/spacer.js";
export { Text } from "./components/text.js";
export { TruncatedText } from "./components/truncated-text.js";
// Kitty keyboard protocol helpers
export {
	isAltBackspace,
	isAltEnter,
	isAltLeft,
	isAltRight,
	isArrowDown,
	isArrowLeft,
	isArrowRight,
	isArrowUp,
	isBackspace,
	isCtrlA,
	isCtrlC,
	isCtrlD,
	isCtrlE,
	isCtrlG,
	isCtrlK,
	isCtrlLeft,
	isCtrlO,
	isCtrlP,
	isCtrlRight,
	isCtrlT,
	isCtrlU,
	isCtrlW,
	isCtrlZ,
	isDelete,
	isEnd,
	isEnter,
	isEscape,
	isHome,
	isShiftEnter,
	isShiftTab,
	isTab,
	Keys,
} from "./keys.js";
// Terminal interface and implementations
export { ProcessTerminal, type Terminal } from "./terminal.js";
// Terminal image support
export {
	type CellDimensions,
	calculateImageRows,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	resetCapabilitiesCache,
	setCellDimensions,
	type TerminalCapabilities,
} from "./terminal-image.js";
export { type Component, Container, TUI } from "./tui.js";
// Utilities
export { truncateToWidth, visibleWidth } from "./utils.js";
