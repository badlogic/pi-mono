#!/usr/bin/env python3
"""
nightly_dogpile.py - Nightly Deep Dive Orchestrator

Workflow:
1. Assess Project (Static + LLM) -> report.json
2. Filter for Critical/Brittle/Aspirational issues
3. Dogpile Research (if needed) -> context.md
4. Code Review Loop (Fix) -> PR/Commit
"""
import sys
import json
import subprocess
import argparse
from pathlib import Path
from typing import Dict, Any, List

# Configuration
SKILLS_DIR = Path.home() / "workspace/experiments/pi-mono/.pi/skills"
ASSESS_SCRIPT = SKILLS_DIR / "assess/assess.py"
DOGPILE_SCRIPT = SKILLS_DIR / "dogpile/run.sh"
CODE_REVIEW_SCRIPT = SKILLS_DIR / "code-review/code_review.py"
MEMORY_SCRIPT = SKILLS_DIR / "memory/run.sh"
TASK_MONITOR_SCRIPT = SKILLS_DIR / "task-monitor/monitor_adapter.py"

def run_assessment(project_path: Path) -> Dict[str, Any]:
    """Run assess.py and return parsed JSON."""
    print(f"Running assessment on {project_path}...")
    try:
        result = subprocess.run(
            [sys.executable, str(ASSESS_SCRIPT), "run", str(project_path)],
            capture_output=True, text=True, check=True
        )
        # Find JSON in output (grep for first {)
        output = result.stdout
        json_start = output.find('{')
        if json_start != -1:
            return json.loads(output[json_start:])
        return {}
    except subprocess.CalledProcessError as e:
        print(f"Assessment failed: {e.stderr}", file=sys.stderr)
        return {}

def record_nightly_assessment(project: str, issue: Dict[str, Any], research: str = "", outcome: str = "", status: str = "success"):
    """Store assessment run in /memory nightly_assessments collection."""
    print(f"Recording assessment for: {issue['feature']}")
    try:
        subprocess.run([
            str(MEMORY_SCRIPT), "assessment",
            "--project", project,
            "--issue", json.dumps(issue),
            "--research", research,
            "--outcome", outcome,
            "--status", status
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Assessment recording failed: {e}", file=sys.stderr)

def trigger_dogpile(topic: str) -> str:
    """Run dogpile search and return summary."""
    print(f"Dogpiling on: {topic}")
    try:
        # Call dogpile search
        result = subprocess.run(
            [str(DOGPILE_SCRIPT), "search", topic],
            capture_output=True, text=True, check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Dogpile failed: {e.stderr}", file=sys.stderr)
        return f"Research failed for {topic}"

def update_task_monitor(task_id: str, status: str, progress: int):
    """Update task monitor if available."""
    try:
        # Use the monitor adapter if it exists
        if TASK_MONITOR_SCRIPT.exists():
            subprocess.run([
                sys.executable, str(TASK_MONITOR_SCRIPT), 
                "update", task_id, 
                "--status", status, 
                "--progress", str(progress)
            ], check=False)
    except Exception:
        pass

def trigger_code_review(project_path: Path, issue: Dict[str, Any], context: str):
    """Run code_review.py loop to fix the issue."""
    print(f"Starting Code Review Loop for: {issue['feature']}")
    update_task_monitor("nightly-fix", f"Fixing {issue['feature']}", 50)
    
    # Construct a request.md for the review
    request_content = f"""
# Nightly Fix: {issue['feature']}

## Issue
{issue['reason']}

## Location
{issue['location']}

## Context from Research
{context}

## Goal
Fix the identified issue. Ensure no regressions.
"""
    request_path = project_path / ".nightly_fix_request.md"
    request_path.write_text(request_content)

    # Run loop
    cmd = [
        sys.executable, str(CODE_REVIEW_SCRIPT), "loop",
        "--file", str(request_path),
        "--rounds", "2",
        "--workspace", str(project_path),
        "--save-intermediate"
    ]
    
    print(f"Executing: {' '.join(cmd)}")
    try:
        subprocess.run(cmd, check=True)
        update_task_monitor("nightly-fix", f"Fixed {issue['feature']}", 100)
        return "Code review successful. Patch applied."
    except subprocess.CalledProcessError:
        update_task_monitor("nightly-fix", f"FAILED {issue['feature']}", 0)
        return "Code review failed."

def run_project(project_path: Path):
    if not project_path.exists():
        print(f"Project not found: {project_path}")
        return

    print(f"=== Starting Nightly Deep Dive: {project_path.name} ===")
    
    # 1. Assess
    report = run_assessment(project_path)
    if not report:
        print("No assessment report generated.")
        return

    # 2. Identify Issues (Brittle & Over-Engineered)
    issues_to_fix = []
    issues_to_fix.extend(report.get("categories", {}).get("brittle", []))
    issues_to_fix.extend(report.get("categories", {}).get("over_engineered", []))
    issues_to_fix.extend(report.get("categories", {}).get("aspirational", [])) # Maybe implement stubs?

    print(f"Found {len(issues_to_fix)} potential issues.")

    # 3. Fix Loop
    for issue in issues_to_fix[:1]: # Limit to 1 per night for safety
        print(f"Selected for repair: {issue['feature']}")
        
        # 4. Research
        context = trigger_dogpile(f"{issue['feature']} in {report['project']}")
        
        # 5. Review/Fix
        outcome = trigger_code_review(project_path, issue, context)
        
        # 6. Memory Storage (Permanent Record)
        record_nightly_assessment(
            project=report['project'],
            issue=issue,
            research=context,
            outcome=outcome or "Fix applied or LGTM",
            status="success" if outcome else "failed"
        )

def main():
    parser = argparse.ArgumentParser(description="Nightly Dogpile Orchestrator")
    parser.add_argument("--project", help="Specific project to run on")
    parser.add_argument("--all-projects", action="store_true", help="Run on all registered projects")
    args = parser.parse_args()

    if args.project:
        run_project(Path(args.project))
    elif args.all_projects:
        # Example hardcoded list for now, ideally read from config
        projects = [
            Path("/home/graham/workspace/experiments/pi-mono"),
            # Add others here
        ]
        for p in projects:
            run_project(p)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
