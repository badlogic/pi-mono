import { randomUUID } from "crypto";

export function newId(): string {
	return randomUUID();
}

export function isValidId(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
