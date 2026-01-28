import { html, LitElement, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// @ts-expect-error lunar-javascript has no types
import { Solar } from "lunar-javascript";

/**
 * Mapping from system action types to lunar calendar keywords (Chinese).
 */
const ACTION_TO_LUNAR_KEYWORD: Record<string, string> = {
	deploy: "开市",
	release: "出火",
	reboot: "动土",
	shutdown: "破屋",
	migrate: "出行",
	backup: "入宅",
	restore: "修造",
	trading: "纳财",
	finance: "纳财",
	invest: "求财",
	purchase: "买车",
	build: "动土",
	construction: "动土",
	init: "上梁",
	start: "开市",
	create: "造屋",
	travel: "出行",
	meeting: "会亲友",
	announce: "开光",
};

export type OracleState = "auspicious" | "ominous" | "neutral";

export interface OracleButtonConfig {
	label: string;
	actionType: string;
	icon?: string;
}

function getLunarContext() {
	const solar = Solar.fromDate(new Date());
	const lunar = solar.getLunar();
	const time = lunar.getTime();
	return {
		dayYi: lunar.getDayYi() as string[],
		dayJi: lunar.getDayJi() as string[],
		timeYi: time.getYi() as string[],
		yearGanZhi: lunar.getYearInGanZhi() as string,
		timeGanZhi: time.getGanZhi() as string,
	};
}

function checkActionState(actionType: string): { state: OracleState } {
	const lunarKeyword = ACTION_TO_LUNAR_KEYWORD[actionType.toLowerCase()];
	if (!lunarKeyword) return { state: "neutral" };
	const context = getLunarContext();
	if (context.timeYi.includes(lunarKeyword) || context.dayYi.includes(lunarKeyword)) {
		return { state: "auspicious" };
	}
	if (context.dayJi.includes(lunarKeyword)) {
		return { state: "ominous" };
	}
	return { state: "neutral" };
}

function stemToElement(stem: string): string {
	const map: Record<string, string> = {
		甲: "WOOD", 乙: "WOOD", 丙: "FIRE", 丁: "FIRE", 戊: "EARTH",
		己: "EARTH", 庚: "METAL", 辛: "METAL", 壬: "WATER", 癸: "WATER",
	};
	return map[stem] || "VOID";
}

function branchToZodiac(branch: string): string {
	const map: Record<string, string> = {
		子: "RAT", 丑: "OX", 寅: "TIGER", 卯: "RABBIT", 辰: "DRAGON", 巳: "SNAKE",
		午: "HORSE", 未: "GOAT", 申: "MONKEY", 酉: "ROOSTER", 戌: "DOG", 亥: "PIG",
	};
	return map[branch] || "VOID";
}

@customElement("oracle-button")
export class OracleButton extends LitElement {
	@property({ type: String }) label = "ACTION";
	@property({ type: String, attribute: "action-type" }) actionType = "deploy";
	@property({ type: Boolean, reflect: true }) disabled = false;

	@state() private _oracleState: OracleState = "neutral";
	@state() private _pressProgress = 0;
	@state() private _isPressing = false;

	private _pressTimer: ReturnType<typeof setInterval> | null = null;
	private _pressStart = 0;
	private readonly DEFY_FATE_DURATION = 2000;
	private _stateInterval: ReturnType<typeof setInterval> | null = null;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
		this._updateOracleState();
		this._stateInterval = setInterval(() => this._updateOracleState(), 60000);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this._stopPressTimer();
		if (this._stateInterval) { clearInterval(this._stateInterval); this._stateInterval = null; }
	}

	private _updateOracleState() {
		this._oracleState = checkActionState(this.actionType).state;
	}

	private _handlePointerDown = (e: PointerEvent) => {
		if (this.disabled) return;
		e.preventDefault();
		this._isPressing = true;
		this._pressStart = performance.now();
		this._pressProgress = 0;
		if (this._oracleState !== "ominous") { this._triggerAction(); return; }
		this._pressTimer = setInterval(() => {
			const elapsed = performance.now() - this._pressStart;
			this._pressProgress = Math.min(100, (elapsed / this.DEFY_FATE_DURATION) * 100);
			if (elapsed >= this.DEFY_FATE_DURATION) { this._stopPressTimer(); this._triggerAction(); }
		}, 16);
	};

	private _handlePointerUp = () => { this._stopPressTimer(); };
	private _handlePointerLeave = () => { this._stopPressTimer(); };

	private _stopPressTimer() {
		this._isPressing = false;
		this._pressProgress = 0;
		if (this._pressTimer) { clearInterval(this._pressTimer); this._pressTimer = null; }
	}

	private _triggerAction() {
		this._stopPressTimer();
		this.dispatchEvent(new CustomEvent("oracle-press", {
			bubbles: true, composed: true,
			detail: { actionType: this.actionType, oracleState: this._oracleState, defiedFate: this._oracleState === "ominous" },
		}));
	}

	private _getStateColors() {
		switch (this._oracleState) {
			case "auspicious": return { border: "#ffd700", glow: "rgba(255, 215, 0, 0.6)", text: "#ffd700", bg: "rgba(255, 215, 0, 0.1)" };
			case "ominous": return { border: "#ff3333", glow: "rgba(255, 51, 51, 0.6)", text: "#ff3333", bg: "rgba(255, 51, 51, 0.1)" };
			default: return { border: "#00ffff", glow: "rgba(0, 255, 255, 0.4)", text: "#00ffff", bg: "rgba(0, 255, 255, 0.05)" };
		}
	}

	private _renderFuluOverlay(): TemplateResult | string {
		if (this._oracleState !== "ominous") return "";
		return svg`<svg class="oracle-fulu-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
			<defs><pattern id="fulu-pattern-${this.actionType}" patternUnits="userSpaceOnUse" width="20" height="20">
				<path d="M2 2 L18 18 M18 2 L2 18" stroke="rgba(255,51,51,0.15)" stroke-width="0.5" fill="none"/>
				<circle cx="10" cy="10" r="3" stroke="rgba(255,51,51,0.1)" stroke-width="0.5" fill="none"/>
			</pattern></defs>
			<rect width="100" height="100" fill="url(#fulu-pattern-${this.actionType})"/>
			<text x="50" y="55" text-anchor="middle" font-size="24" fill="rgba(255,51,51,0.25)" font-family="serif">凶</text>
		</svg>`;
	}

	private _renderProgressRing(): TemplateResult | string {
		if (!this._isPressing || this._oracleState !== "ominous") return "";
		const radius = 45, circumference = 2 * Math.PI * radius;
		const offset = circumference - (this._pressProgress / 100) * circumference;
		return svg`<svg class="oracle-progress-ring" viewBox="0 0 100 100">
			<circle cx="50" cy="50" r="${radius}" stroke="rgba(255,51,51,0.3)" stroke-width="4" fill="none"/>
			<circle cx="50" cy="50" r="${radius}" stroke="#ff3333" stroke-width="4" fill="none"
				stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
				transform="rotate(-90 50 50)" style="transition: stroke-dashoffset 0.05s linear; filter: drop-shadow(0 0 4px #ff3333);"/>
			<text x="50" y="55" text-anchor="middle" font-size="10" fill="#ff3333" font-family="monospace">DEFYING</text>
		</svg>`;
	}

	override render() {
		const colors = this._getStateColors();
		const stateLabel = this._oracleState === "auspicious" ? "YI" : this._oracleState === "ominous" ? "JI" : "---";
		return html`
			<style>
				.oracle-button { position: relative; width: 120px; height: 120px; background: ${colors.bg}; border: 2px solid ${colors.border}; border-radius: 8px; cursor: ${this.disabled ? "not-allowed" : "pointer"}; overflow: hidden; transition: all 0.3s ease; user-select: none; touch-action: none; }
				.oracle-button:not([disabled]):hover { box-shadow: 0 0 20px ${colors.glow}, inset 0 0 20px ${colors.bg}; transform: translateY(-2px); }
				.oracle-button.auspicious { animation: oracle-glow-gold 2s ease-in-out infinite; }
				.oracle-button.ominous { animation: oracle-pulse-red 1.5s ease-in-out infinite; }
				@keyframes oracle-glow-gold { 0%, 100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.3); } 50% { box-shadow: 0 0 25px rgba(255, 215, 0, 0.6), inset 0 0 15px rgba(255, 215, 0, 0.1); } }
				@keyframes oracle-pulse-red { 0%, 100% { box-shadow: 0 0 10px rgba(255, 51, 51, 0.3); } 50% { box-shadow: 0 0 20px rgba(255, 51, 51, 0.5); } }
				.oracle-button-content { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 8px; }
				.oracle-label { font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold; color: ${colors.text}; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px ${colors.glow}; margin-bottom: 8px; }
				.oracle-state { font-family: 'Courier New', monospace; font-size: 10px; color: ${colors.text}; opacity: 0.7; }
				.oracle-state-badge { display: inline-block; padding: 2px 8px; border: 1px solid ${colors.border}; border-radius: 4px; font-size: 9px; margin-top: 4px; }
				.oracle-fulu-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; opacity: 0.8; }
				.oracle-progress-ring { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90px; height: 90px; z-index: 3; pointer-events: none; }
				.oracle-hint { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 7px; color: ${colors.text}; opacity: 0.5; white-space: nowrap; font-family: monospace; }
				.oracle-button::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.1) 2px, rgba(0, 0, 0, 0.1) 4px); pointer-events: none; z-index: 10; }
			</style>
			<div class="oracle-button ${this._oracleState}" ?disabled=${this.disabled} @pointerdown=${this._handlePointerDown} @pointerup=${this._handlePointerUp} @pointerleave=${this._handlePointerLeave} @pointercancel=${this._handlePointerLeave}>
				${this._renderFuluOverlay()}
				<div class="oracle-button-content"><span class="oracle-label">${this.label}</span><span class="oracle-state">${stateLabel}</span><span class="oracle-state-badge">${this._oracleState.toUpperCase()}</span></div>
				${this._renderProgressRing()}
				${this._oracleState === "ominous" ? html`<span class="oracle-hint">HOLD 2s TO DEFY FATE</span>` : ""}
			</div>`;
	}
}

@customElement("oracle-launchpad")
export class OracleLaunchpad extends LitElement {
	@property({ type: Array }) buttons: OracleButtonConfig[] = [
		{ label: "DEPLOY", actionType: "deploy" }, { label: "RELEASE", actionType: "release" },
		{ label: "REBOOT", actionType: "reboot" }, { label: "BACKUP", actionType: "backup" },
		{ label: "MIGRATE", actionType: "migrate" }, { label: "BUILD", actionType: "build" },
	];

	@state() private _cycleInfo = "";
	@state() private _hourElement = "";
	private _updateInterval: ReturnType<typeof setInterval> | null = null;

	override createRenderRoot() { return this; }

	override connectedCallback() {
		super.connectedCallback();
		this._updateLunarInfo();
		this._updateInterval = setInterval(() => this._updateLunarInfo(), 60000);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		if (this._updateInterval) { clearInterval(this._updateInterval); this._updateInterval = null; }
	}

	private _updateLunarInfo() {
		const context = getLunarContext();
		this._cycleInfo = `${stemToElement(context.yearGanZhi[0])} ${branchToZodiac(context.yearGanZhi[1])}`;
		this._hourElement = stemToElement(context.timeGanZhi[0]);
	}

	override render() {
		return html`
			<style>
				.oracle-launchpad { display: flex; flex-direction: column; padding: 16px; background: linear-gradient(135deg, #0a0a0f 0%, #151520 100%); border: 1px solid #333; border-radius: 12px; min-width: 400px; }
				.oracle-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #333; }
				.oracle-title { font-family: 'Courier New', monospace; font-size: 16px; font-weight: bold; color: #00ffff; text-transform: uppercase; letter-spacing: 4px; text-shadow: 0 0 10px rgba(0, 255, 255, 0.5); }
				.oracle-subtitle { font-family: serif; font-size: 12px; color: #666; letter-spacing: 2px; }
				.oracle-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
				.oracle-footer { display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #222; font-family: monospace; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
				.oracle-cycle { color: #ffd700; text-shadow: 0 0 5px rgba(255, 215, 0, 0.3); }
				.oracle-hour { color: #ff6600; text-shadow: 0 0 5px rgba(255, 102, 0, 0.3); }
			</style>
			<div class="oracle-launchpad" style="position: relative;">
				<div class="oracle-header"><div><div class="oracle-title">ORACLE LAUNCHPAD</div><div class="oracle-subtitle">HUANGLI INTEGRATED CONTROL</div></div></div>
				<div class="oracle-grid">${this.buttons.map((btn) => html`<oracle-button label=${btn.label} action-type=${btn.actionType}></oracle-button>`)}</div>
				<div class="oracle-footer"><span>CYCLE: <span class="oracle-cycle">${this._cycleInfo}</span></span><span>HOUR: <span class="oracle-hour">${this._hourElement}</span></span></div>
			</div>`;
	}
}

if (!customElements.get("oracle-button")) { customElements.define("oracle-button", OracleButton); }
if (!customElements.get("oracle-launchpad")) { customElements.define("oracle-launchpad", OracleLaunchpad); }
