import { betterAuth } from "better-auth";
import type { Pool } from "pg";

/**
 * Better Auth configuration with PostgreSQL adapter.
 * Uses email/password for MVP — extensible to OAuth later.
 */
export function createAuth(pool: Pool) {
	return betterAuth({
		database: {
			type: "pg",
			pool,
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false, // MVP: no email verification
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // refresh if >1 day old
		},
		trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",") ?? ["http://localhost:3000"],
	});
}

export type Auth = ReturnType<typeof createAuth>;
