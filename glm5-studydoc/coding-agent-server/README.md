# Coding Agent Server

A Node.js server that runs the pi coding agent programmatically to analyze code repositories.

## Features

- REST API for code analysis
- Server-Sent Events (SSE) for streaming responses
- Configurable LLM provider and model
- Docker support for easy deployment

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your API key
```

### 3. Build and Run

```bash
npm run build
npm start
```

### 4. Place your code in `repo/` directory

```bash
mkdir -p repo
# Copy your code to analyze into repo/
```

## API Endpoints

### POST /analyze

Analyze code and return full result.

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Analyze the project structure"}'
```

Response:
```json
{
  "success": true,
  "response": "...",
  "toolCalls": [...],
  "tokens": { "input": 1000, "output": 500, "total": 1500 },
  "duration": 5000
}
```

### POST /analyze/stream

Analyze code with streaming response (SSE).

```bash
curl -X POST http://localhost:3000/analyze/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Find all TypeScript files"}'
```

Events:
- `delta`: Text chunk
- `tool_start`: Tool execution started
- `tool_end`: Tool execution completed
- `done`: Analysis complete

### POST /chat

Simple chat endpoint.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What files are in the repo?"}'
```

### GET /messages

Get conversation history.

### GET /health

Health check endpoint.

### POST /reset

Reset the agent session.

## Docker Deployment

### Build and Run

```bash
docker-compose up -d
```

### With Custom Repo

```yaml
# docker-compose.yml
volumes:
  - /path/to/your/code:/app/repo:ro
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `PROVIDER` | LLM provider | `anthropic` |
| `MODEL_ID` | Model identifier | `claude-sonnet-4-20250514` |
| `THINKING_LEVEL` | Reasoning level | `medium` |
| `PORT` | Server port | `3000` |
| `REPO_PATH` | Path to code repo | `/app/repo` |

## Example Usage

### Analyze Project Structure

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this codebase: 1) List top-level directories 2) Find entry points 3) Summarize architecture"
  }'
```

### Search for Patterns

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Find all async functions and check error handling patterns"
  }'
```

### Security Audit

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Perform a security audit: check for hardcoded secrets, SQL injection risks, and input validation"
  }'
```

## Supported Providers

- Anthropic (Claude)
- OpenAI (GPT-4)
- Google (Gemini)
- Azure OpenAI
- Amazon Bedrock
- And more...

See [pi-mono docs](https://github.com/badlogic/pi-mono) for full list.
