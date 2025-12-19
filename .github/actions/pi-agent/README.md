# Pi Agent GitHub Action

AI-powered GitHub automation using pi-coding-agent. Responds to @pi mentions, reviews PRs, triages issues, and executes custom prompts.

## Features

- **@pi Mentions**: Respond to comments mentioning `@pi` in issues and PRs
- **PR Review**: Automatic code review with inline comments
- **Issue Triage**: Categorize and label new issues
- **Custom Prompts**: Execute arbitrary agent tasks
- **Progress Tracking**: Visual progress indicators in comments
- **Act-Learn-Reuse**: Leverages expertise system for improved responses

## Quick Start

### 1. Add Secrets

Add these secrets to your repository:
- `OPENROUTER_API_KEY` - Your OpenRouter API key (recommended)
- Or `ANTHROPIC_API_KEY` - Direct Anthropic API key

### 2. Create Workflow

Create `.github/workflows/pi-agent.yml`:

```yaml
name: Pi Agent

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  respond:
    if: contains(github.event.comment.body, '@pi')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/pi-agent
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### 3. Use It

Comment `@pi` in any issue or PR:

```
@pi What does this function do?

@pi Please review this PR for security issues

@pi Can you fix this bug?
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `openrouter_api_key` | OpenRouter API key | - |
| `anthropic_api_key` | Anthropic API key (alternative) | - |
| `github_token` | GitHub token | `${{ github.token }}` |
| `trigger_phrase` | Trigger phrase to look for | `@pi` |
| `mode` | Execution mode: auto, review, implement, triage, custom | `auto` |
| `prompt` | Custom prompt for automation | - |
| `max_turns` | Maximum conversation turns | `25` |
| `model` | Model to use | `anthropic/claude-sonnet-4` |
| `track_progress` | Show progress comments | `true` |
| `enable_learning` | Enable expertise system | `true` |
| `allowed_tools` | Comma-separated tools list | `Read,Write,Edit,Glob,Grep,Bash` |
| `timeout_minutes` | Execution timeout | `10` |

## Outputs

| Output | Description |
|--------|-------------|
| `conclusion` | Result: success, failure, or skipped |
| `comment_id` | ID of response comment posted |
| `branch_name` | Name of branch created (if any) |
| `session_id` | Agent session ID for resumption |

## Examples

### PR Auto-Review

```yaml
name: PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/pi-agent
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          mode: "review"
          prompt: |
            Review this PR focusing on:
            - Security vulnerabilities
            - Performance issues
            - Code quality
```

### Issue Triage

```yaml
name: Issue Triage
on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/pi-agent
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          mode: "triage"
          prompt: |
            Analyze this issue and:
            1. Add appropriate labels (bug, enhancement, question)
            2. Assess priority
            3. Comment with next steps
```

### Scheduled Maintenance

```yaml
name: Weekly Check
on:
  schedule:
    - cron: "0 0 * * 0"

jobs:
  maintenance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/pi-agent
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          prompt: |
            Perform weekly repository health check:
            - Check for outdated dependencies
            - Review open issues older than 30 days
            - Look for TODO comments
            Create an issue summarizing findings.
```

## Modes

| Mode | Description |
|------|-------------|
| `auto` | Automatically detect based on context |
| `review` | PR code review with inline comments |
| `implement` | Implement requested changes |
| `triage` | Categorize and label issues |
| `custom` | Use provided prompt as-is |

## Security

- The action runs on your GitHub runner infrastructure
- API keys are passed as secrets, never logged
- GitHub token permissions are explicitly scoped
- All operations are auditable in workflow logs

## Comparison with claude-code-action

| Feature | Pi Agent | claude-code-action |
|---------|----------|-------------------|
| Base framework | pi-coding-agent | Claude Code CLI |
| Expertise system | Yes (Act-Learn-Reuse) | No |
| Custom tools | Full MCP support | Limited |
| Model providers | OpenRouter, Anthropic | Anthropic, Bedrock, Vertex |
| Local development | Works with pi CLI | Separate tooling |

## Troubleshooting

### Action not triggering

1. Check that `@pi` is in the comment body
2. Verify secrets are configured
3. Check workflow permissions

### Agent times out

Increase `timeout_minutes` input or reduce `max_turns`.

### Missing permissions

Ensure workflow has required permissions:
```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

## License

MIT - See LICENSE file in repository root.
