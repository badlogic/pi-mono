# Letta Code Integration Analysis for Pi-Mono

## Executive Summary

This analysis compares Letta Code's skill learning system with pi-mono's Act-Learn-Reuse expertise system, identifies integration opportunities, and proposes an implementation plan.

---

## 1. Architecture Comparison

### Letta Code Skill System

| Component | Implementation | Location |
|-----------|----------------|----------|
| **Storage** | Letta API (external service) + local `.skills/` | Memory blocks via API |
| **Discovery** | Dynamic SKILL.md file scanning | `.skills/**/SKILL.md` |
| **Metadata** | YAML frontmatter | `id`, `name`, `description`, `category`, `tags` |
| **Loading** | Progressive disclosure (3 levels) | Metadata → Body → Resources |
| **Resources** | Bundled directories | `scripts/`, `references/`, `assets/` |
| **Persistence** | Letta API memory blocks | `skills`, `loaded_skills` blocks |

**Key Features:**
```typescript
// Skill discovery
export async function discoverSkills(dir: string): Promise<SkillMetadata[]>
// Recursively finds SKILL.md files, parses frontmatter

// Skill loading
export async function loadSkill(skillId: string, depth: 'metadata' | 'body' | 'full')
// Progressive disclosure - only load what's needed
```

### Pi-Mono Expertise System

| Component | Implementation | Location |
|-----------|----------------|----------|
| **Storage** | Local filesystem only | `src/agents/expertise/*.md` |
| **Discovery** | Predefined mode list | Mode → `{mode}.md` file |
| **Metadata** | Inline markdown | Title, last updated, session count |
| **Loading** | Full file injection | All expertise loaded at once |
| **Resources** | None | Expertise is text-only |
| **Persistence** | Immediate file writes | No external API |

**Key Features:**
```typescript
// Act-Learn-Reuse cycle
export async function actLearnReuse<T>(
  mode: string,
  task: string,
  executor: (enhancedTask: string) => Promise<{success, output}>
): Promise<{success, output, learned: LearningResult}>

// Learning extraction
export function extractLearnings(output: string): string
// Pattern-based extraction from agent output
```

---

## 2. Detailed Comparison Matrix

| Aspect | Letta Code | Pi-Mono | Winner |
|--------|------------|---------|--------|
| **Discoverability** | Dynamic skill discovery | Static mode list | Letta |
| **Modularity** | Bundled resources (scripts/refs/assets) | Text-only | Letta |
| **Learning** | No automatic learning | Act-Learn-Reuse pattern | Pi-Mono |
| **Simplicity** | Complex (API required) | Simple (filesystem only) | Pi-Mono |
| **Progressive Loading** | 3-level disclosure | All-or-nothing | Letta |
| **Offline Support** | Partial (needs Letta API) | Full | Pi-Mono |
| **Metadata** | Rich frontmatter | Basic inline | Letta |
| **Self-Improvement** | Manual skill creation | Automatic learning | Pi-Mono |
| **Resource Bundling** | Scripts, references, assets | None | Letta |
| **Session Management** | Memory blocks | Session insights section | Tie |

---

## 3. Integration Opportunities

### 3.1 Adopt Letta-Style Skill Bundles (HIGH VALUE)

**Current pi-mono structure:**
```
src/agents/expertise/
├── trading.md
├── security.md
└── coding.md
```

**Proposed hybrid structure:**
```
src/agents/skills/
├── trading/
│   ├── SKILL.md          # Frontmatter + description
│   ├── expertise.md      # Accumulated learnings (auto-updated)
│   ├── scripts/
│   │   └── backtest.py   # Bundled tools
│   └── references/
│       └── strategies.md # Reference documents
├── security/
│   ├── SKILL.md
│   ├── expertise.md
│   └── references/
│       └── owasp.md
└── ...
```

### 3.2 Add Frontmatter Metadata (MEDIUM VALUE)

**Current expertise file:**
```markdown
# Trading Expert

## Mental Model
Accumulated expertise for trading...

*Last updated: Never*
```

**Proposed with frontmatter:**
```markdown
---
id: trading
name: Trading Expert
description: Market analysis, signals, and risk management
category: financial
tags: [trading, crypto, signals, risk]
version: 1.0.0
priority: high
---

# Trading Expert

## Mental Model
...
```

### 3.3 Implement Progressive Disclosure (MEDIUM VALUE)

**Proposed loading levels:**
1. **Metadata** - Just frontmatter (for listing/searching)
2. **Body** - SKILL.md content (for context injection)
3. **Full** - Including bundled resources (for deep execution)

```typescript
export type LoadDepth = 'metadata' | 'body' | 'full';

export async function loadSkill(skillId: string, depth: LoadDepth): Promise<Skill> {
  if (depth === 'metadata') return parseMetadata(skillId);
  if (depth === 'body') return { ...metadata, body: await readBody(skillId) };
  return { ...body, resources: await loadResources(skillId) };
}
```

### 3.4 Keep Act-Learn-Reuse Pattern (PRESERVE)

The pi-mono learning system is **superior** to Letta's manual approach:
- Automatic extraction of learnings from agent output
- Session-based insight accumulation
- Self-improvement prompts that teach agents HOW to learn
- Bounded growth (max 5 recent insights)

**Recommendation:** Keep this pattern, extend it to work with new skill bundles.

### 3.5 Optional Letta API Integration (LOW PRIORITY)

Add optional persistence to Letta API for:
- Cross-device synchronization
- Team sharing of expertise
- Version history

```typescript
export interface SkillStorage {
  local: FilesystemStorage;   // Always available
  remote?: LettaAPIStorage;   // Optional sync
}
```

---

## 4. Implementation Plan

### Phase 1: Skill Bundle Structure (Priority: HIGH)

**Objective:** Migrate from flat files to bundled skill directories

**Tasks:**
1. Create `src/agents/skills/` directory structure
2. Add SKILL.md parser with frontmatter support
3. Migrate existing 21 expertise files to bundle format
4. Update `expertise-manager.ts` to support new structure
5. Maintain backward compatibility with legacy files

**Files to modify:**
- `src/agents/expertise-manager.ts` → `src/agents/skill-manager.ts`
- Create `src/agents/skills/*/SKILL.md` for each domain

**Estimated changes:** ~300 LOC

### Phase 2: Progressive Disclosure (Priority: MEDIUM)

**Objective:** Only load what's needed

**Tasks:**
1. Implement `LoadDepth` type and loading functions
2. Add skill discovery (scan for SKILL.md files)
3. Create skill indexing for fast lookup
4. Update agent prompts to use appropriate depth

**Files to create:**
- `src/agents/skill-loader.ts`
- `src/agents/skill-index.ts`

**Estimated changes:** ~200 LOC

### Phase 3: Resource Bundling (Priority: MEDIUM)

**Objective:** Allow scripts, references, and assets per skill

**Tasks:**
1. Define resource types and loaders
2. Add script execution capability
3. Add reference document injection
4. Create asset management

**New features:**
- `scripts/` - Executable helper scripts
- `references/` - Context documents for injection
- `assets/` - Images, data files, templates

**Estimated changes:** ~250 LOC

### Phase 4: Enhanced Learning (Priority: LOW)

**Objective:** Improve learning extraction and persistence

**Tasks:**
1. Add learning quality scoring
2. Implement learning deduplication
3. Add cross-skill learning transfer
4. Create learning analytics

---

## 5. Proposed API

### New Skill Manager Interface

```typescript
// src/agents/skill-manager.ts

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  version?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface SkillBody extends SkillMetadata {
  body: string;           // SKILL.md content
  expertise?: string;     // Accumulated learnings
}

export interface Skill extends SkillBody {
  resources: {
    scripts?: string[];   // Paths to executable scripts
    references?: string[];// Paths to reference docs
    assets?: string[];    // Paths to asset files
  };
}

export class SkillManager {
  // Discovery
  async discoverSkills(): Promise<SkillMetadata[]>;
  async searchSkills(query: string): Promise<SkillMetadata[]>;

  // Loading (progressive disclosure)
  async loadSkill(id: string, depth?: LoadDepth): Promise<Skill>;
  async loadSkillResource(id: string, type: ResourceType, name: string): Promise<string>;

  // Learning (Act-Learn-Reuse preserved)
  async recordLearning(id: string, insight: string, task: string): Promise<LearningResult>;
  getExpertise(id: string): string;

  // Lifecycle
  async actLearnReuse<T>(skillId: string, task: string, executor: Executor<T>): Promise<ALRResult<T>>;
}
```

### Migration Path

```typescript
// Backward compatibility
export function loadExpertise(mode: string): string {
  // Try new skill bundle first
  if (existsSync(getSkillPath(mode))) {
    return skillManager.getExpertise(mode);
  }
  // Fall back to legacy expertise file
  return legacyLoadExpertise(mode);
}
```

---

## 6. File Structure After Integration

```
src/agents/
├── skill-manager.ts        # NEW: Main skill management
├── skill-loader.ts         # NEW: Progressive loading
├── skill-index.ts          # NEW: Skill discovery/search
├── expertise-manager.ts    # MODIFIED: Calls skill-manager
├── expertise/              # LEGACY: Keep for backward compat
│   └── *.md
└── skills/                 # NEW: Bundled skills
    ├── trading/
    │   ├── SKILL.md
    │   ├── expertise.md
    │   ├── scripts/
    │   │   └── backtest.py
    │   └── references/
    │       └── strategies.md
    ├── security/
    │   ├── SKILL.md
    │   ├── expertise.md
    │   └── references/
    │       └── owasp-top-10.md
    ├── coding/
    │   ├── SKILL.md
    │   ├── expertise.md
    │   └── references/
    │       └── best-practices.md
    └── ...
```

---

## 7. Summary

### What to Adopt from Letta Code:
1. ✅ Skill bundle structure (SKILL.md + resources)
2. ✅ YAML frontmatter for rich metadata
3. ✅ Progressive disclosure (load only what's needed)
4. ✅ Resource bundling (scripts, references, assets)
5. ⚠️ Optional: Letta API for remote persistence

### What to Keep from Pi-Mono:
1. ✅ Act-Learn-Reuse pattern (automatic learning)
2. ✅ Session-based insights
3. ✅ Self-improvement prompts
4. ✅ Local filesystem storage (offline-first)
5. ✅ Learning extraction patterns

### Hybrid Advantage:
The integration creates a **best-of-both-worlds** system:
- Letta's organization and discoverability
- Pi-mono's automatic learning and self-improvement
- Bundled resources for rich skill capabilities
- Progressive loading for performance
- Offline-first with optional cloud sync

---

*Analysis completed: 2025-12-19*
*Recommendation: Proceed with Phase 1 (Skill Bundle Structure)*
