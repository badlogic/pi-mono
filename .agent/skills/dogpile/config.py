#!/usr/bin/env python3
"""Configuration and constants for Dogpile deep search aggregator.

Contains:
- Path definitions (SKILLS_DIR)
- Provider semaphores for concurrency control
- Rate limit state tracking
- Typer app and Rich console setup
- Optional dependency detection (tenacity, resource registry, discord)
"""
import json
import sys
import threading
from pathlib import Path
from typing import Dict, Any

# Core dependencies
try:
    import typer
    from rich.console import Console
except ImportError:
    print("Missing requirements. Run: pip install typer rich", file=sys.stderr)
    sys.exit(1)

# Tenacity for resilient retries
try:
    from tenacity import (
        retry,
        stop_after_attempt,
        stop_after_delay,
        wait_random_exponential,
        retry_if_exception_type,
        RetryError
    )
    TENACITY_AVAILABLE = True
except ImportError:
    TENACITY_AVAILABLE = False
    retry = None
    stop_after_attempt = None
    stop_after_delay = None
    wait_random_exponential = None
    retry_if_exception_type = None
    RetryError = None

# Resource Registry for dynamic source management
try:
    from resources.resource_registry import get_registry, ResourceRegistry
    REGISTRY_AVAILABLE = True
except ImportError:
    REGISTRY_AVAILABLE = False
    get_registry = None
    ResourceRegistry = None

# Discord search integration
try:
    from .discord_search import search_discord as _search_discord_impl, format_discord_results
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False
    _search_discord_impl = None
    format_discord_results = None

# =============================================================================
# PATHS
# =============================================================================
SKILLS_DIR = Path(__file__).resolve().parents[1]

# =============================================================================
# CONCURRENCY CONTROL
# =============================================================================
# Per-provider semaphores to prevent rate limit exhaustion
# GitHub: 10 concurrent (secondary rate limit protection)
# ArXiv: 3 concurrent (be nice to academic APIs)
# Brave: 5 concurrent
# YouTube: 3 concurrent
# Perplexity: 2 concurrent (API limits)
# Codex: 2 concurrent
PROVIDER_SEMAPHORES: Dict[str, threading.Semaphore] = {
    "github": threading.Semaphore(10),
    "arxiv": threading.Semaphore(3),
    "brave": threading.Semaphore(5),
    "youtube": threading.Semaphore(3),
    "perplexity": threading.Semaphore(2),
    "codex": threading.Semaphore(2),
    "wayback": threading.Semaphore(3),
    "fetcher": threading.Semaphore(3),
    "readarr": threading.Semaphore(5),
    "discord": threading.Semaphore(3),
}

# Rate limit tracking per provider
RATE_LIMIT_STATE: Dict[str, Dict[str, Any]] = {}

# =============================================================================
# CLI SETUP
# =============================================================================
app = typer.Typer(help="Dogpile - Deep research aggregator")
console = Console()

# =============================================================================
# VERSION
# =============================================================================
VERSION = "0.4.0"
