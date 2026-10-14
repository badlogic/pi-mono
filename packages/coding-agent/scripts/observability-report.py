#!/usr/bin/env python3
"""Summarize pi observability output (spans and metric snapshots) written as JSONL.

Usage:
    python3 observability-report.py [TELEMETRY_DIR] [--day YYYY-MM-DD]

Defaults to ~/.pi/agent/telemetry and the most recent day found. Standard library only.
Latency percentiles come from span durations; token and count totals come from the last
cumulative metric snapshot of the day.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def fmt(value: float | None, unit: str = "ms") -> str:
    return "-" if value is None else f"{value:.1f}{unit}"


def span_durations(spans: list[dict[str, Any]], name: str) -> list[float]:
    return [s["durationMs"] for s in spans if s["name"] == name and "durationMs" in s]


def latest_metric_values(snapshots: list[dict[str, Any]]) -> dict[tuple[str, tuple[tuple[str, str], ...]], float]:
    """Cumulative counters: the last snapshot holds the day's totals."""
    totals: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
    if not snapshots:
        return totals
    for metric in snapshots[-1]["metrics"]:
        if str(metric.get("type")).upper() not in ("SUM", "3"):
            continue
        for point in metric["dataPoints"]:
            attributes = tuple(sorted((str(k), str(v)) for k, v in point.get("attributes", {}).items()))
            value = point.get("value")
            if isinstance(value, (int, float)):
                totals[(metric["name"], attributes)] = float(value)
    return totals


def sum_by(totals: dict[tuple[str, tuple[tuple[str, str], ...]], float], name: str, key: str) -> dict[str, float]:
    grouped: dict[str, float] = defaultdict(float)
    for (metric_name, attributes), value in totals.items():
        if metric_name != name:
            continue
        label = dict(attributes).get(key, "all")
        grouped[label] += value
    return dict(grouped)


def pick_day(directory: Path, requested: str | None) -> str | None:
    days = sorted({p.name.split("-", 1)[1].removesuffix(".jsonl") for p in directory.glob("spans-*.jsonl")})
    if requested:
        return requested if requested in days else None
    return days[-1] if days else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", nargs="?", default=str(Path.home() / ".pi" / "agent" / "telemetry"))
    parser.add_argument("--day", help="UTC day to summarize, YYYY-MM-DD")
    args = parser.parse_args()

    directory = Path(args.directory).expanduser()
    day = pick_day(directory, args.day)
    if day is None:
        print(f"No span files found in {directory}")
        return

    spans = read_jsonl(directory / f"spans-{day}.jsonl")
    snapshots = read_jsonl(directory / f"metrics-{day}.jsonl")
    totals = latest_metric_values(snapshots)

    print(f"Day {day}  spans={len(spans)}  metric snapshots={len(snapshots)}")
    print()

    runs = span_durations(spans, "session.run")
    turns = span_durations(spans, "turn")
    llm = span_durations(spans, "llm.request")
    print("Latency (from spans)")
    print(f"  session.run   n={len(runs):<5} p50={fmt(percentile(runs, 50))} p95={fmt(percentile(runs, 95))}")
    print(f"  turn          n={len(turns):<5} p50={fmt(percentile(turns, 50))} p95={fmt(percentile(turns, 95))}")
    print(f"  llm.request   n={len(llm):<5} p50={fmt(percentile(llm, 50))} p95={fmt(percentile(llm, 95))}")

    ttft = [s["attributes"]["pi.llm.ttft_ms"] for s in spans if s["name"] == "llm.request" and "pi.llm.ttft_ms" in s["attributes"]]
    print(f"  TTFT          n={len(ttft):<5} p50={fmt(percentile(ttft, 50))} p95={fmt(percentile(ttft, 95))}")
    print()

    tokens = sum_by(totals, "pi.llm.tokens", "pi.token.type")
    if tokens:
        input_side = tokens.get("input", 0) + tokens.get("cache_read", 0) + tokens.get("cache_write", 0)
        hit_ratio = tokens.get("cache_read", 0) / input_side if input_side else None
        print("Tokens (cumulative for the day)")
        for kind in ("input", "output", "cache_read", "cache_write"):
            print(f"  {kind:<12} {int(tokens.get(kind, 0)):>12,}")
        print(f"  cache hit ratio = cache_read / (input + cache_read + cache_write): {'-' if hit_ratio is None else f'{hit_ratio:.1%}'}")
        print()

    calls = sum_by(totals, "pi.tool.calls", "pi.tool.name")
    if calls:
        errors = sum_by({k: v for k, v in totals.items() if dict(k[1]).get("pi.tool.is_error") == "True"}, "pi.tool.calls", "pi.tool.name")
        print("Tools")
        for name in sorted(calls, key=calls.get, reverse=True):
            durations = [s["durationMs"] for s in spans if s["name"] == f"tool.{name}" and "durationMs" in s]
            error_rate = errors.get(name, 0) / calls[name] if calls[name] else 0
            print(
                f"  {name:<12} calls={int(calls[name]):<5} errors={error_rate:.1%} "
                f"p50={fmt(percentile(durations, 50))} p95={fmt(percentile(durations, 95))}"
            )
        print()

    compactions = sum_by(totals, "pi.compactions", "pi.compaction.outcome")
    retries = sum_by(totals, "pi.llm.retries", "pi.llm.retry.attempt")
    if compactions or retries:
        print("Compaction and retries")
        for outcome, count in sorted(compactions.items()):
            print(f"  compaction outcome={outcome:<10} {int(count)}")
        print(f"  llm retries total  {int(sum(retries.values()))}")
        print()


if __name__ == "__main__":
    main()
