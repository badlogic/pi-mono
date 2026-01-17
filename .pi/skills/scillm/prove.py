#!/usr/bin/env python3
"""Lean4 theorem prover CLI via scillm.

Per SCILLM_PAVED_PATH_CONTRACT.md - uses prove_requirement directly.

Usage:
    # Prove a claim
    python prove.py "Prove that n + 0 = n"

    # With tactic hints
    python prove.py "Prove n < n + 1" --tactics omega

    # Check availability
    python prove.py --check
"""
from __future__ import annotations

import asyncio
import json
import sys

import typer

app = typer.Typer(add_completion=False, help="Lean4 theorem proving via scillm")


@app.command()
def prove(
    claim: str = typer.Argument(None, help="Claim to prove (natural language)"),
    tactics: str = typer.Option("", "--tactics", "-t", help="Comma-separated tactics (simp,omega,ring,linarith)"),
    timeout: int = typer.Option(120, "--timeout", help="Compile timeout (s)"),
    candidates: int = typer.Option(3, "--candidates", "-n", help="Number of proof candidates (1-5)"),
    check: bool = typer.Option(False, "--check", help="Check if certainly is available"),
    json_out: bool = typer.Option(True, "--json/--no-json", help="Output JSON"),
):
    """Prove a mathematical claim using Lean4."""
    # Contract: use prove_requirement from scillm.integrations.certainly
    try:
        from scillm.integrations.certainly import (
            prove_requirement,
            is_available,
            check_lean_container,
        )
    except ImportError:
        result = {"ok": False, "error": "scillm[certainly] not installed. Run: pip install scillm[certainly]"}
        print(json.dumps(result, indent=2) if json_out else result["error"])
        raise typer.Exit(1)

    if check:
        pkg_ok = is_available()
        container_ok = check_lean_container() if pkg_ok else False
        result = {
            "package_installed": pkg_ok,
            "lean_container_running": container_ok,
            "ready": pkg_ok and container_ok,
        }
        if not result["ready"]:
            if not pkg_ok:
                result["hint"] = "pip install scillm[certainly]"
            else:
                result["hint"] = "Start lean_runner: cd lean4 && make lean-runner-up"
        print(json.dumps(result, indent=2) if json_out else f"Ready: {result['ready']}")
        raise typer.Exit(0 if result["ready"] else 1)

    if not claim:
        typer.echo("Error: Provide a claim to prove", err=True)
        raise typer.Exit(1)

    if not is_available():
        result = {"ok": False, "error": "certainly not available"}
        print(json.dumps(result, indent=2) if json_out else result["error"])
        raise typer.Exit(1)

    # Parse tactics
    tactic_list = [t.strip() for t in tactics.split(",") if t.strip()] if tactics else None

    async def _run():
        return await prove_requirement(
            requirement=claim,
            tactics=tactic_list,
            compile_timeout_s=timeout,
            num_candidates=candidates,
        )

    typer.echo(f"Proving: {claim[:80]}...", err=True)
    result = asyncio.run(_run())

    if json_out:
        # Simplify output for CLI
        if result.get("ok"):
            out = {
                "ok": True,
                "lean4_code": result["best"]["lean4"],
                "compile_ms": result["best"].get("compile_ms"),
                "summary": f"Proof found ({result['best'].get('compile_ms', 0)}ms)",
            }
        else:
            out = {
                "ok": False,
                "error": result.get("error"),
                "diagnosis": result.get("diagnosis", {}).get("diagnosis"),
                "suggestion": result.get("diagnosis", {}).get("suggested_requirement_edit"),
                "attempts": len(result.get("attempts", [])),
            }
        print(json.dumps(out, indent=2))
    else:
        if result.get("ok"):
            print(f"PROVED:\n{result['best']['lean4']}")
        else:
            print(f"FAILED: {result.get('error') or result.get('diagnosis', {}).get('diagnosis')}")
            if result.get("diagnosis", {}).get("suggested_requirement_edit"):
                print(f"Suggestion: {result['diagnosis']['suggested_requirement_edit']}")

    raise typer.Exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    app()
