/**
 * Session Persistence Examples
 * Demonstrates integration with OpenHands and lightweight agents
 */

import type { LearningAgentResult, OpenHandsResult } from "../index.js";
import {
	cleanupOldSessions,
	completeSession,
	configureWebhook,
	failSession,
	getActiveSessions,
	getSessionContext,
	incrementIteration,
	pauseSession,
	recordLearning,
	recordToolCall,
	resumeSession,
	startSession,
} from "./manager.js";

/**
 * Example 1: OpenHands agent with session persistence
 */
export async function runOpenHandsWithSession(
	task: string,
	mode: string,
	userId?: string,
	channelId?: string,
): Promise<OpenHandsResult> {
	// Import dynamically to avoid circular deps
	const { runOpenHandsAgent } = await import("../openhands-agent.js");

	// Start session
	const session = await startSession(task, mode, {
		userId,
		channelId,
		maxIterations: 50,
		metadata: {
			enableLearning: true,
		},
	});

	try {
		// Record start iteration
		await incrementIteration(session.id, { phase: "initialization" });

		// Run OpenHands agent with session tracking
		const result = await runOpenHandsAgent({
			task,
			mode: mode as any,
			timeout: 600,
			persist: true,
			sessionId: session.id,
		});

		// Record tool usage
		for (const tool of result.tools_used) {
			await recordToolCall(session.id, tool, {}, {});
		}

		// Record learning if captured
		if (result.learnings_captured) {
			await recordLearning(session.id, "Agent learned from execution", `expertise/${mode}.md`);
		}

		// Complete session
		if (result.success) {
			await completeSession(session.id, result.output);
		} else {
			await failSession(session.id, result.error || "Unknown error");
		}

		return result;
	} catch (error) {
		// Fail session on error
		await failSession(session.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/**
 * Example 2: Lightweight agent with session persistence
 */
export async function runLightweightWithSession(
	prompt: string,
	mode: string,
	userId?: string,
	channelId?: string,
): Promise<LearningAgentResult> {
	// Import dynamically
	const { runLearningAgent } = await import("../lightweight-agent.js");

	// Start session
	const session = await startSession(prompt, mode, {
		userId,
		channelId,
		maxIterations: 20,
	});

	try {
		// Run learning agent
		const result = await runLearningAgent({
			prompt,
			mode,
			enableLearning: true,
		});

		// Record learning
		if (result.learned) {
			await recordLearning(session.id, result.learned.insight, result.learned.expertiseFile);
		}

		// Record completion
		await incrementIteration(session.id, { model: result.model });

		if (result.success) {
			await completeSession(session.id, result.output);
		} else {
			await failSession(session.id, result.error || "Unknown error");
		}

		return result;
	} catch (error) {
		await failSession(session.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/**
 * Example 3: Multi-step workflow with pause/resume
 */
export async function runMultiStepWorkflow(task: string, userId: string): Promise<string> {
	const { runOpenHandsAgent } = await import("../openhands-agent.js");

	// Start session
	const session = await startSession(task, "developer", {
		userId,
		maxIterations: 100,
	});

	try {
		// Step 1: Analysis
		await incrementIteration(session.id, { step: "analysis" });
		const analysis = await runOpenHandsAgent({
			task: `Analyze the requirements: ${task}`,
			mode: "developer",
		});

		if (!analysis.success) {
			throw new Error("Analysis failed");
		}

		// Check if user wants to pause (simulated)
		const shouldPause = Math.random() > 0.5;
		if (shouldPause) {
			await pauseSession(session.id, "User requested review of analysis");
			console.log(`Session ${session.id} paused. Resume later with resumeMultiStepWorkflow()`);
			return `Paused after analysis. Session ID: ${session.id}`;
		}

		// Step 2: Implementation
		await incrementIteration(session.id, { step: "implementation" });
		const implementation = await runOpenHandsAgent({
			task: `Implement based on analysis: ${analysis.output}`,
			mode: "developer",
		});

		if (!implementation.success) {
			throw new Error("Implementation failed");
		}

		// Step 3: Testing
		await incrementIteration(session.id, { step: "testing" });
		const testing = await runOpenHandsAgent({
			task: "Generate and run tests",
			mode: "test_generation",
		});

		// Complete
		const finalResult = `Analysis: ${analysis.output}\n\nImplementation: ${implementation.output}\n\nTests: ${testing.output}`;
		await completeSession(session.id, finalResult);

		return finalResult;
	} catch (error) {
		await failSession(session.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/**
 * Example 4: Resume a paused workflow
 */
export async function resumeMultiStepWorkflow(sessionId: string): Promise<string> {
	const { runOpenHandsAgent } = await import("../openhands-agent.js");

	// Resume session
	const session = await resumeSession(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found or not resumable`);
	}

	// Get context to understand where we left off
	const context = getSessionContext(sessionId);
	console.log(`Resuming from iteration ${context?.iterations}`);

	try {
		// Continue from where we left off (Step 2: Implementation)
		await incrementIteration(sessionId, { step: "implementation" });
		const implementation = await runOpenHandsAgent({
			task: "Continue implementation",
			mode: "developer",
		});

		if (!implementation.success) {
			throw new Error("Implementation failed");
		}

		// Step 3: Testing
		await incrementIteration(sessionId, { step: "testing" });
		const testing = await runOpenHandsAgent({
			task: "Generate and run tests",
			mode: "test_generation",
		});

		const finalResult = `Implementation: ${implementation.output}\n\nTests: ${testing.output}`;
		await completeSession(sessionId, finalResult);

		return finalResult;
	} catch (error) {
		await failSession(sessionId, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/**
 * Example 5: Session monitoring and cleanup
 */
export async function monitorSessions(): Promise<void> {
	// Get active sessions
	const active = getActiveSessions();
	console.log(`Active sessions: ${active.length}`);

	for (const session of active) {
		console.log(`- ${session.id}: ${session.task} (${session.iterations}/${session.maxIterations})`);
	}

	// Clean up old completed sessions (older than 30 days)
	const cleaned = cleanupOldSessions(30);
	console.log(`Cleaned up ${cleaned} old sessions`);
}

/**
 * Example 6: Configure webhook for session notifications
 */
export function setupSessionWebhook(webhookUrl: string): void {
	configureWebhook(webhookUrl);
	console.log(`Session webhooks configured for ${webhookUrl}`);
}

/**
 * Example 7: Batch processing with session tracking
 */
export async function batchProcessWithSessions(tasks: string[], mode: string): Promise<void> {
	const { runOpenHandsAgent } = await import("../openhands-agent.js");

	for (const task of tasks) {
		const session = await startSession(task, mode, {
			maxIterations: 30,
		});

		try {
			const result = await runOpenHandsAgent({
				task,
				mode: mode as any,
			});

			if (result.success) {
				await completeSession(session.id, result.output);
			} else {
				await failSession(session.id, result.error || "Failed");
			}
		} catch (error) {
			await failSession(session.id, error instanceof Error ? error.message : String(error));
		}
	}
}

/**
 * Example 8: Session-aware agent wrapper
 */
export class SessionAwareAgent {
	constructor(
		private userId?: string,
		private channelId?: string,
	) {}

	async execute(task: string, mode: string): Promise<string> {
		const { runOpenHandsAgent } = await import("../openhands-agent.js");

		const session = await startSession(task, mode, {
			userId: this.userId,
			channelId: this.channelId,
			maxIterations: 50,
		});

		try {
			const result = await runOpenHandsAgent({
				task,
				mode: mode as any,
				sessionId: session.id,
				persist: true,
			});

			if (result.success) {
				await completeSession(session.id, result.output);
				return result.output;
			} else {
				await failSession(session.id, result.error || "Failed");
				throw new Error(result.error || "Failed");
			}
		} catch (error) {
			await failSession(session.id, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	async pause(sessionId: string, reason?: string): Promise<void> {
		await pauseSession(sessionId, reason);
	}

	async resume(sessionId: string): Promise<string> {
		const context = getSessionContext(sessionId);
		if (!context) {
			throw new Error(`Session ${sessionId} not found`);
		}

		await resumeSession(sessionId);

		// Continue execution...
		const { runOpenHandsAgent } = await import("../openhands-agent.js");
		const result = await runOpenHandsAgent({
			task: context.task as string,
			mode: context.mode as string as any,
			sessionId,
			persist: true,
		});

		if (result.success) {
			await completeSession(sessionId, result.output);
			return result.output;
		} else {
			await failSession(sessionId, result.error || "Failed");
			throw new Error(result.error || "Failed");
		}
	}

	getActiveSessions(): ReturnType<typeof getActiveSessions> {
		return getActiveSessions({
			userId: this.userId,
			channelId: this.channelId,
		});
	}
}

/**
 * Usage examples:
 *
 * // Basic OpenHands with session
 * await runOpenHandsWithSession("Fix bug in auth", "debug", "user123", "channel456");
 *
 * // Lightweight agent with session
 * await runLightweightWithSession("Analyze this code", "coding", "user123");
 *
 * // Multi-step workflow
 * const result = await runMultiStepWorkflow("Build new feature", "user123");
 * // If paused, resume later:
 * await resumeMultiStepWorkflow("session_abc123_xyz");
 *
 * // Monitor sessions
 * await monitorSessions();
 *
 * // Setup webhooks
 * setupSessionWebhook("http://localhost:3001/webhooks/sessions");
 *
 * // Session-aware agent
 * const agent = new SessionAwareAgent("user123", "channel456");
 * await agent.execute("Review code", "code_review");
 * const sessions = agent.getActiveSessions();
 */
