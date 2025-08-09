# Implementation Plan

## Core Principles
- TypeScript throughout
- Clean, minimal code
- Self-contained modules
- Direct SSH execution (no remote manager)
- All state in local JSON

## Package 1: Pod Setup Script Generation
Generate and execute pod_setup.sh via SSH

- [ ] `src/setup/generate-setup-script.ts` - Generate bash script as string
  - [ ] Detect CUDA driver version
  - [ ] Determine CUDA toolkit version needed
  - [ ] Generate uv/Python install commands
  - [ ] Generate venv creation commands
  - [ ] Generate pip install commands (torch, vLLM, etc.)
  - [ ] Handle model-specific vLLM versions (e.g., gpt-oss needs 0.10.1+gptoss)
  - [ ] Generate mount commands if --mount provided
  - [ ] Generate env var setup (HF_TOKEN, PI_API_KEY)

- [ ] `src/setup/detect-hardware.ts` - Run nvidia-smi and parse GPU info
  - [ ] Execute nvidia-smi via SSH
  - [ ] Parse GPU count, names, memory
  - [ ] Return structured GPU info

- [ ] `src/setup/execute-setup.ts` - Main setup orchestrator
  - [ ] Generate setup script
  - [ ] Copy and execute via SSH
  - [ ] Stream output to console
  - [ ] Handle Ctrl+C properly
  - [ ] Save GPU info to local config

## Package 2: Config Management
Local JSON state management

- [ ] `src/config/types.ts` - TypeScript interfaces
  - [ ] Pod interface (ssh, gpus, models, mount)
  - [ ] Model interface (model, port, gpu, pid)
  - [ ] GPU interface (id, name, memory)

- [ ] `src/config/store.ts` - Read/write ~/.pi/pods.json
  - [ ] Load config (handle missing file)
  - [ ] Save config (atomic write)
  - [ ] Get active pod
  - [ ] Add/remove pods
  - [ ] Update model state

## Package 3: SSH Executor
Clean SSH command execution

- [ ] `src/ssh/executor.ts` - SSH command wrapper
  - [ ] Execute command with streaming output
  - [ ] Execute command with captured output
  - [ ] Handle SSH errors gracefully
  - [ ] Support Ctrl+C propagation
  - [ ] Support background processes (nohup)

## Package 4: Pod Commands
Pod management CLI commands

- [ ] `src/commands/pods-setup.ts` - pi pods setup
  - [ ] Parse args (name, ssh, mount)
  - [ ] Check env vars (HF_TOKEN, PI_API_KEY)
  - [ ] Call setup executor
  - [ ] Save pod to config

- [ ] `src/commands/pods-list.ts` - pi pods
  - [ ] Load config
  - [ ] Display all pods with active marker

- [ ] `src/commands/pods-active.ts` - pi pods active
  - [ ] Switch active pod
  - [ ] Update config

- [ ] `src/commands/pods-remove.ts` - pi pods remove
  - [ ] Remove from config (not remote)

## Package 5: Model Management
Model lifecycle management

- [ ] `src/models/model-config.ts` - Known model configurations
  - [ ] Load models.md data structure
  - [ ] Match hardware to vLLM args
  - [ ] Get model-specific env vars

- [ ] `src/models/download.ts` - Model download via HF
  - [ ] Check if model cached
  - [ ] Run huggingface-cli download
  - [ ] Stream progress to console
  - [ ] Handle Ctrl+C

- [ ] `src/models/vllm-builder.ts` - Build vLLM command
  - [ ] Get base command for model
  - [ ] Add hardware-specific args
  - [ ] Add user --vllm args
  - [ ] Add port and API key

## Package 6: Model Commands
Model management CLI commands

- [ ] `src/commands/start.ts` - pi start
  - [ ] Parse model and args
  - [ ] Find next available port
  - [ ] Select GPU (round-robin)
  - [ ] Download if needed
  - [ ] Build and execute vLLM command
  - [ ] Wait for health check
  - [ ] Update config on success

- [ ] `src/commands/stop.ts` - pi stop
  - [ ] Find model in config
  - [ ] Kill process via PID
  - [ ] Clean up config

- [ ] `src/commands/list.ts` - pi list
  - [ ] Show models from config
  - [ ] Optionally verify PIDs

- [ ] `src/commands/logs.ts` - pi logs
  - [ ] Tail log file via SSH
  - [ ] Handle Ctrl+C (stop tailing only)

## Package 7: Model Testing
Quick model testing with tools

- [ ] `src/prompt/tools.ts` - Tool definitions
  - [ ] Define ls, read, glob, rg tools
  - [ ] Format for OpenAI API

- [ ] `src/prompt/client.ts` - OpenAI client wrapper
  - [ ] Create client for model endpoint
  - [ ] Handle streaming responses
  - [ ] Display thinking, tools, content

- [ ] `src/commands/prompt.ts` - pi prompt
  - [ ] Get model endpoint from config
  - [ ] Augment prompt with CWD info
  - [ ] Send request with tools
  - [ ] Display formatted response

## Package 8: CLI Entry Point
Main CLI with commander.js

- [ ] `src/cli.ts` - Main entry point
  - [ ] Setup commander program
  - [ ] Register all commands
  - [ ] Handle global options (--pod override)
  - [ ] Error handling

- [ ] `src/index.ts` - Package exports

## Testing Strategy
- [ ] Test pod_setup.sh generation locally
- [ ] Test on local machine with GPU
- [ ] Test SSH executor with mock commands
- [ ] Test config management with temp files
- [ ] Integration test on real pod

## Dependencies
```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@commander-js/extra-typings": "^12.0.0",
    "openai": "^4.0.0",
    "chalk": "^5.0.0",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

## Build & Distribution
- [ ] TypeScript config for Node.js target
- [ ] Build to dist/
- [ ] npm package with bin entry
- [ ] npx support