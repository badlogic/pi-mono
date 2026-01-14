export type ParsedFrontmatter = {
	frontmatter: Record<string, string>;
	body: string;
	keys: string[];
};

const normalizeNewlines = (content: string): string => content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const stripSurroundingQuotes = (value: string): string => {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
};

export const parseFrontmatter = (content: string): ParsedFrontmatter => {
	const normalized = normalizeNewlines(content);
	const frontmatter: Record<string, string> = {};
	const keys: string[] = [];

	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized, keys };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalized, keys };
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match) {
			const key = match[1];
			const value = stripSurroundingQuotes(match[2].trim());
			keys.push(key);
			frontmatter[key] = value;
		}
	}

	return { frontmatter, body, keys };
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body;
