#!/usr/bin/env python3.12
"""
OpenHands Advanced Agent Runner for Discord Bot
Expert-level software agents with Z.ai GLM model via LiteLLM

Features:
- Expert modes: vulnerability scan, code review, test generation, documentation
- MCP integration support
- Sub-agent delegation
- Security analyzer
- Conversation persistence
- Context condensation
- Agent Experts: Act-Learn-Reuse pattern with expertise accumulation
"""

import os
import sys
import json
import asyncio
import hashlib
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Callable

# OpenHands SDK imports
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.terminal import TerminalTool

# Try to import optional advanced features
try:
    from openhands.tools.web import WebTool
    HAS_WEB_TOOL = True
except ImportError:
    HAS_WEB_TOOL = False

# Persistence directory
PERSISTENCE_DIR = Path(os.getenv("OPENHANDS_PERSISTENCE_DIR", "/tmp/openhands_sessions"))
PERSISTENCE_DIR.mkdir(parents=True, exist_ok=True)

# Expertise directory (Agent Experts pattern)
SCRIPT_DIR = Path(__file__).parent
EXPERTISE_DIR = SCRIPT_DIR / "expertise"
EXPERTISE_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================================
# Expert System Prompts
# ============================================================================

EXPERT_PROMPTS = {
    "vulnerability_scan": """You are a senior security engineer specializing in vulnerability assessment.
Your task is to scan code for security vulnerabilities including:
- SQL injection, XSS, CSRF, command injection
- Authentication/authorization flaws
- Insecure cryptography
- Hardcoded secrets and credentials
- Dependency vulnerabilities
- OWASP Top 10 issues

For each finding, provide:
1. Severity (Critical/High/Medium/Low)
2. Location (file:line)
3. Description of the vulnerability
4. Proof of concept (if applicable)
5. Remediation guidance with code fix

Format output as structured JSON for automation.""",

    "code_review": """You are a principal software engineer conducting a thorough code review.
Analyze the code for:
- Code quality and maintainability
- Performance issues and optimizations
- Error handling and edge cases
- API design and interface clarity
- Test coverage gaps
- Documentation completeness
- Adherence to best practices

Provide actionable feedback with specific line references.
Suggest concrete improvements with example code where appropriate.""",

    "test_generation": """You are a senior QA engineer and test automation specialist.
Generate comprehensive tests including:
- Unit tests for all public functions/methods
- Integration tests for component interactions
- Edge case tests (null, empty, boundary values)
- Error path tests (exceptions, failures)
- Performance/stress tests where appropriate

Use appropriate testing frameworks (pytest, vitest, jest) based on the codebase.
Aim for 90%+ code coverage. Include assertions for both success and failure cases.""",

    "documentation": """You are a technical writer creating developer documentation.
Generate comprehensive documentation including:
- README with project overview, installation, usage
- API documentation with all endpoints/functions
- Architecture diagrams (in Mermaid format)
- Code comments for complex logic
- Changelog entries for changes
- Example usage and tutorials

Follow documentation best practices: clear, concise, with examples.""",

    "refactor": """You are a senior architect performing strategic code refactoring.
Analyze and refactor code to:
- Reduce complexity and improve readability
- Extract reusable components/functions
- Apply appropriate design patterns
- Improve type safety and interfaces
- Eliminate code duplication (DRY)
- Optimize performance bottlenecks

Maintain backward compatibility where possible. Document breaking changes.""",

    "debug": """You are an expert debugger and performance analyst.
Systematically diagnose issues:
1. Reproduce the problem
2. Isolate the root cause
3. Analyze stack traces and logs
4. Test hypotheses with targeted debugging
5. Implement and verify the fix
6. Add regression tests

Provide clear explanation of what went wrong and why the fix works.""",

    "migrate": """You are a migration specialist handling code/dependency upgrades.
Plan and execute migrations:
- Analyze current dependencies and their versions
- Identify breaking changes in target versions
- Create migration plan with phases
- Update code for API changes
- Run tests at each phase
- Document migration steps and rollback procedures

Minimize disruption while maximizing improvements.""",

    "optimize": """You are a performance optimization expert.
Identify and fix performance issues:
- Profile code to find bottlenecks
- Optimize algorithms (reduce complexity)
- Improve memory usage
- Add caching where beneficial
- Parallelize where possible
- Optimize database queries
- Reduce bundle sizes (for frontend)

Measure before/after performance and document improvements.""",
}


# ============================================================================
# Self-Improve Prompts (Agent Experts Pattern)
# ============================================================================

SELF_IMPROVE_PROMPTS = {
    "developer": """After completing this task, reflect on what you learned:
- What patterns or approaches worked well?
- What common pitfalls did you encounter?
- What code templates could be reused?
- What insights about this codebase are valuable?

Format your learnings as markdown sections that can be appended to an expertise file.""",

    "vulnerability_scan": """After this security scan, document your learnings:
- What new vulnerability patterns did you discover?
- Were there any false positives to note?
- What remediation approaches were most effective?
- What codebase-specific security risks exist?

Format as markdown for expertise accumulation.""",

    "code_review": """After this code review, capture your insights:
- What quality patterns indicate well-written code here?
- What anti-patterns are common in this codebase?
- What style preferences should be remembered?
- What performance issues recur?

Format as markdown for expertise accumulation.""",

    "test_generation": """After generating tests, document what you learned:
- What testing patterns work well for this codebase?
- What edge cases should always be tested?
- What mocking strategies were effective?
- What areas typically lack coverage?

Format as markdown for expertise accumulation.""",

    "documentation": """After generating documentation, note your learnings:
- What documentation standards work for this project?
- What example formats communicate best?
- What API documentation patterns are effective?
- Who are the documentation consumers?

Format as markdown for expertise accumulation.""",

    "refactor": """After refactoring, capture your insights:
- What refactoring patterns improved the code?
- What complexity reduction approaches worked?
- What transformations are safe vs risky?
- What architectural patterns exist in this codebase?

Format as markdown for expertise accumulation.""",

    "debug": """After debugging this issue, document your learnings:
- What bug patterns are common here?
- What root cause analysis approaches worked?
- What debugging techniques were effective?
- What error signatures indicate specific problems?

Format as markdown for expertise accumulation.""",

    "migrate": """After this migration, capture your insights:
- What migration patterns worked well?
- What breaking changes were encountered?
- What compatibility layers were needed?
- What rollback strategies are safe?

Format as markdown for expertise accumulation.""",

    "optimize": """After optimization, document your learnings:
- What performance patterns work for this codebase?
- What bottleneck signatures indicate problems?
- What optimization techniques were effective?
- What trade-offs should be remembered?

Format as markdown for expertise accumulation.""",
}


# ============================================================================
# Expertise File Management (Act-Learn-Reuse)
# ============================================================================

def get_expertise_path(mode: str) -> Path:
    """Get path for mode-specific expertise file"""
    return EXPERTISE_DIR / f"{mode}.md"


def load_expertise(mode: str) -> str:
    """
    Load accumulated expertise for a mode (REUSE phase)
    Returns the expertise content to inject into system prompt
    """
    path = get_expertise_path(mode)
    if path.exists():
        try:
            content = path.read_text()
            # Extract non-empty sections
            sections = []
            current_section = []
            for line in content.split("\n"):
                if line.startswith("## ") and current_section:
                    section_text = "\n".join(current_section).strip()
                    # Only include sections with actual content (not just comments)
                    if section_text and not all(l.strip().startswith("<!--") for l in current_section if l.strip()):
                        sections.append(section_text)
                    current_section = [line]
                else:
                    current_section.append(line)

            if current_section:
                section_text = "\n".join(current_section).strip()
                if section_text:
                    sections.append(section_text)

            # Return expertise if there's meaningful content
            expertise = "\n\n".join(sections)
            if expertise and len(expertise) > 100:  # More than just template
                return f"\n\n## Accumulated Expertise\n{expertise}"
        except Exception:
            pass
    return ""


def update_expertise(mode: str, learnings: str, task: str, success: bool) -> None:
    """
    Update expertise file with new learnings (LEARN phase)
    Only updates if the task was successful
    """
    if not success or not learnings or len(learnings) < 50:
        return

    path = get_expertise_path(mode)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    try:
        current = path.read_text() if path.exists() else ""

        # Find the Session Insights section and append
        session_marker = "## Session Insights"
        if session_marker in current:
            # Append to session insights, keeping recent ones
            parts = current.split(session_marker)
            header = parts[0]
            insights = parts[1] if len(parts) > 1 else ""

            # Parse existing insights
            existing_insights = insights.strip().split("\n### Session:")
            existing_insights = [i for i in existing_insights if i.strip() and not i.strip().startswith("<!--")]

            # Keep only last 5 insights to prevent unbounded growth
            if len(existing_insights) > 5:
                existing_insights = existing_insights[-5:]

            # Add new insight
            new_insight = f"\n### Session: {timestamp}\n**Task:** {task[:100]}...\n\n{learnings}\n"
            existing_insights.append(new_insight)

            # Rebuild file
            updated = header + session_marker + "\n" + "\n".join(existing_insights)
        else:
            # Append section if it doesn't exist
            updated = current + f"\n\n{session_marker}\n### Session: {timestamp}\n**Task:** {task[:100]}...\n\n{learnings}\n"

        # Update metadata
        lines = updated.split("\n")
        for i, line in enumerate(lines):
            if line.startswith("*Last updated:"):
                lines[i] = f"*Last updated: {timestamp}*"
            elif line.startswith("*Total sessions:"):
                # Increment session count
                try:
                    count = int(re.search(r"\d+", line).group()) + 1
                    lines[i] = f"*Total sessions: {count}*"
                except:
                    lines[i] = f"*Total sessions: 1*"

        path.write_text("\n".join(lines))

    except Exception as e:
        # Don't fail the main task if learning fails
        sys.stderr.write(f"Warning: Could not update expertise: {e}\n")


def extract_learnings(output: str, mode: str) -> str:
    """
    Extract learning-worthy content from agent output
    Looks for explicit learning markers or infers from success patterns
    """
    learnings = []

    # Look for explicit learning sections
    learning_markers = [
        "## Learnings", "## What I Learned", "## Insights",
        "### Patterns", "### Observations", "### Notes",
        "## Key Insight", "### Key Insight", "## Recommendation",
        "## Anti-Patterns", "### Anti-Patterns", "## Best Practices",
        "## Option", "## Summary", "### Summary"
    ]

    for marker in learning_markers:
        if marker in output:
            idx = output.index(marker)
            # Extract until next ## or end
            section = output[idx:]
            end_idx = section.find("\n## ", len(marker))
            if end_idx > 0:
                section = section[:end_idx]
            learnings.append(section.strip()[:500])  # Limit section length

    # If no explicit learnings, extract key insights from patterns
    if not learnings and output:
        # Look for patterns that indicate insights
        insight_patterns = [
            r"(?:discovered|found|noticed|identified)[:\s]+(.+?)(?:\n|$)",
            r"(?:pattern|approach|technique)[:\s]+(.+?)(?:\n|$)",
            r"(?:important|notable|key)[:\s]+(.+?)(?:\n|$)",
            r"(?:recommend|suggestion|should)[:\s]+(.+?)(?:\n|$)",
            r"(?:anti-pattern|issue|problem)[:\s]+(.+?)(?:\n|$)",
            r"(?:best practice|optimization)[:\s]+(.+?)(?:\n|$)",
        ]

        for pattern in insight_patterns:
            matches = re.findall(pattern, output, re.IGNORECASE)
            learnings.extend(matches[:3])  # Limit to 3 per pattern

    # If still no learnings but output is substantial, extract summary
    if not learnings and output and len(output) > 200:
        # Take the first meaningful paragraph as a learning
        paragraphs = output.split("\n\n")
        for para in paragraphs[:3]:
            if len(para) > 100 and not para.startswith("#"):
                learnings.append(para[:400])
                break

    return "\n".join(learnings[:10]) if learnings else ""


def consolidate_expertise(mode: str) -> dict:
    """
    Consolidate session insights into permanent sections.
    Analyzes patterns across sessions and promotes recurring insights.
    Returns stats about consolidation.
    """
    path = get_expertise_path(mode)
    if not path.exists():
        return {"success": False, "error": "Expertise file not found"}

    content = path.read_text()
    stats = {"sessions_analyzed": 0, "patterns_promoted": 0, "sections_updated": []}

    # Extract all session insights
    if "## Session Insights" not in content:
        return {"success": True, "message": "No sessions to consolidate", **stats}

    parts = content.split("## Session Insights")
    header = parts[0]
    insights_section = parts[1] if len(parts) > 1 else ""

    # Parse sessions
    sessions = re.findall(r"### Session:.*?(?=### Session:|$)", insights_section, re.DOTALL)
    stats["sessions_analyzed"] = len(sessions)

    if len(sessions) < 3:
        return {"success": True, "message": "Need 3+ sessions for consolidation", **stats}

    # Combine all session content for pattern analysis
    all_content = " ".join(sessions).lower()

    # Pattern categories to detect and promote
    pattern_promotions = {
        "## Patterns Learned": ["pattern", "approach", "technique", "method"],
        "## Common Pitfalls": ["pitfall", "mistake", "error", "avoid", "don't", "anti-pattern"],
        "## Effective Approaches": ["effective", "works well", "recommended", "best practice"],
        "## Code Templates": ["template", "example", "snippet", "boilerplate"],
    }

    promoted = []
    for section, keywords in pattern_promotions.items():
        # Check if keywords appear frequently
        keyword_count = sum(all_content.count(kw) for kw in keywords)
        if keyword_count >= 3:  # Threshold for promotion
            # Extract relevant sentences
            for session in sessions:
                for kw in keywords:
                    if kw in session.lower():
                        # Find sentence containing keyword
                        sentences = re.split(r'[.!?]', session)
                        for sent in sentences:
                            if kw in sent.lower() and len(sent) > 30:
                                promoted.append((section, sent.strip()[:200]))
                                break

    # Update file with promoted insights
    if promoted:
        lines = header.split("\n")
        for section, insight in promoted[:5]:  # Limit promotions
            # Find section and add insight
            for i, line in enumerate(lines):
                if line.strip() == section:
                    # Find the comment line and replace or append after it
                    if i + 1 < len(lines) and lines[i + 1].strip().startswith("<!--"):
                        lines[i + 1] = f"- {insight}"
                    else:
                        lines.insert(i + 1, f"- {insight}")
                    stats["sections_updated"].append(section)
                    stats["patterns_promoted"] += 1
                    break

        # Write back
        new_header = "\n".join(lines)
        path.write_text(new_header + "## Session Insights" + insights_section)

    return {"success": True, **stats}


def get_expertise_stats() -> dict:
    """Get statistics about all expertise files."""
    stats = {}
    for mode in ["developer", "vulnerability_scan", "code_review", "test_generation",
                 "documentation", "refactor", "debug", "migrate", "optimize"]:
        path = get_expertise_path(mode)
        if path.exists():
            content = path.read_text()
            sessions = len(re.findall(r"### Session:", content))
            size = len(content)
            stats[mode] = {"sessions": sessions, "size": size, "path": str(path)}
        else:
            stats[mode] = {"sessions": 0, "size": 0, "path": str(path)}
    return stats


# ============================================================================
# LLM Configuration
# ============================================================================

def create_glm_llm() -> LLM:
    """Create LLM configured for Z.ai GLM-4.6"""
    api_key = os.getenv("ZAI_API_KEY")
    if not api_key:
        raise ValueError("ZAI_API_KEY environment variable not set")

    return LLM(
        model="anthropic/claude-3-5-sonnet-20241022",
        api_key=api_key,
        base_url="https://api.z.ai/api/anthropic",
    )


def create_alternate_llm(provider: str = "openrouter") -> LLM:
    """Create LLM with alternate provider for sub-agent delegation"""
    if provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY not set")
        return LLM(
            model="anthropic/claude-3.5-sonnet",
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
        )
    elif provider == "groq":
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY not set")
        return LLM(
            model="llama-3.3-70b-versatile",
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )
    else:
        return create_glm_llm()


# ============================================================================
# Agent Creation with Tools
# ============================================================================

def create_agent(
    llm: LLM,
    mode: str = "developer",
    custom_system_prompt: Optional[str] = None
) -> Agent:
    """Create OpenHands agent with mode-specific configuration"""

    # Build tools list based on mode
    tools = []

    # Core tools for all modes
    tools.append(Tool(name=TerminalTool.name))
    tools.append(Tool(name=FileEditorTool.name))

    # Mode-specific tools
    if mode in ["developer", "refactor", "migrate", "debug"]:
        tools.append(Tool(name=TaskTrackerTool.name))

    if HAS_WEB_TOOL and mode in ["documentation", "research"]:
        tools.append(Tool(name=WebTool.name))

    # Get system prompt
    system_prompt = custom_system_prompt or EXPERT_PROMPTS.get(mode, "")

    return Agent(
        llm=llm,
        tools=tools,
        system_prompt=system_prompt if system_prompt else None,
    )


# ============================================================================
# Persistence Layer
# ============================================================================

def get_session_path(session_id: str) -> Path:
    """Get path for session persistence"""
    return PERSISTENCE_DIR / f"{session_id}.json"


def save_session(session_id: str, data: dict) -> None:
    """Save session state to disk"""
    path = get_session_path(session_id)
    with open(path, "w") as f:
        json.dump({
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data
        }, f, indent=2, default=str)


def load_session(session_id: str) -> Optional[dict]:
    """Load session state from disk"""
    path = get_session_path(session_id)
    if path.exists():
        with open(path, "r") as f:
            return json.load(f)
    return None


def generate_session_id(task: str, workspace: str) -> str:
    """Generate deterministic session ID for resumable sessions"""
    content = f"{task}:{workspace}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


# ============================================================================
# Security Analyzer
# ============================================================================

class SecurityAnalyzer:
    """Validates and filters potentially dangerous operations"""

    DANGEROUS_PATTERNS = [
        "rm -rf /",
        "rm -rf /*",
        "sudo rm",
        ":(){:|:&};:",  # Fork bomb
        "> /dev/sda",
        "mkfs.",
        "dd if=",
        "curl | bash",
        "wget | sh",
    ]

    SENSITIVE_PATHS = [
        "/etc/passwd",
        "/etc/shadow",
        "~/.ssh",
        "~/.aws",
        ".env",
        "credentials",
        "secrets",
    ]

    @classmethod
    def validate_action(cls, action_type: str, action_content: str) -> tuple[bool, str]:
        """
        Validate an action before execution
        Returns (is_safe, reason)
        """
        content_lower = action_content.lower()

        # Check for dangerous patterns
        for pattern in cls.DANGEROUS_PATTERNS:
            if pattern.lower() in content_lower:
                return False, f"Blocked dangerous pattern: {pattern}"

        # Check for sensitive path access
        for path in cls.SENSITIVE_PATHS:
            if path.lower() in content_lower:
                # Allow read but warn about write
                if any(op in content_lower for op in ["write", "delete", "rm", ">"]):
                    return False, f"Blocked write to sensitive path: {path}"

        return True, "OK"


# ============================================================================
# Sub-Agent Delegation
# ============================================================================

class SubAgentManager:
    """Manages delegation to specialized sub-agents"""

    SPECIALISTS = {
        "security": "vulnerability_scan",
        "testing": "test_generation",
        "docs": "documentation",
        "performance": "optimize",
    }

    def __init__(self, primary_llm: LLM):
        self.primary_llm = primary_llm
        self.sub_agents: dict[str, Agent] = {}

    def get_specialist(self, specialty: str) -> Agent:
        """Get or create a specialist sub-agent"""
        if specialty not in self.sub_agents:
            mode = self.SPECIALISTS.get(specialty, "developer")
            # Use alternate LLM for sub-agents to parallelize
            try:
                llm = create_alternate_llm("groq")
            except Exception:
                llm = self.primary_llm
            self.sub_agents[specialty] = create_agent(llm, mode)
        return self.sub_agents[specialty]

    async def delegate(
        self,
        specialty: str,
        task: str,
        workspace: str,
        timeout: int = 120
    ) -> dict:
        """Delegate a task to a specialist sub-agent"""
        agent = self.get_specialist(specialty)

        result = {
            "specialty": specialty,
            "success": False,
            "output": "",
            "error": None,
        }

        output_parts = []

        def callback(event):
            event_type = type(event).__name__
            if event_type == 'ActionEvent':
                action = getattr(event, 'action', None)
                if action:
                    msg = getattr(action, 'message', None)
                    if msg and isinstance(msg, str):
                        output_parts.append(msg.strip())

        try:
            conversation = Conversation(
                agent=agent,
                workspace=workspace,
                callbacks=[callback]
            )
            conversation.send_message(task)

            await asyncio.wait_for(
                asyncio.to_thread(conversation.run),
                timeout=timeout
            )

            result["success"] = True
            result["output"] = "\n".join(output_parts)

        except asyncio.TimeoutError:
            result["error"] = f"Sub-agent timed out after {timeout}s"
        except Exception as e:
            result["error"] = str(e)

        return result


# ============================================================================
# Main Agent Runner
# ============================================================================

async def run_agent_task(
    task: str,
    workspace: str = None,
    mode: str = "developer",
    timeout: int = 300,
    persist: bool = False,
    session_id: str = None,
    delegate_subtasks: bool = False,
    security_check: bool = True,
    enable_learning: bool = True,
) -> dict:
    """
    Run an OpenHands agent to complete a task with Act-Learn-Reuse pattern

    Args:
        task: The task description for the agent
        workspace: Working directory (defaults to current)
        mode: Expert mode (developer, vulnerability_scan, code_review, etc.)
        timeout: Maximum execution time in seconds
        persist: Whether to persist session for resumption
        session_id: Session ID for resumption (auto-generated if persist=True)
        delegate_subtasks: Whether to use sub-agents for specialized tasks
        security_check: Whether to validate actions before execution
        enable_learning: Whether to update expertise files after completion

    Returns:
        dict with success status, output, and metadata
    """
    workspace = workspace or os.getcwd()

    result = {
        "success": False,
        "output": "",
        "error": None,
        "workspace": workspace,
        "mode": mode,
        "tools_used": [],
        "session_id": None,
        "delegated_tasks": [],
        "expertise_applied": False,
        "learnings_captured": False,
    }

    # =========================================================================
    # REUSE PHASE: Load accumulated expertise
    # =========================================================================
    expertise = load_expertise(mode) if enable_learning else ""
    if expertise:
        result["expertise_applied"] = True

    # Session management
    if persist:
        session_id = session_id or generate_session_id(task, workspace)
        result["session_id"] = session_id

        # Check for existing session
        existing = load_session(session_id)
        if existing:
            result["resumed_from"] = existing.get("timestamp")

    # Collect output via callback
    output_parts = []
    tools_used = set()
    blocked_actions = []

    def event_callback(event):
        """Capture events from the conversation with security validation"""
        event_type = type(event).__name__

        if event_type == 'ActionEvent':
            action = getattr(event, 'action', None)
            if action:
                action_type = type(action).__name__

                # Security check
                if security_check:
                    action_content = str(getattr(action, 'command', '')) or str(getattr(action, 'content', ''))
                    is_safe, reason = SecurityAnalyzer.validate_action(action_type, action_content)
                    if not is_safe:
                        blocked_actions.append({"action": action_type, "reason": reason})
                        return  # Skip unsafe actions

                # Get message from action
                action_msg = getattr(action, 'message', None)
                if action_msg and isinstance(action_msg, str):
                    output_parts.append(action_msg.strip())

                tools_used.add(action_type)

        elif event_type == 'MessageEvent':
            llm_msg = getattr(event, 'llm_message', None)
            if llm_msg and hasattr(llm_msg, 'role') and llm_msg.role == 'assistant':
                content = getattr(llm_msg, 'content', [])
                if isinstance(content, list):
                    for item in content:
                        if hasattr(item, 'text') and item.text:
                            output_parts.append(item.text.strip())

    try:
        # Setup
        llm = create_glm_llm()
        agent = create_agent(llm, mode)

        # Sub-agent manager for delegation
        sub_manager = SubAgentManager(llm) if delegate_subtasks else None

        # Create conversation with callback
        conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[event_callback]
        )

        # =====================================================================
        # ACT PHASE: Send task with expertise and learning request
        # =====================================================================
        mode_context = f"[MODE: {mode.upper()}]\n\n" if mode != "developer" else ""

        # Build enhanced task with expertise and self-improve prompt
        enhanced_task = f"{mode_context}{task}"

        if expertise:
            enhanced_task = f"{enhanced_task}\n\n{expertise}"

        # Add self-improve prompt to encourage learning
        if enable_learning and mode in SELF_IMPROVE_PROMPTS:
            enhanced_task = f"{enhanced_task}\n\n---\n{SELF_IMPROVE_PROMPTS[mode]}"

        conversation.send_message(enhanced_task)

        # Run with timeout
        try:
            await asyncio.wait_for(
                asyncio.to_thread(conversation.run),
                timeout=timeout
            )
            result["success"] = True
        except asyncio.TimeoutError:
            result["error"] = f"Agent timed out after {timeout}s"

        # Collect output
        result["output"] = "\n".join(output_parts) if output_parts else "Task completed"
        result["tools_used"] = list(tools_used)

        if blocked_actions:
            result["blocked_actions"] = blocked_actions

        # Persist session if requested
        if persist and session_id:
            save_session(session_id, {
                "task": task,
                "mode": mode,
                "output": result["output"],
                "success": result["success"],
                "tools_used": result["tools_used"],
            })

        # =====================================================================
        # LEARN PHASE: Extract and save learnings
        # =====================================================================
        if enable_learning and result["success"]:
            learnings = extract_learnings(result["output"], mode)
            if learnings:
                update_expertise(mode, learnings, task, result["success"])
                result["learnings_captured"] = True

    except Exception as e:
        result["error"] = str(e)

    return result


# ============================================================================
# Expert Mode Runners
# ============================================================================

async def run_vulnerability_scan(path: str, timeout: int = 600) -> dict:
    """Scan code for security vulnerabilities"""
    task = f"""Perform a comprehensive security audit of the codebase at: {path}

Scan for:
1. OWASP Top 10 vulnerabilities
2. Hardcoded secrets and credentials
3. Insecure dependencies
4. Authentication/authorization issues
5. Input validation problems
6. Cryptographic weaknesses

Output a JSON report with all findings, severity, and remediation steps."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="vulnerability_scan",
        timeout=timeout,
        security_check=True,
    )


async def run_code_review(path: str, focus: str = None, timeout: int = 300) -> dict:
    """Perform thorough code review"""
    focus_text = f"\nFocus especially on: {focus}" if focus else ""
    task = f"""Review the code at: {path}{focus_text}

Analyze for:
1. Code quality and maintainability
2. Performance issues
3. Error handling
4. API design
5. Test coverage
6. Documentation

Provide specific, actionable feedback with file:line references."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="code_review",
        timeout=timeout,
    )


async def run_test_generation(path: str, coverage_target: int = 90, timeout: int = 600) -> dict:
    """Generate comprehensive test suite"""
    task = f"""Generate tests for the code at: {path}

Requirements:
1. Achieve {coverage_target}%+ code coverage
2. Cover all public functions/methods
3. Include edge cases and error paths
4. Use appropriate testing framework
5. Add integration tests for component interactions

Write the tests directly to the appropriate test files."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="test_generation",
        timeout=timeout,
    )


async def run_documentation(path: str, doc_type: str = "all", timeout: int = 300) -> dict:
    """Generate comprehensive documentation"""
    task = f"""Generate documentation for the project at: {path}

Documentation types to generate: {doc_type}

Include:
1. README with overview, installation, usage
2. API documentation with examples
3. Architecture diagrams (Mermaid format)
4. Inline code comments
5. Changelog entries

Write documentation files directly to the project."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="documentation",
        timeout=timeout,
    )


async def run_refactor(path: str, target: str = None, timeout: int = 600) -> dict:
    """Refactor code for improved quality"""
    target_text = f"\nFocus on: {target}" if target else ""
    task = f"""Refactor the code at: {path}{target_text}

Goals:
1. Reduce complexity
2. Improve readability
3. Apply design patterns where appropriate
4. Eliminate duplication
5. Improve type safety
6. Maintain backward compatibility

Make changes directly and document what was changed."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="refactor",
        timeout=timeout,
    )


async def run_debug(path: str, issue: str, timeout: int = 300) -> dict:
    """Debug and fix an issue"""
    task = f"""Debug and fix the following issue in: {path}

Issue: {issue}

Steps:
1. Reproduce the problem
2. Isolate root cause
3. Implement fix
4. Add regression test
5. Verify fix works

Document the root cause and solution."""

    return await run_agent_task(
        task=task,
        workspace=path,
        mode="debug",
        timeout=timeout,
    )


# ============================================================================
# CLI Entry Point
# ============================================================================

def main():
    """CLI entry point with extended options"""
    import argparse

    parser = argparse.ArgumentParser(description="OpenHands Advanced Agent Runner")
    parser.add_argument("task", help="Task for the agent")
    parser.add_argument("--workspace", "-w", help="Working directory", default=None)
    parser.add_argument("--mode", "-m", choices=[
        "developer", "vulnerability_scan", "code_review", "test_generation",
        "documentation", "refactor", "debug", "migrate", "optimize"
    ], default="developer", help="Expert mode")
    parser.add_argument("--timeout", "-t", type=int, default=300, help="Timeout in seconds")
    parser.add_argument("--persist", "-p", action="store_true", help="Persist session")
    parser.add_argument("--session-id", "-s", help="Session ID for resumption")
    parser.add_argument("--delegate", "-d", action="store_true", help="Enable sub-agent delegation")
    parser.add_argument("--no-security", action="store_true", help="Disable security checks")
    parser.add_argument("--no-learning", action="store_true", help="Disable expertise learning")

    # Parse with fallback for simple usage
    if len(sys.argv) < 2:
        sys.stderr.write(json.dumps({
            "error": "Usage: openhands-runner.py <task> [options]",
            "modes": list(EXPERT_PROMPTS.keys()),
        }))
        sys.exit(1)

    # Handle simple positional args for backward compatibility
    if not sys.argv[1].startswith("-"):
        task = sys.argv[1]
        workspace = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("-") else None
        mode = "developer"
        timeout = 300
        persist = False
        session_id = None
        delegate = False
        security_check = True
        enable_learning = True

        # Check for mode and other flags in remaining args
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg.startswith("--mode="):
                mode = arg.split("=")[1]
            elif arg == "--mode" and i + 1 < len(sys.argv):
                mode = sys.argv[i + 1]
            elif arg == "-m" and i + 1 < len(sys.argv):
                mode = sys.argv[i + 1]
            elif arg.startswith("--timeout="):
                timeout = int(arg.split("=")[1])
            elif arg == "--timeout" and i + 1 < len(sys.argv):
                timeout = int(sys.argv[i + 1])
            elif arg == "-t" and i + 1 < len(sys.argv):
                timeout = int(sys.argv[i + 1])
            elif arg == "--no-learning":
                enable_learning = False
    else:
        args = parser.parse_args()
        task = args.task
        workspace = args.workspace
        mode = args.mode
        timeout = args.timeout
        persist = args.persist
        session_id = args.session_id
        delegate = args.delegate
        security_check = not args.no_security
        enable_learning = not args.no_learning

    # Suppress OpenHands rich output
    import io
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()

    try:
        result = asyncio.run(run_agent_task(
            task=task,
            workspace=workspace,
            mode=mode,
            timeout=timeout,
            persist=persist,
            session_id=session_id,
            delegate_subtasks=delegate,
            security_check=security_check,
            enable_learning=enable_learning,
        ))
    finally:
        sys.stdout = old_stdout

    # Output ONLY the JSON result with marker
    print("###OPENHANDS_RESULT###")
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
