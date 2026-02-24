# @mariozechner/pi-agent-service

HTTP + SSE host service for `@mariozechner/pi-coding-agent` sessions.

## User Documentation

- Best Practices: [docs/BEST_PRACTICES.md](./docs/BEST_PRACTICES.md)
- Optional Enhancements Evaluation: [docs/optional-evaluation.md](./docs/optional-evaluation.md)

## Quick Start

```ts
import { createAgentService } from "@mariozechner/pi-agent-service";

const service = createAgentService({
  apiKey: process.env.AGENT_SERVICE_API_KEY!,
  defaultCwd: process.cwd(),
});

await service.listen(8080, "127.0.0.1");
```

Use `X-API-Key` header for all `/v1` routes.
