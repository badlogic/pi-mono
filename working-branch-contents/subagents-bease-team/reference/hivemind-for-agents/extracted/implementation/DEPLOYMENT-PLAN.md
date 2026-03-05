# Deployment Plan

## Overview

This document defines the **deployment and release strategy** for Claude-Flow v3. Agent #15 (Release Engineer) leads this effort with coordination from Agent #1 (Queen Coordinator).

---

## Release Timeline

```
                         v3.0.0 Release Timeline
    ┌─────────────────────────────────────────────────────────────┐
    │                                                             │
    │  Week 1-2      Week 3-6      Week 7-10     Week 11-14      │
    │  ┌───────┐     ┌───────┐     ┌───────┐     ┌───────┐       │
    │  │ Alpha │     │ Alpha │     │ Beta  │     │  RC   │ v3.0  │
    │  │  .1   │────►│ .2-.5 │────►│ .1-.3 │────►│ .1-.2 │──►    │
    │  └───────┘     └───────┘     └───────┘     └───────┘       │
    │                                                             │
    │  Security      Core          Integration   Polish &        │
    │  Foundation    Systems       Features      Release         │
    └─────────────────────────────────────────────────────────────┘
```

---

## Version Strategy

### Semantic Versioning

```
v3.0.0-alpha.1  → First internal alpha
v3.0.0-alpha.5  → Feature complete alpha
v3.0.0-beta.1   → Public beta
v3.0.0-beta.3   → Feature freeze
v3.0.0-rc.1     → Release candidate
v3.0.0-rc.2     → Final RC (if needed)
v3.0.0          → Stable release
```

### Version Bumping Rules

| Change Type | Version Impact | Example |
|-------------|----------------|---------|
| Breaking API | Major (3.x.x) | Remove deprecated methods |
| New feature | Minor (x.1.x) | Add new agent type |
| Bug fix | Patch (x.x.1) | Fix memory leak |
| Security fix | Patch (x.x.1) | CVE remediation |
| Pre-release | Suffix | -alpha.1, -beta.1, -rc.1 |

---

## Release Artifacts

### npm Package

```json
{
  "name": "@anthropic/claude-flow",
  "version": "3.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "claude-flow": "bin/claude-flow.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "dist/",
    "bin/",
    "templates/",
    "README.md",
    "LICENSE"
  ]
}
```

### GitHub Release

```markdown
## Claude-Flow v3.0.0

### Highlights
- 2.49x-7.47x performance improvement (Flash Attention)
- 150x faster vector search (AgentDB with HNSW)
- Unified SwarmCoordinator (merged 4 systems)
- Security score: 90/100 (up from 45/100)
- 40% smaller codebase (130k → 78k lines)

### Breaking Changes
- Minimum Node.js version: 20.0.0
- Deprecated v2 APIs removed (see migration guide)

### New Features
- [ ] agentic-flow@alpha integration
- [ ] 9 RL algorithms for continuous learning
- [ ] SONA adaptive learning modes
- [ ] Cross-platform Windows support (sql.js)

### Bug Fixes
- [ ] Fixed CVE-1: Vulnerable dependencies
- [ ] Fixed CVE-2: Weak password hashing
- [ ] Fixed CVE-3: Hardcoded credentials

### Migration
See [MIGRATION-GUIDE.md](./v3/implementation/migration/MIGRATION-GUIDE.md)

---
**Full Changelog**: https://github.com/anthropic/claude-flow/compare/v2.7.47...v3.0.0
```

---

## CI/CD Pipeline

### GitHub Actions Workflows

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate version
        run: |
          TAG_VERSION=${GITHUB_REF#refs/tags/v}
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Version mismatch: tag=$TAG_VERSION, package=$PKG_VERSION"
            exit 1
          fi

  test:
    needs: validate
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - run: npm ci
      - run: npm test
      - run: npm run benchmark

  security:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Security audit
        run: npm audit --audit-level=moderate

      - name: SAST scan
        uses: github/codeql-action/analyze@v3

      - name: Secrets scan
        uses: trufflesecurity/trufflehog@main

  build:
    needs: [test, security]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm run build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  publish-npm:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/

      - name: Publish to npm
        run: |
          if [[ "$GITHUB_REF" == *"-alpha"* ]]; then
            npm publish --tag alpha --access public
          elif [[ "$GITHUB_REF" == *"-beta"* ]]; then
            npm publish --tag beta --access public
          elif [[ "$GITHUB_REF" == *"-rc"* ]]; then
            npm publish --tag next --access public
          else
            npm publish --access public
          fi
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  github-release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate changelog
        id: changelog
        run: |
          # Generate changelog from commits
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^)
          CHANGELOG=$(git log $PREV_TAG..HEAD --pretty=format:"- %s (%h)")
          echo "changelog<<EOF" >> $GITHUB_OUTPUT
          echo "$CHANGELOG" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          body: |
            ## What's Changed
            ${{ steps.changelog.outputs.changelog }}

            ## Installation
            ```bash
            npm install -g @anthropic/claude-flow@${{ github.ref_name }}
            ```

            ## Documentation
            - [Migration Guide](./v3/implementation/migration/MIGRATION-GUIDE.md)
            - [API Reference](./docs/api.md)
          draft: false
          prerelease: ${{ contains(github.ref, 'alpha') || contains(github.ref, 'beta') || contains(github.ref, 'rc') }}
```

### Pre-Release Workflow

```yaml
# .github/workflows/pre-release.yml
name: Pre-Release Check

on:
  pull_request:
    branches: [main]
    paths:
      - 'package.json'

jobs:
  check-version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check version bump
        run: |
          MAIN_VERSION=$(git show origin/main:package.json | jq -r .version)
          PR_VERSION=$(jq -r .version package.json)

          if [ "$MAIN_VERSION" == "$PR_VERSION" ]; then
            echo "Warning: Version not bumped"
            # Allow but warn
          fi

          echo "Main: $MAIN_VERSION → PR: $PR_VERSION"
```

---

## Deployment Environments

### Staging

```yaml
# .github/workflows/staging.yml
name: Deploy to Staging

on:
  push:
    branches: [develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Publish to npm (staging)
        run: npm publish --tag staging --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Update staging docs
        run: |
          npm run docs:build
          # Deploy to staging docs site
```

### Production

```yaml
# Production release checklist
pre_release_checks:
  - [ ] All tests passing on main branch
  - [ ] Security audit clean (npm audit)
  - [ ] Performance benchmarks meet targets
  - [ ] Documentation updated
  - [ ] Changelog generated
  - [ ] Migration guide reviewed
  - [ ] Breaking changes documented

release_approval:
  - [ ] Product owner approval
  - [ ] Tech lead approval
  - [ ] Security review complete

post_release:
  - [ ] npm package verified
  - [ ] GitHub release created
  - [ ] Documentation published
  - [ ] Announcement posted
  - [ ] Monitoring enabled
```

---

## Migration Support

### Automated Migration Script

```typescript
// bin/migrate-v2-to-v3.ts
#!/usr/bin/env node

import { program } from 'commander';
import { migrate } from '../src/migration/migrator';

program
  .name('claude-flow-migrate')
  .description('Migrate Claude-Flow v2 to v3')
  .option('-d, --dry-run', 'Show what would be migrated')
  .option('-b, --backup', 'Create backup before migration')
  .option('--config <path>', 'Path to config file')
  .action(async (options) => {
    console.log('Claude-Flow v2 → v3 Migration');
    console.log('================================\n');

    const result = await migrate({
      dryRun: options.dryRun,
      backup: options.backup,
      configPath: options.config
    });

    if (result.success) {
      console.log('\n✅ Migration completed successfully!');
      console.log(`   Files migrated: ${result.filesMigrated}`);
      console.log(`   Configs updated: ${result.configsUpdated}`);
      console.log(`   Warnings: ${result.warnings.length}`);
    } else {
      console.error('\n❌ Migration failed:');
      console.error(`   ${result.error}`);
      process.exit(1);
    }
  });

program.parse();
```

### Configuration Migration

```typescript
// src/migration/config-migrator.ts
interface MigrationRule {
  v2Path: string;
  v3Path: string;
  transform?: (value: any) => any;
}

const CONFIG_MIGRATIONS: MigrationRule[] = [
  // Renamed settings
  { v2Path: 'swarm.coordinator', v3Path: 'swarm.unifiedCoordinator' },
  { v2Path: 'memory.backend', v3Path: 'memory.agentDB' },

  // Transformed settings
  {
    v2Path: 'security.hashAlgorithm',
    v3Path: 'security.passwordHashing',
    transform: (v) => v === 'sha256' ? 'bcrypt' : v
  },

  // Removed settings (warn user)
  { v2Path: 'deprecated.hiveMindMode', v3Path: null },

  // New defaults
  {
    v2Path: null,
    v3Path: 'agenticFlow.enabled',
    transform: () => true
  }
];

export function migrateConfig(v2Config: any): { v3Config: any; warnings: string[] } {
  const v3Config = {};
  const warnings: string[] = [];

  for (const rule of CONFIG_MIGRATIONS) {
    // Apply migration rules...
  }

  return { v3Config, warnings };
}
```

---

## Rollback Plan

### Automated Rollback

```yaml
# .github/workflows/rollback.yml
name: Emergency Rollback

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to rollback to'
        required: true
        default: '2.7.47'
      reason:
        description: 'Reason for rollback'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deprecate current version
        run: npm deprecate @anthropic/claude-flow@latest "Rolling back due to: ${{ inputs.reason }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Promote previous version
        run: npm dist-tag add @anthropic/claude-flow@${{ inputs.version }} latest
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create incident issue
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `[INCIDENT] Rollback to v${{ inputs.version }}`,
              body: `## Rollback Details\n\n**Rolled back to:** v${{ inputs.version }}\n**Reason:** ${{ inputs.reason }}\n**Triggered by:** @${{ github.actor }}`,
              labels: ['incident', 'rollback', 'priority:critical']
            });

      - name: Notify team
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "🚨 Claude-Flow rollback executed",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Claude-Flow Rollback*\nVersion: v${{ inputs.version }}\nReason: ${{ inputs.reason }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

---

## Monitoring & Observability

### Release Metrics

```typescript
// src/telemetry/release-metrics.ts
interface ReleaseMetrics {
  version: string;
  installCount: number;
  errorRate: number;
  avgStartupTime: number;
  userFeedback: {
    positive: number;
    negative: number;
  };
}

// Collect anonymous usage metrics (opt-in)
export async function reportReleaseMetrics(): Promise<void> {
  const metrics: ReleaseMetrics = {
    version: VERSION,
    installCount: await getInstallCount(),
    errorRate: await getErrorRate(),
    avgStartupTime: await getAvgStartupTime(),
    userFeedback: await getFeedbackCounts()
  };

  // Report to telemetry endpoint
  await fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(metrics)
  });
}
```

### Health Checks

```yaml
# Post-release health checks
checks:
  - name: npm install
    command: npm install -g @anthropic/claude-flow@latest
    timeout: 60s

  - name: CLI startup
    command: claude-flow --version
    expected: "3.0.0"
    timeout: 5s

  - name: Basic swarm
    command: claude-flow swarm init test --dry-run
    timeout: 10s

  - name: MCP server
    command: claude-flow mcp start --health-check
    timeout: 30s
```

---

## Release Communication

### Announcement Template

```markdown
# 🚀 Claude-Flow v3.0.0 Released!

We're excited to announce the release of Claude-Flow v3.0.0, a major update
that brings significant performance improvements, enhanced security, and
deep integration with the agentic-flow ecosystem.

## Highlights

### ⚡ Performance
- **2.49x-7.47x faster** with Flash Attention
- **150x faster** vector search with HNSW indexing
- **50% memory reduction** with optimized allocations

### 🔒 Security
- Security score increased from 45/100 to **90/100**
- bcrypt password hashing (replaced SHA-256)
- Secure random token generation
- Command injection prevention

### 🏗️ Architecture
- Unified SwarmCoordinator (merged 4 coordination systems)
- 40% smaller codebase (130k → 78k lines)
- agentic-flow@alpha native integration
- Cross-platform Windows support

## Upgrade

```bash
npm install -g @anthropic/claude-flow@3.0.0
claude-flow migrate --from v2
```

## Links
- [Full Changelog](./CHANGELOG.md)
- [Migration Guide](./v3/implementation/migration/MIGRATION-GUIDE.md)
- [Documentation](./docs/)

## Thank You
Special thanks to all contributors who made this release possible!
```

---

## Related Documents

- [SWARM-OVERVIEW.md](./SWARM-OVERVIEW.md) - 15-agent swarm plan
- [AGENT-SPECIFICATIONS.md](./AGENT-SPECIFICATIONS.md) - Agent #15 details
- [../migration/MIGRATION-GUIDE.md](../migration/MIGRATION-GUIDE.md) - Migration guide
- [GITHUB-ISSUE-TRACKING.md](./GITHUB-ISSUE-TRACKING.md) - Issue workflow
