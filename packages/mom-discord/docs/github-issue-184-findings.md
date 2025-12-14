# GitHub Issue #184 - Discord Transport for Mom

## Issue Link
https://github.com/badlogic/pi-mono/issues/184

## Summary

### Original Proposal (nicobailon)
Refactor the codebase into modular components:
- `mom-core`: Agent logic, prompts, tools, and memory management
- `mom-slack`: Slack-specific transport layer
- `mom-discord`: Discord-specific transport layer

### Mario's Response (badlogic - repo owner)

#### 1. Open to Contribution
- Interested in a draft PR
- Notes recent work integrating `AgentSession` from `coding-agent`
- Should be aware of these changes for compatibility

#### 2. Technical Challenges Identified

| Challenge | Description |
|-----------|-------------|
| Timestamp deduplication | Slack uses unique timestamps for message deduping |
| Message segmentation | Slack enforces size limits requiring message splitting |
| API abstraction | Need a cross-platform transport interface |

#### 3. Structural Preference

**Preferred structure** (single package with transport modules):
```
mom/src/transport/
├── slack.ts (or slack/)
└── discord.ts (or discord/)
```

**Not preferred** (separate packages):
```
packages/
├── mom-core/
├── mom-slack/
└── mom-discord/
```

## How Our Implementation Addresses These Concerns

### Timestamp Deduplication
- **Status**: Already handled
- **Implementation**: Discord uses message IDs similar to Slack's timestamps
- **Location**: `store.ts` has deduplication via `recentlyLogged` Map

### Message Segmentation
- **Status**: Already handled
- **Implementation**: Discord's 2000 char limit handled with `splitMessage()` helper
- **Location**: `discord.ts` in both `createContext()` and `createContextFromInteraction()`

### API Abstraction
- **Status**: Needs work
- **Current state**: Our `DiscordContext` interface is similar to what Slack uses
- **Action needed**: Define a common `TransportContext` interface

## Next Steps

1. Review current `mom` (Slack) package structure
2. Understand the `AgentSession` integration Mario mentioned
3. Design the transport abstraction layer
4. Plan migration from `mom-discord` package to `mom/src/transport/discord/`
5. Create draft PR

## Labels
- enhancement
- pkg:mom
