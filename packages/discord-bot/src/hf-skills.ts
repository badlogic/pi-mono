/**
 * HuggingFace Expert Skills Service
 * Integrates 30+ HF Spaces for AI capabilities
 *
 * Categories:
 * - Image Generation (Qwen, FLUX, Z-Image)
 * - 3D Generation (Hunyuan3D, TRELLIS)
 * - Voice/TTS (F5-TTS, Chatterbox, Edge-TTS)
 * - OCR/Documents (DeepSeek-OCR, GLiNER)
 * - Code Generation (Qwen-Coder, DeepSeek-Coder)
 * - Trading/Finance (Trading-Analyst, PublicAlpha)
 * - AI Agents (TraceMind, Browser-Use)
 */

import { Client } from "@gradio/client";

// ============================================================================
// Types
// ============================================================================

export interface HFSkillResult {
	success: boolean;
	data?: unknown;
	url?: string;
	error?: string;
	duration?: number;
}

export interface ImageGenOptions {
	prompt: string;
	negativePrompt?: string;
	width?: number;
	height?: number;
	steps?: number;
	seed?: number;
}

export interface TTSOptions {
	text: string;
	voice?: string;
	speed?: number;
	referenceAudio?: string;
}

export interface OCROptions {
	imageUrl?: string;
	imageBase64?: string;
}

export interface CodeGenOptions {
	prompt: string;
	language?: string;
	maxTokens?: number;
}

export interface TradingAnalysisOptions {
	asset: string;
	newsText?: string;
}

// ============================================================================
// HuggingFace Spaces Configuration
// ============================================================================

export const HF_SPACES = {
	// Image Generation
	IMAGE: {
		QWEN_FAST: "mcp-tools/Qwen-Image-Fast",
		QWEN_QUALITY: "mcp-tools/Qwen-Image",
		FLUX_KREA: "mcp-tools/FLUX.1-Krea-dev",
		FLUX_SCHNELL: "evalstate/flux1_schnell",
		Z_IMAGE_TURBO: "Tongyi-MAI/Z-Image-Turbo",
		FLUX_KONTEXT: "mcp-tools/FLUX.1-Kontext-Dev",
	},
	// Image Editing
	EDIT: {
		BACKGROUND_REMOVAL: "not-lain/background-removal",
		PHOTO_MATE: "prithivMLmods/Photo-Mate-i2i",
		OUTPAINT: "fffiloni/diffusers-image-outpaint",
		INSTANT_IR: "fffiloni/InstantIR",
		QWEN_EDIT_ANGLES: "mcp-tools/Qwen-Image-Edit-Angles",
	},
	// 3D Generation
	THREE_D: {
		HUNYUAN_2_1: "tencent/Hunyuan3D-2.1",
		HUNYUAN_2: "tencent/Hunyuan3D-2",
		TRELLIS: "microsoft/TRELLIS.2",
	},
	// Video Generation
	VIDEO: {
		WAN2: "mcp-tools/wan2-2-fp8da-aoti-faster",
		WAN2_FRAMES: "mcp-tools/wan-2-2-first-last-frame",
	},
	// Voice/TTS
	VOICE: {
		CHATTERBOX: "ResembleAI/Chatterbox",
		CHATTERBOX_TURBO: "ResembleAI/chatterbox-turbo-demo",
		F5_TTS: "mrfakename/E2-F5-TTS",
		EDGE_TTS: "innoai/Edge-TTS-Text-to-Speech",
		DIA: "nari-labs/Dia-1.6B",
		TTS_UNLIMITED: "NihalGazi/Text-To-Speech-Unlimited",
	},
	// OCR/Documents
	OCR: {
		DEEPSEEK: "mcp-tools/DeepSeek-OCR-experimental",
		DEEPSEEK_DEMO: "merterbak/DeepSeek-OCR-Demo",
		ONNXTR: "Felix92/OnnxTR-OCR",
		LIGHTON: "lightonai/LightOnOCR-1B-Demo",
		GLINER: "fastino/gliner2-official-demo",
	},
	// Code Generation
	CODE: {
		QWEN_CODER: "Qwen/Qwen2.5-Coder-Artifacts",
		QWEN_WEBDEV: "Qwen/Qwen3-Coder-WebDev",
		DEEPSEEK_CODER: "deepseek-ai/deepseek-coder-33b-instruct",
		HIGH_QUALITY_PYTHON: "OSS-forge/HighQualityPython",
		MULTI_AGENT: "bstraehle/multi-agent-ai-autogen-coding",
	},
	// Trading/Finance
	TRADING: {
		ANALYST: "dami1996/trading-analyst",
		PUBLIC_ALPHA: "MCP-1st-Birthday/PublicAlpha",
		FINANCIAL_REPORT: "MCP-1st-Birthday/Easy-Financial-Report",
		STOCK_AGENT: "OnursFriends/StockAnalysisAgent",
		GLOBAL_MARKET: "JayLacoma/Global_Market_Analysis",
	},
	// AI Agents
	AGENTS: {
		TRACEMIND: "MCP-1st-Birthday/TraceMind",
		QWEN_VL: "Qwen/Qwen3-VL-30B-A3B-Demo",
		PROMPT_POLISHER: "dream2589632147/Dream-Prompt-Polisher",
		DREAM_HUB: "dream2589632147/Dream-Hub-Pro",
	},
	// Object Detection
	DETECTION: {
		SAM3: "prithivMLmods/SAM3-Image-Segmentation",
	},
} as const;

// ============================================================================
// HuggingFace Skills Service
// ============================================================================

class HFSkillsService {
	private hfToken: string | null;
	private cache: Map<string, { client: unknown; timestamp: number }> = new Map();
	private cacheTimeout = 5 * 60 * 1000; // 5 minutes

	constructor() {
		this.hfToken = process.env.HF_TOKEN || null;
	}

	private async getClient(spaceId: string): Promise<Client> {
		const cached = this.cache.get(spaceId);
		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			return cached.client as Client;
		}

		const client = await Client.connect(spaceId, {
			hf_token: this.hfToken || undefined,
		});

		this.cache.set(spaceId, { client, timestamp: Date.now() });
		return client;
	}

	// ==========================================================================
	// Image Generation
	// ==========================================================================

	async generateImage(
		options: ImageGenOptions,
		model: keyof typeof HF_SPACES.IMAGE = "QWEN_FAST",
	): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const spaceId = HF_SPACES.IMAGE[model];
			const client = await this.getClient(spaceId);

			let result: unknown;

			if (model === "QWEN_FAST" || model === "QWEN_QUALITY") {
				result = await client.predict("/generate_image", {
					prompt: options.prompt,
					aspect_ratio: "1:1",
					num_inference_steps: options.steps || 8,
					seed: options.seed || Math.floor(Math.random() * 1000000),
					randomize_seed: !options.seed,
					guidance_scale: 1,
				});
			} else if (model === "Z_IMAGE_TURBO") {
				result = await client.predict("/infer", {
					prompt: options.prompt,
					seed: options.seed || 0,
					randomize_seed: !options.seed,
					width: options.width || 1024,
					height: options.height || 1024,
					num_inference_steps: options.steps || 4,
				});
			} else {
				result = await client.predict("/predict", {
					prompt: options.prompt,
				});
			}

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Image Editing
	// ==========================================================================

	async removeBackground(imageUrl: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.EDIT.BACKGROUND_REMOVAL);
			const result = await client.predict("/predict", {
				image: imageUrl,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async editImage(imageUrl: string, prompt: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.IMAGE.FLUX_KONTEXT);
			const result = await client.predict("/predict", {
				image: imageUrl,
				prompt: prompt,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async restoreImage(imageUrl: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.EDIT.INSTANT_IR);
			const result = await client.predict("/predict", {
				image: imageUrl,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// 3D Generation
	// ==========================================================================

	async generateModel3D(
		imageUrl: string,
		model: keyof typeof HF_SPACES.THREE_D = "HUNYUAN_2_1",
	): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const spaceId = HF_SPACES.THREE_D[model];
			const client = await this.getClient(spaceId);

			const result = await client.predict("/predict", {
				image: imageUrl,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Video Generation
	// ==========================================================================

	async generateVideo(imageUrl: string, prompt: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.VIDEO.WAN2);
			const result = await client.predict("/predict", {
				image: imageUrl,
				prompt: prompt,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async interpolateFrames(startImage: string, endImage: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.VIDEO.WAN2_FRAMES);
			const result = await client.predict("/predict", {
				start_image: startImage,
				end_image: endImage,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Voice/TTS
	// ==========================================================================

	async textToSpeech(options: TTSOptions, model: keyof typeof HF_SPACES.VOICE = "CHATTERBOX"): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const spaceId = HF_SPACES.VOICE[model];
			const client = await this.getClient(spaceId);

			let result: unknown;

			if (model === "F5_TTS" && options.referenceAudio) {
				result = await client.predict("/predict", {
					text: options.text,
					audio: options.referenceAudio,
				});
			} else if (model === "EDGE_TTS") {
				result = await client.predict("/predict", {
					text: options.text,
					voice: options.voice || "en-US-AriaNeural",
					rate: options.speed || 1.0,
				});
			} else {
				result = await client.predict("/predict", {
					text: options.text,
				});
			}

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async cloneVoice(text: string, referenceAudio: string): Promise<HFSkillResult> {
		return this.textToSpeech({ text, referenceAudio }, "F5_TTS");
	}

	// ==========================================================================
	// OCR/Documents
	// ==========================================================================

	async extractText(imageUrl: string, model: keyof typeof HF_SPACES.OCR = "DEEPSEEK"): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const spaceId = HF_SPACES.OCR[model];
			const client = await this.getClient(spaceId);

			const result = await client.predict("/predict", {
				image: imageUrl,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async extractEntities(text: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.OCR.GLINER);
			const result = await client.predict("/predict", {
				text: text,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Code Generation
	// ==========================================================================

	async generateCode(
		options: CodeGenOptions,
		model: keyof typeof HF_SPACES.CODE = "QWEN_CODER",
	): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const spaceId = HF_SPACES.CODE[model];
			const client = await this.getClient(spaceId);

			const result = await client.predict("/predict", {
				prompt: options.prompt,
				language: options.language || "python",
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async generateWebApp(description: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.CODE.QWEN_WEBDEV);
			const result = await client.predict("/predict", {
				prompt: description,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Trading/Finance
	// ==========================================================================

	async analyzeTradingSentiment(options: TradingAnalysisOptions): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.TRADING.ANALYST);
			const result = await client.predict("/predict", {
				asset: options.asset,
				news: options.newsText || "",
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async getStockRecommendations(): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.TRADING.PUBLIC_ALPHA);
			const result = await client.predict("/predict", {});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async generateFinancialReport(query: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.TRADING.FINANCIAL_REPORT);
			const result = await client.predict("/predict", {
				query: query,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async analyzeStock(symbol: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.TRADING.STOCK_AGENT);
			const result = await client.predict("/predict", {
				symbol: symbol,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// AI Agents
	// ==========================================================================

	async polishPrompt(prompt: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.AGENTS.PROMPT_POLISHER);
			const result = await client.predict("/predict", {
				prompt: prompt,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	async visionChat(imageUrl: string, question: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.AGENTS.QWEN_VL);
			const result = await client.predict("/predict", {
				image: imageUrl,
				question: question,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Object Detection
	// ==========================================================================

	async detectObjects(imageUrl: string): Promise<HFSkillResult> {
		const start = Date.now();
		try {
			const client = await this.getClient(HF_SPACES.DETECTION.SAM3);
			const result = await client.predict("/predict", {
				image: imageUrl,
			});

			return {
				success: true,
				data: result,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - start,
			};
		}
	}

	// ==========================================================================
	// Utility Methods
	// ==========================================================================

	getAvailableSkills(): Record<string, string[]> {
		return {
			image: Object.keys(HF_SPACES.IMAGE),
			edit: Object.keys(HF_SPACES.EDIT),
			threeD: Object.keys(HF_SPACES.THREE_D),
			video: Object.keys(HF_SPACES.VIDEO),
			voice: Object.keys(HF_SPACES.VOICE),
			ocr: Object.keys(HF_SPACES.OCR),
			code: Object.keys(HF_SPACES.CODE),
			trading: Object.keys(HF_SPACES.TRADING),
			agents: Object.keys(HF_SPACES.AGENTS),
			detection: Object.keys(HF_SPACES.DETECTION),
		};
	}

	isAvailable(): boolean {
		return this.hfToken !== null && this.hfToken.length > 0;
	}
}

// Singleton export
export const hfSkills = new HFSkillsService();

// Skill descriptions for help command
export const SKILL_DESCRIPTIONS = {
	// Image
	generateImage: "Generate images from text prompts (Qwen, FLUX, Z-Image)",
	removeBackground: "Remove background from images",
	editImage: "Edit images with text prompts",
	restoreImage: "Restore/enhance low quality images",

	// 3D
	generateModel3D: "Generate 3D models from images (Hunyuan, TRELLIS)",

	// Video
	generateVideo: "Generate short videos from image + prompt",
	interpolateFrames: "Create video between two images",

	// Voice
	textToSpeech: "Convert text to speech (multiple voices)",
	cloneVoice: "Clone voice from reference audio",

	// OCR
	extractText: "Extract text from images/PDFs (OCR)",
	extractEntities: "Extract named entities from text",

	// Code
	generateCode: "Generate code from descriptions",
	generateWebApp: "Generate full web applications",

	// Trading
	analyzeTradingSentiment: "Analyze trading sentiment from news",
	getStockRecommendations: "Get AI stock recommendations",
	generateFinancialReport: "Generate financial reports",
	analyzeStock: "Analyze specific stock symbols",

	// Agents
	polishPrompt: "Improve/polish AI prompts",
	visionChat: "Chat about images with AI",
	detectObjects: "Detect and segment objects in images",
};

export default hfSkills;
