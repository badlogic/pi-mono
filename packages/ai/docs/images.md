# Image Input Support for LLM Providers

This document describes how to submit images to different LLM provider APIs and proposes an abstraction layer for unified image handling.

## Provider-Specific Image Support

### 1. Anthropic (Claude)

**Supported Models**: Claude 3 and Claude 4 families (Sonnet, Haiku, Opus)

**Image Formats**: JPEG, PNG, GIF, WebP

**Methods**:
1. **Base64 Encoding**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/jpeg",
        "data": "<base64_encoded_image_data>"
      }
    },
    {
      "type": "text",
      "text": "What's in this image?"
    }
  ]
}
```

2. **URL Support**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "image",
      "source": {
        "type": "url",
        "url": "https://example.com/image.jpg"
      }
    }
  ]
}
```

**Limitations**:
- Maximum 20 images per request
- Each image max 3.75 MB
- Maximum dimensions: 8,000px × 8,000px
- Images are ephemeral (not stored beyond request duration)

### 2. Google GenAI (Gemini)

**Supported Models**: Gemini Pro Vision, Gemini 1.5, Gemini 2.0

**Image Formats**: JPEG, PNG, GIF, WebP

**Methods**:
1. **Inline Base64 Data** (for files < 20MB):
```json
{
  "contents": [{
    "parts": [
      {
        "inline_data": {
          "mime_type": "image/jpeg",
          "data": "BASE64_ENCODED_IMAGE_DATA"
        }
      },
      {
        "text": "Describe this image"
      }
    ]
  }]
}
```

2. **File API** (for larger files or reuse):
- Upload file first using File API
- Reference by file URI in subsequent requests

**Limitations**:
- Inline data: Total request size (text + images) < 20MB
- Base64 encoding increases size in transit
- Returns HTTP 413 if request too large

### 3. OpenAI Chat Completions (GPT-4o, GPT-4o-mini)

**Supported Models**: GPT-4o, GPT-4o-mini, GPT-4-turbo with vision

**Image Formats**: JPEG, PNG, GIF, WebP

**Methods**:
1. **URL Reference**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "What's in this image?"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/image.jpg"
      }
    }
  ]
}
```

2. **Base64 Data URL**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,<base64_encoded_image>"
      }
    }
  ]
}
```

**Note**: Despite the field name `image_url`, base64 data URLs are supported.

### 4. OpenAI Responses API (o1, o3, o4-mini)

**Vision Support by Model**:
- ✅ **o1**: Full vision support
- ✅ **o3**: Vision support + image generation
- ✅ **o4-mini**: Vision support + image generation
- ❌ **o3-mini**: No vision capabilities
- ✅ **o3-pro**: Vision analysis (no generation)

**Methods**: Same as Chat Completions API
- URL references
- Base64 data URLs

**Note**: Vision capabilities integrated into reasoning chain-of-thought for more contextually rich responses.

## Proposed Unified Abstraction

### Image Content Type

```typescript
interface ImageContent {
  type: "image";
  source: ImageSource;
  alt?: string; // Optional alt text for accessibility
}

type ImageSource = 
  | { type: "base64"; data: string; mimeType: string }
  | { type: "url"; url: string }
  | { type: "file"; path: string }; // Local file path
```

### Unified Message Structure

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
}

interface TextContent {
  type: "text";
  text: string;
}
```

### Provider Adapter Implementation

Each provider adapter would:

1. **Check Model Capabilities**:
```typescript
if (model.input.includes("image")) {
  // Process image content
} else {
  // Throw error or ignore images
}
```

2. **Convert to Provider Format**:

```typescript
// Anthropic converter
function toAnthropicContent(content: (TextContent | ImageContent)[]) {
  return content.map(item => {
    if (item.type === "image") {
      if (item.source.type === "base64") {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: item.source.mimeType,
            data: item.source.data
          }
        };
      } else if (item.source.type === "url") {
        return {
          type: "image",
          source: {
            type: "url",
            url: item.source.url
          }
        };
      } else if (item.source.type === "file") {
        // Read file and convert to base64
        const data = fs.readFileSync(item.source.path).toString('base64');
        const mimeType = getMimeType(item.source.path);
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data
          }
        };
      }
    }
    return { type: "text", text: item.text };
  });
}

// OpenAI converter
function toOpenAIContent(content: (TextContent | ImageContent)[]) {
  return content.map(item => {
    if (item.type === "image") {
      if (item.source.type === "base64") {
        return {
          type: "image_url",
          image_url: {
            url: `data:${item.source.mimeType};base64,${item.source.data}`
          }
        };
      } else if (item.source.type === "url") {
        return {
          type: "image_url",
          image_url: { url: item.source.url }
        };
      } else if (item.source.type === "file") {
        // Read and convert to data URL
        const data = fs.readFileSync(item.source.path).toString('base64');
        const mimeType = getMimeType(item.source.path);
        return {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${data}`
          }
        };
      }
    }
    return { type: "text", text: item.text };
  });
}

// Google converter
function toGoogleContent(content: (TextContent | ImageContent)[]) {
  return content.map(item => {
    if (item.type === "image") {
      if (item.source.type === "base64") {
        return {
          inline_data: {
            mime_type: item.source.mimeType,
            data: item.source.data
          }
        };
      } else if (item.source.type === "url") {
        // Google doesn't support external URLs directly
        // Would need to fetch and convert to base64
        throw new Error("Google GenAI requires base64 or File API for images");
      } else if (item.source.type === "file") {
        const data = fs.readFileSync(item.source.path).toString('base64');
        const mimeType = getMimeType(item.source.path);
        return {
          inline_data: {
            mime_type: mimeType,
            data
          }
        };
      }
    }
    return { text: item.text };
  });
}
```

### Size and Format Validation

```typescript
interface ImageConstraints {
  maxSizeMB: number;
  maxWidth: number;
  maxHeight: number;
  maxCount: number;
  supportedFormats: string[];
}

const PROVIDER_CONSTRAINTS: Record<string, ImageConstraints> = {
  anthropic: {
    maxSizeMB: 3.75,
    maxWidth: 8000,
    maxHeight: 8000,
    maxCount: 20,
    supportedFormats: ["image/jpeg", "image/png", "image/gif", "image/webp"]
  },
  google: {
    maxSizeMB: 20, // for inline data
    maxWidth: Infinity,
    maxHeight: Infinity,
    maxCount: Infinity,
    supportedFormats: ["image/jpeg", "image/png", "image/gif", "image/webp"]
  },
  openai: {
    maxSizeMB: 20,
    maxWidth: Infinity,
    maxHeight: Infinity,
    maxCount: Infinity,
    supportedFormats: ["image/jpeg", "image/png", "image/gif", "image/webp"]
  }
};

async function validateImage(
  source: ImageSource, 
  provider: string
): Promise<void> {
  const constraints = PROVIDER_CONSTRAINTS[provider];
  
  // Get image data
  let imageBuffer: Buffer;
  if (source.type === "file") {
    imageBuffer = await fs.readFile(source.path);
  } else if (source.type === "base64") {
    imageBuffer = Buffer.from(source.data, 'base64');
  } else {
    // For URLs, might need to fetch and validate
    return;
  }
  
  // Check size
  const sizeMB = imageBuffer.length / (1024 * 1024);
  if (sizeMB > constraints.maxSizeMB) {
    throw new Error(`Image exceeds ${constraints.maxSizeMB}MB limit`);
  }
  
  // Could add dimension checks using image processing library
}
```

## Implementation Considerations

1. **Automatic Format Conversion**:
   - Convert URLs to base64 for providers that don't support URLs
   - Handle file paths by reading and encoding files
   - Optimize image size/quality when needed

2. **Error Handling**:
   - Validate image formats before sending
   - Check model capabilities
   - Provide clear error messages for unsupported features

3. **Performance**:
   - Cache base64 encodings for reused images
   - Stream large images when possible
   - Consider using provider-specific file upload APIs for large images

4. **Token Counting**:
   - Images consume tokens (varies by provider)
   - Include image token estimates in usage calculations

5. **Fallback Strategies**:
   - If model doesn't support images, extract text description
   - Offer image-to-text preprocessing options