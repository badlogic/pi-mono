from pathlib import Path
import json
import time
import os
from datetime import datetime

# Standard location for task-monitor
TASK_MONITOR_REGISTRY = Path.home() / ".pi" / "task-monitor" / "registry.json"
STATE_FILE = Path(__file__).parent / "train_convo_steering_task_state.json"

class SteeringTaskClient:
    """Client for task-monitor integration."""
    def __init__(self, task_name: str, total_items: int):
        self.task_name = task_name
        self.total_items = total_items
        self.completed = 0
        self.start_time = time.time()
        self._register_task()
        self._write_state()

    def _register_task(self):
        try:
            registry = {}
            if TASK_MONITOR_REGISTRY.exists():
                registry = json.loads(TASK_MONITOR_REGISTRY.read_text())
            
            registry[f"train-convo-steering:{self.task_name}"] = {
                "state_file": str(STATE_FILE),
                "total": self.total_items,
                "project": "train-convo-steering",
                "started_at": datetime.now().isoformat()
            }
            TASK_MONITOR_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
            TASK_MONITOR_REGISTRY.write_text(json.dumps(registry, indent=2))
        except Exception:
            # Task monitor failure shouldn't crash the skill
            pass

    def _write_state(self, final=False, status="running"):
        try:
            pct = round(self.completed / max(1, self.total_items) * 100, 1)
            state = {
                "completed": self.completed,
                "total": self.total_items,
                "progress_pct": pct,
                "status": "completed" if final else status,
                "last_updated": datetime.now().isoformat()
            }
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(state, indent=2))
            os.replace(tmp, STATE_FILE)
        except Exception:
            pass

    def update(self, count=1, status="running"):
        self.completed += count
        if self.completed > self.total_items:
            self.completed = self.total_items
        self._write_state(status=status)

    def finish(self):
        self._write_state(final=True)
