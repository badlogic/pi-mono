# Lean4/Mathlib Tactics Reference

Tactics are hints passed to the LLM to guide proof generation. The LLM can use any Mathlib tactic, but suggesting appropriate ones improves success rates.

## Quick Reference

| Tactic | Use Case | Example |
|--------|----------|---------|
| `simp` | Simplification, identities | `n + 0 = n` |
| `omega` | Linear integer/natural arithmetic | `a + b > a` when `b > 0` |
| `ring` | Polynomial ring identities | `(a + b)² = a² + 2ab + b²` |
| `linarith` | Linear arithmetic inequalities | `a < b → b < c → a < c` |
| `norm_num` | Numeric computations | `2 + 2 = 4` |
| `decide` | Decidable propositions | `True ∨ False` |
| `rfl` | Reflexivity (definitional equality) | `5 = 5` |
| `exact` | Direct proof term | When you know the lemma name |
| `apply` | Apply theorem to goal | Backward reasoning |
| `intro` | Introduce hypotheses | `∀ x, P x` goals |
| `cases` | Case analysis | Pattern matching |
| `induction` | Inductive proofs | Recursive types |
| `rw` | Rewrite with equality | Substitution |
| `ext` | Extensionality | Function/set equality |
| `constructor` | Build inductive value | Existential/conjunction goals |
| `contradiction` | Prove from False | Contradictory hypotheses |
| `push_neg` | Push negations inward | `¬∀ x, P x` → `∃ x, ¬P x` |
| `gcongr` | Monotonic congruence | Inequality preservation |
| `positivity` | Positivity proofs | `x² + 1 > 0` |
| `field_simp` | Clear denominators | Fraction simplification |

## Tactics by Category

### Arithmetic & Algebra

```
simp        - General simplification (very powerful, try first)
omega       - Linear arithmetic over ℤ/ℕ (equations and inequalities)
ring        - Polynomial identities in commutative rings
linarith    - Linear arithmetic inequalities
norm_num    - Numeric evaluation (2 + 3 = 5)
field_simp  - Simplify fractions by clearing denominators
nlinarith   - Non-linear arithmetic (limited)
polyrith    - Polynomial arithmetic (needs setup)
```

### Logic & Decidability

```
decide      - Decidable propositions (computable)
tauto       - Propositional tautologies
contradiction - Derive False from inconsistent hypotheses
push_neg    - Push negations through quantifiers
by_contra   - Proof by contradiction
by_cases    - Case split on decidable proposition
```

### Structural

```
intro/intros - Introduce ∀ or → hypotheses
apply       - Apply lemma/theorem backward
exact       - Provide exact proof term
rfl         - Reflexivity (definitional equality)
rw/rewrite  - Rewrite using equality
cases       - Destruct inductive types
induction   - Inductive proof
rcases      - Recursive case split with patterns
constructor - Apply constructor of inductive type
use         - Provide witness for existential
ext         - Prove equality by extensionality
funext      - Function extensionality
congr       - Congruence (apply function to both sides)
```

### Search & Automation

```
simp        - Simplification with lemma database
aesop       - General-purpose automation (powerful but slow)
trivial     - Try simple tactics (rfl, exact, assumption)
assumption  - Find matching hypothesis
library_search - Search Mathlib for matching lemma
hint        - Suggest applicable tactics
```

### Inequalities & Order

```
linarith    - Linear inequalities
nlinarith   - Non-linear inequalities (weaker)
positivity  - Prove expressions are positive/nonnegative
gcongr      - Monotonicity-based congruence
mono        - Monotonicity
```

## Usage Examples

### Basic Identity
```python
await prove_requirement(
    requirement="Prove 0 + n = n",
    tactics=["simp"],  # simp knows Nat.zero_add
)
```

### Arithmetic Inequality
```python
await prove_requirement(
    requirement="Prove that n < n + 1 for natural numbers",
    tactics=["omega"],  # omega handles linear ℕ arithmetic
)
```

### Algebraic Identity
```python
await prove_requirement(
    requirement="Prove (a + b) * (a - b) = a² - b² for reals",
    tactics=["ring"],  # ring normalizes polynomial expressions
)
```

### Logical Proof
```python
await prove_requirement(
    requirement="Prove that P ∧ Q → Q ∧ P",
    tactics=["intro", "constructor"],  # structure manipulation
)
```

### Inductive Proof
```python
await prove_requirement(
    requirement="Prove sum of first n naturals is n*(n+1)/2",
    tactics=["induction", "simp", "ring"],  # induction + simplify
)
```

## Tips

1. **Start with `simp`** - It's surprisingly powerful and knows many Mathlib lemmas
2. **Use `omega` for ℤ/ℕ arithmetic** - Handles linear equations and inequalities
3. **Use `ring` for algebra** - Normalizes polynomial expressions
4. **Combine tactics** - `["simp", "linarith"]` tries both
5. **Don't over-specify** - The LLM can figure out tactics; hints just help
6. **Empty tactics is valid** - `tactics=[]` lets LLM decide entirely

## When Proofs Fail

If a proof fails, try:
1. Different tactics (e.g., `omega` instead of `linarith`)
2. More specific tactics (e.g., `exact Nat.add_comm` instead of `simp`)
3. Simpler requirement statement
4. Check if the statement is actually provable
