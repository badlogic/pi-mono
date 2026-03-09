# AI Platform Audit Report

This report summarizes the analysis of the existing AI platform running on the VPS environment.

## 1. System Overview
- **Operating System**: Ubuntu 24.04.4 LTS (Noble Numbat)
- **Kernel**: Linux 6.14.0-1017-azure (x86_64)
- **Resources**: 54Gi Total RAM (approx. 51Gi available).
- **Runtimes**:
    - **Node.js**: v24.14.0
    - **Docker**: 29.3.0
    - **Docker Compose**: v5.1.0
    - **Python/Bun/Deno**: Not installed or not in PATH.

## 2. Infrastructure Diagram
```text
[ Internet / Slack ]
      |
      v
[ Port 80/443: Nginx (Reverse Proxy) ]
      |
      +--> [ Port 3000: Open WebUI ]
      |
      +--> [ Port 19999: Netdata (Monitoring) ]
      |
      +--> [ Port 6333: Qdrant (Vector DB) ]
      |
      +--> [ localhost:11434: Ollama (Local LLM) ]

[ Host Services ]
      |
      +--> [ mom.service: Mom Slack Bot ]
      +--> [ ssh.service: SSH (Ports 22, 22222) ]
      +--> [ ollama.service: Ollama Server ]
```

## 3. Running Services
| Container Name | Image | Ports | Purpose |
| :--- | :--- | :--- | :--- |
| `reverse-proxy` | `nginx:1.27-alpine` | 80/443 | Entry point and SSL termination |
| `open-webui` | `ghcr.io/open-webui/open-webui:main` | 3000 | Web interface for LLMs |
| `netdata` | `netdata/netdata:stable` | 19999 | Infrastructure monitoring |
| `qdrant` | `qdrant/qdrant:latest` | 6333 | Vector storage for RAG and long-term memory |
| `mom.service` | (Local Node.js) | N/A | Slack bot agent orchestrator |
| `ollama.service`| (Local Binary) | 11434 | Local inference server |

## 4. Agent Ecosystem
The platform is centered around the **pi-mono** repository (`/srv/agents/pi`), consisting of several specialized packages:

- **Coding Agent (`packages/coding-agent`)**: A TUI-based coding assistant that provides tools (`read`, `write`, `edit`, `bash`) for autonomous development.
- **Mom (`packages/mom`)**: A sophisticated Slack bot agent capable of planning and executing multi-step tasks across the filesystem.
- **AI Core (`packages/ai`)**: Standardized provider implementation for various LLM backends.
- **TUI/Web-UI**: UI components for different interaction modes.

## 5. Skills and Extensions
Capabilities are extended via modular packages and custom definitions:
- **Extensions**:
    - `pi-subagents`: Enables the main agent to delegate tasks to sub-agents.
    - `pi-interactive-shell`: Integration for running delegated interactive tasks.
    - `pi-extmgr`: Management tool for extensions.
- **Skills**:
    - `oh-pi`: A primary skill package containing specialized instructions.
    - Custom Markdown skills loaded from `.pi/skills/` directories.
- **Prompt Templates**: Located in `.pi/prompts/` (e.g., `cl.md`, `is.md`, `pr.md`).

## 6. Workflows and Automation
- **Operations (`ops/`)**: A dedicated management structure for operating principles, decision logs, and weekly/daily planning.
- **Automation Scripts**:
    - `release.mjs`: Automated release workflow.
    - `build-binaries.sh`: Binary compilation script.
    - `sync-versions.js`: Workspace version management.
- **CI/CD**: GitHub Actions workflows for continuous integration (`ci.yml`) and binary builds.
- **Maintenance**: 14 systemd timers handle routine system collection and cleanup tasks.

## 7. LLM Configuration
LLM access is consolidated through a priority-based resolution system:
- **Local Models**: Ollama provides models like `phi4-mini`, `qwen2.5-vl`, and `llama3.1`.
- **Remote Providers**:
    - **Google Antigravity**: Default provider for the coding agent (`gemini-3-flash`).
    - **Nano-GPT**: Acts as a comprehensive gateway for high-end models (Claude 4.6, GPT-5, etc.) for the `mom` agent.
    - **Built-in Support**: OpenAI, Anthropic, Vertex AI, and Amazon Bedrock.
- **Configuration Storage**: Located in `~/.pi/agent/auth.json` and `~/.pi/mom/auth.json`.

## 8. Documentation Status
The platform is exceptionally well-documented:
- **Technical Docs**: In-depth coverage of extension APIs, skill formats, and session management in `packages/coding-agent/docs`.
- **Agent Docs**: Detailed architecture and event documentation for `mom` and `pods`.
- **Operational Docs**: Clear guidelines on direction and intern delegation in `ops/`.

## 9. Risks and Observations
- **Sandbox Security**: The `mom` agent is currently configured with `--sandbox=host`, providing the agent with broad access to the host environment.
- **Error Logs**: The `mom` service reports frequent `msg_too_long` errors when communicating with Slack, suggesting a need for better response truncation or multi-message handling.
- **Environment Gaps**: Lack of Python might limit certain data science or script-heavy AI tasks.
