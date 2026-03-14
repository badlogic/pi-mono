import { parse } from "yaml";

type ParsedFrontmatter<T extends Record<string, unknown>> = {
	frontmatter: T;
	body: string;
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const stripUtf8Bom = (value: string): string => value.replace(/^\uFEFF/, "");
const normalizeFrontmatterInput = (value: string): string => stripUtf8Bom(normalizeNewlines(value));

const extractFrontmatter = (content: string): { yamlString: string | null; body: string } => {
	const normalized = normalizeFrontmatterInput(content);
	const leadingFrontmatterMatch = normalized.match(/^\s*---(?:\n|$)/);

	if (!leadingFrontmatterMatch) {
		return { yamlString: null, body: normalized };
	}

	const frontmatterStartIndex = leadingFrontmatterMatch[0].length;
	const endIndex = normalized.indexOf("\n---", frontmatterStartIndex);
	if (endIndex === -1) {
		return { yamlString: null, body: normalized };
	}

	return {
		yamlString: normalized.slice(frontmatterStartIndex, endIndex),
		body: normalized.slice(endIndex + 4).trim(),
	};
};

export const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> => {
	const { yamlString, body } = extractFrontmatter(content);
	if (!yamlString) {
		return { frontmatter: {} as T, body };
	}
	const parsed = parse(yamlString);
	return { frontmatter: (parsed ?? {}) as T, body };
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body;
