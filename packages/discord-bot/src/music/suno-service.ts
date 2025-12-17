/**
 * Suno API Service (sunoapi.org)
 * AI Music Generation via third-party API
 *
 * Features:
 * - Generate music from prompts (with or without lyrics)
 * - Custom mode with style, title, lyrics
 * - Multiple model versions (V4, V4.5, V5)
 * - Polling for generation status
 * - Download audio URLs
 */

const SUNO_API_BASE = "https://api.sunoapi.org";

export type SunoModel = "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5";

export type SunoStatus =
	| "PENDING"
	| "TEXT_SUCCESS"
	| "FIRST_SUCCESS"
	| "SUCCESS"
	| "CREATE_TASK_FAILED"
	| "GENERATE_AUDIO_FAILED"
	| "CALLBACK_EXCEPTION"
	| "SENSITIVE_WORD_ERROR";

export interface SunoGenerateOptions {
	prompt: string;
	style?: string;
	title?: string;
	instrumental?: boolean;
	model?: SunoModel;
	customMode?: boolean;
	negativeTags?: string;
	vocalGender?: "m" | "f";
}

export interface SunoTrack {
	id: string;
	audioUrl: string;
	streamAudioUrl: string;
	imageUrl: string;
	prompt: string;
	modelName: string;
	title: string;
	tags: string;
	createTime: string;
	duration: number;
}

export interface SunoTaskResult {
	taskId: string;
	status: SunoStatus;
	tracks: SunoTrack[];
	error?: string;
}

export interface SunoCredits {
	remaining: number;
	total: number;
}

class SunoService {
	private apiKey: string | null;

	constructor() {
		this.apiKey = process.env.SUNO_API_KEY || null;
	}

	isAvailable(): boolean {
		return this.apiKey !== null && this.apiKey.length > 0;
	}

	private async request<T>(method: "GET" | "POST", endpoint: string, body?: Record<string, unknown>): Promise<T> {
		if (!this.apiKey) {
			throw new Error("SUNO_API_KEY not configured");
		}

		const url = `${SUNO_API_BASE}${endpoint}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};

		const options: RequestInit = {
			method,
			headers,
		};

		if (body && method === "POST") {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);
		const data = (await response.json()) as { code: number; msg: string; data: T };

		if (data.code !== 200) {
			throw new Error(`Suno API error (${data.code}): ${data.msg}`);
		}

		return data.data;
	}

	/**
	 * Generate music from a prompt
	 * Returns 2 tracks per request
	 */
	async generate(options: SunoGenerateOptions): Promise<{ taskId: string }> {
		const {
			prompt,
			style = "",
			title = "",
			instrumental = false,
			model = "V4_5ALL",
			customMode = false,
			negativeTags,
			vocalGender,
		} = options;

		const body: Record<string, unknown> = {
			customMode,
			instrumental,
			model,
			prompt,
			callBackUrl: "", // We'll poll instead
		};

		// Custom mode requires style and title
		if (customMode) {
			body.style = style;
			body.title = title;
		}

		if (negativeTags) {
			body.negativeTags = negativeTags;
		}

		if (vocalGender) {
			body.vocalGender = vocalGender;
		}

		return this.request<{ taskId: string }>("POST", "/api/v1/generate", body);
	}

	/**
	 * Simple generation mode - just provide a prompt, AI handles the rest
	 */
	async generateSimple(prompt: string, instrumental = false): Promise<{ taskId: string }> {
		return this.generate({
			prompt,
			instrumental,
			customMode: false,
			model: "V4_5ALL",
		});
	}

	/**
	 * Custom generation with full control over style and lyrics
	 */
	async generateCustom(
		lyrics: string,
		style: string,
		title: string,
		model: SunoModel = "V4_5ALL",
	): Promise<{ taskId: string }> {
		return this.generate({
			prompt: lyrics,
			style,
			title,
			instrumental: false,
			customMode: true,
			model,
		});
	}

	/**
	 * Generate instrumental track
	 */
	async generateInstrumental(style: string, title: string, model: SunoModel = "V4_5ALL"): Promise<{ taskId: string }> {
		return this.generate({
			prompt: "",
			style,
			title,
			instrumental: true,
			customMode: true,
			model,
		});
	}

	/**
	 * Check generation status and get results
	 */
	async getStatus(taskId: string): Promise<SunoTaskResult> {
		const data = await this.request<{
			taskId: string;
			status: SunoStatus;
			response?: {
				sunoData?: SunoTrack[];
			};
			errorMessage?: string;
		}>("GET", `/api/v1/generate/record-info?taskId=${taskId}`);

		return {
			taskId: data.taskId,
			status: data.status,
			tracks: data.response?.sunoData || [],
			error: data.errorMessage || undefined,
		};
	}

	/**
	 * Poll for completion with timeout
	 */
	async waitForCompletion(taskId: string, timeoutMs = 300000, pollIntervalMs = 5000): Promise<SunoTaskResult> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const result = await this.getStatus(taskId);

			if (result.status === "SUCCESS") {
				return result;
			}

			if (result.status === "FIRST_SUCCESS") {
				// First track ready, but we can wait for both
				console.log("[SUNO] First track ready, waiting for second...");
			}

			if (
				result.status === "CREATE_TASK_FAILED" ||
				result.status === "GENERATE_AUDIO_FAILED" ||
				result.status === "SENSITIVE_WORD_ERROR"
			) {
				throw new Error(`Generation failed: ${result.status} - ${result.error || "Unknown error"}`);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}

		throw new Error("Generation timed out");
	}

	/**
	 * Get remaining credits
	 */
	async getCredits(): Promise<SunoCredits> {
		const data = await this.request<{ credit: number; totalCredit: number }>("GET", "/api/v1/generate/credit");

		return {
			remaining: data.credit,
			total: data.totalCredit,
		};
	}

	/**
	 * Generate and wait for results (convenience method)
	 */
	async generateAndWait(
		options: SunoGenerateOptions,
		timeoutMs = 300000,
	): Promise<{ taskId: string; tracks: SunoTrack[] }> {
		const { taskId } = await this.generate(options);
		const result = await this.waitForCompletion(taskId, timeoutMs);
		return { taskId, tracks: result.tracks };
	}
}

// Singleton instance
export const sunoService = new SunoService();

// Helper for formatting track info
export function formatTrackInfo(track: SunoTrack): string {
	const duration = Math.round(track.duration);
	const minutes = Math.floor(duration / 60);
	const seconds = duration % 60;
	const durationStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

	return [`**${track.title}**`, `Style: ${track.tags}`, `Duration: ${durationStr}`, `Model: ${track.modelName}`].join(
		"\n",
	);
}

// Status descriptions for user display
export const STATUS_DESCRIPTIONS: Record<SunoStatus, string> = {
	PENDING: "Queued for generation...",
	TEXT_SUCCESS: "Lyrics generated, creating audio...",
	FIRST_SUCCESS: "First track ready!",
	SUCCESS: "All tracks ready!",
	CREATE_TASK_FAILED: "Failed to create task",
	GENERATE_AUDIO_FAILED: "Audio generation failed",
	CALLBACK_EXCEPTION: "Callback error",
	SENSITIVE_WORD_ERROR: "Content flagged - please revise prompt",
};

export default sunoService;
