#!/usr/bin/env python3
"""scillm batch completions CLI.

Per SCILLM_PAVED_PATH_CONTRACT.md - uses parallel_acompletions directly.

Usage:
    # Single prompt
    python batch.py single "What is 2+2?"

    # Batch from JSONL (one {"prompt": "..."} per line)
    python batch.py batch --input prompts.jsonl

    # Batch with JSON mode
    python batch.py batch --input prompts.jsonl --json

    # As importable function from other skills:
    from scillm_skill import quick_completion
    result = quick_completion("What is 2+2?")
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Optional

SKILLS_DIR = Path(__file__).resolve().parents[1]
if str(SKILLS_DIR) not in sys.path:
    sys.path.append(str(SKILLS_DIR))

try:
    from dotenv_helper import load_env as _load_env  # type: ignore
except Exception:
    def _load_env():
        try:
            from dotenv import load_dotenv, find_dotenv  # type: ignore
            load_dotenv(find_dotenv(usecwd=True), override=False)
        except Exception:
            pass

_load_env()

import typer

app = typer.Typer(add_completion=False, help="Batch LLM completions via scillm")


# =============================================================================
# Importable helper for other skills
# =============================================================================

async def _quick_acompletion(
    prompt: str,
    model: Optional[str] = None,
    json_mode: bool = False,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    timeout: int = 30,
    system: Optional[str] = None,
) -> str:
    """Async single completion - importable by other skills.

    Args:
        prompt: The user prompt
        model: Model ID (default: $CHUTES_MODEL_ID or $CHUTES_TEXT_MODEL)
        json_mode: Request JSON response
        max_tokens: Max tokens
        temperature: Sampling temperature
        timeout: Request timeout in seconds
        system: Optional system prompt

    Returns:
        The completion text, or raises exception on error
    """
    from scillm import acompletion

    api_base = os.getenv("CHUTES_API_BASE")
    api_key = os.getenv("CHUTES_API_KEY")
    model_id = model or os.getenv("CHUTES_MODEL_ID") or os.getenv("CHUTES_TEXT_MODEL")

    if not api_key:
        raise ValueError("CHUTES_API_KEY not set")
    if not model_id:
        raise ValueError("No model specified (--model or $CHUTES_MODEL_ID)")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    resp = await acompletion(
        model=model_id,
        api_base=api_base,
        api_key=api_key,
        custom_llm_provider="openai_like",
        messages=messages,
        response_format={"type": "json_object"} if json_mode else None,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
    )

    return resp.choices[0].message.content


def quick_completion(
    prompt: str,
    model: Optional[str] = None,
    json_mode: bool = False,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    timeout: int = 30,
    system: Optional[str] = None,
) -> str:
    """Sync single completion - importable by other skills.

    Example:
        from batch import quick_completion
        result = quick_completion("What is 2+2?")
        result = quick_completion("Extract JSON", json_mode=True)

    Args:
        prompt: The user prompt
        model: Model ID (default: $CHUTES_MODEL_ID or $CHUTES_TEXT_MODEL)
        json_mode: Request JSON response
        max_tokens: Max tokens
        temperature: Sampling temperature
        timeout: Request timeout in seconds
        system: Optional system prompt

    Returns:
        The completion text, or raises exception on error
    """
    return asyncio.run(_quick_acompletion(
        prompt=prompt,
        model=model,
        json_mode=json_mode,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
        system=system,
    ))


def _get_env(key: str, default: str = "") -> str:
    """Get env var."""
    return os.getenv(key, default)


@app.command()
def batch(
    input_file: Optional[Path] = typer.Option(None, "--input", "-i", help="JSONL file (or - for stdin)"),
    prompt: Optional[str] = typer.Option(None, "--prompt", "-p", help="Single prompt"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output JSONL"),
    model: Optional[str] = typer.Option(None, "--model", "-m", help="Model (default: $CHUTES_MODEL_ID)"),
    json_mode: bool = typer.Option(False, "--json", "-j", help="Request JSON response"),
    concurrency: int = typer.Option(6, "--concurrency", "-c", help="Parallel requests"),
    timeout: int = typer.Option(30, "--timeout", "-t", help="Per-request timeout (s)"),
    wall_time: int = typer.Option(300, "--wall-time", help="Total wall time (s)"),
    max_tokens: int = typer.Option(1024, "--max-tokens", help="Max tokens"),
):
    """Run batch completions per SCILLM_PAVED_PATH_CONTRACT.md."""
    # Contract: use parallel_acompletions from scillm
    from scillm import parallel_acompletions

    api_base = _get_env("CHUTES_API_BASE")
    api_key = _get_env("CHUTES_API_KEY")
    model_id = model or _get_env("CHUTES_MODEL_ID") or _get_env("CHUTES_TEXT_MODEL")

    if not api_key:
        typer.echo('{"error": "CHUTES_API_KEY not set"}')
        raise typer.Exit(1)
    if not model_id:
        typer.echo('{"error": "No model (--model or $CHUTES_MODEL_ID)"}')
        raise typer.Exit(1)

    # Collect prompts
    prompts: list[str] = []
    if prompt:
        prompts.append(prompt)
    elif input_file:
        lines = sys.stdin.read().strip().split("\n") if str(input_file) == "-" else input_file.read_text().strip().split("\n")
        for line in lines:
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                prompts.append(data.get("prompt") or data.get("text") or line)
            except json.JSONDecodeError:
                prompts.append(line)
    else:
        typer.echo('{"error": "Provide --input or --prompt"}')
        raise typer.Exit(1)

    if not prompts:
        typer.echo('{"error": "No prompts"}')
        raise typer.Exit(1)

    # Contract: model goes INSIDE each request dict, NOT as top-level kwarg
    reqs = []
    for p in prompts:
        req = {
            "model": model_id,
            "messages": [{"role": "user", "content": p}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if json_mode:
            req["response_format"] = {"type": "json_object"}
        reqs.append(req)

    async def _run():
        return await parallel_acompletions(
            reqs,
            api_base=api_base,
            api_key=api_key,
            custom_llm_provider="openai_like",
            concurrency=concurrency,
            timeout=timeout,
            wall_time_s=wall_time,
            response_format={"type": "json_object"} if json_mode else None,
            tenacious=False,  # Contract: recommended default
        )

    typer.echo(f"Processing {len(prompts)} prompts...", err=True)
    results = asyncio.run(_run())

    # Contract: return shape is list of dicts with index, request, response, error, status, content
    out_lines = []
    ok_count = err_count = 0

    for i, r in enumerate(results):
        if r.get("error"):
            out_lines.append(json.dumps({"index": i, "error": r["error"], "status": r.get("status")}))
            err_count += 1
        else:
            out_lines.append(json.dumps({"index": i, "content": r.get("content"), "ok": True}))
            ok_count += 1

    if output:
        output.write_text("\n".join(out_lines))
        typer.echo(f"Wrote to {output}", err=True)
    else:
        for line in out_lines:
            print(line)

    typer.echo(f"Done: {ok_count} ok, {err_count} errors", err=True)


@app.command()
def single(
    prompt: str = typer.Argument(..., help="Prompt"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    json_mode: bool = typer.Option(False, "--json", "-j"),
    timeout: int = typer.Option(30, "--timeout", "-t"),
):
    """Single completion (convenience)."""
    from scillm import acompletion

    api_base = _get_env("CHUTES_API_BASE")
    api_key = _get_env("CHUTES_API_KEY")
    model_id = model or _get_env("CHUTES_MODEL_ID") or _get_env("CHUTES_TEXT_MODEL")

    if not api_key or not model_id:
        typer.echo('{"error": "CHUTES_API_KEY and model required"}')
        raise typer.Exit(1)

    async def _run():
        return await acompletion(
            model=model_id,
            api_base=api_base,
            api_key=api_key,
            custom_llm_provider="openai_like",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"} if json_mode else None,
            max_tokens=1024,
            temperature=0.2,
            timeout=timeout,
        )

    resp = asyncio.run(_run())

    try:
        content = resp.choices[0].message.content
        if json_mode:
            print(json.dumps(json.loads(content), indent=2))
        else:
            print(content)
    except Exception as e:
        typer.echo(f'{{"error": "{e}"}}')
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
