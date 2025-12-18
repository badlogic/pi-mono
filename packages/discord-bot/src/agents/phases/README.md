# Two-Phase Agent Execution Pattern

Based on the [leonvanzyl/autonomous-coding](https://github.com/leonvanzyl/autonomous-coding) pattern, this system splits complex tasks into two phases:

1. **Phase 1: Planning** - Analyze task and generate feature breakdown
2. **Phase 2: Execution** - Execute features one by one with learning

## Quick Start

```typescript
import { runTwoPhaseAgent, getTaskStatus, resumeTask } from "./agents/index.js";

// Run complete workflow (plan + execute)
const result = await runTwoPhaseAgent({
  prompt: "Build a REST API with JWT authentication and user management",
  mode: "coding",
  autoExecute: true,
  continueOnError: true,
});

console.log(`Task ${result.taskId}: ${result.success ? 'COMPLETED' : 'FAILED'}`);
console.log(`Features: ${result.summary.featuresCompleted}/${result.spec.features.length}`);
console.log(`Learnings: ${result.summary.totalLearnings}`);
```

## Core Concepts

### TaskSpec

The central data structure representing a task:

```typescript
interface TaskSpec {
  id: string;              // Unique task ID (UUID)
  title: string;           // Short task title
  description: string;     // Full task description
  features: Feature[];     // Feature breakdown
  status: 'planning' | 'executing' | 'completed' | 'failed';
  mode: string;            // Expertise mode (coding, general, research, trading)
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
  metadata: {
    totalFeatures: number;
    completedFeatures: number;
    failedFeatures: number;
  };
}
```

### Feature

Individual work items within a task:

```typescript
interface Feature {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencies?: string[];  // Feature IDs that must complete first
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: string;          // Execution output
  learnings?: string;       // Extracted learnings
}
```

## Phase 1: Planning

Initialize a task and generate feature breakdown:

```typescript
import { initializeTask } from "./agents/index.js";

const spec = await initializeTask({
  prompt: "Create a user authentication system with JWT tokens",
  mode: "coding",
  maxFeatures: 8,          // Limit feature count
  enableLearning: true,    // Use Act-Learn-Reuse
});

console.log(`Task ID: ${spec.id}`);
console.log(`Features planned: ${spec.features.length}`);

// Features are saved to: src/agents/sessions/{taskId}/spec.json
```

### Feature Prioritization

The planner automatically assigns priorities based on:
- **Critical**: Security, urgent, bug-related
- **High**: Important, core functionality, setup tasks, first feature
- **Medium**: Default priority
- **Low**: Optional, nice-to-have, enhancements, last features

### Dependency Management

Features can have dependencies:

```typescript
// Example feature list:
[
  {
    name: "Setup Database Schema",
    dependencies: [],
    priority: "high"
  },
  {
    name: "Implement Authentication",
    dependencies: ["setup-database-schema"],
    priority: "high"
  },
  {
    name: "Create User Dashboard",
    dependencies: ["implement-authentication"],
    priority: "medium"
  }
]
```

## Phase 2: Execution

Execute features one by one:

### Execute All Features

```typescript
import { executeAllFeatures } from "./agents/index.js";

const results = await executeAllFeatures({
  taskId: spec.id,
  maxRetries: 2,           // Retry failed features
  enableLearning: true,    // Extract learnings
  pauseOnError: false,     // Continue to next feature on error
});

// Each result contains:
results.forEach(result => {
  console.log(`Feature: ${result.currentFeature?.name}`);
  console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Output: ${result.output.substring(0, 200)}...`);
  if (result.learned?.learned) {
    console.log(`Learning: ${result.learned.insight}`);
  }
});
```

### Execute Step by Step

```typescript
import { executeStep, getTaskStatus } from "./agents/index.js";

// Execute one feature at a time
while (true) {
  const status = getTaskStatus(taskId);

  if (!status.canResume) {
    console.log("Task complete!");
    break;
  }

  console.log(`Next: ${status.nextFeature?.name}`);
  const result = await executeStep(taskId);

  console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Progress: ${result.spec.metadata.completedFeatures}/${result.spec.metadata.totalFeatures}`);

  // Pause for user confirmation
  await userConfirm();
}
```

### Execute Single Feature

```typescript
import { executeNextFeature } from "./agents/index.js";

const result = await executeNextFeature({
  taskId: spec.id,
  enableLearning: true,
});

console.log(result.output);
console.log(`Next feature: ${result.nextFeature?.name || 'None'}`);
```

## Orchestration

### Full Workflow

```typescript
import { runTwoPhaseAgent } from "./agents/index.js";

// Plan + Execute in one call
const result = await runTwoPhaseAgent({
  prompt: "Build a trading bot with Hyperliquid integration",
  mode: "trading",
  autoExecute: true,        // Execute after planning
  continueOnError: true,    // Don't stop on failures
  maxRetries: 3,            // Retry failed features
  enableLearning: true,     // Use Act-Learn-Reuse
});

console.log(`Task: ${result.taskId}`);
console.log(`Status: ${result.spec.status}`);
console.log(`Duration: ${result.totalDuration}ms`);
console.log(`Features completed: ${result.summary.featuresCompleted}`);
console.log(`Features failed: ${result.summary.featuresFailed}`);
console.log(`Total learnings: ${result.summary.totalLearnings}`);
```

### Plan Only (No Execution)

```typescript
const result = await runTwoPhaseAgent({
  prompt: "Complex multi-step project",
  mode: "coding",
  autoExecute: false,  // Plan only
});

// Review the plan before executing
console.log("Planned features:");
result.spec.features.forEach((f, i) => {
  console.log(`${i+1}. ${f.name} (${f.priority})`);
  console.log(`   ${f.description}`);
});

// Execute later
const execResult = await resumeTask(result.taskId);
```

### Resume Incomplete Task

```typescript
import { resumeTask } from "./agents/index.js";

// Resume from last checkpoint
const result = await resumeTask(taskId, {
  continueOnError: true,
  maxRetries: 2,
  enableLearning: true,
});
```

### Check Task Progress

```typescript
import { getTaskStatus } from "./agents/index.js";

const status = getTaskStatus(taskId);

console.log(`Task: ${status.taskId}`);
console.log(`Status: ${status.spec.status}`);
console.log(`Progress: ${status.progress.percentComplete}%`);
console.log(`Completed: ${status.progress.completed}`);
console.log(`Failed: ${status.progress.failed}`);
console.log(`Pending: ${status.progress.pending}`);
console.log(`Can resume: ${status.canResume}`);

if (status.nextFeature) {
  console.log(`Next: ${status.nextFeature.name}`);
}
```

### List All Tasks

```typescript
import { listTasks } from "./agents/index.js";

const tasks = listTasks();

tasks.forEach(task => {
  console.log(`${task.taskId}: ${task.spec.title}`);
  console.log(`  ${task.progress.percentComplete}% complete`);
  console.log(`  Status: ${task.spec.status}`);
  console.log(`  Updated: ${task.spec.updatedAt}`);
});
```

## Act-Learn-Reuse Integration

The two-phase system integrates with the Agent Experts learning system:

### Automatic Learning

```typescript
// Learning is enabled by default
const result = await runTwoPhaseAgent({
  prompt: "Build a feature",
  mode: "coding",
  enableLearning: true,  // Extract learnings after each feature
});

// Each feature execution extracts learnings
result.results.forEach(r => {
  if (r.learned?.learned) {
    console.log(`Learned: ${r.learned.insight}`);
    console.log(`Saved to: ${r.learned.expertiseFile}`);
  }
});
```

### Accumulated Expertise

Each feature execution:
1. **ACT**: Loads accumulated expertise for the mode
2. **LEARN**: Extracts learnings from execution output
3. **REUSE**: Next feature benefits from previous learnings

```typescript
// First feature execution
await executeStep(taskId);  // Learns about authentication patterns

// Second feature execution (benefits from first)
await executeStep(taskId);  // Reuses authentication learnings

// Third feature execution (benefits from both)
await executeStep(taskId);  // Even more accumulated knowledge
```

### Expertise Files

Learnings are stored in mode-specific files:

```
src/agents/expertise/
├── coding.md       # Coding expertise
├── general.md      # General expertise
├── research.md     # Research expertise
└── trading.md      # Trading expertise
```

## File Storage

### Session Directory Structure

```
src/agents/sessions/{taskId}/
└── spec.json       # TaskSpec with all features and status
```

### Spec File Format

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Build REST API with authentication",
  "description": "Create a REST API with JWT auth, user management...",
  "features": [
    {
      "id": "f1",
      "name": "Setup Database Schema",
      "description": "Create tables for users, sessions...",
      "status": "completed",
      "priority": "high",
      "startedAt": "2025-12-18T10:00:00Z",
      "completedAt": "2025-12-18T10:05:00Z",
      "output": "Created schema.sql with 3 tables...",
      "learnings": "Always use indexes on foreign keys..."
    },
    {
      "id": "f2",
      "name": "Implement JWT Authentication",
      "description": "Add login/logout endpoints...",
      "status": "in_progress",
      "priority": "high",
      "dependencies": ["f1"],
      "startedAt": "2025-12-18T10:06:00Z"
    }
  ],
  "status": "executing",
  "mode": "coding",
  "createdAt": "2025-12-18T10:00:00Z",
  "updatedAt": "2025-12-18T10:06:00Z",
  "metadata": {
    "totalFeatures": 5,
    "completedFeatures": 1,
    "failedFeatures": 0
  }
}
```

## Error Handling

### Continue on Error

```typescript
const result = await runTwoPhaseAgent({
  prompt: "Multi-step task",
  continueOnError: true,  // Skip failed features, continue to next
});

// Review failures
result.spec.features.forEach(f => {
  if (f.status === 'failed') {
    console.log(`FAILED: ${f.name}`);
    console.log(`Error: ${f.error}`);
  }
});
```

### Pause on Error

```typescript
const result = await runTwoPhaseAgent({
  prompt: "Multi-step task",
  continueOnError: false,  // Stop on first failure
  pauseOnError: true,      // Pause instead of marking as failed
});

// Fix the issue manually, then resume
const resumed = await resumeTask(result.taskId);
```

### Retry Failed Features

```typescript
const result = await runTwoPhaseAgent({
  prompt: "Multi-step task",
  maxRetries: 3,  // Retry each feature up to 3 times
});
```

## Advanced Usage

### Custom Feature Breakdown

```typescript
import { initializeTask, saveTaskSpec } from "./agents/index.js";

// Initialize with default planning
const spec = await initializeTask({
  prompt: "Build a feature",
  mode: "coding",
});

// Modify features manually
spec.features.push({
  id: crypto.randomUUID(),
  name: "Custom Feature",
  description: "Manual feature added",
  status: "pending",
  priority: "high",
  dependencies: [spec.features[0].id],
});

// Save modified spec
saveTaskSpec(spec);

// Execute with custom features
const result = await resumeTask(spec.id);
```

### Re-plan a Task

```typescript
import { replanTask } from "./agents/index.js";

// Re-generate feature breakdown for existing task
const newSpec = await replanTask(taskId, {
  maxFeatures: 15,  // Different feature count
  mode: "coding",   // Same or different mode
});
```

### Manual Feature Updates

```typescript
import { updateFeature, loadTaskSpec } from "./agents/index.js";

// Update feature manually
updateFeature(taskId, featureId, {
  status: "completed",
  output: "Manual completion",
  completedAt: new Date().toISOString(),
});

// Verify update
const spec = loadTaskSpec(taskId);
console.log(spec.features.find(f => f.id === featureId));
```

## Best Practices

1. **Start Small**: Test with simple tasks first
2. **Review Plans**: Use `autoExecute: false` to review feature breakdown
3. **Enable Learning**: Always use `enableLearning: true` for accumulated expertise
4. **Handle Errors**: Decide between `continueOnError` vs `pauseOnError` based on task
5. **Monitor Progress**: Check `getTaskStatus()` for long-running tasks
6. **Save Task IDs**: Store task IDs for resumption
7. **Limit Features**: Use `maxFeatures` to prevent over-planning

## Examples

### Example 1: Code Generation

```typescript
const result = await runTwoPhaseAgent({
  prompt: `Create a TypeScript trading bot with:
  - Hyperliquid API integration
  - WebSocket price feeds
  - Risk management (max position size, stop loss)
  - SQLite trade history
  - Discord notifications`,
  mode: "coding",
  maxFeatures: 12,
  autoExecute: true,
  continueOnError: true,
  maxRetries: 2,
});
```

### Example 2: Research Task

```typescript
const result = await runTwoPhaseAgent({
  prompt: `Research the best DeFi yield farming strategies:
  - Compare top 10 protocols
  - Analyze historical APYs
  - Identify risk factors
  - Recommend top 3 strategies`,
  mode: "research",
  maxFeatures: 6,
  autoExecute: true,
});
```

### Example 3: Step-by-Step Execution

```typescript
// Plan first
const planResult = await runTwoPhaseAgent({
  prompt: "Complex multi-phase project",
  mode: "coding",
  autoExecute: false,
});

console.log("Features planned:");
planResult.spec.features.forEach((f, i) => {
  console.log(`${i+1}. ${f.name} (${f.priority})`);
});

// Execute one feature at a time with user approval
for (let i = 0; i < planResult.spec.features.length; i++) {
  const status = getTaskStatus(planResult.taskId);
  console.log(`\nExecuting: ${status.nextFeature?.name}`);

  const confirm = await askUser("Continue? (y/n)");
  if (confirm !== 'y') break;

  const result = await executeStep(planResult.taskId);
  console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(result.output);
}
```

## Discord Bot Integration

The two-phase system can be integrated into Discord slash commands:

```typescript
// /task create <description>
client.on('interactionCreate', async (interaction) => {
  if (interaction.commandName === 'task') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const description = interaction.options.getString('description');

      await interaction.deferReply();

      const result = await runTwoPhaseAgent({
        prompt: description,
        mode: 'general',
        autoExecute: false,
      });

      const embed = new EmbedBuilder()
        .setTitle(`Task Created: ${result.taskId}`)
        .setDescription(`Planned ${result.spec.features.length} features`)
        .addFields(
          result.spec.features.slice(0, 5).map((f, i) => ({
            name: `${i+1}. ${f.name}`,
            value: f.description.substring(0, 100),
          }))
        );

      await interaction.editReply({ embeds: [embed] });
    }
  }
});

// /task execute <taskId>
// /task status <taskId>
// /task resume <taskId>
// /task step <taskId>
```

## Troubleshooting

### Features Not Executing

Check dependencies:
```typescript
const status = getTaskStatus(taskId);
if (!status.nextFeature && status.progress.pending > 0) {
  console.log("Features have unmet dependencies");

  // Find blocked features
  status.spec.features
    .filter(f => f.status === 'pending')
    .forEach(f => {
      console.log(`${f.name}: waiting for ${f.dependencies}`);
    });
}
```

### Task Stuck in Progress

Reset in-progress features:
```typescript
const spec = loadTaskSpec(taskId);
spec.features.forEach(f => {
  if (f.status === 'in_progress') {
    updateFeature(taskId, f.id, { status: 'pending' });
  }
});
```

### Planning Generated Too Many Features

Limit features:
```typescript
const spec = await initializeTask({
  prompt: "Complex task",
  maxFeatures: 8,  // Hard limit
});

// Or trim manually
spec.features = spec.features.slice(0, 8);
saveTaskSpec(spec);
```

## Performance

- **Planning**: 5-15 seconds (one LLM call)
- **Feature Execution**: 10-60 seconds each (depends on complexity)
- **Total Task**: Linear with feature count

For long tasks (10+ features), use step-by-step execution to monitor progress.
