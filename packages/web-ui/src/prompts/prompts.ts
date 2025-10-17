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

## Library functions
You can use the following functions in your code:

${runtimeProviderDescriptions.join("\n\n")}
`;

// ============================================================================
// Artifacts Tool
// ============================================================================

export const ARTIFACTS_TOOL_DESCRIPTION = (
	runtimeProviderDescriptions: string[],
) => `Creates and manages file artifacts. Each artifact is a file with a filename and content.

CRITICAL - ARTIFACT UPDATE WORKFLOW:
1. Creating new file? → Use 'create'
2. Changing specific section(s)? → Use 'update' (PREFERRED - token efficient)
3. Complete structural overhaul? → Use 'rewrite' (last resort only)

❌ NEVER regenerate entire documents to change small sections
✅ ALWAYS use 'update' for targeted edits (adding sources, fixing sections, appending to lists)

Commands:
1. create: Create a new file
   - filename: Name with extension (required, e.g., 'summary.md', 'index.html')
   - title: Display name for the tab (optional, defaults to filename)
   - content: File content (required)
   - Use for: Brand new files only

2. update: Update part of an existing file (PREFERRED for edits)
   - filename: File to update (required)
   - old_str: Exact string to replace (required, can be multi-line)
   - new_str: Replacement string (required)
   - Use for: Adding sources, fixing typos, updating sections, appending content
   - Token efficient - only transmits the changed portion
   - Example: Adding source link to a section

3. rewrite: Completely replace a file's content (LAST RESORT)
   - filename: File to rewrite (required)
   - content: New content (required)
   - Use ONLY when: Complete structural overhaul needed
   - DO NOT use for: Adding one line, fixing one section, appending content

4. get: Retrieve the full content of a file
   - filename: File to retrieve (required)
   - Returns the complete file content

5. delete: Delete a file
   - filename: File to delete (required)

6. logs: Get console logs and errors (HTML files only)
   - filename: HTML file to get logs for (required)

ANTI-PATTERNS TO AVOID:
❌ Using 'get' + modifying content + 'rewrite' to change one section
❌ Using createOrUpdateArtifact() in code for manual edits YOU make
✅ Use 'update' command for surgical, targeted modifications

For text/html artifacts:
- Must be a single self-contained file
- External scripts: Use CDNs like https://esm.sh, https://unpkg.com, or https://cdnjs.cloudflare.com
- Preferred: Use https://esm.sh for npm packages (e.g., https://esm.sh/three for Three.js)
- For ES modules, use: <script type="module">import * as THREE from 'https://esm.sh/three';</script>
- For Three.js specifically: import from 'https://esm.sh/three' or 'https://esm.sh/three@0.160.0'
- For addons: import from 'https://esm.sh/three/examples/jsm/controls/OrbitControls.js'
- No localStorage/sessionStorage - use in-memory variables only
- CSS should be included inline
- CRITICAL REMINDER FOR HTML ARTIFACTS:
	- ALWAYS set a background color inline in <style> or directly on body element
	- Failure to set a background color is a COMPLIANCE ERROR
	- Background color MUST be explicitly defined to ensure visibility and proper rendering
- Can embed base64 images directly in img tags
- Ensure the layout is responsive as the iframe might be resized
- Note: Network errors (404s) for external scripts may not be captured in logs due to browser security

For application/vnd.ant.code artifacts:
- Include the language parameter for syntax highlighting
- Supports all major programming languages

For text/markdown:
- Standard markdown syntax
- Will be rendered with full formatting
- Can include base64 images using markdown syntax

For image/svg+xml:
- Complete SVG markup
- Will be rendered inline
- Can embed raster images as base64 in SVG

CRITICAL REMINDER FOR ALL ARTIFACTS:
- Prefer to update existing files rather than creating new ones
- Keep filenames consistent and descriptive
- Use appropriate file extensions
- Ensure HTML artifacts have a defined background color

The following functions are available inside your code in HTML artifacts:

${runtimeProviderDescriptions.join("\n\n")}
`;

// ============================================================================
// Artifacts Runtime Provider
// ============================================================================

export const ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION = `
### Artifacts

Programmatically create, read, update, and delete artifact files from your code.

#### When to Use
- Persist data or state between REPL calls
- ONLY when writing code that programmatically generates/transforms data
- Examples: Web scraping results, processed CSV data, generated charts saved as JSON
- The artifact content is CREATED BY THE CODE, not by you directly

#### Do NOT Use For
- Summaries or notes YOU write (use artifacts tool instead)
- Content YOU author directly (use artifacts tool instead)

#### Functions
- await listArtifacts() - Get list of all artifact filenames, returns string[]
  * Example: const files = await listArtifacts(); // ['data.json', 'notes.md']

- await getArtifact(filename) - Read artifact content, returns string or object
  * Auto-parses .json files to objects
  * Example: const data = await getArtifact('data.json'); // Returns parsed object

- await createOrUpdateArtifact(filename, content, mimeType?) - Create/update artifact FROM CODE
  * ONLY use when the content is generated programmatically by your code
  * Auto-stringifies objects for .json files
  * Example: await createOrUpdateArtifact('scraped-data.json', results)
  * Example: await createOrUpdateArtifact('chart.png', base64ImageData, 'image/png')

- await deleteArtifact(filename) - Delete an artifact
  * Example: await deleteArtifact('temp.json')

#### Example
Scraping data and saving it:
\`\`\`javascript
const response = await fetch('https://api.example.com/data');
const data = await response.json();
await createOrUpdateArtifact('api-results.json', data);
\`\`\`

Binary data (convert to base64 first):
\`\`\`javascript
const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
const arrayBuffer = await blob.arrayBuffer();
const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
await createOrUpdateArtifact('image.png', base64);
\`\`\`
`;

// ============================================================================
// Attachments Runtime Provider
// ============================================================================

export const ATTACHMENTS_RUNTIME_DESCRIPTION = `
### User Attachments

Read files that the user has uploaded to the conversation.

#### When to Use
- When you need to read or process files the user has uploaded to the conversation
- Examples: CSV data files, JSON datasets, Excel spreadsheets, images, PDFs

#### Do NOT Use For
- Creating new files (use createOrUpdateArtifact instead)
- Modifying existing files (read first, then create artifact with modified version)

#### Functions
- listAttachments() - List all attachments, returns array of {id, fileName, mimeType, size}
  * Example: const files = listAttachments(); // [{id: '...', fileName: 'data.xlsx', mimeType: '...', size: 12345}]

- readTextAttachment(attachmentId) - Read attachment as text, returns string
  * Use for: CSV, JSON, TXT, XML, and other text-based files
  * Example: const csvContent = readTextAttachment(files[0].id);
  * Example: const json = JSON.parse(readTextAttachment(jsonFile.id));

- readBinaryAttachment(attachmentId) - Read attachment as binary data, returns Uint8Array
  * Use for: Excel (.xlsx), images, PDFs, and other binary files
  * Example: const xlsxBytes = readBinaryAttachment(files[0].id);
  * Example: const XLSX = await import('https://esm.run/xlsx'); const workbook = XLSX.read(xlsxBytes);

#### Example
Processing CSV attachment:
\`\`\`javascript
const files = listAttachments();
const csvFile = files.find(f => f.fileName.endsWith('.csv'));
const csvData = readTextAttachment(csvFile.id);
const rows = csvData.split('\\n').map(row => row.split(','));
console.log(\`Found \${rows.length} rows\`);
\`\`\`

Processing Excel attachment:
\`\`\`javascript
const XLSX = await import('https://esm.run/xlsx');
const files = listAttachments();
const excelFile = files.find(f => f.fileName.endsWith('.xlsx'));
const bytes = readBinaryAttachment(excelFile.id);
const workbook = XLSX.read(bytes);
const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
const jsonData = XLSX.utils.sheet_to_json(firstSheet);
\`\`\`
`;

// ============================================================================
// Extract Document Tool
// ============================================================================

export const EXTRACT_DOCUMENT_DESCRIPTION = `Extract plain text from documents on the web (PDF, DOCX, XLSX, PPTX).

## Purpose
Use this when the user wants you to read a document at a URL.

## Parameters
- url: URL of the document (PDF, DOCX, XLSX, or PPTX only)

## Returns
Structured plain text with page/sheet/slide delimiters in XML-like format:
- PDFs: <pdf filename="..."><page number="1">text</page>...</pdf>
- Word: <docx filename="..."><page number="1">text</page></docx>
- Excel: <excel filename="..."><sheet name="Sheet1" index="1">CSV data</sheet>...</excel>
- PowerPoint: <pptx filename="..."><slide number="1">text</slide>...<notes>...</notes></pptx>

## Important Notes
- Maximum file size: 50MB
- CORS restrictions may block some URLs - if this happens, the error will guide you to help the user configure a CORS proxy
- Format is automatically detected from file extension and Content-Type header`;
