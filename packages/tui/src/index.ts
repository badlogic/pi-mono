// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.js";
// Loading animation component
export { LoadingAnimation } from "./components/loading-animation.js";
// Markdown component
export { MarkdownComponent } from "./components/markdown-component.js";
// Select list component
export { type SelectItem, SelectList } from "./components/select-list.js";
// Text component
export { TextComponent } from "./components/text-component.js";
// Text editor component
export { TextEditor, type TextEditorConfig } from "./components/text-editor.js";
// Whitespace component
export { WhitespaceComponent } from "./components/whitespace-component.js";
// Terminal interface and implementations
export { ProcessTerminal, type Terminal } from "./terminal.js";
export {
	type Component,
	type ComponentRenderResult,
	Container,
	getNextComponentId,
	type Padding,
	TUI,
} from "./tui.js";
