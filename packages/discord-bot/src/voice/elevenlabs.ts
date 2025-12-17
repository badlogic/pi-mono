/**
 * ElevenLabs TTS Integration
 * High-quality text-to-speech synthesis
 */

import type { ElevenLabsVoice, TTSOptions } from "./types.js";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel - conversational
const DEFAULT_MODEL = "eleven_turbo_v2_5"; // Fast, high quality

export class ElevenLabsTTS {
	private apiKey: string;
	private baseUrl = "https://api.elevenlabs.io/v1";
	private voiceCache: Map<string, ElevenLabsVoice> = new Map();

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || "";
	}

	get isConfigured(): boolean {
		return this.apiKey.length > 0;
	}

	/**
	 * Generate speech from text
	 */
	async synthesize(text: string, options: TTSOptions = {}): Promise<Buffer> {
		if (!this.isConfigured) {
			throw new Error("ElevenLabs API key not configured");
		}

		const voiceId = options.voiceId || DEFAULT_VOICE_ID;
		const model = options.model || DEFAULT_MODEL;

		const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
			method: "POST",
			headers: {
				"xi-api-key": this.apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify({
				text,
				model_id: model,
				voice_settings: {
					stability: options.stability ?? 0.5,
					similarity_boost: options.similarityBoost ?? 0.75,
					style: options.style ?? 0.5,
					use_speaker_boost: options.useSpeakerBoost ?? true,
				},
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}

	/**
	 * Stream speech generation
	 */
	async synthesizeStream(text: string, options: TTSOptions = {}): Promise<ReadableStream<Uint8Array>> {
		if (!this.isConfigured) {
			throw new Error("ElevenLabs API key not configured");
		}

		const voiceId = options.voiceId || DEFAULT_VOICE_ID;
		const model = options.model || DEFAULT_MODEL;

		const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}/stream`, {
			method: "POST",
			headers: {
				"xi-api-key": this.apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify({
				text,
				model_id: model,
				voice_settings: {
					stability: options.stability ?? 0.5,
					similarity_boost: options.similarityBoost ?? 0.75,
					style: options.style ?? 0.5,
					use_speaker_boost: options.useSpeakerBoost ?? true,
				},
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`ElevenLabs streaming error: ${response.status} - ${error}`);
		}

		if (!response.body) {
			throw new Error("No response body for streaming");
		}

		return response.body;
	}

	/**
	 * Get available voices
	 */
	async getVoices(): Promise<ElevenLabsVoice[]> {
		if (!this.isConfigured) {
			throw new Error("ElevenLabs API key not configured");
		}

		const response = await fetch(`${this.baseUrl}/voices`, {
			headers: {
				"xi-api-key": this.apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch voices: ${response.status}`);
		}

		const data = await response.json();
		const voices = data.voices as ElevenLabsVoice[];

		// Cache voices
		for (const voice of voices) {
			this.voiceCache.set(voice.voice_id, voice);
		}

		return voices;
	}

	/**
	 * Get voice by ID
	 */
	async getVoice(voiceId: string): Promise<ElevenLabsVoice | null> {
		if (this.voiceCache.has(voiceId)) {
			return this.voiceCache.get(voiceId)!;
		}

		try {
			const voices = await this.getVoices();
			return voices.find((v) => v.voice_id === voiceId) || null;
		} catch {
			return null;
		}
	}

	/**
	 * Get subscription info (quota remaining)
	 */
	async getSubscriptionInfo(): Promise<{
		characterCount: number;
		characterLimit: number;
		remainingCharacters: number;
	}> {
		if (!this.isConfigured) {
			throw new Error("ElevenLabs API key not configured");
		}

		const response = await fetch(`${this.baseUrl}/user/subscription`, {
			headers: {
				"xi-api-key": this.apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch subscription: ${response.status}`);
		}

		const data = await response.json();
		return {
			characterCount: data.character_count,
			characterLimit: data.character_limit,
			remainingCharacters: data.character_limit - data.character_count,
		};
	}
}

// Singleton instance
let ttsInstance: ElevenLabsTTS | null = null;

export function getElevenLabsTTS(): ElevenLabsTTS {
	if (!ttsInstance) {
		ttsInstance = new ElevenLabsTTS();
	}
	return ttsInstance;
}
