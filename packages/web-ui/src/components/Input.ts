import { type BaseComponentProps, fc } from "@mariozechner/mini-lit/dist/mini.js";
import { html } from "lit";
import { type Ref, ref } from "lit/directives/ref.js";
import { i18n } from "../utils/i18n.js";

export type InputType = "text" | "email" | "password" | "number" | "url" | "tel" | "search";
export type InputSize = "sm" | "md" | "lg";

export interface InputProps extends BaseComponentProps {
	type?: InputType;
	size?: InputSize;
	value?: string;
	placeholder?: string;
	label?: string;
	error?: string;
	disabled?: boolean;
	required?: boolean;
	name?: string;
	autocomplete?: string;
	min?: number;
	max?: number;
	step?: number;
	inputRef?: Ref<HTMLInputElement>;
	onInput?: (e: Event) => void;
	onChange?: (e: Event) => void;
	onKeyDown?: (e: KeyboardEvent) => void;
	onKeyUp?: (e: KeyboardEvent) => void;
}

export const Input = fc<InputProps>(
	({
		type = "text",
		size = "md",
		value = "",
		placeholder = "",
		label = "",
		error = "",
		disabled = false,
		required = false,
		name = "",
		autocomplete = "",
		min,
		max,
		step,
		inputRef,
		onInput,
		onChange,
		onKeyDown,
		onKeyUp,
		className = "",
	}) => {
		const sizeClasses = {
			sm: "h-8 px-3 py-1 text-sm",
			md: "h-9 px-3 py-1 text-sm md:text-sm",
			lg: "h-10 px-4 py-1 text-base",
		};

		const baseClasses =
			"flex w-full min-w-0 rounded-md border bg-transparent text-foreground shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium";
		const interactionClasses =
			"placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground";
		const focusClasses = "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
		const darkClasses = "dark:bg-input/30";
		const stateClasses = error
			? "border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
			: "border-input";
		const disabledClasses = "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

		const handleInput = (e: Event) => {
			onInput?.(e);
		};

		const handleChange = (e: Event) => {
			onChange?.(e);
		};

		return html`
			<div class="flex flex-col gap-1.5 ${className}">
				${
					label
						? html`
							<label class="text-sm font-medium text-foreground">
								${label} ${required ? html`<span class="text-destructive">${i18n("*")}</span>` : ""}
							</label>
						`
						: ""
				}
				<input
					type="${type}"
					class="${baseClasses} ${
						sizeClasses[size]
					} ${interactionClasses} ${focusClasses} ${darkClasses} ${stateClasses} ${disabledClasses}"
					.value=${value}
					placeholder="${placeholder}"
					?disabled=${disabled}
					?required=${required}
					?aria-invalid=${!!error}
					name="${name}"
					autocomplete="${autocomplete}"
					min="${min ?? ""}"
					max="${max ?? ""}"
					step="${step ?? ""}"
					@input=${handleInput}
					@change=${handleChange}
					@keydown=${onKeyDown}
					@keyup=${onKeyUp}
					${inputRef ? ref(inputRef) : ""}
				/>
				${error ? html`<span class="text-sm text-destructive">${error}</span>` : ""}
			</div>
		`;
	},
);
