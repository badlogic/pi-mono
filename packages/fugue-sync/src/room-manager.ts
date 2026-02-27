import type { UnknownRecord } from "@tldraw/store";
import { TLSocketRoom } from "@tldraw/sync-core";
import type { RoomSnapshot, RoomStore } from "./store.js";

const PERSIST_INTERVAL_MS = 5_000; // save every 5 seconds if dirty
const IDLE_TIMEOUT_MS = 60_000; // destroy room after 60s with no connections

interface ManagedRoom {
	room: TLSocketRoom<UnknownRecord>;
	persistTimer: NodeJS.Timeout | null;
	idleTimer: NodeJS.Timeout | null;
	dirty: boolean;
	connectionCount: number;
}

/**
 * Manages a pool of active tldraw rooms.
 * Rooms are loaded on first connection and persisted to Postgres on data change.
 * Idle rooms (no connections for IDLE_TIMEOUT_MS) are closed and evicted from memory.
 */
export class RoomManager {
	private readonly rooms: Map<string, ManagedRoom> = new Map();

	constructor(private readonly store: RoomStore) {}

	async getOrCreate(roomId: string): Promise<TLSocketRoom<UnknownRecord>> {
		const existing = this.rooms.get(roomId);
		if (existing) return existing.room;

		const snapshot = await this.store.load(roomId);

		const managed: ManagedRoom = {
			room: null as unknown as ManagedRoom["room"],
			persistTimer: null,
			idleTimer: null,
			dirty: false,
			connectionCount: 0,
		};

		managed.room = new TLSocketRoom({
			initialSnapshot: (snapshot as ConstructorParameters<typeof TLSocketRoom>[0]["initialSnapshot"]) ?? undefined,
			onDataChange: () => {
				managed.dirty = true;
				if (!managed.persistTimer) {
					managed.persistTimer = setTimeout(async () => {
						managed.persistTimer = null;
						if (managed.dirty) {
							managed.dirty = false;
							await this.persist(roomId, managed);
						}
					}, PERSIST_INTERVAL_MS);
				}
			},
		});

		this.rooms.set(roomId, managed);
		return managed.room;
	}

	onConnectionOpen(roomId: string): void {
		const managed = this.rooms.get(roomId);
		if (!managed) return;
		managed.connectionCount++;
		// Cancel idle eviction while someone is connected
		if (managed.idleTimer) {
			clearTimeout(managed.idleTimer);
			managed.idleTimer = null;
		}
	}

	onConnectionClose(roomId: string): void {
		const managed = this.rooms.get(roomId);
		if (!managed) return;
		managed.connectionCount = Math.max(0, managed.connectionCount - 1);

		if (managed.connectionCount === 0) {
			// Flush immediately then schedule eviction
			this.persist(roomId, managed).catch(() => {});
			managed.idleTimer = setTimeout(() => {
				this.evict(roomId);
			}, IDLE_TIMEOUT_MS);
		}
	}

	private async persist(roomId: string, managed: ManagedRoom): Promise<void> {
		try {
			const snapshot = managed.room.getCurrentSnapshot() as unknown as RoomSnapshot;
			await this.store.save(roomId, snapshot);
		} catch {
			// Non-fatal: snapshot will be saved on next change or eviction attempt
		}
	}

	private evict(roomId: string): void {
		const managed = this.rooms.get(roomId);
		if (!managed) return;
		if (managed.persistTimer) clearTimeout(managed.persistTimer);
		if (managed.idleTimer) clearTimeout(managed.idleTimer);
		managed.room.close();
		this.rooms.delete(roomId);
	}

	async close(): Promise<void> {
		const flushes: Promise<void>[] = [];
		for (const [roomId, managed] of this.rooms.entries()) {
			if (managed.dirty) {
				flushes.push(this.persist(roomId, managed));
			}
			if (managed.persistTimer) clearTimeout(managed.persistTimer);
			if (managed.idleTimer) clearTimeout(managed.idleTimer);
			managed.room.close();
		}
		await Promise.allSettled(flushes);
		this.rooms.clear();
	}

	get activeRoomCount(): number {
		return this.rooms.size;
	}
}
