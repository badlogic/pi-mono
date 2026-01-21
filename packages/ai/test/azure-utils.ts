/**
 * Utility functions for Azure OpenAI tests
 */

export function hasAzureOpenAICredentials(): boolean {
	const hasKey = !!process.env.AZURE_OPENAI_API_KEY;
	const hasBaseUrl = !!(process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_OPENAI_RESOURCE_NAME);
	return hasKey && hasBaseUrl;
}
