/**
 * VibeVoice TTS Integration
 * Microsoft's open-source text-to-speech model
 * Uses HuggingFace Inference API or local transformers
 */

import type { TTSOptions } from "./types.js";

const HF_INFERENCE_URL = "https://api-inference.huggingface.co/models/microsoft/VibeVoice-Realtime-0.5B";
const FALLBACK_MODEL = "facebook/mms-tts-eng"; // Fallback TTS if VibeVoice unavailable

export class VibeVoiceTTS {
	private hfToken: string;
	private useVibeVoice: boolean = true;

	constructor(hfToken?: string) {
		this.hfToken = hfToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "";
	}

	get isConfigured(): boolean {
		return this.hfToken.length > 0;
	}

	/**
	 * Generate speech from text using VibeVoice
	 */
	async synthesize(text: string, options: TTSOptions = {}): Promise<Buffer> {
		if (!this.isConfigured) {
			throw new Error("HuggingFace token not configured. Set HF_TOKEN environment variable.");
		}

		// Try VibeVoice first, fallback to MMS-TTS
		const modelUrl = this.useVibeVoice
			? HF_INFERENCE_URL
			: `https://api-inference.huggingface.co/models/${FALLBACK_MODEL}`;

		try {
			const response = await fetch(modelUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.hfToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					inputs: text,
					options: {
						wait_for_model: true,
					},
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();

				// If VibeVoice fails, try fallback
				if (this.useVibeVoice && response.status === 503) {
					console.log("[VibeVoice] Model loading, trying fallback MMS-TTS...");
					this.useVibeVoice = false;
					return this.synthesize(text, options);
				}

				throw new Error(`HuggingFace API error: ${response.status} - ${errorText}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer);
		} catch (error) {
			// Try fallback on any error
			if (this.useVibeVoice) {
				console.log("[VibeVoice] Error, trying fallback MMS-TTS...");
				this.useVibeVoice = false;
				return this.synthesize(text, options);
			}
			throw error;
		}
	}

	/**
	 * Check if VibeVoice model is available
	 */
	async checkAvailability(): Promise<{ available: boolean; model: string }> {
		if (!this.isConfigured) {
			return { available: false, model: "none" };
		}

		try {
			const response = await fetch(HF_INFERENCE_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.hfToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					inputs: "test",
					options: { wait_for_model: false },
				}),
			});

			if (response.ok || response.status === 503) {
				return { available: true, model: "microsoft/VibeVoice-Realtime-0.5B" };
			}

			return { available: true, model: FALLBACK_MODEL };
		} catch {
			return { available: false, model: "none" };
		}
	}

	/**
	 * Get model info
	 */
	getModelInfo(): { name: string; description: string; languages: string[] } {
		return {
			name: "VibeVoice-Realtime-0.5B",
			description: "Microsoft's open-source real-time TTS (~300ms latency)",
			languages: ["en", "de", "fr", "it", "ja", "ko", "nl", "pl", "pt", "es"],
		};
	}
}

// Singleton instance
let ttsInstance: VibeVoiceTTS | null = null;

export function getVibeVoiceTTS(): VibeVoiceTTS {
	if (!ttsInstance) {
		ttsInstance = new VibeVoiceTTS();
	}
	return ttsInstance;
}
