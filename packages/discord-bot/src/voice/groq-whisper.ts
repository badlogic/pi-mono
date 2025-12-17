/**
 * Groq Whisper STT Integration
 * Ultra-fast speech-to-text transcription
 */

import type { STTResult } from "./types.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo"; // Fast and accurate

export class GroqWhisperSTT {
	private apiKey: string;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.GROQ_API_KEY || "";
	}

	get isConfigured(): boolean {
		return this.apiKey.length > 0;
	}

	/**
	 * Transcribe audio buffer to text
	 */
	async transcribe(
		audioBuffer: Buffer,
		options: {
			model?: string;
			language?: string;
			prompt?: string;
			responseFormat?: "json" | "text" | "verbose_json";
		} = {},
	): Promise<STTResult> {
		if (!this.isConfigured) {
			throw new Error("Groq API key not configured");
		}

		const formData = new FormData();

		// Convert buffer to blob for FormData
		const uint8Array = new Uint8Array(audioBuffer);
		const blob = new Blob([uint8Array], { type: "audio/ogg" });
		formData.append("file", blob, "audio.ogg");
		formData.append("model", options.model || DEFAULT_MODEL);

		if (options.language) {
			formData.append("language", options.language);
		}

		if (options.prompt) {
			formData.append("prompt", options.prompt);
		}

		formData.append("response_format", options.responseFormat || "verbose_json");

		const startTime = Date.now();

		const response = await fetch(GROQ_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: formData,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Groq API error: ${response.status} - ${error}`);
		}

		const data = await response.json();
		const duration = Date.now() - startTime;

		return {
			text: data.text || "",
			duration,
			language: data.language,
			confidence: this.extractConfidence(data),
		};
	}

	/**
	 * Transcribe from file path
	 */
	async transcribeFile(
		filePath: string,
		options: {
			model?: string;
			language?: string;
			prompt?: string;
		} = {},
	): Promise<STTResult> {
		const { readFile } = await import("node:fs/promises");
		const audioBuffer = await readFile(filePath);
		return this.transcribe(audioBuffer, options);
	}

	/**
	 * Extract confidence from verbose response
	 */
	private extractConfidence(data: any): number | undefined {
		if (data.segments && data.segments.length > 0) {
			// Average confidence across segments
			const totalConfidence = data.segments.reduce((sum: number, seg: any) => sum + (seg.avg_logprob || 0), 0);
			// Convert log prob to percentage (rough approximation)
			const avgLogProb = totalConfidence / data.segments.length;
			return Math.min(1, Math.max(0, Math.exp(avgLogProb)));
		}
		return undefined;
	}

	/**
	 * Get supported languages
	 */
	getSupportedLanguages(): string[] {
		// Whisper supports many languages
		return [
			"en",
			"es",
			"fr",
			"de",
			"it",
			"pt",
			"nl",
			"pl",
			"ru",
			"ja",
			"ko",
			"zh",
			"ar",
			"tr",
			"vi",
			"th",
			"id",
			"ms",
			"hi",
			"bn",
			"ta",
			"te",
			"ur",
			"fa",
			"he",
			"el",
			"cs",
			"sk",
			"hu",
			"ro",
			"bg",
			"uk",
			"hr",
			"sr",
			"sl",
			"et",
			"lv",
			"lt",
			"fi",
			"sv",
			"no",
			"da",
			"is",
			"cy",
			"ga",
			"mt",
			"lb",
			"eu",
			"ca",
			"gl",
			"ast",
			"oc",
			"br",
			"co",
			"sc",
			"fy",
			"gd",
			"kw",
			"gv",
			"la",
		];
	}
}

// Singleton instance
let sttInstance: GroqWhisperSTT | null = null;

export function getGroqWhisperSTT(): GroqWhisperSTT {
	if (!sttInstance) {
		sttInstance = new GroqWhisperSTT();
	}
	return sttInstance;
}
