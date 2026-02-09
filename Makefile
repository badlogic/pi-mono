.PHONY: dev video-agent video-agent-build video-agent-votgo

dev: video-agent

video-agent: video-agent-votgo video-agent-build
	@npx electron packages/video-electron/dist/run.js

video-agent-build:
	@cd packages/video-electron && npm run build

video-agent-votgo:
	@mkdir -p VotGO/bin
	@cd VotGO && go build -o bin/votgo .
