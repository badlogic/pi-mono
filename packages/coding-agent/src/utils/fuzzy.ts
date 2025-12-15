// Fuzzy search. Matches if all query characters appear in order (not necessarily consecutive).
// Lower score = better match.

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();

	if (queryLower.length === 0) {
		return { matches: true, score: 0 };
	}

	if (queryLower.length > textLower.length) {
		return { matches: false, score: 0 };
	}

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
		if (textLower[i] === queryLower[queryIndex]) {
			const isWordBoundary = i === 0 || /[\s\-_./]/.test(textLower[i - 1]!);

			// Reward consecutive character matches (e.g., typing "foo" matches "foobar" better than "f_o_o")
			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				// Penalize gaps between matched characters
				if (lastMatchIndex >= 0) {
					score += (i - lastMatchIndex - 1) * 2;
				}
			}

			// Reward matches at word boundaries (start of words are more likely intentional targets)
			if (isWordBoundary) {
				score -= 10;
			}

			// Slight penalty for matches later in the string (prefer earlier matches)
			score += i * 0.1;

			lastMatchIndex = i;
			queryIndex++;
		}
	}

	// Not all query characters were found in order
	if (queryIndex < queryLower.length) {
		return { matches: false, score: 0 };
	}

	return { matches: true, score };
}

// Filter and sort items by fuzzy match quality (best matches first)
// Supports space-separated tokens: all tokens must match, sorted by match count then score
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	if (!query.trim()) {
		return items;
	}

	// Split query into tokens
	const tokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items;
	}

	const results: { item: T; totalScore: number }[] = [];

	for (const item of items) {
		const text = getText(item);
		let totalScore = 0;
		let allMatch = true;

		// Check each token against the text - ALL must match
		for (const token of tokens) {
			const match = fuzzyMatch(token, text);
			if (match.matches) {
				totalScore += match.score;
			} else {
				allMatch = false;
				break;
			}
		}

		// Only include if all tokens match
		if (allMatch) {
			results.push({ item, totalScore });
		}
	}

	// Sort by score (asc, lower is better)
	results.sort((a, b) => a.totalScore - b.totalScore);

	return results.map((r) => r.item);
}
