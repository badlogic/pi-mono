export interface X402EnvConfig {
	privateKey: string;
	routerUrl: string;
	network: string;
	permitCap: string;
	paymentHeader: string;
	modelId: string;
	modelName: string;
}

export interface RouterConfig {
	network: string;
	asset: string;
	payTo: string;
	facilitatorSigner: string;
	tokenName: string;
	tokenVersion: string;
	paymentHeader: string;
}

export interface RouterConfigResponse {
	networks?: Array<{
		network_id?: string;
		active?: boolean;
		asset?: {
			address?: string;
		};
		pay_to?: string;
	}>;
	eip712_config?: {
		domain_name?: string;
		domain_version?: string;
	};
	payment_header?: string;
}

export interface PaymentRequirementExtra {
	name?: string;
	version?: string;
	maxAmount?: string;
	max_amount?: string;
	maxAmountRequired?: string;
	max_amount_required?: string;
}

export interface PaymentRequirement {
	network?: string;
	asset?: string;
	payTo?: string;
	pay_to?: string;
	extra?: PaymentRequirementExtra;
}

export interface PaymentRequiredHeader {
	x402Version?: number;
	error?: string;
	accepts?: PaymentRequirement[];
}

export interface ErrorResponse {
	code?: string;
	error?: string;
	message?: string;
}

export interface CachedPermit {
	paymentSig: string;
	deadline: number;
	maxValue: string;
	nonce: string;
	network: string;
	asset: string;
	payTo: string;
}

export interface SignPermitParams {
	privateKey: string;
	routerConfig: RouterConfig;
	permitCap: string;
}

export type SignPermit = (params: SignPermitParams) => Promise<CachedPermit>;
