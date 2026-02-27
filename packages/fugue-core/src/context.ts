import type { EventBus } from "@fugue/events";
import type { DrizzleDb } from "@fugue/graph";
import type { Pool } from "pg";

export interface Session {
	userId: string;
	email: string;
	role: string;
}

export interface AppContext {
	db: DrizzleDb;
	pool: Pool;
	bus: EventBus;
	/** Null for unauthenticated requests */
	session: Session | null;
}
