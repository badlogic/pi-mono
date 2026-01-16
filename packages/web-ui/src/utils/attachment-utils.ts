import { parseAsync } from "docx-preview";
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";
import { i18n } from "./i18n.js";

// Configure PDF.js worker - we'll need to bundle this
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export interface Attachment {
	id: string;
	type: "image" | "document";
	fileName: string;
	mimeType: string;
	size: number;
	content: string; // base64 encoded original data (without data URL prefix)
	extractedText?: string; // For documents: <pdf filename="..."><page number="1">text</page></pdf>
	preview?: string; // base64 image preview (first page for PDFs, or same as content for images)
}

/**
 * Load an attachment from various sources
 * @param source - URL string, File, Blob, or ArrayBuffer
 * @param fileName - Optional filename override
 * @returns Promise<Attachment>
 * @throws Error if loading fails
 */
export async function loadAttachment(
	source: string | File | Blob | ArrayBuffer,
	fileName?: string,
): Promise<Attachment> {
	let arrayBuffer: ArrayBuffer;
	let detectedFileName = fileName || "unnamed";
	let mimeType = "application/octet-stream";
	let size = 0;

	// Convert source to ArrayBuffer
	if (typeof source === "string") {
		// It's a URL - fetch it
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(i18n("Failed to fetch file"));
		}
		arrayBuffer = await response.arrayBuffer();
		size = arrayBuffer.byteLength;
		mimeType = response.headers.get("content-type") || mimeType;
		if (!fileName) {
			// Try to extract filename from URL
			const urlParts = source.split("/");
			detectedFileName = urlParts[urlParts.length - 1] || "document";
		}
	} else if (source instanceof File) {
		arrayBuffer = await source.arrayBuffer();
		size = source.size;
		mimeType = source.type || mimeType;
		detectedFileName = fileName || source.name;
	} else if (source instanceof Blob) {
		arrayBuffer = await source.arrayBuffer();
		size = source.size;
		mimeType = source.type || mimeType;
	} else if (source instanceof ArrayBuffer) {
		arrayBuffer = source;
		size = source.byteLength;
	} else {
		throw new Error(i18n("Invalid source type"));
	}

	// Convert ArrayBuffer to base64 - handle large files properly
	const uint8Array = new Uint8Array(arrayBuffer);
	let binary = "";
	const chunkSize = 0x8000; // Process in 32KB chunks to avoid stack overflow
	for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.slice(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	const base64Content = btoa(binary);

	// Detect type and process accordingly
	const id = `${detectedFileName}_${Date.now()}_${Math.random()}`;

	// Check if it's a PDF
	if (mimeType === "application/pdf" || detectedFileName.toLowerCase().endsWith(".pdf")) {
		const { extractedText, preview } = await processPdf(arrayBuffer, detectedFileName);
		return {
			id,
			type: "document",
			fileName: detectedFileName,
			mimeType: "application/pdf",
			size,
			content: base64Content,
			extractedText,
			preview,
		};
	}

	// Check if it's a DOCX file
	if (
		mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		detectedFileName.toLowerCase().endsWith(".docx")
	) {
		const { extractedText } = await processDocx(arrayBuffer, detectedFileName);
		return {
			id,
			type: "document",
			fileName: detectedFileName,
			mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			size,
			content: base64Content,
			extractedText,
		};
	}

	// Check if it's a PPTX file
	if (
		mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
		detectedFileName.toLowerCase().endsWith(".pptx")
	) {
		const { extractedText } = await processPptx(arrayBuffer, detectedFileName);
		return {
			id,
			type: "document",
			fileName: detectedFileName,
			mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
			size,
			content: base64Content,
			extractedText,
		};
	}

	// Check if it's an Excel file (XLSX/XLS)
	const excelMimeTypes = [
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-excel",
	];
	if (
		excelMimeTypes.includes(mimeType) ||
		detectedFileName.toLowerCase().endsWith(".xlsx") ||
		detectedFileName.toLowerCase().endsWith(".xls")
	) {
		const { extractedText } = await processExcel(arrayBuffer, detectedFileName);
		return {
			id,
			type: "document",
			fileName: detectedFileName,
			mimeType: mimeType.startsWith("application/vnd")
				? mimeType
				: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			size,
			content: base64Content,
			extractedText,
		};
	}

	// Check if it's an image
	if (mimeType.startsWith("image/")) {
		return {
			id,
			type: "image",
			fileName: detectedFileName,
			mimeType,
			size,
			content: base64Content,
			preview: base64Content, // For images, preview is the same as content
		};
	}

	// Check if it's a text document
	const textExtensions = [
		".txt",
		".md",
		".json",
		".xml",
		".html",
		".css",
		".js",
		".ts",
		".jsx",
		".tsx",
		".yml",
		".yaml",
	];
	const isTextFile =
		mimeType.startsWith("text/") || textExtensions.some((ext) => detectedFileName.toLowerCase().endsWith(ext));

	if (isTextFile) {
		const decoder = new TextDecoder();
		const text = decoder.decode(arrayBuffer);
		return {
			id,
			type: "document",
			fileName: detectedFileName,
			mimeType: mimeType.startsWith("text/") ? mimeType : "text/plain",
			size,
			content: base64Content,
			extractedText: text,
		};
	}

	throw new Error(`Unsupported file type: ${mimeType}`);
}

async function processPdf(
	arrayBuffer: ArrayBuffer,
	fileName: string,
): Promise<{ extractedText: string; preview?: string }> {
	let pdf: PDFDocumentProxy | null = null;
	try {
		pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

		// Extract text with page structure
		let extractedText = `<pdf filename="${fileName}">`;
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const textContent = await page.getTextContent();
			const pageText = textContent.items
				.map((item: any) => item.str)
				.filter((str: string) => str.trim())
				.join(" ");
			extractedText += `\n<page number="${i}">\n${pageText}\n</page>`;
		}
		extractedText += "\n</pdf>";

		// Generate preview from first page
		const preview = await generatePdfPreview(pdf);

		return { extractedText, preview };
	} catch (error) {
		console.error("Error processing PDF:", error);
		throw new Error(`Failed to process PDF: ${String(error)}`);
	} finally {
		// Clean up PDF resources
		if (pdf) {
			pdf.destroy();
		}
	}
}

async function generatePdfPreview(pdf: PDFDocumentProxy): Promise<string | undefined> {
	try {
		const page = await pdf.getPage(1);
		const viewport = page.getViewport({ scale: 1.0 });

		// Create canvas with reasonable size for thumbnail (160x160 max)
		const scale = Math.min(160 / viewport.width, 160 / viewport.height);
		const scaledViewport = page.getViewport({ scale });

		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) {
			return undefined;
		}

		canvas.height = scaledViewport.height;
		canvas.width = scaledViewport.width;

		const renderContext = {
			canvasContext: context,
			viewport: scaledViewport,
			canvas: canvas,
		};
		await page.render(renderContext).promise;

		// Return base64 without data URL prefix
		return canvas.toDataURL("image/png").split(",")[1];
	} catch (error) {
		console.error("Error generating PDF preview:", error);
		return undefined;
	}
}

async function processDocx(arrayBuffer: ArrayBuffer, fileName: string): Promise<{ extractedText: string }> {
	try {
		// Parse document structure
		const wordDoc = await parseAsync(arrayBuffer);

		// Extract structured text from document body
		let extractedText = `<docx filename="${fileName}">\n<page number="1">\n`;

		const body = wordDoc.documentPart?.body;
		if (body?.children) {
			// Walk through document elements and extract text
			const texts: string[] = [];
			for (const element of body.children) {
				const text = extractTextFromElement(element);
				if (text) {
					texts.push(text);
				}
			}
			extractedText += texts.join("\n");
		}

		extractedText += `\n</page>\n</docx>`;
		return { extractedText };
	} catch (error) {
		console.error("Error processing DOCX:", error);
		throw new Error(`Failed to process DOCX: ${String(error)}`);
	}
}

function extractTextFromElement(element: any): string {
	let text = "";

	// Check type with lowercase
	const elementType = element.type?.toLowerCase() || "";

	// Handle paragraphs
	if (elementType === "paragraph" && element.children) {
		for (const child of element.children) {
			const childType = child.type?.toLowerCase() || "";
			if (childType === "run" && child.children) {
				for (const textChild of child.children) {
					const textType = textChild.type?.toLowerCase() || "";
					if (textType === "text") {
						text += textChild.text || "";
					}
				}
			} else if (childType === "text") {
				text += child.text || "";
			}
		}
	}
	// Handle tables
	else if (elementType === "table") {
		if (element.children) {
			const tableTexts: string[] = [];
			for (const row of element.children) {
				const rowType = row.type?.toLowerCase() || "";
				if (rowType === "tablerow" && row.children) {
					const rowTexts: string[] = [];
					for (const cell of row.children) {
						const cellType = cell.type?.toLowerCase() || "";
						if (cellType === "tablecell" && cell.children) {
							const cellTexts: string[] = [];
							for (const cellElement of cell.children) {
								const cellText = extractTextFromElement(cellElement);
								if (cellText) cellTexts.push(cellText);
							}
							if (cellTexts.length > 0) rowTexts.push(cellTexts.join(" "));
						}
					}
					if (rowTexts.length > 0) tableTexts.push(rowTexts.join(" | "));
				}
			}
			if (tableTexts.length > 0) {
				text = `\n[Table]\n${tableTexts.join("\n")}\n[/Table]\n`;
			}
		}
	}
	// Recursively handle other container elements
	else if (element.children && Array.isArray(element.children)) {
		const childTexts: string[] = [];
		for (const child of element.children) {
			const childText = extractTextFromElement(child);
			if (childText) childTexts.push(childText);
		}
		text = childTexts.join(" ");
	}

	return text.trim();
}

async function processPptx(arrayBuffer: ArrayBuffer, fileName: string): Promise<{ extractedText: string }> {
	try {
		// Load the PPTX file as a ZIP
		const zip = await JSZip.loadAsync(arrayBuffer);

		// PPTX slides are stored in ppt/slides/slide[n].xml
		let extractedText = `<pptx filename="${fileName}">`;

		// Get all slide files and sort them numerically
		const slideFiles = Object.keys(zip.files)
			.filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
			.sort((a, b) => {
				const numA = Number.parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
				const numB = Number.parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || "0", 10);
				return numA - numB;
			});

		// Extract text from each slide
		for (let i = 0; i < slideFiles.length; i++) {
			const slideFile = zip.file(slideFiles[i]);
			if (slideFile) {
				const slideXml = await slideFile.async("text");

				// Extract text from XML (simple regex approach)
				// Looking for <a:t> tags which contain text in PPTX
				const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);

				if (textMatches) {
					extractedText += `\n<slide number="${i + 1}">`;
					const slideTexts = textMatches
						.map((match) => {
							const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
							return textMatch ? textMatch[1] : "";
						})
						.filter((t) => t.trim());

					if (slideTexts.length > 0) {
						extractedText += `\n${slideTexts.join("\n")}`;
					}
					extractedText += "\n</slide>";
				}
			}
		}

		// Also try to extract text from notes
		const notesFiles = Object.keys(zip.files)
			.filter((name) => name.match(/ppt\/notesSlides\/notesSlide\d+\.xml$/))
			.sort((a, b) => {
				const numA = Number.parseInt(a.match(/notesSlide(\d+)\.xml$/)?.[1] || "0", 10);
				const numB = Number.parseInt(b.match(/notesSlide(\d+)\.xml$/)?.[1] || "0", 10);
				return numA - numB;
			});

		if (notesFiles.length > 0) {
			extractedText += "\n<notes>";
			for (const noteFile of notesFiles) {
				const file = zip.file(noteFile);
				if (file) {
					const noteXml = await file.async("text");
					const textMatches = noteXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
					if (textMatches) {
						const noteTexts = textMatches
							.map((match) => {
								const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
								return textMatch ? textMatch[1] : "";
							})
							.filter((t) => t.trim());

						if (noteTexts.length > 0) {
							const slideNum = noteFile.match(/notesSlide(\d+)\.xml$/)?.[1];
							extractedText += `\n[Slide ${slideNum} notes]: ${noteTexts.join(" ")}`;
						}
					}
				}
			}
			extractedText += "\n</notes>";
		}

		extractedText += "\n</pptx>";
		return { extractedText };
	} catch (error) {
		console.error("Error processing PPTX:", error);
		throw new Error(`Failed to process PPTX: ${String(error)}`);
	}
}

async function processExcel(arrayBuffer: ArrayBuffer, fileName: string): Promise<{ extractedText: string }> {
	try {
		// Read the workbook
		const workbook = XLSX.read(arrayBuffer, { type: "array" });

		let extractedText = `<excel filename="${fileName}">`;

		// Process each sheet
		for (const [index, sheetName] of workbook.SheetNames.entries()) {
			const worksheet = workbook.Sheets[sheetName];

			// Extract text as CSV for the extractedText field
			const csvText = XLSX.utils.sheet_to_csv(worksheet);
			extractedText += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csvText}\n</sheet>`;
		}

		extractedText += "\n</excel>";

		return { extractedText };
	} catch (error) {
		console.error("Error processing Excel:", error);
		throw new Error(`Failed to process Excel: ${String(error)}`);
	}
}
