/**
 * Voice Module Exports
 * Open-source TTS (VibeVoice) + STT (Whisper) for Discord
 */

// Types
export * from "./types.js";

// VibeVoice TTS (Microsoft open-source)
export { getVibeVoiceTTS, VibeVoiceTTS } from "./vibevoice.js";
// Voice Session
export {
	getAllVoiceSessions,
	getVoiceSession,
	removeVoiceSession,
	VoiceSession,
} from "./voice-session.js";
// Whisper Local STT (open-source)
export { getWhisperLocalSTT, WhisperLocalSTT } from "./whisper-local.js";
