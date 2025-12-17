/**
 * Local Whisper STT Integration
 * Uses whisper.cpp or faster-whisper for open-source transcription
 * Falls back to HuggingFace Inference API if local not available
 */

import { spawn } from "child_process";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { STTResult } from "./types.js";

const HF_WHISPER_URL = "https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo";

export class WhisperLocalSTT {
	private hfToken: string;
	private whisperPath: string | null = null;
	private useLocal: boolean = false;

	constructor(hfToken?: string) {
		this.hfToken = hfToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "";
		this.detectLocalWhisper();
	}

	get isConfigured(): boolean {
		return this.useLocal || this.hfToken.length > 0;
	}

	/**
	 * Detect if whisper.cpp or faster-whisper is available locally
	 */
	private async detectLocalWhisper(): Promise<void> {
		// Check for whisper.cpp
		try {
			const result = await this.runCommand("which", ["whisper-cpp"]);
			if (result.exitCode === 0) {
				this.whisperPath = result.stdout.trim();
				this.useLocal = true;
				console.log("[Whisper] Found local whisper-cpp");
				return;
			}
		} catch {
			/* ignore - checking availability */
		}

		// Check for faster-whisper Python
		try {
			const result = await this.runCommand("python3", ["-c", "import faster_whisper; print('ok')"]);
			if (result.exitCode === 0 && result.stdout.includes("ok")) {
				this.whisperPath = "faster-whisper";
				this.useLocal = true;
				console.log("[Whisper] Found local faster-whisper");
				return;
			}
		} catch {
			/* ignore - checking availability */
		}

		// Check for openai-whisper Python
		try {
			const result = await this.runCommand("python3", ["-c", "import whisper; print('ok')"]);
			if (result.exitCode === 0 && result.stdout.includes("ok")) {
				this.whisperPath = "openai-whisper";
				this.useLocal = true;
				console.log("[Whisper] Found local openai-whisper");
				return;
			}
		} catch {
			/* ignore - checking availability */
		}

		console.log("[Whisper] No local Whisper found, using HuggingFace API");
	}

	/**
	 * Transcribe audio buffer to text
	 */
	async transcribe(
		audioBuffer: Buffer,
		options: {
			language?: string;
			prompt?: string;
		} = {},
	): Promise<STTResult> {
		const startTime = Date.now();

		if (this.useLocal && this.whisperPath) {
			return this.transcribeLocal(audioBuffer, options, startTime);
		}

		return this.transcribeHuggingFace(audioBuffer, options, startTime);
	}

	/**
	 * Transcribe using local Whisper
	 */
	private async transcribeLocal(
		audioBuffer: Buffer,
		options: { language?: string; prompt?: string },
		startTime: number,
	): Promise<STTResult> {
		// Write audio to temp file
		const tempPath = join(tmpdir(), `whisper_${Date.now()}.wav`);

		try {
			await writeFile(tempPath, audioBuffer);

			let result: { stdout: string; exitCode: number };

			if (this.whisperPath === "faster-whisper") {
				// Use faster-whisper Python script
				const script = `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, info = model.transcribe("${tempPath}", language="${options.language || "en"}")
for segment in segments:
    print(segment.text)
`;
				result = await this.runCommand("python3", ["-c", script]);
			} else if (this.whisperPath === "openai-whisper") {
				// Use openai-whisper
				const script = `
import whisper
model = whisper.load_model("small")
result = model.transcribe("${tempPath}", language="${options.language || "en"}")
print(result["text"])
`;
				result = await this.runCommand("python3", ["-c", script]);
			} else {
				// Use whisper.cpp CLI
				result = await this.runCommand(this.whisperPath!, [
					"-f",
					tempPath,
					"-l",
					options.language || "en",
					"--output-txt",
				]);
			}

			const duration = Date.now() - startTime;

			return {
				text: result.stdout.trim(),
				duration,
				language: options.language || "en",
			};
		} finally {
			// Cleanup temp file
			try {
				await unlink(tempPath);
			} catch {
				/* ignore - cleanup */
			}
		}
	}

	/**
	 * Transcribe using HuggingFace Inference API
	 */
	private async transcribeHuggingFace(
		audioBuffer: Buffer,
		options: { language?: string; prompt?: string },
		startTime: number,
	): Promise<STTResult> {
		if (!this.hfToken) {
			throw new Error("HuggingFace token not configured and no local Whisper available");
		}

		const response = await fetch(HF_WHISPER_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.hfToken}`,
				"Content-Type": "audio/wav",
			},
			body: new Uint8Array(audioBuffer),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
		}

		const data = await response.json();
		const duration = Date.now() - startTime;

		return {
			text: data.text || "",
			duration,
			language: options.language || "auto",
		};
	}

	/**
	 * Helper to run shell commands
	 */
	private runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve, reject) => {
			const proc = spawn(cmd, args, { shell: false });
			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				resolve({ stdout, stderr, exitCode: code || 0 });
			});

			proc.on("error", (err) => {
				reject(err);
			});

			// Timeout after 60 seconds
			setTimeout(() => {
				proc.kill();
				reject(new Error("Whisper transcription timeout"));
			}, 60000);
		});
	}

	/**
	 * Get backend info
	 */
	getBackendInfo(): { type: string; model: string } {
		if (this.useLocal) {
			return {
				type: "local",
				model: this.whisperPath || "unknown",
			};
		}
		return {
			type: "huggingface",
			model: "openai/whisper-large-v3-turbo",
		};
	}
}

// Singleton instance
let sttInstance: WhisperLocalSTT | null = null;

export function getWhisperLocalSTT(): WhisperLocalSTT {
	if (!sttInstance) {
		sttInstance = new WhisperLocalSTT();
	}
	return sttInstance;
}
