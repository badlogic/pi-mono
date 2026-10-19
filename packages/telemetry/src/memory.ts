import type {
	AttributeValue,
	SpanAttributes,
	SpanLink,
	SpanOptions,
	SpanStatus,
	TelemetryCarrier,
	TelemetryContext,
	TelemetryPropagation,
	TelemetrySpan,
} from "./index.ts";
import type {
	HistogramOptions,
	InstrumentOptions,
	TelemetryCounter,
	TelemetryHistogram,
	TelemetryMetrics,
	TelemetryUpDownCounter,
} from "./metrics.ts";
import { NOOP_TELEMETRY_CONTEXT } from "./noop.ts";

export interface RecordedTelemetryEvent {
	readonly name: string;
	readonly attributes: Readonly<SpanAttributes>;
}

export interface RecordedTelemetryLink {
	readonly context: Readonly<TelemetryCarrier>;
	readonly attributes: Readonly<SpanAttributes>;
}

export interface RecordedTelemetrySpan {
	readonly id: number;
	/** Local parent ID, or null for roots and parents owned by another recorder. */
	readonly parentId: number | null;
	readonly context: Readonly<TelemetryCarrier>;
	readonly parentContext: Readonly<TelemetryCarrier> | null;
	readonly links: readonly RecordedTelemetryLink[];
	readonly name: string;
	readonly attributes: Readonly<SpanAttributes>;
	readonly events: readonly RecordedTelemetryEvent[];
	readonly status: SpanStatus;
	readonly settled: boolean;
	readonly endSequence?: number;
}

export interface RecordedTelemetryMeasurement {
	readonly kind: "counter" | "upDownCounter" | "histogram";
	readonly name: string;
	readonly description?: string;
	readonly unit?: string;
	readonly boundaries?: readonly number[];
	readonly value: number;
	readonly attributes: Readonly<SpanAttributes>;
	readonly context: Readonly<TelemetryCarrier> | null;
}

interface MutableRecordedTelemetryEvent {
	name: string;
	attributes: SpanAttributes;
}

interface MutableRecordedTelemetrySpan {
	id: number;
	parentId: number | null;
	context: TelemetryCarrier;
	parentContext: TelemetryCarrier | null;
	links: RecordedTelemetryLink[];
	name: string;
	attributes: SpanAttributes;
	events: MutableRecordedTelemetryEvent[];
	status: SpanStatus;
	explicitStatus: boolean;
	settled: boolean;
	endSequence?: number;
}

interface InMemoryParent {
	context: TelemetryCarrier;
	localId: number | null;
	span?: MutableRecordedTelemetrySpan;
}

// Identity survives settlement without exposing backend IDs on the generic context contract.
const contextCarriers = new WeakMap<TelemetryContext, TelemetryCarrier>();

interface InMemoryTelemetryState {
	metrics: TelemetryMetrics;
	propagation: TelemetryPropagation;
	scope: string;
	spans: MutableRecordedTelemetrySpan[];
	measurements: RecordedTelemetryMeasurement[];
	nextSpanId: number;
	nextEndSequence: number;
}

function copyAttributeValue(value: AttributeValue): AttributeValue {
	return Array.isArray(value) ? ([...value] as AttributeValue) : value;
}

function copyAttributes(attributes?: SpanAttributes): SpanAttributes {
	const copy: SpanAttributes = {};
	if (!attributes) return copy;
	for (const [name, value] of Object.entries(attributes)) {
		if (value !== undefined) copy[name] = copyAttributeValue(value);
	}
	return copy;
}

function mergeAttributes(current: SpanAttributes, attributes: SpanAttributes): SpanAttributes {
	const merged = copyAttributes(current);
	for (const [name, value] of Object.entries(attributes)) {
		if (value !== undefined) merged[name] = copyAttributeValue(value);
	}
	return merged;
}

function copyLink(link: SpanLink): RecordedTelemetryLink | undefined {
	try {
		const context = contextCarriers.get(link.context);
		if (!context) return undefined;
		return { context: { ...context }, attributes: copyAttributes(link.attributes) };
	} catch {
		return undefined;
	}
}

function copyStatus(status: SpanStatus): SpanStatus {
	if (status.status === "ok") return { status: "ok" };
	return status.error
		? { status: "error", error: { name: status.error.name, message: status.error.message } }
		: { status: "error" };
}

function automaticErrorStatus(error: unknown): SpanStatus {
	try {
		if (error instanceof Error) {
			return { status: "error", error: { name: error.name, message: error.message } };
		}
	} catch {
		// Error inspection is passive. Fall through to an error status without details.
	}
	return { status: "error" };
}

function settleSpan(
	state: InMemoryTelemetryState,
	span: MutableRecordedTelemetrySpan,
	failed: boolean,
	error?: unknown,
): void {
	if (span.settled) return;
	if (failed && !span.explicitStatus) span.status = automaticErrorStatus(error);
	span.settled = true;
	span.endSequence = state.nextEndSequence++;
}

function createSpan(
	state: InMemoryTelemetryState,
	parent: InMemoryParent | undefined,
	options: SpanOptions,
): MutableRecordedTelemetrySpan {
	const name = options.name;
	const attributes = copyAttributes(options.attributes);
	const links: RecordedTelemetryLink[] = [];
	try {
		for (const link of options.links ?? []) {
			const copy = copyLink(link);
			if (copy) links.push(copy);
		}
	} catch {
		// An unreadable link list must not suppress the operation's span.
	}
	const id = state.nextSpanId++;
	return {
		id,
		parentId: parent?.localId ?? null,
		context: { "pi-memory-scope": state.scope, "pi-memory-span": String(id) },
		parentContext: parent ? { ...parent.context } : null,
		links,
		name,
		attributes,
		events: [],
		status: { status: "ok" },
		explicitStatus: false,
		settled: false,
	};
}

function startInertSpan<T>(
	state: InMemoryTelemetryState,
	options: SpanOptions,
	callback: (span: TelemetrySpan) => T | Promise<T>,
): Promise<T> {
	return NOOP_TELEMETRY_CONTEXT.startSpan(options, (noop) =>
		callback({
			...noop,
			metrics: state.metrics,
			propagation: state.propagation,
			startSpan: <Result>(
				childOptions: SpanOptions,
				childCallback: (span: TelemetrySpan) => Result | Promise<Result>,
			) => startInertSpan(state, childOptions, childCallback),
		}),
	);
}

function startInMemorySpan<T>(
	state: InMemoryTelemetryState,
	parent: InMemoryParent | undefined,
	options: SpanOptions,
	callback: (span: TelemetrySpan) => T | Promise<T>,
): Promise<T> {
	if (parent?.span?.settled) return startInertSpan(state, options, callback);

	let recordedSpan: MutableRecordedTelemetrySpan;
	try {
		recordedSpan = createSpan(state, parent, options);
		state.spans.push(recordedSpan);
	} catch {
		return startInertSpan(state, options, callback);
	}

	const span: TelemetrySpan = {
		metrics: state.metrics,
		propagation: state.propagation,
		startSpan: <Result>(
			childOptions: SpanOptions,
			childCallback: (child: TelemetrySpan) => Result | Promise<Result>,
		) =>
			startInMemorySpan(
				state,
				{ context: recordedSpan.context, localId: recordedSpan.id, span: recordedSpan },
				childOptions,
				childCallback,
			),
		addLink(link) {
			if (recordedSpan.settled) return;
			const copy = copyLink(link);
			if (copy) recordedSpan.links.push(copy);
		},
		addEvent(name, attributes) {
			if (recordedSpan.settled) return;
			try {
				recordedSpan.events.push({ name, attributes: copyAttributes(attributes) });
			} catch {
				// Recording is passive. Ignore malformed or unreadable telemetry payloads.
			}
		},
		setAttributes(attributes) {
			if (recordedSpan.settled) return;
			try {
				recordedSpan.attributes = mergeAttributes(recordedSpan.attributes, attributes);
			} catch {
				// Recording is passive. Ignore malformed or unreadable telemetry payloads.
			}
		},
		setStatus(status) {
			if (recordedSpan.settled) return;
			try {
				recordedSpan.status = copyStatus(status);
				recordedSpan.explicitStatus = true;
			} catch {
				// Recording is passive. Ignore malformed or unreadable telemetry payloads.
			}
		},
	};

	contextCarriers.set(span, recordedSpan.context);

	let result: T | Promise<T>;
	try {
		result = callback(span);
	} catch (error) {
		settleSpan(state, recordedSpan, true, error);
		return Promise.reject(error);
	}

	return Promise.resolve(result).then(
		(value) => {
			settleSpan(state, recordedSpan, false);
			return value;
		},
		(error: unknown) => {
			settleSpan(state, recordedSpan, true, error);
			throw error;
		},
	);
}

function createMeasurementRecorder(
	state: InMemoryTelemetryState,
	kind: RecordedTelemetryMeasurement["kind"],
	name: string,
	options?: HistogramOptions,
): (value: number, attributes?: SpanAttributes, context?: TelemetryContext) => void {
	try {
		const description = options?.description;
		const unit = options?.unit;
		const boundaries =
			kind === "histogram" && options?.boundaries !== undefined ? [...options.boundaries] : undefined;
		if (
			typeof name !== "string" ||
			(description !== undefined && typeof description !== "string") ||
			(unit !== undefined && typeof unit !== "string")
		)
			return () => {};
		if (boundaries?.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= boundaries[index - 1]!)))
			return () => {};
		const metadata = {
			kind,
			name,
			...(description === undefined ? {} : { description }),
			...(unit === undefined ? {} : { unit }),
			...(boundaries === undefined ? {} : { boundaries }),
		};
		return (value, attributes, context) => {
			if (!Number.isFinite(value) || (kind === "counter" && value < 0)) return;
			try {
				const carrier = context === undefined ? undefined : contextCarriers.get(context);
				state.measurements.push({
					...metadata,
					value,
					attributes: copyAttributes(attributes),
					context: carrier ? { ...carrier } : null,
				});
			} catch {
				// Measurements are passive; discard the whole failed call.
			}
		};
	} catch {
		return () => {};
	}
}

/**
 * Backend-neutral reference implementation that records spans in process memory.
 * Create a fresh instance to isolate tests or independent recording scopes.
 */
export class InMemoryTelemetryContext implements TelemetryContext, TelemetryPropagation, TelemetryMetrics {
	readonly metrics: TelemetryMetrics = this;
	readonly propagation: TelemetryPropagation = this;
	private readonly state: InMemoryTelemetryState = {
		metrics: this,
		propagation: this,
		scope: crypto.randomUUID(),
		spans: [],
		measurements: [],
		nextSpanId: 1,
		nextEndSequence: 1,
	};

	startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
		return startInMemorySpan(this.state, undefined, options, callback);
	}

	/** Returns a detached carrier for a known span or extracted parent, including settled spans. */
	inject(context: TelemetryContext): TelemetryCarrier | undefined {
		const carrier = contextCarriers.get(context);
		return carrier ? { ...carrier } : undefined;
	}

	/** Unrecognized or unreadable carriers fall back to this recorder's root context. */
	extract(carrier: TelemetryCarrier | undefined): TelemetryContext {
		try {
			if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) return this;
			if (!Object.hasOwn(carrier, "pi-memory-scope") || !Object.hasOwn(carrier, "pi-memory-span")) return this;
			if (Object.values(carrier).some((value) => typeof value !== "string")) return this;
			const scope = carrier["pi-memory-scope"];
			const span = carrier["pi-memory-span"];
			if (typeof scope !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scope))
				return this;
			if (typeof span !== "string" || !/^[1-9][0-9]*$/.test(span) || !Number.isSafeInteger(Number(span)))
				return this;
			const context = { "pi-memory-scope": scope, "pi-memory-span": span };
			const localId =
				scope === this.state.scope && this.state.spans.some((candidate) => candidate.id === Number(span))
					? Number(span)
					: null;
			const parent: TelemetryContext = {
				metrics: this,
				propagation: this,
				startSpan: <T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) =>
					startInMemorySpan(this.state, { context, localId }, options, callback),
			};
			contextCarriers.set(parent, context);
			return parent;
		} catch {
			return this;
		}
	}

	counter(name: string, options?: InstrumentOptions): TelemetryCounter {
		return { add: createMeasurementRecorder(this.state, "counter", name, options) };
	}

	upDownCounter(name: string, options?: InstrumentOptions): TelemetryUpDownCounter {
		return { add: createMeasurementRecorder(this.state, "upDownCounter", name, options) };
	}

	histogram(name: string, options?: HistogramOptions): TelemetryHistogram {
		return { record: createMeasurementRecorder(this.state, "histogram", name, options) };
	}

	/** Returns detached measurements in recording order, without aggregation. */
	getMetrics(): readonly RecordedTelemetryMeasurement[] {
		return this.state.measurements.map((measurement) => ({
			...measurement,
			...(measurement.boundaries === undefined ? {} : { boundaries: [...measurement.boundaries] }),
			attributes: copyAttributes(measurement.attributes),
			context: measurement.context ? { ...measurement.context } : null,
		}));
	}

	/** Returns detached snapshots in span-start order. */
	getSpans(): readonly RecordedTelemetrySpan[] {
		return this.state.spans.map((span) => ({
			id: span.id,
			parentId: span.parentId,
			context: { ...span.context },
			parentContext: span.parentContext ? { ...span.parentContext } : null,
			links: span.links.map((link) => ({
				context: { ...link.context },
				attributes: copyAttributes(link.attributes),
			})),
			name: span.name,
			attributes: copyAttributes(span.attributes),
			events: span.events.map((event) => ({
				name: event.name,
				attributes: copyAttributes(event.attributes),
			})),
			status: copyStatus(span.status),
			settled: span.settled,
			...(span.endSequence === undefined ? {} : { endSequence: span.endSequence }),
		}));
	}
}
