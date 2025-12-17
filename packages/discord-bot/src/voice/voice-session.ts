/**
 * Voice Session Manager
 * Handles Discord voice channel connections and audio streaming
 */

import { Readable } from "node:stream";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	type AudioReceiveStream,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import type { VoiceConfig, VoiceSessionState } from "./types.js";
import { getVibeVoiceTTS } from "./vibevoice.js";
import { getWhisperLocalSTT } from "./whisper-local.js";

const DEFAULT_CONFIG: VoiceConfig = {
	enabled: true,
	defaultVoiceId: "21m00Tcm4TlvDq8ikWAM",
	defaultModel: "eleven_turbo_v2_5",
	maxSessionDuration: 30 * 60 * 1000, // 30 minutes
	silenceTimeout: 2000, // 2 seconds of silence before processing
};

export class VoiceSession {
	private config: VoiceConfig;
	private connection: VoiceConnection | null = null;
	private player: AudioPlayer | null = null;
	private state: VoiceSessionState | null = null;
	private audioChunks: Map<string, Buffer[]> = new Map();
	private silenceTimers: Map<string, NodeJS.Timeout> = new Map();
	private messageHandler: ((userId: string, text: string) => Promise<string>) | null = null;
	private sessionTimeout: NodeJS.Timeout | null = null;

	constructor(config: Partial<VoiceConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	get isConnected(): boolean {
		return this.connection !== null && this.state !== null;
	}

	get isEnabled(): boolean {
		const tts = getVibeVoiceTTS();
		const stt = getWhisperLocalSTT();
		return this.config.enabled && (tts.isConfigured || stt.isConfigured);
	}

	/**
	 * Set message handler for processing transcribed speech
	 */
	setMessageHandler(handler: (userId: string, text: string) => Promise<string>): void {
		this.messageHandler = handler;
	}

	/**
	 * Join a voice channel
	 */
	async join(channel: VoiceChannel, userId: string): Promise<{ success: boolean; error?: string }> {
		if (!this.isEnabled) {
			return {
				success: false,
				error: "Voice mode not configured. Set HF_TOKEN for HuggingFace API or install local Whisper.",
			};
		}

		try {
			// Leave existing connection if any
			if (this.connection) {
				await this.leave();
			}

			// Join the voice channel
			this.connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: channel.guild.id,
				adapterCreator: channel.guild.voiceAdapterCreator,
				selfDeaf: false,
				selfMute: false,
			});

			// Wait for connection to be ready
			await entersState(this.connection, VoiceConnectionStatus.Ready, 10000);

			// Create audio player
			this.player = createAudioPlayer();
			this.connection.subscribe(this.player);

			// Set up state
			this.state = {
				guildId: channel.guild.id,
				channelId: channel.id,
				userId,
				isListening: true,
				isSpeaking: false,
				startedAt: Date.now(),
				lastActivity: Date.now(),
			};

			// Set up audio receiver
			this.setupAudioReceiver();

			// Set up session timeout
			this.sessionTimeout = setTimeout(() => {
				this.leave();
			}, this.config.maxSessionDuration);

			// Handle disconnection
			this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
				try {
					await Promise.race([
						entersState(this.connection!, VoiceConnectionStatus.Signalling, 5000),
						entersState(this.connection!, VoiceConnectionStatus.Connecting, 5000),
					]);
				} catch {
					this.connection?.destroy();
					this.cleanup();
				}
			});

			console.log(`[Voice] Joined channel ${channel.name} in ${channel.guild.name}`);

			return { success: true };
		} catch (error) {
			console.error("[Voice] Failed to join channel:", error);
			this.cleanup();
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to join voice channel",
			};
		}
	}

	/**
	 * Leave the voice channel
	 */
	async leave(): Promise<void> {
		if (this.connection) {
			this.connection.destroy();
		}
		this.cleanup();
		console.log("[Voice] Left voice channel");
	}

	/**
	 * Speak text using TTS
	 */
	async speak(text: string): Promise<void> {
		if (!this.isConnected || !this.player) {
			throw new Error("Not connected to a voice channel");
		}

		if (this.state) {
			this.state.isSpeaking = true;
			this.state.lastActivity = Date.now();
		}

		try {
			const tts = getVibeVoiceTTS();
			const audioBuffer = await tts.synthesize(text);

			// Create audio resource from buffer
			const stream = Readable.from(audioBuffer);
			const resource = createAudioResource(stream);

			// Play audio
			this.player.play(resource);

			// Wait for audio to finish
			await new Promise<void>((resolve, reject) => {
				this.player!.once(AudioPlayerStatus.Idle, () => resolve());
				this.player!.once("error", reject);
			});
		} finally {
			if (this.state) {
				this.state.isSpeaking = false;
			}
		}
	}

	/**
	 * Set up audio receiver for STT
	 */
	private setupAudioReceiver(): void {
		if (!this.connection) return;

		const receiver = this.connection.receiver;

		receiver.speaking.on("start", (userId) => {
			if (!this.state?.isListening || this.state?.isSpeaking) return;

			// Clear any existing silence timer
			const existingTimer = this.silenceTimers.get(userId);
			if (existingTimer) {
				clearTimeout(existingTimer);
				this.silenceTimers.delete(userId);
			}

			// Start collecting audio
			const audioStream = receiver.subscribe(userId, {
				end: {
					behavior: 1, // EndBehaviorType.AfterSilence
					duration: this.config.silenceTimeout,
				},
			});

			this.collectAudio(userId, audioStream);
		});

		receiver.speaking.on("end", (userId) => {
			// Set timer to process audio after silence
			const timer = setTimeout(() => {
				this.processAudio(userId);
			}, this.config.silenceTimeout);

			this.silenceTimers.set(userId, timer);
		});
	}

	/**
	 * Collect audio chunks from user
	 */
	private collectAudio(userId: string, stream: AudioReceiveStream): void {
		const chunks: Buffer[] = [];

		stream.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		stream.on("end", () => {
			const existing = this.audioChunks.get(userId) || [];
			this.audioChunks.set(userId, [...existing, ...chunks]);
		});

		stream.on("error", (error) => {
			console.error(`[Voice] Audio stream error for ${userId}:`, error);
		});
	}

	/**
	 * Process collected audio
	 */
	private async processAudio(userId: string): Promise<void> {
		const chunks = this.audioChunks.get(userId);
		if (!chunks || chunks.length === 0) return;

		// Clear collected chunks
		this.audioChunks.delete(userId);

		try {
			// Concatenate audio chunks
			const audioBuffer = Buffer.concat(chunks);

			// Skip if too short (likely noise)
			if (audioBuffer.length < 1000) return;

			// Transcribe
			const stt = getWhisperLocalSTT();
			const result = await stt.transcribe(audioBuffer);

			// Skip empty or very short transcriptions
			if (!result.text || result.text.trim().length < 2) return;

			console.log(`[Voice] Transcribed from ${userId}: "${result.text}"`);

			// Update activity
			if (this.state) {
				this.state.lastActivity = Date.now();
			}

			// Process message if handler is set
			if (this.messageHandler) {
				const response = await this.messageHandler(userId, result.text);
				if (response) {
					await this.speak(response);
				}
			}
		} catch (error) {
			console.error(`[Voice] Failed to process audio for ${userId}:`, error);
		}
	}

	/**
	 * Cleanup resources
	 */
	private cleanup(): void {
		// Clear timers
		for (const timer of this.silenceTimers.values()) {
			clearTimeout(timer);
		}
		this.silenceTimers.clear();

		if (this.sessionTimeout) {
			clearTimeout(this.sessionTimeout);
			this.sessionTimeout = null;
		}

		// Clear audio chunks
		this.audioChunks.clear();

		// Reset state
		this.connection = null;
		this.player = null;
		this.state = null;
	}

	/**
	 * Get current session state
	 */
	getState(): VoiceSessionState | null {
		return this.state ? { ...this.state } : null;
	}

	/**
	 * Get session stats
	 */
	getStats(): {
		connected: boolean;
		duration: number;
		guildId?: string;
		channelId?: string;
	} {
		if (!this.state) {
			return { connected: false, duration: 0 };
		}

		return {
			connected: true,
			duration: Date.now() - this.state.startedAt,
			guildId: this.state.guildId,
			channelId: this.state.channelId,
		};
	}
}

// Session manager - one session per guild
const sessions: Map<string, VoiceSession> = new Map();

export function getVoiceSession(guildId: string): VoiceSession {
	let session = sessions.get(guildId);
	if (!session) {
		session = new VoiceSession();
		sessions.set(guildId, session);
	}
	return session;
}

export function getAllVoiceSessions(): Map<string, VoiceSession> {
	return sessions;
}

export function removeVoiceSession(guildId: string): void {
	const session = sessions.get(guildId);
	if (session) {
		session.leave();
		sessions.delete(guildId);
	}
}
