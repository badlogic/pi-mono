/**
 * Voice Module Types
 * ElevenLabs TTS + Groq Whisper STT integration
 */

export interface VoiceConfig {
	enabled: boolean;
	elevenLabsApiKey?: string;
	groqApiKey?: string;
	defaultVoiceId: string;
	defaultModel: string;
	maxSessionDuration: number; // ms
	silenceTimeout: number; // ms to wait before processing
}

export interface TTSOptions {
	voiceId?: string;
	model?: string;
	stability?: number;
	similarityBoost?: number;
	style?: number;
	useSpeakerBoost?: boolean;
}

export interface STTResult {
	text: string;
	duration: number;
	language?: string;
	confidence?: number;
}

export interface VoiceSessionState {
	guildId: string;
	channelId: string;
	userId: string;
	isListening: boolean;
	isSpeaking: boolean;
	startedAt: number;
	lastActivity: number;
}

export interface ElevenLabsVoice {
	voice_id: string;
	name: string;
	category: string;
	labels: Record<string, string>;
}

export interface AudioChunk {
	data: Buffer;
	timestamp: number;
	userId: string;
}
