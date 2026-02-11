#!/usr/bin/env python3
"""Task Monitor Integration for Dogpile.

Provides:
- DogpileMonitor: Task-monitor compatible progress tracker
- Auto-registration with task-monitor
- Progress updates for multi-stage searches
- Error state reporting

Integrates with ~/.pi/task-monitor/ for centralized monitoring.
"""
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

# Task monitor registry location
TASK_MONITOR_REGISTRY = Path.home() / ".pi" / "task-monitor" / "registry.json"
TASK_MONITOR_API_URL = os.environ.get("TASK_MONITOR_API", "http://localhost:8765")


class DogpileMonitor:
    """Task-monitor compatible progress tracker for dogpile searches.

    Tracks:
    - Search stages (stage1: broad search, stage2: deep dives, synthesis)
    - Per-provider status and timing
    - Error counts and rate limits

    Pushes updates to task-monitor state file or API.
    """

    # Standard dogpile providers and their stages
    PROVIDERS = [
        "brave", "perplexity", "github", "arxiv",
        "youtube", "readarr", "wayback", "codex", "discord"
    ]
    STAGES = ["tailoring", "stage1", "stage2_github", "stage2_arxiv",
              "stage2_youtube", "stage2_brave", "synthesis"]

    def __init__(
        self,
        query: str,
        name: str = "dogpile-search",
        state_file: Optional[str] = None,
        api_url: Optional[str] = None,
        register: bool = True,
    ):
        self.query = query[:60]
        self.name = name
        self.api_url = api_url or (TASK_MONITOR_API_URL if os.environ.get("TASK_MONITOR_API") else None)

        # State file path
        if state_file:
            self.state_file = Path(state_file).resolve()
        else:
            # Default to dogpile directory
            self.state_file = Path(__file__).parent / "dogpile_task_state.json"

        # Progress tracking
        self.total_steps = len(self.PROVIDERS) + len(self.STAGES)
        self.completed_steps = 0
        self.current_stage = "initializing"

        # Provider status
        self.provider_status: Dict[str, str] = {p: "pending" for p in self.PROVIDERS}
        self.provider_times: Dict[str, float] = {}

        # Error tracking
        self.errors: List[Dict[str, Any]] = []
        self.rate_limits: Dict[str, int] = {}

        # Timing
        self.start_time = time.time()
        self.last_update = 0.0

        # Auto-register with task-monitor
        if register:
            self._register_task()

        # Initial state write
        self._update_state()

    def _register_task(self):
        """Register this task with task-monitor registry."""
        try:
            TASK_MONITOR_REGISTRY.parent.mkdir(parents=True, exist_ok=True)

            # Load existing registry
            registry = {}
            if TASK_MONITOR_REGISTRY.exists():
                try:
                    registry = json.loads(TASK_MONITOR_REGISTRY.read_text())
                except Exception:
                    registry = {}

            # Add/update our task
            registry[self.name] = {
                "state_file": str(self.state_file),
                "total": self.total_steps,
                "description": f"Dogpile: {self.query}",
                "project": "dogpile",
                "registered_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }

            # Write atomically
            tmp = TASK_MONITOR_REGISTRY.with_suffix(".tmp")
            tmp.write_text(json.dumps(registry, indent=2))
            os.replace(tmp, TASK_MONITOR_REGISTRY)
        except Exception:
            pass  # Silent fail - task-monitor is optional

    def _update_state(self, final: bool = False):
        """Update task-monitor state file."""
        now = time.time()

        # Throttle updates (max every 0.5s unless final)
        if not final and (now - self.last_update) < 0.5:
            return
        self.last_update = now

        elapsed = now - self.start_time

        # Calculate progress
        providers_done = sum(1 for s in self.provider_status.values() if s in ("done", "error"))
        progress_pct = (self.completed_steps / self.total_steps * 100) if self.total_steps > 0 else 0

        state = {
            "completed": self.completed_steps,
            "total": self.total_steps,
            "description": f"Dogpile: {self.query}",
            "current_item": self.current_stage,
            "stats": {
                "providers_done": providers_done,
                "providers_total": len(self.PROVIDERS),
                "errors": len(self.errors),
                "rate_limits": sum(self.rate_limits.values()),
            },
            "provider_status": self.provider_status,
            "provider_times": self.provider_times,
            "errors": self.errors[-10:],  # Last 10 errors
            "rate_limits": self.rate_limits,
            "elapsed_seconds": round(elapsed, 1),
            "progress_pct": round(progress_pct, 1),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "completed" if final else "running",
        }

        # Write to file
        try:
            tmp = self.state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(state, indent=2))
            os.replace(tmp, self.state_file)
        except Exception:
            pass

        # Push to API if configured
        if self.api_url:
            try:
                import requests
                requests.post(
                    f"{self.api_url}/tasks/{self.name}/state",
                    json=state,
                    timeout=0.5
                )
            except Exception:
                pass

    def start_stage(self, stage: str):
        """Mark a stage as starting."""
        self.current_stage = stage
        self._update_state()

    def complete_stage(self, stage: str):
        """Mark a stage as complete."""
        self.completed_steps += 1
        self._update_state()

    def start_provider(self, provider: str):
        """Mark a provider search as starting."""
        self.provider_status[provider] = "running"
        self.provider_times[provider] = time.time()
        self.current_stage = f"{provider} search"
        self._update_state()

    def complete_provider(self, provider: str, success: bool = True, error_msg: Optional[str] = None):
        """Mark a provider search as complete."""
        self.provider_status[provider] = "done" if success else "error"
        if provider in self.provider_times:
            self.provider_times[provider] = round(time.time() - self.provider_times[provider], 2)

        if not success and error_msg:
            self.errors.append({
                "provider": provider,
                "message": error_msg,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            })

        self.completed_steps += 1
        self._update_state()

    def log_rate_limit(self, provider: str, retry_after: Optional[float] = None):
        """Log a rate limit hit."""
        self.rate_limits[provider] = self.rate_limits.get(provider, 0) + 1
        self.provider_status[provider] = "rate_limited"
        self.errors.append({
            "provider": provider,
            "message": f"Rate limited (retry after {retry_after:.0f}s)" if retry_after else "Rate limited",
            "type": "rate_limit",
            "retry_after": retry_after,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        self._update_state()

    def log_error(self, provider: str, error_msg: str, error_type: str = "error"):
        """Log an error."""
        self.errors.append({
            "provider": provider,
            "message": error_msg,
            "type": error_type,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        self._update_state()

    def finish(self, success: bool = True):
        """Mark the search as complete."""
        self.current_stage = "completed" if success else "failed"
        self._update_state(final=True)

    def get_summary(self) -> Dict[str, Any]:
        """Get a summary for logging/reporting."""
        elapsed = time.time() - self.start_time
        providers_done = sum(1 for s in self.provider_status.values() if s == "done")
        providers_error = sum(1 for s in self.provider_status.values() if s == "error")

        return {
            "query": self.query,
            "elapsed_seconds": round(elapsed, 1),
            "providers": {
                "succeeded": providers_done,
                "failed": providers_error,
                "total": len(self.PROVIDERS),
            },
            "errors": len(self.errors),
            "rate_limits": sum(self.rate_limits.values()),
            "rate_limit_providers": list(self.rate_limits.keys()),
        }


# Global monitor instance for current search
_current_monitor: Optional[DogpileMonitor] = None


def start_search(query: str, name: str = "dogpile-search") -> DogpileMonitor:
    """Start monitoring a new dogpile search."""
    global _current_monitor
    _current_monitor = DogpileMonitor(query=query, name=name)
    return _current_monitor


def get_monitor() -> Optional[DogpileMonitor]:
    """Get the current search monitor."""
    return _current_monitor


def end_search(success: bool = True):
    """End the current search monitoring."""
    global _current_monitor
    if _current_monitor:
        _current_monitor.finish(success)
        _current_monitor = None
