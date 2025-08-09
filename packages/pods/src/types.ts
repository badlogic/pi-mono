// Core type definitions for pi

export interface GPU {
	id: number;
	name: string;
	memory: string;
}

export interface Model {
	model: string;
	port: number;
	gpu: number[]; // Array of GPU IDs for multi-GPU deployment
	pid: number;
}

export interface Pod {
	ssh: string;
	gpus: GPU[];
	models: Record<string, Model>;
	modelsPath?: string;
	vllmVersion?: "release" | "nightly" | "gpt-oss"; // Track which vLLM version is installed
}

export interface Config {
	pods: Record<string, Pod>;
	active?: string;
}
