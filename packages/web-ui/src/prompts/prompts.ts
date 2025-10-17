/**
 * Centralized tool prompts/descriptions.
 * Each prompt is either a string constant or a template function.
 */

// ============================================================================
// JavaScript REPL Tool
// ============================================================================

export const JAVASCRIPT_REPL_TOOL_DESCRIPTION = (runtimeProviderDescriptions: string[]) => `# JavaScript REPL

## Purpose
Execute JavaScript code in a sandboxed browser environment with full Web APIs.

## When to Use
- Quick calculations or data transformations
- Testing JavaScript code snippets in isolation
- Processing data with libraries (XLSX, CSV, etc.)
- Creating artifacts from data

## Environment
- ES2023+ JavaScript (async/await, optional chaining, nullish coalescing, etc.)
- All browser APIs: DOM, Canvas, WebGL, Fetch, Web Workers, WebSockets, Crypto, etc.
- Import any npm package: await import('https://esm.run/package-name')

## Common Libraries
- XLSX: const XLSX = await import('https://esm.run/xlsx');
- CSV: const Papa = (await import('https://esm.run/papaparse')).default;
- Chart.js: const Chart = (await import('https://esm.run/chart.js/auto')).default;
- Three.js: const THREE = await import('https://esm.run/three');

## Persistence between tool calls
- Objects stored on global scope do not persist between calls.
- Use artifacts as a key-value JSON object store:
  - Use createOrUpdateArtifact(filename, content) to persist data between calls. JSON objects are auto-stringified.
  - Use listArtifacts() and getArtifact(filename) to read persisted data. JSON files are auto-parsed to objects.
  - Prefer to use a single artifact throughout the session to store intermediate data (e.g. 'data.json').

## Input
- You have access to the user's attachments via listAttachments(), readTextAttachment(id), and readBinaryAttachment(id)
- You have access to previously created artifacts via listArtifacts() and getArtifact(filename)

## Output
- All console.log() calls are captured for you to inspect. The user does not see these logs.
- Create artifacts for file results (images, JSON, CSV, etc.) which persiste throughout the
  session and are accessible to you and the user.

## Example
const data = [10, 20, 15, 25];
const sum = data.reduce((a, b) => a + b, 0);
const avg = sum / data.length;
console.log('Sum:', sum, 'Average:', avg);

## Important Notes
- Graphics: Use fixed dimensions (800x600), NOT window.innerWidth/Height
- Chart.js: Set options: { responsive: false, animation: false }
- Three.js: renderer.setSize(800, 600) with matching aspect ratio

## Helper Functions (Automatically Available)

These functions are injected into the execution environment and available globally:

${runtimeProviderDescriptions.join("\n\n")}
`;

// ============================================================================
// Artifacts Tool
// ============================================================================

export const ARTIFACTS_TOOL_DESCRIPTION = (runtimeProviderDescriptions: string[]) => `# Artifacts

Create and manage persistent files that live alongside the conversation.

## When to Use - Artifacts Tool vs REPL

**Use artifacts tool when YOU are the author:**
- Writing research summaries, analysis, ideas, documentation
- Creating markdown notes for user to read
- Building HTML applications/visualizations that present data
- Creating HTML artifacts that render charts from programmatically generated data

**Use repl + artifact storage functions when CODE processes data:**
- Scraping workflows that extract and store data
- Processing CSV/Excel files programmatically
- Data transformation pipelines
- Binary file generation requiring libraries (PDF, DOCX)

**Pattern: REPL generates data → Artifacts tool creates HTML that visualizes it**
Example: repl scrapes products → stores products.json → you author dashboard.html that reads products.json and renders Chart.js visualizations

## Input
- { action: "create", filename: "notes.md", content: "..." } - Create new file
- { action: "update", filename: "notes.md", old_str: "...", new_str: "..." } - Update part of file (PREFERRED)
- { action: "rewrite", filename: "notes.md", content: "..." } - Replace entire file (LAST RESORT)
- { action: "get", filename: "data.json" } - Retrieve file content
- { action: "delete", filename: "old.csv" } - Delete file
- { action: "htmlArtifactLogs", filename: "app.html" } - Get console logs from HTML artifact

## Returns
Depends on action:
- create/update/rewrite/delete: Success status or error
- get: File content
- htmlArtifactLogs: Console logs and errors

## Supported File Types
✅ Text-based files you author: .md, .txt, .html, .js, .css, .json, .csv, .svg
❌ Binary files requiring libraries (use repl): .pdf, .docx

## Critical - Prefer Update Over Rewrite
❌ NEVER: get entire file + rewrite to change small sections
✅ ALWAYS: update for targeted edits (token efficient)
✅ Ask: Can I describe the change as old_str → new_str? Use update.

---

## HTML Artifacts

Interactive HTML applications that can visualize data from other artifacts.

### Data Access
- Can read artifacts created by repl and user attachments
- Use to build dashboards, visualizations, interactive tools
- See Helper Functions section below for available functions

### Requirements
- Self-contained single file
- Import ES modules from esm.sh: <script type="module">import X from 'https://esm.sh/pkg';</script>
- Use Tailwind CDN: <script src="https://cdn.tailwindcss.com"></script>
- Can embed images from any domain: <img src="https://example.com/image.jpg">
- MUST set background color explicitly (avoid transparent)
- Inline CSS or Tailwind utility classes
- No localStorage/sessionStorage

### Styling
- Use Tailwind utility classes for clean, functional designs
- Ensure responsive layout (iframe may be resized)
- Avoid purple gradients, AI aesthetic clichés, and emojis

### Helper Functions (Automatically Available)

These functions are injected into HTML artifact sandbox:

${runtimeProviderDescriptions.join("\n\n")}
`;

// ============================================================================
// Artifacts Runtime Provider
// ============================================================================

export const ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RW = `
### Artifacts Storage

Create, read, update, and delete files in artifacts storage.

#### When to Use
- Store intermediate results between tool calls
- Save generated files (images, CSVs, processed data) for user to view and download

#### Do NOT Use For
- Content you author directly, like summaries of content you read (use artifacts tool instead)

#### Functions
- listArtifacts() - List all artifact filenames, returns Promise<string[]>
- getArtifact(filename) - Read artifact content, returns Promise<string | object>. JSON files auto-parse to objects, binary files return base64 string
- createOrUpdateArtifact(filename, content, mimeType?) - Create or update artifact, returns Promise<void>. JSON files auto-stringify objects, binary requires base64 string with mimeType
- deleteArtifact(filename) - Delete artifact, returns Promise<void>

#### Example
JSON workflow:
\`\`\`javascript
// Fetch and save
const response = await fetch('https://api.example.com/products');
const products = await response.json();
await createOrUpdateArtifact('products.json', products);

// Later: read and filter
const all = await getArtifact('products.json');
const cheap = all.filter(p => p.price < 100);
await createOrUpdateArtifact('cheap.json', cheap);
\`\`\`

Binary file (image):
\`\`\`javascript
const canvas = document.createElement('canvas');
canvas.width = 800; canvas.height = 600;
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'blue';
ctx.fillRect(0, 0, 800, 600);
// Remove data:image/png;base64, prefix
const base64 = canvas.toDataURL().split(',')[1];
await createOrUpdateArtifact('chart.png', base64, 'image/png');
\`\`\`
`;

export const ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RO = `
### Artifacts Storage

Read files from artifacts storage.

#### When to Use
- Read artifacts created by REPL or artifacts tool
- Access data from other HTML artifacts
- Load configuration or data files

#### Do NOT Use For
- Creating new artifacts (not available in HTML artifacts)
- Modifying artifacts (read-only access)

#### Functions
- listArtifacts() - List all artifact filenames, returns Promise<string[]>
- getArtifact(filename) - Read artifact content, returns Promise<string | object>. JSON files auto-parse to objects, binary files return base64 string

#### Example
JSON data:
\`\`\`javascript
const products = await getArtifact('products.json');
const html = products.map(p => \`<div>\${p.name}: $\${p.price}</div>\`).join('');
document.body.innerHTML = html;
\`\`\`

Binary image:
\`\`\`javascript
const base64 = await getArtifact('chart.png');
const img = document.createElement('img');
img.src = 'data:image/png;base64,' + base64;
document.body.appendChild(img);
\`\`\`
`;

// ============================================================================
// Attachments Runtime Provider
// ============================================================================

export const ATTACHMENTS_RUNTIME_DESCRIPTION = `
### User Attachments

Read files the user uploaded to the conversation.

#### When to Use
- Process user-uploaded files (CSV, JSON, Excel, images, PDFs)

#### Functions
- listAttachments() - List all attachments, returns array of {id, fileName, mimeType, size}
- readTextAttachment(id) - Read attachment as text, returns string
- readBinaryAttachment(id) - Read attachment as binary data, returns Uint8Array

#### Example
CSV file:
\`\`\`javascript
const files = listAttachments();
const csvFile = files.find(f => f.fileName.endsWith('.csv'));
const csvData = readTextAttachment(csvFile.id);
const rows = csvData.split('\\n').map(row => row.split(','));
\`\`\`

Excel file:
\`\`\`javascript
const XLSX = await import('https://esm.run/xlsx');
const files = listAttachments();
const xlsxFile = files.find(f => f.fileName.endsWith('.xlsx'));
const bytes = readBinaryAttachment(xlsxFile.id);
const workbook = XLSX.read(bytes);
const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
\`\`\`
`;

// ============================================================================
// Extract Document Tool
// ============================================================================

export const EXTRACT_DOCUMENT_DESCRIPTION = `# Extract Document

Extract plain text from documents on the web (PDF, DOCX, XLSX, PPTX).

## When to Use
User wants you to read a document at a URL.

## Input
- { url: "https://example.com/document.pdf" } - URL to PDF, DOCX, XLSX, or PPTX

## Returns
Structured plain text with page/sheet/slide delimiters.`;
