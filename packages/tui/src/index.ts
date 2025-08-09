// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.js";
// Logger for debugging
export { type LoggerConfig, logger } from "./logger.js";
// Markdown component
export { MarkdownComponent } from "./markdown-component.js";
// Select list component
export { type SelectItem, SelectList } from "./select-list.js";
// Text component
export { TextComponent } from "./text-component.js";
// Text editor component
export { TextEditor, type TextEditorConfig } from "./text-editor.js";
export {
	type Component,
	type ComponentRenderResult,
	Container,
	type ContainerRenderResult,
	type Padding,
	TUI,
} from "./tui.js";
// Whitespace component
export { WhitespaceComponent } from "./whitespace-component.js";
