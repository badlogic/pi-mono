import { icon } from "@mariozechner/mini-lit";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Activity, AlertTriangle, Loader2, Radio, Trash2, Zap } from "lucide";

/**
 * Button state for tactical button.
 */
export type TacticalButtonState = "idle" | "active" | "processing" | "success" | "error";

/**
 * Configuration for a tactical button.
 */
export interface TacticalButtonConfig {
	label: string;
	icon: string;
	color: string;
	action: () => Promise<void>;
}

/**
 * Icon name to Lucide icon mapping.
 */
const ICON_MAP: Record<string, typeof Zap> = {
	zap: Zap,
	trash: Trash2,
	alert: AlertTriangle,
	radio: Radio,
	activity: Activity,
	loader: Loader2,
};

/**
 * TacticalButton - A high-feedback industrial sci-fi button for touchscreens.
 *
 * Features:
 * - Tactile visual feedback on press (scale/translate transform)
 * - Neon glow effects based on color prop
 * - Processing state with spinner
 * - Success/error state feedback
 *
 * @example
 * ```html
 * <tactical-button
 *   label="DEPLOY"
 *   icon="zap"
 *   color="#00ffff"
 *   .action=${async () => { await doSomething(); }}
 * ></tactical-button>
 * ```
 */
@customElement("tactical-button")
export class TacticalButton extends LitElement {
	/**
	 * Button label text.
	 */
	@property({ type: String })
	label = "ACTION";

	/**
	 * Icon name (maps to Lucide icons: zap, trash, alert, radio, activity).
	 */
	@property({ type: String })
	icon = "zap";

	/**
	 * Neon accent color for the button.
	 */
	@property({ type: String })
	color = "#00ffff";

	/**
	 * Async action to execute on press.
	 */
	@property({ attribute: false })
	action?: () => Promise<void>;

	/**
	 * Whether this is a toggle button (maintains active state).
	 */
	@property({ type: Boolean })
	toggle = false;

	/**
	 * Current button state.
	 */
	@state()
	private _state: TacticalButtonState = "idle";

	/**
	 * Whether the button is currently pressed (for visual feedback).
	 */
	@state()
	private _pressed = false;

	/**
	 * Progress value (0-100) for progress bar display.
	 */
	@state()
	private _progress = 0;

	/**
	 * Status text shown below label during processing.
	 */
	@state()
	private _statusText = "";

	/**
	 * Toggle active state for toggle buttons.
	 */
	@state()
	private _toggleActive = false;

	// Use light DOM to inherit styles
	override createRenderRoot() {
		return this;
	}

	private async _handleClick() {
		if (this._state === "processing") return;

		if (this.toggle) {
			this._toggleActive = !this._toggleActive;
			this._state = this._toggleActive ? "active" : "idle";
		}

		if (this.action) {
			this._state = "processing";
			this._statusText = "";
			this._progress = 0;

			try {
				await this.action();
				if (!this.toggle) {
					this._state = "success";
					setTimeout(() => {
						this._state = "idle";
					}, 1000);
				}
			} catch {
				this._state = "error";
				setTimeout(() => {
					this._state = this.toggle && this._toggleActive ? "active" : "idle";
				}, 1500);
			}
		}
	}

	private _handlePointerDown() {
		this._pressed = true;
	}

	private _handlePointerUp() {
		this._pressed = false;
	}

	private _handlePointerLeave() {
		this._pressed = false;
	}

	private _handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			this._pressed = true;
			this._handleClick();
		}
	}

	private _handleKeyUp(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === " ") {
			this._pressed = false;
		}
	}

	/**
	 * Set progress value (0-100) for external control.
	 */
	public setProgress(value: number) {
		this._progress = Math.max(0, Math.min(100, value));
	}

	/**
	 * Set status text shown during processing.
	 */
	public setStatus(text: string) {
		this._statusText = text;
	}

	/**
	 * Get the current state.
	 */
	public getState(): TacticalButtonState {
		return this._state;
	}

	/**
	 * Get toggle active state.
	 */
	public isToggleActive(): boolean {
		return this._toggleActive;
	}

	private _getIcon() {
		const IconComponent = ICON_MAP[this.icon.toLowerCase()] || Zap;
		return icon(IconComponent, "md");
	}

	override render() {
		const isActive = this._state === "active" || this._toggleActive;
		const isProcessing = this._state === "processing";
		const isSuccess = this._state === "success";
		const isError = this._state === "error";

		// Determine current color based on state
		let currentColor = this.color;
		if (isSuccess) currentColor = "#00ff00";
		if (isError) currentColor = "#ff0000";

		// CSS custom properties for dynamic styling
		const buttonStyle = `
			--tactical-color: ${currentColor};
			--tactical-color-dim: ${currentColor}4d;
			--tactical-color-medium: ${currentColor}99;
			--tactical-color-bright: ${currentColor};
		`;

		const pressedTransform = this._pressed ? "scale(0.95) translateY(2px)" : "scale(1) translateY(0)";
		const activeBackground = isActive || isSuccess || isError ? `${currentColor}33` : "transparent";

		return html`
			<style>
				.tactical-button {
					position: relative;
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: center;
					min-width: 100px;
					min-height: 100px;
					padding: 16px;
					background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
					border: 1px solid var(--tactical-color-dim);
					border-radius: 8px;
					cursor: pointer;
					user-select: none;
					transition: all 0.1s ease-out;
					font-family: monospace;
					text-transform: uppercase;
					letter-spacing: 1px;
					outline: none;
					overflow: hidden;
				}

				.tactical-button:hover {
					border-color: var(--tactical-color-medium);
					box-shadow: 0 0 15px var(--tactical-color-dim);
				}

				.tactical-button:focus-visible {
					border-color: var(--tactical-color-bright);
					box-shadow: 0 0 20px var(--tactical-color-dim), inset 0 0 10px var(--tactical-color-dim);
				}

				.tactical-button.active {
					border-color: var(--tactical-color-bright);
					box-shadow: 0 0 25px var(--tactical-color-dim), inset 0 0 15px var(--tactical-color-dim);
				}

				.tactical-button.processing {
					cursor: wait;
					animation: tactical-pulse 1.5s ease-in-out infinite;
				}

				.tactical-button.success {
					border-color: #00ff00;
					box-shadow: 0 0 30px rgba(0, 255, 0, 0.5);
				}

				.tactical-button.error {
					border-color: #ff0000;
					box-shadow: 0 0 30px rgba(255, 0, 0, 0.5);
				}

				.tactical-button__icon {
					color: var(--tactical-color-bright);
					margin-bottom: 8px;
					transition: color 0.15s ease;
					filter: drop-shadow(0 0 4px var(--tactical-color-dim));
				}

				.tactical-button__label {
					font-size: 12px;
					font-weight: 600;
					color: var(--tactical-color-bright);
					text-shadow: 0 0 8px var(--tactical-color-dim);
				}

				.tactical-button__status {
					font-size: 9px;
					color: var(--tactical-color-medium);
					margin-top: 4px;
					min-height: 12px;
				}

				.tactical-button__spinner {
					position: absolute;
					top: 8px;
					right: 8px;
					width: 16px;
					height: 16px;
					color: var(--tactical-color-bright);
					animation: tactical-spin 1s linear infinite;
				}

				.tactical-button__progress {
					position: absolute;
					bottom: 0;
					left: 0;
					height: 3px;
					background: var(--tactical-color-bright);
					transition: width 0.1s ease-out;
					box-shadow: 0 0 10px var(--tactical-color-bright);
				}

				.tactical-button__bg-fill {
					position: absolute;
					inset: 0;
					background: var(--bg-color);
					opacity: 1;
					z-index: 0;
					transition: background 0.15s ease;
				}

				.tactical-button__content {
					position: relative;
					z-index: 1;
					display: flex;
					flex-direction: column;
					align-items: center;
				}

				/* Scanline effect */
				.tactical-button::after {
					content: "";
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background: repeating-linear-gradient(
						0deg,
						transparent,
						transparent 2px,
						rgba(0, 0, 0, 0.1) 2px,
						rgba(0, 0, 0, 0.1) 4px
					);
					pointer-events: none;
					border-radius: 7px;
				}
			</style>

			<button
				class="tactical-button ${isActive ? "active" : ""} ${isProcessing ? "processing" : ""} ${isSuccess ? "success" : ""} ${isError ? "error" : ""}"
				style="${buttonStyle} transform: ${pressedTransform};"
				role="button"
				aria-pressed="${this.toggle ? this._toggleActive : undefined}"
				aria-busy="${isProcessing}"
				aria-label="${this.label}"
				tabindex="0"
				@click=${this._handleClick}
				@pointerdown=${this._handlePointerDown}
				@pointerup=${this._handlePointerUp}
				@pointerleave=${this._handlePointerLeave}
				@keydown=${this._handleKeyDown}
				@keyup=${this._handleKeyUp}
			>
				<div class="tactical-button__bg-fill" style="--bg-color: ${activeBackground}"></div>

				<div class="tactical-button__content">
					<div class="tactical-button__icon">
						${this._getIcon()}
					</div>
					<div class="tactical-button__label">${this.label}</div>
					<div class="tactical-button__status">${this._statusText}</div>
				</div>

				${isProcessing ? html`<div class="tactical-button__spinner">${icon(Loader2, "sm")}</div>` : ""}

				${this._progress > 0 ? html`<div class="tactical-button__progress" style="width: ${this._progress}%"></div>` : ""}
			</button>
		`;
	}
}

/**
 * TacticalLaunchpad - A grid of tactical buttons for macro control.
 *
 * Transforms the interface into an interactive control surface with
 * high-feedback buttons designed for touchscreens.
 *
 * @example
 * ```html
 * <tactical-launchpad columns="3" demo-mode></tactical-launchpad>
 * ```
 */
@customElement("tactical-launchpad")
export class TacticalLaunchpad extends LitElement {
	/**
	 * Number of columns in the grid.
	 */
	@property({ type: Number })
	columns = 3;

	/**
	 * Gap between buttons in pixels.
	 */
	@property({ type: Number })
	gap = 12;

	/**
	 * Enable demo mode with pre-configured mock buttons.
	 */
	@property({ type: Boolean, attribute: "demo-mode" })
	demoMode = true;

	/**
	 * Mock alert mode state (for demo).
	 */
	@state()
	private _alertMode = false;

	/**
	 * Reference to button elements for programmatic control.
	 */
	private _buttonRefs: Map<string, TacticalButton> = new Map();

	// Use light DOM
	override createRenderRoot() {
		return this;
	}

	/**
	 * Demo action: System Purge
	 * Simulates a cleanup process with progress bar.
	 */
	private async _demoPurge() {
		const button = this._buttonRefs.get("purge");
		if (!button) return;

		button.setStatus("INITIALIZING...");
		await this._delay(300);

		for (let i = 0; i <= 100; i += 5) {
			button.setProgress(i);
			button.setStatus(`PURGING... ${i}%`);
			await this._delay(80);
		}

		button.setStatus("COMPLETE");
		button.setProgress(0);
	}

	/**
	 * Demo action: Red Alert
	 * Toggles alert mode state.
	 */
	private async _demoAlert() {
		this._alertMode = !this._alertMode;
		const button = this._buttonRefs.get("alert");
		if (button) {
			button.setStatus(this._alertMode ? "ACTIVE" : "");
		}
	}

	/**
	 * Demo action: Ping Host
	 * Simulates a network ping operation.
	 */
	private async _demoPing() {
		const button = this._buttonRefs.get("ping");
		if (!button) return;

		button.setStatus("PINGING...");
		await this._delay(500 + Math.random() * 500);

		const latency = Math.floor(15 + Math.random() * 30);
		button.setStatus(`OK ${latency}ms`);
	}

	private _delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	override render() {
		const gridStyle = `
			display: grid;
			grid-template-columns: repeat(${this.columns}, 1fr);
			gap: ${this.gap}px;
			padding: ${this.gap}px;
			background: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);
			border-radius: 12px;
			border: 1px solid #222;
		`;

		return html`
			<style>
				.tactical-launchpad {
					box-shadow:
						inset 0 0 30px rgba(0, 0, 0, 0.8),
						0 4px 20px rgba(0, 0, 0, 0.5);
				}

				.tactical-launchpad__title {
					grid-column: 1 / -1;
					text-align: center;
					font-family: monospace;
					font-size: 10px;
					color: #444;
					text-transform: uppercase;
					letter-spacing: 3px;
					padding: 8px 0;
					border-bottom: 1px solid #222;
					margin-bottom: 4px;
				}

				/* Alert mode visual effect */
				.tactical-launchpad.alert-mode {
					border-color: rgba(255, 0, 0, 0.3);
					box-shadow:
						inset 0 0 30px rgba(255, 0, 0, 0.1),
						0 4px 20px rgba(0, 0, 0, 0.5),
						0 0 40px rgba(255, 0, 0, 0.2);
					animation: alert-pulse 2s ease-in-out infinite;
				}

				@keyframes alert-pulse {
					0%, 100% { border-color: rgba(255, 0, 0, 0.3); }
					50% { border-color: rgba(255, 0, 0, 0.6); }
				}
			</style>

			<div
				class="tactical-launchpad ${this._alertMode ? "alert-mode" : ""}"
				style="${gridStyle}"
			>
				${this.demoMode ? html`<div class="tactical-launchpad__title">Tactical Control</div>` : ""}

				${
					this.demoMode
						? html`
					<tactical-button
						label="SYSTEM PURGE"
						icon="trash"
						color="#00ffff"
						.action=${() => this._demoPurge()}
					></tactical-button>

					<tactical-button
						label="RED ALERT"
						icon="alert"
						color="#ff0000"
						?toggle=${true}
						.action=${() => this._demoAlert()}
					></tactical-button>

					<tactical-button
						label="PING HOST"
						icon="radio"
						color="#ffbf00"
						.action=${() => this._demoPing()}
					></tactical-button>
				`
						: html`<slot></slot>`
				}
			</div>
		`;
	}

	override firstUpdated() {
		// Get button references after first render
		this.querySelectorAll("tactical-button").forEach((button) => {
			const label = button.getAttribute("label")?.toLowerCase().replace(/\s+/g, "-");
			if (label && button instanceof TacticalButton) {
				if (label.includes("purge")) this._buttonRefs.set("purge", button);
				if (label.includes("alert")) this._buttonRefs.set("alert", button);
				if (label.includes("ping")) this._buttonRefs.set("ping", button);
			}
		});
	}
}

// Guard against duplicate registration
if (!customElements.get("tactical-button")) {
	customElements.define("tactical-button", TacticalButton);
}

if (!customElements.get("tactical-launchpad")) {
	customElements.define("tactical-launchpad", TacticalLaunchpad);
}
