import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Phosphor color mode for the CRT effect.
 */
export type CRTColorMode = "green" | "amber" | "blue";

/**
 * A wrapper component that applies a retro CRT/phosphor monitor effect
 * to its children. Includes scanlines, flicker, vignette, and optional
 * screen curvature.
 *
 * @example
 * ```html
 * <crt-container color-mode="green" curvature>
 *   <div>Your app content here</div>
 * </crt-container>
 * ```
 */
@customElement("crt-container")
export class CRTContainer extends LitElement {
	/**
	 * The phosphor color mode: "green" (classic), "amber" (warm), or "blue" (cool).
	 */
	@property({ type: String, attribute: "color-mode", reflect: true })
	colorMode: CRTColorMode = "green";

	/**
	 * Whether to apply a subtle curved screen effect via CSS 3D transforms.
	 */
	@property({ type: Boolean, reflect: true })
	curvature = false;

	// Render into light DOM to inherit Tailwind styles
	createRenderRoot() {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		this.style.display = "block";
		this.style.width = "100%";
		this.style.height = "100%";
		this.style.position = "relative";
	}

	override render() {
		const curvatureClass = this.curvature ? "crt-curvature" : "";

		return html`
			<div class="crt-wrapper ${curvatureClass}">
				<!-- Content slot -->
				<div class="crt-content">
					<slot></slot>
				</div>
				<!-- Overlay layer: scanlines + vignette + flicker -->
				<div class="crt-overlay" aria-hidden="true"></div>
			</div>
		`;
	}
}

// Guard against duplicate registration
if (!customElements.get("crt-container")) {
	customElements.define("crt-container", CRTContainer);
}
