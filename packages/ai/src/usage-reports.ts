/** A provider-normalized finite subscription-usage window. All times are Unix milliseconds. */
export interface UsageWindow {
	/** Length of this rolling window in milliseconds. */
	duration: number;
	/** Fraction of the window's allowance already consumed, from 0 through 1. */
	used: number;
	/** Time at which the provider usage was observed, in Unix milliseconds. */
	observedAt: number;
	/** Absolute window reset time, in Unix milliseconds. */
	resetsAt: number;
}

/** Subscription usage available to a caller without exposing credentials. */
export interface UsageReport {
	windows: readonly UsageWindow[];
}

/** Credential-derived request data supplied only by the AI runtime to a provider adapter. */
export interface UsageReportRequest {
	accessToken: string;
	signal: AbortSignal;
}

/** Provider-owned subscription usage adapter. */
export type UsageReportFetcher = (request: UsageReportRequest) => Promise<UsageReport | undefined>;
