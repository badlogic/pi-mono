export type UIOwner = object;

export interface UIOverrideResult {
	effectiveOwner: UIOwner | undefined;
	previousOwner: UIOwner | undefined;
	conflictedOwner: UIOwner | undefined;
}

type Override<T> = {
	owner: UIOwner;
	value: T;
};

export class OwnerOverrideSlot<T> {
	#overrides: Override<T>[] = [];

	get current(): Override<T> | undefined {
		return this.#overrides.at(-1);
	}

	set(owner: UIOwner, value: T): UIOverrideResult {
		const previousOwner = this.current?.owner;
		this.#overrides = this.#overrides.filter((override) => override.owner !== owner);
		this.#overrides.push({ owner, value });
		return {
			effectiveOwner: owner,
			previousOwner,
			conflictedOwner: previousOwner === owner ? undefined : previousOwner,
		};
	}

	clear(): UIOverrideResult {
		const previousOwner = this.current?.owner;
		this.#overrides = [];
		return { effectiveOwner: undefined, previousOwner, conflictedOwner: undefined };
	}

	release(owner: UIOwner): UIOverrideResult {
		const previousOwner = this.current?.owner;
		this.#overrides = this.#overrides.filter((override) => override.owner !== owner);
		return {
			effectiveOwner: this.current?.owner,
			previousOwner,
			conflictedOwner: undefined,
		};
	}
}
