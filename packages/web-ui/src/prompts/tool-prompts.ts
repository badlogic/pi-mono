/**
 * Centralized tool prompts/descriptions.
 * Each prompt is either a string constant or a template function.
 */

// ============================================================================
// JavaScript REPL Tool
// ============================================================================

export const JAVASCRIPT_REPL_DESCRIPTION = `# JavaScript REPL

## Purpose
Execute JavaScript code in a sandboxed browser environment with full Web APIs.

## When to Use
- Quick calculations or data transformations
- Testing JavaScript code snippets
- Processing data with libraries (XLSX, CSV, etc.)
- Creating visualizations (charts, graphs)

## Environment
- ES2023+ JavaScript (async/await, optional chaining, nullish coalescing, etc.)
- All browser APIs: DOM, Canvas, WebGL, Fetch, Web Workers, WebSockets, Crypto, etc.
- Import any npm package: await import('https://esm.run/package-name')

## Common Libraries
- XLSX: const XLSX = await import('https://esm.run/xlsx');
- CSV: const Papa = (await import('https://esm.run/papaparse')).default;
- Chart.js: const Chart = (await import('https://esm.run/chart.js/auto')).default;
- Three.js: const THREE = await import('https://esm.run/three');
- Lodash: const _ = await import('https://esm.run/lodash-es');
- D3.js: const d3 = await import('https://esm.run/d3');

## Important Notes
- Graphics: Use fixed dimensions (800x600), NOT window.innerWidth/Height
- Chart.js: Set options: { responsive: false, animation: false }
- Three.js: renderer.setSize(800, 600) with matching aspect ratio
- Output: All console.log() calls are captured and displayed

## Example
const data = [10, 20, 15, 25];
const sum = data.reduce((a, b) => a + b, 0);
const avg = sum / data.length;
console.log('Sum:', sum, 'Average:', avg);`;

// ============================================================================
// Artifacts Tool
// ============================================================================

export const ARTIFACTS_BASE_DESCRIPTION = `Creates and manages file artifacts. Each artifact is a file with a filename and content.

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
✅ Use 'update' command for surgical, targeted modifications`;

export const ARTIFACTS_RUNTIME_EXAMPLE = `- Example HTML artifact that processes a CSV attachment:
  <script>
    // List available files
    const files = listAttachments();
    console.log('Available files:', files);

    // Find CSV file
    const csvFile = files.find(f => f.mimeType === 'text/csv');
    if (csvFile) {
      const csvContent = readTextAttachment(csvFile.id);
      // Process CSV data...
    }

    // Display image
    const imageFile = files.find(f => f.mimeType.startsWith('image/'));
    if (imageFile) {
      const bytes = readBinaryAttachment(imageFile.id);
      const blob = new Blob([bytes], {type: imageFile.mimeType});
      const url = URL.createObjectURL(blob);
      document.body.innerHTML = '<img src="' + url + '">';
    }
  </script>
`;

export const ARTIFACTS_HTML_SECTION = `
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
- Ensure HTML artifacts have a defined background color`;

/**
 * Build complete artifacts description with optional provider docs.
 */
export function buildArtifactsDescription(providerDocs?: string): string {
	const runtimeSection = providerDocs
		? `

For text/html artifacts with runtime capabilities:${providerDocs}
${ARTIFACTS_RUNTIME_EXAMPLE}
`
		: "";

	return ARTIFACTS_BASE_DESCRIPTION + runtimeSection + ARTIFACTS_HTML_SECTION;
}

// ============================================================================
// Artifacts Runtime Provider
// ============================================================================

export const ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION = `
Artifact Management from within executed code (HTML/JavaScript REPL).

WHEN TO USE THESE FUNCTIONS:
- ONLY when writing code that programmatically generates/transforms data
- Examples: Web scraping results, processed CSV data, generated charts saved as JSON
- The artifact content is CREATED BY THE CODE, not by you directly

DO NOT USE THESE FUNCTIONS FOR:
- Summaries or notes YOU write (use artifacts tool instead)
- Content YOU author directly (use artifacts tool instead)

Functions:
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

Example - Scraping data and saving it:
  const response = await fetch('https://api.example.com/data');
  const data = await response.json();
  await createOrUpdateArtifact('api-results.json', data);

Binary data must be converted to a base64 string before passing to createOrUpdateArtifact.
Example:
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  await createOrUpdateArtifact('image.png', base64);
`;

// ============================================================================
// Downloadable File Runtime Provider
// ============================================================================

export const DOWNLOADABLE_FILE_RUNTIME_DESCRIPTION = `
Downloadable Files (one-time downloads for the user - YOU cannot read these back):
- await returnDownloadableFile(filename, content, mimeType?) - Create downloadable file (async!)
  * Use for: Processed/transformed data, generated images, analysis results
  * Important: This creates a download for the user. You will NOT be able to access this file's content later.
  * If you need to access the data later, use createArtifact() instead (if available).
  * Always use await with returnDownloadableFile
  * REQUIRED: For Blob/Uint8Array binary content, you MUST supply a proper MIME type (e.g., "image/png").
    If omitted, throws an Error with stack trace pointing to the offending line.
  * Strings without a MIME default to text/plain.
  * Objects are auto-JSON stringified and default to application/json unless a MIME is provided.
  * Canvas images: Use toBlob() with await Promise wrapper
  * Examples:
    - await returnDownloadableFile('cleaned-data.csv', csvString, 'text/csv')
    - await returnDownloadableFile('analysis.json', {results: [...]}, 'application/json')
    - await returnDownloadableFile('chart.png', blob, 'image/png')`;

// ============================================================================
// Attachments Runtime Provider
// ============================================================================

export const ATTACHMENTS_RUNTIME_DESCRIPTION = `
User Attachments (files the user added to the conversation):
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

Common pattern - Process attachment and create download:
  const files = listAttachments();
  const csvFile = files.find(f => f.fileName.endsWith('.csv'));
  const csvData = readTextAttachment(csvFile.id);
  // Process csvData...
  await returnDownloadableFile('processed-' + csvFile.fileName, processedData, 'text/csv');`;
