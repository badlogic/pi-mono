/**
 * PiAgent: ACP Agent interface implementation for pi.
 *
 * Implements the Agent interface from @agentclientprotocol/sdk to handle
 * ACP protocol requests and manage sessions.
 */

import * as crypto from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import { VERSION } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { acpDebug } from "./acp-mode.js";
import { AcpSession } from "./acp-session.js";

/** ACP protocol version supported by this implementation */
const PROTOCOL_VERSION = 1;

/**
 * PiAgent implements the ACP Agent interface.
 *
 * Handles initialization, session management, and prompt processing
 * by delegating to AcpSession instances that wrap AgentSession.
 */
export class PiAgent implements acp.Agent {
	private readonly _agentSession: AgentSession;
	private readonly _connection: acp.AgentSideConnection;
	private readonly _sessions: Map<string, AcpSession> = new Map();

	constructor(session: AgentSession, connection: acp.AgentSideConnection) {
		this._agentSession = session;
		this._connection = connection;
	}

	/**
	 * Initialize the agent and negotiate capabilities.
	 *
	 * Returns the protocol version and agent capabilities including
	 * support for images and embedded context.
	 */
	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		acpDebug(`initialize: client protocol version ${params.protocolVersion}`);
		const response = {
			protocolVersion: Math.min(params.protocolVersion, PROTOCOL_VERSION),
			agentInfo: {
				name: "pi",
				version: VERSION,
			},
			agentCapabilities: {
				promptCapabilities: {
					image: true,
					embeddedContext: true,
				},
			},
			// No auth required for pi
			authMethods: [],
		};
		acpDebug(`initialize: responding with protocol version ${response.protocolVersion}`);
		return response;
	}

	/**
	 * Create a new session.
	 *
	 * Creates an AcpSession wrapper around the AgentSession and returns
	 * a unique session ID for subsequent requests.
	 *
	 * Note: pi ignores the cwd and mcpServers parameters as it manages
	 * its own working directory and tool system.
	 */
	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		acpDebug(`newSession: cwd=${params.cwd}`);
		const sessionId = crypto.randomUUID();

		// Create AcpSession wrapper
		const acpSession = new AcpSession(sessionId, this._agentSession, this._connection);
		this._sessions.set(sessionId, acpSession);

		acpDebug(`newSession: created session ${sessionId}`);
		return {
			sessionId,
		};
	}

	/**
	 * Process a user prompt.
	 *
	 * Delegates to the AcpSession for the given session ID.
	 * Returns the stop reason when processing completes.
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		acpDebug(`prompt: session=${params.sessionId}, blocks=${params.prompt.length}`);
		const session = this._sessions.get(params.sessionId);
		if (!session) {
			acpDebug(`prompt: session not found ${params.sessionId}`);
			throw new Error(`Session not found: ${params.sessionId}`);
		}

		const response = await session.prompt(params);
		acpDebug(`prompt: completed with stopReason=${response.stopReason}`);
		return response;
	}

	/**
	 * Cancel ongoing operations for a session.
	 *
	 * Delegates to the AcpSession for the given session ID.
	 */
	async cancel(params: acp.CancelNotification): Promise<void> {
		acpDebug(`cancel: session=${params.sessionId}`);
		const session = this._sessions.get(params.sessionId);
		if (!session) {
			acpDebug(`cancel: session not found ${params.sessionId}`);
			// Session not found - nothing to cancel
			return;
		}

		session.cancel();
		acpDebug(`cancel: cancelled session ${params.sessionId}`);
	}

	/**
	 * Authenticate the client.
	 *
	 * Pi doesn't require authentication, so this is a no-op.
	 */
	async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		return {};
	}
}
