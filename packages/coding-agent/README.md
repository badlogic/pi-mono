# @mariozechner/pi-coding-agent

AI coding assistant with file system access, code execution, and precise editing tools. Built on pi-ai for tool-enabled LLM workflows.

**Note**: Designed for local development environments. Use with caution—tools can modify your filesystem.

## Installation

```bash
npm install @mariozechner/pi-coding-agent
```

## Quick Start

```typescript
import { getModel, CodingAgent, read, bash, edit, write } from '@mariozechner/pi-coding-agent';

// Define tools for the agent
const tools = [
  read({ description: 'Read file contents (text or images)' }),
  bash({ description: 'Execute bash commands (ls, grep, etc.)' }),
  edit({ description: 'Edit files by replacing exact text matches' }),
  write({ description: 'Write or overwrite files, creates directories' })
];

// Create coding agent with model
const agent = new CodingAgent({
  model: getModel('openai', 'gpt-4o-mini'),
  tools,
  systemPrompt: 'You are an expert coding assistant. Use tools to read/edit files, run commands. Be precise and safe.'
});

// Run agent with a task
const task = { role: 'user', content: 'Create a simple Express server in src/server.ts' };

const stream = agent.run(task);

for await (const event of stream) {
  switch (event.type) {
    case 'agent_start':
      console.log('Agent started');
      break;
    case 'message_update':
      if (event.message.role === 'assistant') {
        console.log('Agent:', event.message.content.map(c => c.type === 'text' ? c.text : '[Tool Call]').join(''));
      }
      break;
    case 'tool_execution_start':
      console.log(`Executing: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case 'tool_execution_end':
      if (event.isError) {
        console.error('Tool error:', event.result);
      } else {
        console.log('Tool result:', event.result.output);
      }
      break;
    case 'agent_end':
      console.log('Task complete');
      break;
  }
}

// Get final messages
const messages = await stream.result();
```

## Tools

The agent uses specialized tools for coding tasks. All tools are type-safe with TypeBox schemas and validated at runtime.

### File Reading

```typescript
import { read } from '@mariozechner/pi-coding-agent';

const readTool = read({
  description: 'Read file contents',
  parameters: Type.Object({
    path: Type.String({ description: 'File path (relative or absolute)' })
  })
});

// In agent context
const context = {
  systemPrompt: 'You are a coding assistant.',
  messages: [{ role: 'user', content: 'What\'s in package.json?' }],
  tools: [readTool]
};
```

### Bash Execution

```typescript
import { bash } from '@mariozechner/pi-coding-agent';

const bashTool = bash({
  description: 'Run bash commands',
  parameters: Type.Object({
    command: Type.String({ description: 'Bash command to execute' })
  }),
  timeout: 30000  // 30s default
});

// Example: List files
// Agent calls: bash({ command: 'ls -la' })
// Returns stdout/stderr
```

### Precise Editing

For surgical code changes without overwriting entire files:

```typescript
import { edit } from '@mariozechner/pi-coding-agent';

const editTool = edit({
  description: 'Replace exact text in files',
  parameters: Type.Object({
    path: Type.String({ description: 'File path' }),
    oldText: Type.String({ description: 'Exact text to find (including whitespace)' }),
    newText: Type.String({ description: 'Replacement text' })
  })
});

// Example: Update import in src/index.ts
// edit({ path: 'src/index.ts', oldText: 'import { foo }', newText: 'import { foo, bar }' })
```

### File Writing

```typescript
import { write } from '@mariozechner/pi-coding-agent';

const writeTool = write({
  description: 'Write file content',
  parameters: Type.Object({
    path: Type.String({ description: 'File path' }),
    content: Type.String({ description: 'File content' })
  })
});

// Creates directories if needed, overwrites existing files
// write({ path: 'src/utils/helper.ts', content: 'export const helper = () => { ... };' })
```

### Custom Tools

Extend with custom tools using the pi-ai AgentTool interface:

```typescript
import { Type, AgentTool } from '@mariozechner/pi-ai';

const gitTool: AgentTool<typeof Type.Object({ command: Type.String() })> = {
  name: 'git',
  description: 'Run git commands',
  parameters: Type.Object({ command: Type.String() }),
  execute: async (toolCallId, args) => {
    const { stdout } = await exec(`git ${args.command}`);
    return { output: stdout };
  }
};
```

## Agent Workflow

The coding agent runs in loops until completion:

1. **Task Input**: User provides coding task (e.g., "Implement user auth")
2. **Planning**: Agent may think/reason (if model supports)
3. **Tool Calls**: Agent reads files, runs commands, proposes edits
4. **Execution**: Tools run safely; results fed back to agent
5. **Iteration**: Agent reviews outputs, makes adjustments
6. **Completion**: Agent signals done or asks for clarification

### Streaming Events

Monitor progress with detailed events:

- `agent_start` / `agent_end`: Session boundaries
- `turn_start` / `turn_end`: LLM-tool cycles
- `message_update`: Streaming assistant responses and tool calls
- `tool_execution_start` / `tool_execution_end`: Tool runs with args/results
- `error`: Validation failures or execution errors

### Safety Features

- **Read-Only Mode**: Set `readOnly: true` to disable writes/edits
- **Path Validation**: Restrict to project directory (configurable)
- **Timeout**: 30s default for bash commands
- **Validation**: All tool args validated against schemas
- **Dry Run**: Log actions without executing (for review)

```typescript
const agent = new CodingAgent({
  model: getModel('openai', 'gpt-4o-mini'),
  tools,
  readOnly: process.env.NODE_ENV === 'production',  // Disable writes in prod
  allowedPaths: ['./src', './test'],  // Restrict file access
  dryRun: true  // Log without executing
});
```

## Example Tasks

```typescript
// Refactor code
agent.run({ role: 'user', content: 'Convert src/index.ts to use async/await instead of callbacks' });

// Debug
agent.run({ role: 'user', content: 'Fix the TypeScript error in test/utils.test.ts: "Cannot find name \'describe\'"' });

// New feature
agent.run({ role: 'user', content: 'Add a REST API endpoint to src/server.ts for /users with GET/POST' });

// Analyze
agent.run({ role: 'user', content: 'Review src/ and suggest performance improvements' });
```

## Integration with pi-ai

Built on `@mariozechner/pi-ai`. Use existing Context/Agent APIs:

```typescript
import { CodingAgent, Context } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

const context: Context = {
  systemPrompt: 'Expert TypeScript developer.',
  messages: [
    { role: 'user', content: 'Optimize this loop in src/data.ts' },
    { role: 'assistant', content: [{ type: 'text', text: 'First, let me read the file...' }] }
  ],
  tools: [read({}), edit({})]
};

const agent = new CodingAgent({ model: getModel('anthropic', 'claude-3-5-sonnet-20240620'), tools: context.tools });
const continuation = await agent.continue(context);  // Resume from existing context
```

## Environment

Set up your working directory (current dir becomes project root):

```bash
# Clone or navigate to your project
cd my-project

# Install and run agent
npm install @mariozechner/pi-coding-agent
node -e "
  const { CodingAgent } = require('@mariozechner/pi-coding-agent');
  const agent = new CodingAgent({ model: getModel('openai', 'gpt-4o-mini') });
  await agent.run({ role: 'user', content: process.argv[1] }, { cwd: process.cwd() });
" "Implement fizzbuzz in src/index.ts"
```

## API Keys

Uses pi-ai's key management:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
# etc.
```

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit
