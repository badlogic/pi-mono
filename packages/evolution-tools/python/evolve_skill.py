"""Bounded Pi skill-evolution helper.

This adapts the Hermes self-evolution Phase 1 workflow to Pi skill roots:

- target only SKILL.md files
- read/write only under the provided run directory
- never overwrite live skills
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class EvalExample:
    task_input: str
    expected_behavior: str
    difficulty: str = "medium"
    category: str = "general"
    source: str = "synthetic"

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_input": self.task_input,
            "expected_behavior": self.expected_behavior,
            "difficulty": self.difficulty,
            "category": self.category,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "EvalExample":
        return cls(
            task_input=str(payload.get("task_input", "")),
            expected_behavior=str(payload.get("expected_behavior", "")),
            difficulty=str(payload.get("difficulty", "medium")),
            category=str(payload.get("category", "general")),
            source=str(payload.get("source", "golden")),
        )


@dataclass
class EvalDataset:
    train: list[EvalExample] = field(default_factory=list)
    val: list[EvalExample] = field(default_factory=list)
    holdout: list[EvalExample] = field(default_factory=list)

    @property
    def all_examples(self) -> list[EvalExample]:
        return self.train + self.val + self.holdout

    def save(self, target: Path) -> None:
        target.mkdir(parents=True, exist_ok=True)
        for split_name, split_data in [("train", self.train), ("val", self.val), ("holdout", self.holdout)]:
            with (target / f"{split_name}.jsonl").open("w", encoding="utf8") as handle:
                for example in split_data:
                    handle.write(json.dumps(example.to_dict()) + "\n")

    @classmethod
    def load(cls, target: Path) -> "EvalDataset":
        dataset = cls()
        for split_name in ["train", "val", "holdout"]:
            split_file = target / f"{split_name}.jsonl"
            if not split_file.exists():
                continue
            items: list[EvalExample] = []
            for line in split_file.read_text(encoding="utf8").splitlines():
                if not line.strip():
                    continue
                items.append(EvalExample.from_dict(json.loads(line)))
            setattr(dataset, split_name, items)
        return dataset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evolve a Pi skill with DSPy + GEPA style optimization.")
    parser.add_argument("--skill", required=True, help="Skill name")
    parser.add_argument("--skill-path", required=True, help="Absolute path to the source SKILL.md")
    parser.add_argument("--run-dir", required=True, help="Output directory for this run")
    parser.add_argument("--dataset-path", required=True, help="Dataset directory or JSONL path")
    parser.add_argument("--eval-source", default="synthetic", choices=["synthetic", "golden"], help="Dataset source")
    parser.add_argument("--iterations", type=int, default=5, help="Number of optimization iterations")
    parser.add_argument("--optimizer-model", default="openai/gpt-4.1", help="Optimizer model")
    parser.add_argument("--eval-model", default="openai/gpt-4.1-mini", help="Evaluation model")
    parser.add_argument("--project-skill-root", required=True, help="Project skill root")
    parser.add_argument("--user-skill-root", required=True, help="User skill root")
    parser.add_argument("--dry-run", action="store_true", help="Validate and write artifacts without optimization")
    return parser.parse_args()


def load_skill(skill_path: Path) -> dict[str, Any]:
    raw = skill_path.read_text(encoding="utf8")
    frontmatter = ""
    body = raw
    if raw.strip().startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            frontmatter = parts[1].strip()
            body = parts[2].strip()
    name = ""
    description = ""
    for line in frontmatter.splitlines():
        stripped = line.strip()
        if stripped.startswith("name:"):
            name = stripped.split(":", 1)[1].strip().strip("'\"")
        elif stripped.startswith("description:"):
            description = stripped.split(":", 1)[1].strip().strip("'\"")
    return {
        "path": skill_path,
        "raw": raw,
        "frontmatter": frontmatter,
        "body": body,
        "name": name,
        "description": description,
    }


def reassemble_skill(frontmatter: str, body: str) -> str:
    return f"---\n{frontmatter}\n---\n\n{body.strip()}\n"


def load_dataset(dataset_path: Path, eval_source: str, skill_text: str) -> EvalDataset:
    if dataset_path.exists():
        if dataset_path.is_file():
            examples = [
                EvalExample.from_dict(json.loads(line))
                for line in dataset_path.read_text(encoding="utf8").splitlines()
                if line.strip()
            ]
            return split_examples(examples)
        dataset = EvalDataset.load(dataset_path)
        if dataset.all_examples:
            return dataset
    if eval_source != "synthetic":
        raise FileNotFoundError(f"No dataset found at {dataset_path} and eval_source={eval_source}.")
    dataset = generate_synthetic_dataset(skill_text)
    dataset.save(dataset_path)
    return dataset


def split_examples(examples: list[EvalExample]) -> EvalDataset:
    shuffled = list(examples)
    random.shuffle(shuffled)
    total = len(shuffled)
    if total == 0:
        return EvalDataset()
    train_end = max(1, int(total * 0.5))
    val_end = min(total, train_end + max(1, int(total * 0.25)))
    return EvalDataset(
        train=shuffled[:train_end],
        val=shuffled[train_end:val_end],
        holdout=shuffled[val_end:],
    )


def generate_synthetic_dataset(skill_text: str) -> EvalDataset:
    import dspy

    class GenerateTestCases(dspy.Signature):
        artifact_text: str = dspy.InputField(desc="Full skill text")
        artifact_type: str = dspy.InputField(desc="Artifact type")
        num_cases: int = dspy.InputField(desc="Number of evaluation cases to generate")
        test_cases: str = dspy.OutputField(
            desc="JSON array of objects with task_input, expected_behavior, difficulty, category"
        )

    lm = dspy.LM(os.getenv("PI_EVOLUTION_SYNTHETIC_MODEL", "openai/gpt-4.1-mini"))
    generator = dspy.ChainOfThought(GenerateTestCases)
    with dspy.context(lm=lm):
        result = generator(artifact_text=skill_text, artifact_type="skill", num_cases=12)
    raw = result.test_cases
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            raise ValueError(f"Could not parse synthetic dataset from model output: {raw[:200]}")
        payload = json.loads(match.group(0))
    examples = [
        EvalExample(
            task_input=str(item.get("task_input", "")).strip(),
            expected_behavior=str(item.get("expected_behavior", "")).strip(),
            difficulty=str(item.get("difficulty", "medium")),
            category=str(item.get("category", "general")),
            source="synthetic",
        )
        for item in payload
        if str(item.get("task_input", "")).strip() and str(item.get("expected_behavior", "")).strip()
    ]
    return split_examples(examples)


def constraint_results(candidate_body: str, baseline_body: str, skill_text: str, eval_model: str) -> tuple[list[dict[str, Any]], float]:
    import dspy

    max_size = 15_000
    max_growth = 0.2
    results: list[dict[str, Any]] = []

    size_passed = len(candidate_body) <= max_size
    results.append(
        {
            "constraint_name": "size_limit",
            "passed": size_passed,
            "message": f"Size {'OK' if size_passed else 'exceeded'}: {len(candidate_body)}/{max_size}",
        }
    )

    growth = (len(candidate_body) - len(baseline_body)) / max(1, len(baseline_body))
    growth_passed = growth <= max_growth
    results.append(
        {
            "constraint_name": "growth_limit",
            "passed": growth_passed,
            "message": f"Growth {growth:+.1%} (limit {max_growth:+.1%})",
        }
    )

    non_empty = bool(candidate_body.strip())
    results.append(
        {
            "constraint_name": "non_empty",
            "passed": non_empty,
            "message": "Candidate is non-empty" if non_empty else "Candidate is empty",
        }
    )

    structure_ok = skill_text.strip().startswith("---") and "name:" in skill_text[:500] and "description:" in skill_text[:500]
    results.append(
        {
            "constraint_name": "skill_structure",
            "passed": structure_ok,
            "message": "Skill structure preserved" if structure_ok else "Skill frontmatter is invalid",
        }
    )

    class SemanticPreservationJudge(dspy.Signature):
        baseline_skill: str = dspy.InputField(desc="Original skill body")
        candidate_skill: str = dspy.InputField(desc="Candidate skill body")
        preservation_score: float = dspy.OutputField(desc="0.0-1.0 score for semantic preservation")
        notes: str = dspy.OutputField(desc="Why the candidate does or does not preserve the original skill")

    judge = dspy.ChainOfThought(SemanticPreservationJudge)
    lm = dspy.LM(eval_model)
    with dspy.context(lm=lm):
        verdict = judge(baseline_skill=baseline_body, candidate_skill=candidate_body)
    score = max(0.0, min(1.0, float(verdict.preservation_score)))
    semantic_ok = score >= 0.6
    results.append(
        {
            "constraint_name": "semantic_preservation",
            "passed": semantic_ok,
            "message": f"Semantic preservation {score:.2f}",
            "details": verdict.notes,
        }
    )
    return results, score


def optimize_skill(skill_body: str, dataset: EvalDataset, iterations: int, optimizer_model: str, eval_model: str) -> tuple[str, float, float]:
    import dspy

    class SkillTask(dspy.Signature):
        skill_instructions: str = dspy.InputField(desc="Skill instructions")
        task_input: str = dspy.InputField(desc="User task")
        output: str = dspy.OutputField(desc="Response following the skill")

    class Judge(dspy.Signature):
        task_input: str = dspy.InputField(desc="Original task")
        expected_behavior: str = dspy.InputField(desc="Rubric for a good response")
        agent_output: str = dspy.InputField(desc="Model output")
        skill_text: str = dspy.InputField(desc="Skill text used to generate the output")
        correctness: float = dspy.OutputField(desc="0.0-1.0 correctness score")
        procedure_following: float = dspy.OutputField(desc="0.0-1.0 skill adherence score")
        conciseness: float = dspy.OutputField(desc="0.0-1.0 conciseness score")
        feedback: str = dspy.OutputField(desc="Actionable feedback")

    class SkillModule(dspy.Module):
        def __init__(self, skill_text: str):
            super().__init__()
            self.skill_text = skill_text
            self.predictor = dspy.ChainOfThought(SkillTask)

        def forward(self, task_input: str) -> dspy.Prediction:
            result = self.predictor(skill_instructions=self.skill_text, task_input=task_input)
            return dspy.Prediction(output=result.output)

    judge = dspy.ChainOfThought(Judge)
    baseline_module = SkillModule(skill_body)

    def metric(example: dspy.Example, prediction: dspy.Prediction, trace: Any = None) -> float:
        del trace
        eval_lm = dspy.LM(eval_model)
        with dspy.context(lm=eval_lm):
            verdict = judge(
                task_input=example.task_input,
                expected_behavior=example.expected_behavior,
                agent_output=prediction.output,
                skill_text=baseline_module.skill_text,
            )
        return (
            float(verdict.correctness) * 0.5
            + float(verdict.procedure_following) * 0.35
            + float(verdict.conciseness) * 0.15
        )

    trainset = [dspy.Example(task_input=example.task_input, expected_behavior=example.expected_behavior).with_inputs("task_input") for example in dataset.train]
    valset = [dspy.Example(task_input=example.task_input, expected_behavior=example.expected_behavior).with_inputs("task_input") for example in dataset.val]

    dspy.configure(lm=dspy.LM(optimizer_model))
    try:
        optimizer = dspy.GEPA(metric=metric, max_steps=iterations)
        optimized = optimizer.compile(baseline_module, trainset=trainset, valset=valset)
    except Exception:
        optimizer = dspy.MIPROv2(metric=metric, auto="light")
        optimized = optimizer.compile(baseline_module, trainset=trainset)

    baseline_score = evaluate_holdout(dataset.holdout, baseline_module, eval_model)
    candidate_score = evaluate_holdout(dataset.holdout, optimized, eval_model)
    return optimized.skill_text, baseline_score, candidate_score


def evaluate_holdout(holdout: list[EvalExample], module: Any, eval_model: str) -> float:
    import dspy

    if not holdout:
        return 0.0

    class Judge(dspy.Signature):
        task_input: str = dspy.InputField(desc="Original task")
        expected_behavior: str = dspy.InputField(desc="Rubric for a good response")
        agent_output: str = dspy.InputField(desc="Model output")
        correctness: float = dspy.OutputField(desc="0.0-1.0 correctness score")
        procedure_following: float = dspy.OutputField(desc="0.0-1.0 skill adherence score")
        conciseness: float = dspy.OutputField(desc="0.0-1.0 conciseness score")

    judge = dspy.ChainOfThought(Judge)
    eval_lm = dspy.LM(eval_model)
    scores: list[float] = []
    for example in holdout:
        with dspy.context(lm=eval_lm):
            prediction = module(task_input=example.task_input)
            verdict = judge(
                task_input=example.task_input,
                expected_behavior=example.expected_behavior,
                agent_output=prediction.output,
            )
        scores.append(
            float(verdict.correctness) * 0.5
            + float(verdict.procedure_following) * 0.35
            + float(verdict.conciseness) * 0.15
        )
    return sum(scores) / max(1, len(scores))


def write_metrics(metrics_path: Path, payload: dict[str, Any]) -> None:
    metrics_path.write_text(json.dumps(payload, indent=2), encoding="utf8")


def main() -> None:
    args = parse_args()
    skill_path = Path(args.skill_path).expanduser().resolve()
    run_dir = Path(args.run_dir).expanduser().resolve()
    dataset_path = Path(args.dataset_path).expanduser().resolve()
    run_dir.mkdir(parents=True, exist_ok=True)

    skill = load_skill(skill_path)
    dataset = load_dataset(dataset_path, args.eval_source, skill["raw"])

    baseline_path = run_dir / "baseline_skill.md"
    candidate_path = run_dir / "candidate_skill.md"
    baseline_path.write_text(skill["raw"], encoding="utf8")

    if args.dry_run:
        candidate_path.write_text(skill["raw"], encoding="utf8")
        metrics = {
            "skill_name": args.skill,
            "run_dir": str(run_dir),
            "dataset_path": str(dataset_path),
            "status": "dry_run",
            "dry_run": True,
            "improvement": 0.0,
            "baseline_score": 0.0,
            "candidate_score": 0.0,
            "baseline_size": len(skill["body"]),
            "candidate_size": len(skill["body"]),
            "iterations": args.iterations,
            "eval_source": args.eval_source,
            "optimizer_model": args.optimizer_model,
            "eval_model": args.eval_model,
            "constraints_passed": True,
            "semantic_preservation_score": 1.0,
            "train_examples": len(dataset.train),
            "val_examples": len(dataset.val),
            "holdout_examples": len(dataset.holdout),
            "candidate_path": str(candidate_path),
            "baseline_path": str(baseline_path),
        }
        write_metrics(run_dir / "metrics.json", metrics)
        print(json.dumps(metrics))
        return

    evolved_body, baseline_score, candidate_score = optimize_skill(
        skill["body"],
        dataset,
        args.iterations,
        args.optimizer_model,
        args.eval_model,
    )
    evolved_full = reassemble_skill(skill["frontmatter"], evolved_body)
    candidate_path.write_text(evolved_full, encoding="utf8")

    constraint_payload, semantic_score = constraint_results(evolved_body, skill["body"], evolved_full, args.eval_model)
    constraints_passed = all(result["passed"] for result in constraint_payload)
    metrics = {
        "skill_name": args.skill,
        "run_dir": str(run_dir),
        "dataset_path": str(dataset_path),
        "status": "completed" if constraints_passed else "rejected",
        "dry_run": False,
        "improvement": candidate_score - baseline_score,
        "baseline_score": baseline_score,
        "candidate_score": candidate_score,
        "baseline_size": len(skill["body"]),
        "candidate_size": len(evolved_body),
        "iterations": args.iterations,
        "eval_source": args.eval_source,
        "optimizer_model": args.optimizer_model,
        "eval_model": args.eval_model,
        "constraints_passed": constraints_passed,
        "semantic_preservation_score": semantic_score,
        "constraint_results": constraint_payload,
        "train_examples": len(dataset.train),
        "val_examples": len(dataset.val),
        "holdout_examples": len(dataset.holdout),
        "candidate_path": str(candidate_path),
        "baseline_path": str(baseline_path),
    }
    write_metrics(run_dir / "metrics.json", metrics)
    print(json.dumps(metrics))


if __name__ == "__main__":
    main()
