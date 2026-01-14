type ParsedFrontmatter<T extends Record<string, unknown>> = {
	frontmatter: T;
	body: string;
	allKeys: string[];
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const stripQuotes = (value: string): string => {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
};

export const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> => {
	const frontmatter = {} as T;
	const allKeys: string[] = [];
	const normalized = normalizeNewlines(content);

	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized, allKeys };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalized, allKeys };
	}

	const block = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	for (const line of block.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match) {
			const key = match[1];
			const value = stripQuotes(match[2].trim());
			allKeys.push(key);
			(frontmatter as Record<string, unknown>)[key] = value;
		}
	}

	return { frontmatter, body, allKeys };
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body.trim();
