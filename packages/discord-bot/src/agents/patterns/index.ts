/**
 * Fabric Patterns Integration
 * Sync and execute patterns from danielmiessler/fabric repository
 */

// Pattern synchronization
export {
	clearPatternCache,
	downloadPattern,
	fetchPatternList,
	getPattern,
	getPatternStats,
	hasPattern,
	listPatterns,
	type PatternInfo,
	PRIORITY_PATTERNS,
	searchPatterns,
	syncFabricPatterns,
} from "./fabric-sync.js";

// Pattern execution
export {
	executePattern,
	executePatternBatch,
	executePatternChain,
	executePreset,
	getSuggestedPatterns,
	type PatternChainOptions,
	PatternChainPresets,
	type PatternChainResult,
	type PatternExecuteOptions,
	type PatternExecuteResult,
	QuickPatterns,
	validatePattern,
} from "./pattern-executor.js";
