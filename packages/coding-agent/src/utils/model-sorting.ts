function tokenizeModelId(id: string): string[] {
	return id.split(/[.-]/).filter((token) => token.length > 0);
}

function isNumericToken(token: string): boolean {
	return /^\d+$/.test(token);
}

function extractVersion(tokens: string[]): { major: number | null; minor: number | null } {
	// Treat the first 1-2 digit numeric token as major and the next 1-2 digit token as minor.
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (!isNumericToken(token) || token.length > 2) {
			continue;
		}

		const major = Number(token);
		let minor: number | null = null;
		const nextToken = tokens[i + 1];
		if (nextToken && isNumericToken(nextToken) && nextToken.length <= 2) {
			minor = Number(nextToken);
		}
		return { major, minor };
	}

	return { major: null, minor: null };
}

function extractDate(tokens: string[]): number | null {
	// Look for date-like numeric tokens (e.g. 20251101) at the end of the id.
	for (let i = tokens.length - 1; i >= 0; i--) {
		const token = tokens[i]!;
		if (isNumericToken(token) && token.length >= 6 && token.length <= 8) {
			return Number(token);
		}
	}

	return null;
}

export function normalizeModelSearchText(text: string): string {
	return text.replace(/[.-]/g, " ");
}

// Version-first ordering: higher major/minor first, then newer dates, then shorter ids, then lexicographic.
export function compareModelIds(left: string, right: string): number {
	const leftTokens = tokenizeModelId(left);
	const rightTokens = tokenizeModelId(right);
	const leftVersion = extractVersion(leftTokens);
	const rightVersion = extractVersion(rightTokens);

	if (leftVersion.major !== null || rightVersion.major !== null) {
		if (leftVersion.major === null) return 1;
		if (rightVersion.major === null) return -1;
		if (leftVersion.major !== rightVersion.major) {
			return rightVersion.major - leftVersion.major;
		}

		const leftMinor = leftVersion.minor ?? -1;
		const rightMinor = rightVersion.minor ?? -1;
		if (leftMinor !== rightMinor) {
			return rightMinor - leftMinor;
		}

		const leftDate = extractDate(leftTokens);
		const rightDate = extractDate(rightTokens);
		if (leftDate !== null || rightDate !== null) {
			if (leftDate === null) return -1;
			if (rightDate === null) return 1;
			if (leftDate !== rightDate) {
				return rightDate - leftDate;
			}
		}

		if (leftTokens.length !== rightTokens.length) {
			return leftTokens.length - rightTokens.length;
		}
	}

	const leftLower = left.toLowerCase();
	const rightLower = right.toLowerCase();
	if (leftLower !== rightLower) {
		return leftLower.localeCompare(rightLower);
	}

	return left.localeCompare(right);
}
