# Changelog

All notable changes to the Pi-Discord Bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI/CD pipeline with GitHub Actions
- Automated deployment script with rollback capability
- Pre-commit hooks for code quality
- Comprehensive Makefile for common operations
- Health check monitoring
- Security scanning with Trivy
- Docker multi-platform builds (amd64, arm64)

### Changed
- Improved Docker build process with multi-stage builds
- Enhanced logging and monitoring capabilities

### Fixed
- N/A

### Security
- Added automated dependency auditing
- Added vulnerability scanning in CI pipeline

## [0.20.2] - 2024-12-14

### Current
- Discord bot with Claude AI integration
- Docker containerization
- Express webhook server
- Scheduled task management
- Health check endpoint

### Features
- Multi-agent support via pi-agent-core
- Claude AI integration via pi-ai
- Discord.js 14 integration
- TypeScript support
- Environment-based configuration

---

## Version Numbering

We use Semantic Versioning (SemVer):

- **MAJOR** version (X.0.0): Incompatible API changes
- **MINOR** version (0.X.0): New functionality in a backwards compatible manner
- **PATCH** version (0.0.X): Backwards compatible bug fixes

## Release Process

1. Update CHANGELOG.md with changes
2. Bump version: `npm version [patch|minor|major]`
3. Commit changes: `git commit -am "chore: release vX.Y.Z"`
4. Tag release: `git tag vX.Y.Z`
5. Push: `git push && git push --tags`
6. Deploy: `make deploy`

## Categories

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Vulnerability fixes
