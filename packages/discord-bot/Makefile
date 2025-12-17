.PHONY: help install build test dev clean deploy logs restart status health docker-build docker-up docker-down docker-logs format lint type-check version

# Default target
.DEFAULT_GOAL := help

# Colors
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Variables
CONTAINER_NAME := pi-discord-bot
COMPOSE_FILE := docker-compose.yml
DATA_DIR := /opt/discord-bot-data
DEPLOY_SCRIPT := $(DATA_DIR)/scripts/deploy.sh

##@ General

help: ## Display this help message
	@echo "$(BLUE)Pi-Discord Bot - Available Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make $(GREEN)<target>$(NC)\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(BLUE)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)Dependencies installed$(NC)"

build: ## Build TypeScript
	@echo "$(BLUE)Building TypeScript...$(NC)"
	npm run clean
	npm run build
	@echo "$(GREEN)Build completed$(NC)"

dev: ## Run in development mode with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	npm run dev

test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	npm test || echo "$(YELLOW)No tests configured$(NC)"

clean: ## Clean build artifacts
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	npm run clean
	rm -rf node_modules/.cache
	@echo "$(GREEN)Clean completed$(NC)"

##@ Code Quality

lint: ## Run linting
	@echo "$(BLUE)Running linting...$(NC)"
	npm run lint || echo "$(YELLOW)No lint script configured$(NC)"

type-check: ## Run TypeScript type checking
	@echo "$(BLUE)Running type check...$(NC)"
	npx tsc --noEmit

format: ## Format code
	@echo "$(BLUE)Formatting code...$(NC)"
	npx prettier --write "src/**/*.{ts,js,json}" || echo "$(YELLOW)Prettier not installed$(NC)"

format-check: ## Check code formatting
	@echo "$(BLUE)Checking code formatting...$(NC)"
	npx prettier --check "src/**/*.{ts,js,json}" || echo "$(YELLOW)Prettier not installed$(NC)"

##@ Docker

docker-build: ## Build Docker image
	@echo "$(BLUE)Building Docker image...$(NC)"
	docker-compose build
	@echo "$(GREEN)Docker image built$(NC)"

docker-up: ## Start Docker container
	@echo "$(BLUE)Starting Docker container...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)Container started$(NC)"
	@make status

docker-down: ## Stop Docker container
	@echo "$(BLUE)Stopping Docker container...$(NC)"
	docker-compose down
	@echo "$(GREEN)Container stopped$(NC)"

docker-logs: ## View Docker container logs
	docker-compose logs -f

docker-restart: ## Restart Docker container
	@echo "$(BLUE)Restarting Docker container...$(NC)"
	docker-compose restart
	@echo "$(GREEN)Container restarted$(NC)"

docker-shell: ## Open shell in running container
	docker exec -it $(CONTAINER_NAME) sh

##@ Deployment

deploy: ## Deploy latest version (pull, build, restart)
	@echo "$(BLUE)Starting deployment...$(NC)"
	@if [ -f "$(DEPLOY_SCRIPT)" ]; then \
		sudo $(DEPLOY_SCRIPT); \
	else \
		echo "$(RED)Deploy script not found at $(DEPLOY_SCRIPT)$(NC)"; \
		exit 1; \
	fi

restart: ## Restart the bot service
	@echo "$(BLUE)Restarting bot...$(NC)"
	docker-compose restart
	@sleep 3
	@make health
	@echo "$(GREEN)Restart completed$(NC)"

##@ Monitoring

logs: ## View bot logs (tail -f)
	@echo "$(BLUE)Viewing logs (press Ctrl+C to exit)...$(NC)"
	docker logs -f $(CONTAINER_NAME)

logs-tail: ## View last 100 lines of logs
	@docker logs --tail 100 $(CONTAINER_NAME)

logs-errors: ## View error logs only
	@docker logs $(CONTAINER_NAME) 2>&1 | grep -i "error\|fatal\|exception" || echo "$(GREEN)No errors found$(NC)"

status: ## Show container status
	@echo "$(BLUE)Container Status:$(NC)"
	@docker ps -a --filter "name=$(CONTAINER_NAME)" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || echo "$(RED)Container not found$(NC)"

health: ## Check bot health
	@echo "$(BLUE)Checking health...$(NC)"
	@curl -f http://localhost:3333/health 2>/dev/null && echo "$(GREEN)✓ Bot is healthy$(NC)" || echo "$(RED)✗ Bot is unhealthy$(NC)"

metrics: ## Show bot metrics
	@echo "$(BLUE)Bot Metrics:$(NC)"
	@curl -s http://localhost:3333/health 2>/dev/null | jq . || echo "$(YELLOW)Metrics not available$(NC)"

##@ Backup & Restore

backup: ## Create backup of bot data
	@echo "$(BLUE)Creating backup...$(NC)"
	@if [ -f "$(DATA_DIR)/scripts/backup.sh" ]; then \
		sudo $(DATA_DIR)/scripts/backup.sh; \
	else \
		echo "$(YELLOW)Backup script not found$(NC)"; \
	fi

##@ Version Management

version: ## Show current version
	@echo "$(BLUE)Current Version:$(NC)"
	@cat package.json | grep version | head -1 | awk -F: '{ print $$2 }' | sed 's/[",]//g' | xargs

version-patch: ## Bump patch version (0.0.X)
	@echo "$(BLUE)Bumping patch version...$(NC)"
	npm version patch
	@make version

version-minor: ## Bump minor version (0.X.0)
	@echo "$(BLUE)Bumping minor version...$(NC)"
	npm version minor
	@make version

version-major: ## Bump major version (X.0.0)
	@echo "$(BLUE)Bumping major version...$(NC)"
	npm version major
	@make version

##@ Utilities

verify: ## Verify installation and configuration
	@echo "$(BLUE)Verifying installation...$(NC)"
	@echo "Node version: $$(node --version)"
	@echo "NPM version: $$(npm --version)"
	@echo "Docker version: $$(docker --version)"
	@echo "Project directory: $$(pwd)"
	@echo "Data directory: $(DATA_DIR)"
	@[ -f "package.json" ] && echo "$(GREEN)✓ package.json found$(NC)" || echo "$(RED)✗ package.json missing$(NC)"
	@[ -f "tsconfig.json" ] && echo "$(GREEN)✓ tsconfig.json found$(NC)" || echo "$(RED)✗ tsconfig.json missing$(NC)"
	@[ -f "Dockerfile" ] && echo "$(GREEN)✓ Dockerfile found$(NC)" || echo "$(RED)✗ Dockerfile missing$(NC)"
	@[ -f ".env" ] && echo "$(GREEN)✓ .env found$(NC)" || echo "$(YELLOW)! .env missing$(NC)"

dependencies-update: ## Update all dependencies
	@echo "$(BLUE)Updating dependencies...$(NC)"
	npm update
	@echo "$(GREEN)Dependencies updated$(NC)"

dependencies-audit: ## Run security audit
	@echo "$(BLUE)Running security audit...$(NC)"
	npm audit

dependencies-fix: ## Fix security vulnerabilities
	@echo "$(BLUE)Fixing security vulnerabilities...$(NC)"
	npm audit fix
