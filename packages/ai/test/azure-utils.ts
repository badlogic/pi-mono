/**
 * Utility functions for Azure OpenAI tests
 */

export function hasAzureOpenAICredentials(): boolean {
	const hasKey = !!process.env.AZURE_OPENAI_API_KEY;
	const hasEndpoint = !!(process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_RESOURCE_NAME);
	return hasKey && hasEndpoint;
}
