import { isMap, parseDocument } from "yaml";

type ParsedFrontmatter<T extends Record<string, unknown>> = {
	frontmatter: T;
	body: string;
	allKeys: string[];
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const toRecord = (value: unknown): Record<string, unknown> | null => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
};

const extractFrontmatter = (content: string): { block: string | null; body: string } => {
	const normalized = normalizeNewlines(content);

	if (!normalized.startsWith("---")) {
		return { block: null, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { block: null, body: normalized };
	}

	return {
		block: normalized.slice(4, endIndex),
		body: normalized.slice(endIndex + 4).trim(),
	};
};

export const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> => {
	const { block, body } = extractFrontmatter(content);
	if (!block) {
		return { frontmatter: {} as T, body, allKeys: [] };
	}

	try {
		const document = parseDocument(block);
		const parsed = toRecord(document.toJS({ mapAsMap: false })) ?? {};
		const allKeys = isMap(document.contents)
			? document.contents.items.map((item) => item.key?.toString() ?? "").filter((key) => Boolean(key))
			: [];

		return { frontmatter: parsed as T, body, allKeys };
	} catch {
		return { frontmatter: {} as T, body, allKeys: [] };
	}
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body.trim();
