import { html, LitElement, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * Represents a detected device/signal target on the radar.
 */
export interface RadarTarget {
	/** Unique identifier for the target */
	id: string;
	/** Signal strength in dBm (typically -30 to -90) */
	rssi: number;
	/** Display label (e.g., "iPhone", "Unknown Tag") */
	label: string;
	/** Calculated angle in degrees (0-360), derived from ID hash */
	angle: number;
	/** Timestamp of last sweep pass for phosphor fade effect */
	lastSweepTime: number;
}

/**
 * Color scheme for the radar display.
 */
export type RadarColorScheme = "green" | "red" | "amber";

/**
 * Simple hash function to convert a string ID to a consistent angle.
 */
function hashToAngle(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		const char = id.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash % 360);
}

/**
 * Maps RSSI value to a normalized radius (0-1).
 * Stronger signal (closer to -30) = closer to center (smaller radius).
 * Weaker signal (closer to -90) = closer to edge (larger radius).
 */
function rssiToRadius(rssi: number): number {
	const minRssi = -90;
	const maxRssi = -30;
	const clamped = Math.max(minRssi, Math.min(maxRssi, rssi));
	// Invert: stronger signal = smaller radius
	return 1 - (clamped - minRssi) / (maxRssi - minRssi);
}

/**
 * Generates mock device names for simulation.
 */
const MOCK_DEVICE_NAMES = [
	"iPhone-7X3K",
	"Galaxy-S21",
	"AirPods Pro",
	"MacBook-Air",
	"Unknown Tag",
	"Beacon-A1",
	"Tile Tracker",
	"ESP32-Node",
	"Raspberry Pi",
	"Arduino-BLE",
	"Fitbit-Versa",
	"Apple Watch",
	"WiFi-Router",
	"Smart Lock",
	"Nest Cam",
];

/**
 * ProximityRadar - A Sci-Fi radar widget that visualizes nearby
 * Bluetooth/BLE devices or Wi-Fi signals as blips on a circular display.
 *
 * Features:
 * - Rotating sweep line with phosphor fade effect
 * - Signal strength mapped to distance from center
 * - Device ID mapped to consistent angular position
 * - Mock scanner simulation for demo purposes
 *
 * @example
 * ```html
 * <proximity-radar
 *   color-scheme="green"
 *   sweep-duration="4"
 *   mock-mode
 * ></proximity-radar>
 * ```
 */
@customElement("proximity-radar")
export class ProximityRadar extends LitElement {
	/**
	 * Color scheme: "green" (classic), "red" (alert), "amber" (warm).
	 */
	@property({ type: String, attribute: "color-scheme", reflect: true })
	colorScheme: RadarColorScheme = "green";

	/**
	 * Duration of one full sweep rotation in seconds.
	 */
	@property({ type: Number, attribute: "sweep-duration" })
	sweepDuration = 4;

	/**
	 * Whether to run in mock/simulation mode.
	 */
	@property({ type: Boolean, attribute: "mock-mode", reflect: true })
	mockMode = true;

	/**
	 * Size of the radar in pixels (width and height).
	 */
	@property({ type: Number })
	size = 400;

	/**
	 * Show target labels on hover.
	 */
	@property({ type: Boolean, attribute: "show-labels" })
	showLabels = true;

	/**
	 * Internal state: current sweep angle in degrees.
	 */
	@state()
	private _sweepAngle = 0;

	/**
	 * Internal state: detected targets.
	 */
	@state()
	private _targets: RadarTarget[] = [];

	/**
	 * Animation frame ID for cleanup.
	 */
	private _animationFrameId: number | null = null;

	/**
	 * Last timestamp for animation timing.
	 */
	private _lastTimestamp = 0;

	/**
	 * Mock simulation interval ID.
	 */
	private _mockIntervalId: ReturnType<typeof setInterval> | null = null;

	// Use light DOM to inherit Tailwind styles
	override createRenderRoot() {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		this.style.display = "block";
		this.style.width = `${this.size}px`;
		this.style.height = `${this.size}px`;

		// Start animation loop
		this._startAnimation();

		// Start mock scanner if enabled
		if (this.mockMode) {
			this._startMockScanner();
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this._stopAnimation();
		this._stopMockScanner();
	}

	override updated(changedProperties: Map<string, unknown>) {
		if (changedProperties.has("mockMode")) {
			if (this.mockMode) {
				this._startMockScanner();
			} else {
				this._stopMockScanner();
			}
		}
		if (changedProperties.has("size")) {
			this.style.width = `${this.size}px`;
			this.style.height = `${this.size}px`;
		}
	}

	/**
	 * Add or update a target on the radar.
	 */
	public addTarget(id: string, rssi: number, label: string) {
		const existingIndex = this._targets.findIndex((t) => t.id === id);
		const target: RadarTarget = {
			id,
			rssi,
			label,
			angle: hashToAngle(id),
			lastSweepTime: existingIndex >= 0 ? this._targets[existingIndex].lastSweepTime : 0,
		};

		if (existingIndex >= 0) {
			this._targets = [...this._targets.slice(0, existingIndex), target, ...this._targets.slice(existingIndex + 1)];
		} else {
			this._targets = [...this._targets, target];
		}
	}

	/**
	 * Remove a target from the radar.
	 */
	public removeTarget(id: string) {
		this._targets = this._targets.filter((t) => t.id !== id);
	}

	/**
	 * Clear all targets.
	 */
	public clearTargets() {
		this._targets = [];
	}

	private _startAnimation() {
		this._lastTimestamp = performance.now();
		const animate = (timestamp: number) => {
			const delta = timestamp - this._lastTimestamp;
			this._lastTimestamp = timestamp;

			// Update sweep angle
			const degreesPerMs = 360 / (this.sweepDuration * 1000);
			this._sweepAngle = (this._sweepAngle + delta * degreesPerMs) % 360;

			// Update target sweep times when the sweep passes them
			this._updateTargetSweepTimes();

			this._animationFrameId = requestAnimationFrame(animate);
		};
		this._animationFrameId = requestAnimationFrame(animate);
	}

	private _stopAnimation() {
		if (this._animationFrameId !== null) {
			cancelAnimationFrame(this._animationFrameId);
			this._animationFrameId = null;
		}
	}

	private _updateTargetSweepTimes() {
		const now = performance.now();
		const sweepWidth = 10; // Degrees of "tolerance" for sweep detection

		let updated = false;
		const newTargets = this._targets.map((target) => {
			const angleDiff = Math.abs(this._sweepAngle - target.angle);
			const normalizedDiff = Math.min(angleDiff, 360 - angleDiff);

			if (normalizedDiff < sweepWidth && now - target.lastSweepTime > 500) {
				updated = true;
				return { ...target, lastSweepTime: now };
			}
			return target;
		});

		if (updated) {
			this._targets = newTargets;
		}
	}

	private _startMockScanner() {
		// Generate initial targets
		this._generateMockTargets();

		// Periodically drift targets and occasionally add/remove
		this._mockIntervalId = setInterval(() => {
			this._driftMockTargets();
		}, 500);
	}

	private _stopMockScanner() {
		if (this._mockIntervalId !== null) {
			clearInterval(this._mockIntervalId);
			this._mockIntervalId = null;
		}
	}

	private _generateMockTargets() {
		const count = 5 + Math.floor(Math.random() * 6); // 5-10 targets
		const usedNames = new Set<string>();

		for (let i = 0; i < count; i++) {
			let name: string;
			do {
				name = MOCK_DEVICE_NAMES[Math.floor(Math.random() * MOCK_DEVICE_NAMES.length)];
			} while (usedNames.has(name));
			usedNames.add(name);

			const id = `mock-${name}-${Math.random().toString(36).substring(2, 6)}`;
			const rssi = -30 - Math.random() * 60; // -30 to -90

			this.addTarget(id, rssi, name);
		}
	}

	private _driftMockTargets() {
		// Drift existing targets' RSSI slightly
		this._targets = this._targets.map((target) => {
			const drift = (Math.random() - 0.5) * 4; // +/- 2 dBm
			const newRssi = Math.max(-90, Math.min(-30, target.rssi + drift));
			return { ...target, rssi: newRssi };
		});

		// Occasionally add or remove a target
		if (Math.random() < 0.05 && this._targets.length > 3) {
			// Remove random target
			const index = Math.floor(Math.random() * this._targets.length);
			this._targets = [...this._targets.slice(0, index), ...this._targets.slice(index + 1)];
		} else if (Math.random() < 0.03 && this._targets.length < 12) {
			// Add new target
			const name = MOCK_DEVICE_NAMES[Math.floor(Math.random() * MOCK_DEVICE_NAMES.length)];
			const id = `mock-${name}-${Math.random().toString(36).substring(2, 6)}`;
			const rssi = -30 - Math.random() * 60;
			this.addTarget(id, rssi, name);
		}
	}

	private _getColors() {
		switch (this.colorScheme) {
			case "red":
				return {
					primary: "#ff0000",
					glow: "rgba(255, 0, 0, 0.8)",
					dim: "rgba(255, 0, 0, 0.3)",
					faint: "rgba(255, 0, 0, 0.1)",
					sweep: "rgba(255, 0, 0, 0.4)",
				};
			case "amber":
				return {
					primary: "#ffbf00",
					glow: "rgba(255, 191, 0, 0.8)",
					dim: "rgba(255, 191, 0, 0.3)",
					faint: "rgba(255, 191, 0, 0.1)",
					sweep: "rgba(255, 191, 0, 0.4)",
				};
			default:
				return {
					primary: "#00ff00",
					glow: "rgba(0, 255, 0, 0.8)",
					dim: "rgba(0, 255, 0, 0.3)",
					faint: "rgba(0, 255, 0, 0.1)",
					sweep: "rgba(0, 255, 0, 0.4)",
				};
		}
	}

	private _renderGrid() {
		const colors = this._getColors();
		const center = this.size / 2;
		const maxRadius = center - 10;

		// Ring radii (25%, 50%, 75%, 100%)
		const rings = [0.25, 0.5, 0.75, 1].map((r) => r * maxRadius);

		return svg`
			<!-- Concentric circles -->
			${rings.map(
				(radius) => svg`
				<circle
					cx="${center}"
					cy="${center}"
					r="${radius}"
					fill="none"
					stroke="${colors.dim}"
					stroke-width="1"
				/>
			`,
			)}

			<!-- Crosshairs -->
			<line
				x1="${center}"
				y1="${center - maxRadius}"
				x2="${center}"
				y2="${center + maxRadius}"
				stroke="${colors.dim}"
				stroke-width="1"
			/>
			<line
				x1="${center - maxRadius}"
				y1="${center}"
				x2="${center + maxRadius}"
				y2="${center}"
				stroke="${colors.dim}"
				stroke-width="1"
			/>

			<!-- Diagonal crosshairs -->
			<line
				x1="${center - maxRadius * Math.SQRT1_2}"
				y1="${center - maxRadius * Math.SQRT1_2}"
				x2="${center + maxRadius * Math.SQRT1_2}"
				y2="${center + maxRadius * Math.SQRT1_2}"
				stroke="${colors.faint}"
				stroke-width="1"
			/>
			<line
				x1="${center + maxRadius * Math.SQRT1_2}"
				y1="${center - maxRadius * Math.SQRT1_2}"
				x2="${center - maxRadius * Math.SQRT1_2}"
				y2="${center + maxRadius * Math.SQRT1_2}"
				stroke="${colors.faint}"
				stroke-width="1"
			/>

			<!-- Center dot -->
			<circle
				cx="${center}"
				cy="${center}"
				r="3"
				fill="${colors.primary}"
			/>
		`;
	}

	private _renderSweep() {
		const colors = this._getColors();
		const center = this.size / 2;
		const maxRadius = center - 10;

		// Create a conic gradient effect using a path
		const sweepAngleRad = (this._sweepAngle * Math.PI) / 180;
		const trailLength = 60; // degrees
		const trailAngleRad = ((this._sweepAngle - trailLength) * Math.PI) / 180;

		const x1 = center + maxRadius * Math.cos(sweepAngleRad - Math.PI / 2);
		const y1 = center + maxRadius * Math.sin(sweepAngleRad - Math.PI / 2);
		const x2 = center + maxRadius * Math.cos(trailAngleRad - Math.PI / 2);
		const y2 = center + maxRadius * Math.sin(trailAngleRad - Math.PI / 2);

		// Determine if the arc is greater than 180 degrees
		const largeArc = trailLength > 180 ? 1 : 0;

		return svg`
			<!-- Sweep gradient arc -->
			<defs>
				<linearGradient id="sweepGradient-${this.colorScheme}" gradientUnits="userSpaceOnUse"
					x1="${x2}" y1="${y2}" x2="${x1}" y2="${y1}">
					<stop offset="0%" stop-color="${colors.sweep}" stop-opacity="0"/>
					<stop offset="100%" stop-color="${colors.sweep}" stop-opacity="1"/>
				</linearGradient>
			</defs>

			<path
				d="M ${center} ${center}
				   L ${x2} ${y2}
				   A ${maxRadius} ${maxRadius} 0 ${largeArc} 1 ${x1} ${y1}
				   Z"
				fill="url(#sweepGradient-${this.colorScheme})"
			/>

			<!-- Sweep line -->
			<line
				x1="${center}"
				y1="${center}"
				x2="${x1}"
				y2="${y1}"
				stroke="${colors.primary}"
				stroke-width="2"
				style="filter: drop-shadow(0 0 4px ${colors.glow});"
			/>
		`;
	}

	private _renderBlips() {
		const colors = this._getColors();
		const center = this.size / 2;
		const maxRadius = center - 20; // Slightly smaller to keep blips inside grid
		const now = performance.now();

		return this._targets.map((target) => {
			const radius = rssiToRadius(target.rssi) * maxRadius;
			const angleRad = ((target.angle - 90) * Math.PI) / 180; // -90 to start from top
			const x = center + radius * Math.cos(angleRad);
			const y = center + radius * Math.sin(angleRad);

			// Calculate opacity based on time since last sweep (phosphor fade)
			const timeSinceSweep = now - target.lastSweepTime;
			const fadeTime = this.sweepDuration * 1000; // Full fade over one sweep period
			const opacity = Math.max(0.2, 1 - timeSinceSweep / fadeTime);

			// Blip size based on signal strength (stronger = larger)
			const blipSize = 4 + (1 - rssiToRadius(target.rssi)) * 4;

			return svg`
				<g class="radar-blip" style="cursor: pointer;">
					<!-- Glow effect -->
					<circle
						cx="${x}"
						cy="${y}"
						r="${blipSize + 4}"
						fill="${colors.glow}"
						opacity="${opacity * 0.3}"
						style="filter: blur(4px);"
					/>
					<!-- Main blip -->
					<circle
						cx="${x}"
						cy="${y}"
						r="${blipSize}"
						fill="${colors.primary}"
						opacity="${opacity}"
						style="filter: drop-shadow(0 0 ${opacity * 6}px ${colors.glow});"
					/>
					${
						this.showLabels
							? svg`
						<!-- Label (shown on hover via CSS) -->
						<text
							x="${x}"
							y="${y - blipSize - 8}"
							text-anchor="middle"
							fill="${colors.primary}"
							font-size="10"
							font-family="monospace"
							opacity="${opacity}"
							class="radar-label"
						>
							${target.label}
						</text>
						<text
							x="${x}"
							y="${y - blipSize - 18}"
							text-anchor="middle"
							fill="${colors.dim}"
							font-size="8"
							font-family="monospace"
							opacity="${opacity}"
							class="radar-label"
						>
							${target.rssi.toFixed(0)} dBm
						</text>
					`
							: ""
					}
				</g>
			`;
		});
	}

	override render() {
		const colors = this._getColors();

		return html`
			<style>
				.proximity-radar-container {
					position: relative;
					width: ${this.size}px;
					height: ${this.size}px;
					background: radial-gradient(circle at center, #0a0a0a 0%, #000000 100%);
					border-radius: 50%;
					box-shadow:
						inset 0 0 30px rgba(0, 0, 0, 0.8),
						0 0 20px rgba(0, 0, 0, 0.5),
						0 0 2px ${colors.dim};
					overflow: hidden;
				}

				.proximity-radar-container::before {
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
					border-radius: 50%;
				}

				.proximity-radar-svg {
					position: absolute;
					top: 0;
					left: 0;
					width: 100%;
					height: 100%;
				}

				.radar-label {
					opacity: 0;
					transition: opacity 0.2s ease;
					pointer-events: none;
				}

				.radar-blip:hover .radar-label {
					opacity: 1 !important;
				}

				.radar-stats {
					position: absolute;
					bottom: 8px;
					left: 50%;
					transform: translateX(-50%);
					font-family: monospace;
					font-size: 10px;
					color: ${colors.dim};
					text-transform: uppercase;
					letter-spacing: 1px;
				}

				.radar-title {
					position: absolute;
					top: 8px;
					left: 50%;
					transform: translateX(-50%);
					font-family: monospace;
					font-size: 10px;
					color: ${colors.primary};
					text-transform: uppercase;
					letter-spacing: 2px;
					text-shadow: 0 0 10px ${colors.glow};
				}
			</style>

			<div class="proximity-radar-container">
				<div class="radar-title">PROXIMITY SCAN</div>
				<svg
					class="proximity-radar-svg"
					viewBox="0 0 ${this.size} ${this.size}"
					xmlns="http://www.w3.org/2000/svg"
				>
					${this._renderGrid()}
					${this._renderSweep()}
					${this._renderBlips()}
				</svg>
				<div class="radar-stats">
					${this._targets.length} TARGET${this._targets.length !== 1 ? "S" : ""} DETECTED
				</div>
			</div>
		`;
	}
}

// Guard against duplicate registration
if (!customElements.get("proximity-radar")) {
	customElements.define("proximity-radar", ProximityRadar);
}
