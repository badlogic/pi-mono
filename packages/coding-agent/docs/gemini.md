# Gemini OAuth Integration Guide

This document provides a comprehensive analysis of how OAuth authentication could be implemented for Google Gemini in the pi coding-agent, based on the existing Anthropic OAuth implementation and the Gemini CLI's approach.

## Table of Contents

1. [Current Anthropic OAuth Implementation](#current-anthropic-oauth-implementation)
2. [Gemini CLI Authentication Analysis](#gemini-cli-authentication-analysis)
3. [Gemini API Capabilities](#gemini-api-capabilities)
4. [Gemini API Endpoints](#gemini-api-endpoints)
5. [Implementation Plan](#implementation-plan)

## Current Anthropic OAuth Implementation

The pi coding-agent implements OAuth for Anthropic with the following architecture:

### Key Components

1. **OAuth Flow** (`packages/coding-agent/src/core/oauth/anthropic.ts`):
   - Uses PKCE (Proof Key for Code Exchange) flow for security
   - Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
   - Authorization URL: `https://claude.ai/oauth/authorize`
   - Token URL: `https://console.anthropic.com/v1/oauth/token`
   - Scopes: `org:create_api_key user:profile user:inference`

2. **Token Storage** (`packages/coding-agent/src/core/oauth/storage.ts`):
   - Stores credentials in `~/.pi/agent/oauth.json`
   - File permissions set to 0600 (owner read/write only)
   - Format: `{ provider: { type: "oauth", refresh: string, access: string, expires: number } }`

3. **Token Management** (`packages/coding-agent/src/core/oauth/index.ts`):
   - Auto-refresh tokens when expired (with 5-minute buffer)
   - Supports multiple providers through `SupportedOAuthProvider` type
   - Provider info includes id, name, and availability status

4. **Model Integration** (`packages/coding-agent/src/core/model-config.ts`):
   - Checks OAuth tokens first, then environment variables
   - OAuth status cached to avoid repeated file reads
   - Maps providers to OAuth providers via `providerToOAuthProvider`

### Authentication Flow

1. User initiates login with `pi auth login`
2. Authorization URL is generated with PKCE challenge
3. User opens URL in browser and authorizes
4. User copies authorization code (format: `code#state`)
5. Code is exchanged for access/refresh tokens
6. Tokens are saved encrypted with expiry time

## Gemini CLI Authentication Analysis

The Gemini CLI uses a more complex OAuth implementation with several key differences:

### Authentication Methods

Gemini supports multiple authentication types:
- `LOGIN_WITH_GOOGLE` (OAuth personal account)
- `USE_GEMINI` (API key)
- `USE_VERTEX_AI` (Vertex AI)
- `COMPUTE_ADC` (Application Default Credentials)

### OAuth Implementation Details

1. **OAuth Configuration**:
   - Client ID and Secret: See [google-gemini/gemini-cli oauth2.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts) (public for installed apps per Google's OAuth docs)
   - Scopes:
     - `https://www.googleapis.com/auth/cloud-platform`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`

2. **Authentication Flows**:
   - **Web Flow**: Opens browser, runs local HTTP server for callback
   - **User Code Flow**: For environments without browser (NO_BROWSER=true)
   - Uses Google's `google-auth-library` for OAuth handling

3. **Token Storage**:
   - Supports encrypted storage via `OAuthCredentialStorage`
   - Falls back to plain JSON storage
   - Stores user info (email) separately

4. **API Integration**:
   - Uses `CodeAssistServer` for API calls
   - Endpoint: `https://cloudcode-pa.googleapis.com`
   - Includes user tier information (FREE, STANDARD, etc.)

## Gemini API Capabilities

Based on the Gemini CLI analysis:

### System Prompts
✅ **Yes, Gemini supports system prompts**
- Implemented via `getCoreSystemPrompt()` in the codebase
- System instructions are part of the `GenerateContentParameters`

### Tools/Function Calling
✅ **Yes, Gemini supports tools and function calling**
- Uses the `Tool` type from `@google/genai`
- Extensive tool support including:
  - File system operations (read, write, edit)
  - Web search and fetch
  - MCP (Model Context Protocol) tools
  - Custom tool registration

### Content Generation
- Supports streaming and non-streaming generation
- Token counting capabilities
- Embedding support
- Context compression for long conversations

## Gemini API Endpoints

When using OAuth tokens, the Gemini CLI talks to:

### Primary Endpoint
- **Base URL**: `https://cloudcode-pa.googleapis.com`
- **API Version**: `v1internal`

### Key Methods
- `generateContent` - Non-streaming content generation
- `streamGenerateContent` - Streaming content generation
- `countTokens` - Token counting
- `embedContent` - Text embeddings
- `loadCodeAssist` - User setup and tier information
- `onboardUser` - User onboarding

### Authentication
- OAuth tokens are passed via `AuthClient` from `google-auth-library`
- Tokens are automatically refreshed by the library
- Project ID and session ID included in requests

## Implementation Plan

### 1. Add Gemini OAuth Provider Support

**File**: `packages/coding-agent/src/core/oauth/gemini.ts`

```typescript
import { OAuth2Client } from 'google-auth-library';
import { type OAuthCredentials, saveOAuthCredentials } from "./storage.js";

// OAuth credentials from google-gemini/gemini-cli:
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];

export async function loginGemini(
  onAuthUrl: (url: string) => void,
  onPromptCode: () => Promise<string>,
): Promise<void> {
  // Implementation similar to Anthropic but using google-auth-library
}

export async function refreshGeminiToken(refreshToken: string): Promise<OAuthCredentials> {
  // Use google-auth-library for refresh
}
```

### 2. Update OAuth Index

**File**: `packages/coding-agent/src/core/oauth/index.ts`

```typescript
export type SupportedOAuthProvider = "anthropic" | "github-copilot" | "gemini";

// Add Gemini to provider list
{
  id: "gemini",
  name: "Google Gemini (Code Assist)",
  available: true,
}

// Add cases for Gemini in login/refresh functions
```

### 3. Create Gemini API Client

**File**: `packages/ai/src/providers/gemini-oauth.ts`

```typescript
export class GeminiOAuthProvider implements Provider {
  // Implement Provider interface
  // Use CodeAssistServer approach from Gemini CLI
  // Map to standard pi-ai API format
}
```

### 4. Update Model Configuration

**File**: `packages/coding-agent/src/core/model-config.ts`

```typescript
// Add to providerToOAuthProvider mapping
gemini: "gemini",

// Add Gemini OAuth token check
if (model.provider === "gemini") {
  const oauthToken = await getOAuthToken("gemini");
  if (oauthToken) return oauthToken;
  const oauthEnv = process.env.GEMINI_OAUTH_TOKEN;
  if (oauthEnv) return oauthEnv;
}
```

### 5. Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "google-auth-library": "^9.0.0"
  }
}
```

### 6. Environment Variables

Support these environment variables:
- `GEMINI_OAUTH_TOKEN` - Manual OAuth token
- `GOOGLE_CLOUD_PROJECT` - For project-specific features
- `NO_BROWSER` - Force user code flow

### Key Differences from Anthropic Implementation

1. **Authentication Library**: Use `google-auth-library` instead of manual OAuth
2. **Multiple Auth Types**: Support OAuth, API key, and ADC
3. **User Info**: Fetch and cache user email/profile
4. **Project Context**: Include project ID in API calls
5. **Tier Management**: Handle user tier (FREE/STANDARD) responses

### Challenges and Considerations

1. **API Access**: The Code Assist API (`cloudcode-pa.googleapis.com`) might require special access or be in preview
2. **Model Naming**: Need to map Gemini model names to Code Assist equivalents
3. **Rate Limits**: Handle tier-based rate limits
4. **Error Handling**: Map Google-specific errors to pi error types
5. **Token Scopes**: Ensure scopes are sufficient for all operations

### Testing Plan

1. Test OAuth flow (browser and NO_BROWSER modes)
2. Test token refresh
3. Test API calls with OAuth tokens
4. Test fallback to API keys
5. Test error scenarios (invalid tokens, network errors)
6. Test model switching and tier limits

### Migration Path

1. Users with `GEMINI_API_KEY` continue working unchanged
2. New `pi auth login gemini` command for OAuth
3. OAuth takes precedence over API keys when available
4. Clear messaging about benefits (higher limits, better features)