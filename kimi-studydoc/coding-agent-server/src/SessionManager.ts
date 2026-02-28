import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import type { Session, ExecutionState, ExecutionContract, Snapshot } from "./types.js";

export interface StorageAdapter {
  save(session: Session): Promise<void>;
  load(sessionId: string): Promise<Session | null>;
  list(): Promise<Session[]>;
  delete(sessionId: string): Promise<void>;
}

export class FileStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string = "./sessions") {
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.json`);
  }

  async save(session: Session): Promise<void> {
    const path = this.getSessionPath(session.id);
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
  }

  async load(sessionId: string): Promise<Session | null> {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      return null;
    }
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Session;
  }

  async list(): Promise<Session[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }
    const files = readFileSync(this.baseDir, "utf-8");
    // Simple implementation - read all .json files
    const sessions: Session[] = [];
    const { readdirSync } = await import("fs");
    for (const file of readdirSync(this.baseDir)) {
      if (file.endsWith(".json")) {
        const content = readFileSync(join(this.baseDir, file), "utf-8");
        sessions.push(JSON.parse(content));
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(sessionId: string): Promise<void> {
    const path = this.getSessionPath(sessionId);
    if (existsSync(path)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(path);
    }
  }
}

export class SessionManager {
  private storage: StorageAdapter;
  private activeSessions: Map<string, Session> = new Map();

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? new FileStorageAdapter();
  }

  async createSession(userPrompt: string, skillText: string): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: uuidv4(),
      state: "INIT",
      userPrompt,
      skillText,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.save(session);
    this.activeSessions.set(session.id, session);

    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    // Check active sessions first
    const active = this.activeSessions.get(sessionId);
    if (active) {
      return active;
    }

    // Load from storage
    const session = await this.storage.load(sessionId);
    if (session) {
      this.activeSessions.set(sessionId, session);
    }
    return session;
  }

  async updateState(sessionId: string, state: ExecutionState): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.state = state;
    session.updatedAt = Date.now();

    await this.storage.save(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }

  async updateContract(sessionId: string, contract: ExecutionContract): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.contract = contract;
    session.updatedAt = Date.now();

    await this.storage.save(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }

  async updateSnapshot(sessionId: string, snapshot: Snapshot): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.snapshot = snapshot;
    session.updatedAt = Date.now();

    await this.storage.save(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }

  async updateProgress(
    sessionId: string,
    currentStep: number,
    totalSteps: number,
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.currentStep = currentStep;
    session.totalSteps = totalSteps;
    session.updatedAt = Date.now();

    await this.storage.save(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }

  async setError(sessionId: string, error: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.error = error;
    session.state = "FAILED";
    session.updatedAt = Date.now();

    await this.storage.save(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }

  async listSessions(): Promise<Session[]> {
    return this.storage.list();
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);
    await this.storage.delete(sessionId);
  }

  canTransition(from: ExecutionState, to: ExecutionState): boolean {
    const validTransitions: Record<ExecutionState, ExecutionState[]> = {
      INIT: ["CONTRACT_SYNTHESIS"],
      CONTRACT_SYNTHESIS: ["PREFLIGHT", "FAILED"],
      PREFLIGHT: ["FROZEN", "FAILED"],
      FROZEN: ["EXECUTING", "FAILED"],
      EXECUTING: ["COMPLETE", "FAILED", "PAUSED"],
      PAUSED: ["EXECUTING", "FAILED"],
      COMPLETE: [],
      FAILED: ["INIT"], // Allow retry from scratch
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  async transitionTo(sessionId: string, newState: ExecutionState): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!this.canTransition(session.state, newState)) {
      throw new Error(
        `Invalid state transition from ${session.state} to ${newState}`,
      );
    }

    return this.updateState(sessionId, newState);
  }
}
