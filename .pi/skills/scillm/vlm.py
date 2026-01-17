#!/usr/bin/env python3
"""scillm VLM (Vision-Language Model) completions CLI.

Per SCILLM_PAVED_PATH_CONTRACT.md - uses acompletion for multimodal calls.

Usage:
    # Describe an image
    python vlm.py describe /path/to/image.png

    # Describe with custom prompt
    python vlm.py describe /path/to/image.png --prompt "What table headers do you see?"

    # Batch describe images from JSONL
    python vlm.py batch --input images.jsonl

    # JSON output
    python vlm.py describe /path/to/image.png --json
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any

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

app = typer.Typer(add_completion=False, help="VLM (multimodal) completions via scillm")


def _encode_image(path: Path) -> str:
    """Read image file and return base64-encoded data URI."""
    suffix = path.suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    mime = mime_types.get(suffix, "image/png")
    data = base64.b64encode(path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{data}"


async def _describe_image(
    image_path: Path,
    prompt: str = "Describe this image in detail.",
    model: Optional[str] = None,
    json_mode: bool = False,
    max_tokens: int = 1024,
    timeout: int = 45,
) -> Dict[str, Any]:
    """Describe a single image using VLM."""
    from scillm import acompletion

    api_base = os.getenv("CHUTES_API_BASE")
    api_key = os.getenv("CHUTES_API_KEY")
    model_id = model or os.getenv("CHUTES_VLM_MODEL") or "Qwen/Qwen3-VL-235B-A22B-Instruct"

    if not api_key:
        return {"ok": False, "error": "CHUTES_API_KEY not set"}

    if not image_path.exists():
        return {"ok": False, "error": f"Image not found: {image_path}"}

    try:
        image_url = _encode_image(image_path)
    except Exception as e:
        return {"ok": False, "error": f"Failed to read image: {e}"}

    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
    }]

    try:
        resp = await acompletion(
            model=model_id,
            api_base=api_base,
            api_key=api_key,
            custom_llm_provider="openai_like",  # Required per SCILLM_PAVED_PATH_CONTRACT
            messages=messages,
            response_format={"type": "json_object"} if json_mode else None,
            max_tokens=max_tokens,
            temperature=0.2,
            timeout=timeout,
        )
        content = resp.choices[0].message.content
        return {"ok": True, "content": content, "model": model_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def describe_image_sync(
    image_path: Path,
    prompt: str = "Describe this image in detail.",
    model: Optional[str] = None,
    json_mode: bool = False,
    max_tokens: int = 1024,
    timeout: int = 45,
) -> Dict[str, Any]:
    """Sync wrapper for describe_image - importable by other skills.

    Example:
        from vlm import describe_image_sync
        result = describe_image_sync(Path("image.png"))
        if result["ok"]:
            print(result["content"])
    """
    return asyncio.run(_describe_image(
        image_path=image_path,
        prompt=prompt,
        model=model,
        json_mode=json_mode,
        max_tokens=max_tokens,
        timeout=timeout,
    ))


@app.command()
def describe(
    image: Path = typer.Argument(..., help="Path to image file"),
    prompt: str = typer.Option("Describe this image in detail.", "--prompt", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m", help="Model (default: $CHUTES_VLM_MODEL)"),
    json_mode: bool = typer.Option(False, "--json", "-j", help="Request JSON response"),
    timeout: int = typer.Option(45, "--timeout", "-t", help="Request timeout (s)"),
):
    """Describe a single image using VLM."""
    result = asyncio.run(_describe_image(
        image_path=image,
        prompt=prompt,
        model=model,
        json_mode=json_mode,
        timeout=timeout,
    ))

    if result["ok"]:
        if json_mode:
            try:
                parsed = json.loads(result["content"])
                print(json.dumps(parsed, indent=2))
            except json.JSONDecodeError:
                print(result["content"])
        else:
            print(result["content"])
    else:
        print(json.dumps({"error": result["error"]}))
        raise typer.Exit(1)


@app.command()
def batch(
    input_file: Path = typer.Option(..., "--input", "-i", help="JSONL file with image paths"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output JSONL"),
    prompt: str = typer.Option("Describe this image.", "--prompt", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    json_mode: bool = typer.Option(False, "--json", "-j"),
    concurrency: int = typer.Option(6, "--concurrency", "-c"),
    timeout: int = typer.Option(45, "--timeout", "-t"),
    wall_time: int = typer.Option(300, "--wall-time", help="Total wall time (s)"),
):
    """Batch describe images using parallel VLM calls."""
    from scillm.batch import parallel_acompletions_iter

    api_base = os.getenv("CHUTES_API_BASE")
    api_key = os.getenv("CHUTES_API_KEY")
    model_id = model or os.getenv("CHUTES_VLM_MODEL") or "Qwen/Qwen3-VL-235B-A22B-Instruct"

    if not api_key:
        print('{"error": "CHUTES_API_KEY not set"}')
        raise typer.Exit(1)

    # Read image paths from JSONL
    lines = input_file.read_text().strip().split("\n")
    requests: List[Dict[str, Any]] = []
    path_map: Dict[int, str] = {}

    for idx, line in enumerate(lines):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            img_path = Path(data.get("path") or data.get("image") or line.strip())
            item_prompt = data.get("prompt", prompt)
        except json.JSONDecodeError:
            img_path = Path(line.strip())
            item_prompt = prompt

        if not img_path.exists():
            typer.echo(f"Skip: {img_path} (not found)", err=True)
            continue

        try:
            image_url = _encode_image(img_path)
        except Exception as e:
            typer.echo(f"Skip: {img_path} ({e})", err=True)
            continue

        requests.append({
            "model": model_id,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": item_prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ]
            }],
            "response_format": {"type": "json_object"} if json_mode else None,
            "max_tokens": 1024,
            "temperature": 0.2,
            "index": idx,
        })
        path_map[idx] = str(img_path)

    if not requests:
        print('{"error": "No valid images"}')
        raise typer.Exit(1)

    typer.echo(f"Processing {len(requests)} images with {model_id}...", err=True)

    async def _run():
        results = []
        async for r in parallel_acompletions_iter(
            requests,
            api_base=api_base,
            api_key=api_key,
            custom_llm_provider="openai_like",  # Required per SCILLM_PAVED_PATH_CONTRACT
            concurrency=concurrency,
            timeout=timeout,
            wall_time_s=wall_time,
            tenacious=False,
        ):
            idx = r.get("index", len(results))
            path = path_map.get(idx, "unknown")
            if r.get("ok"):
                results.append({"index": idx, "path": path, "content": r.get("content"), "ok": True})
            else:
                results.append({"index": idx, "path": path, "error": r.get("error"), "ok": False})
        return results

    results = asyncio.run(_run())

    out_lines = [json.dumps(r) for r in results]
    if output:
        output.write_text("\n".join(out_lines))
        typer.echo(f"Wrote to {output}", err=True)
    else:
        for line in out_lines:
            print(line)

    ok = sum(1 for r in results if r.get("ok"))
    typer.echo(f"Done: {ok}/{len(results)} ok", err=True)


if __name__ == "__main__":
    app()
