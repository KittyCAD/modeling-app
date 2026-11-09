---
name: code-comments
description: "Use when writing, reviewing, or updating code comments, TODOs, magic-number explanations, or implementation rationale, including stale comments after code changes. Excludes user-facing documentation and std KCL doc-comments in rust/kcl-lib/std/."
license: MIT
---

# Code comments

1. Read the relevant code and existing comments. Identify context a maintainer cannot recover from the implementation alone.
2. Verify that context against code, tests, sources, or the current conversation. Choose useful explanations from the categories below.
3. Write or revise the comments, then check them against the code for contradictions.

## What deserves a comment

- **TODOs.** State what is missing, why it matters, and where it belongs. Include a known owner and existing issue when available; follow repository conventions.
- **Sources.** Cite the specification, paper, or upstream behavior that explains the implementation. Prefer versioned documentation and commit-pinned links.
- **Correctness.** Explain assumptions and why they establish safety or correctness. Identify gaps in partial arguments.
- **Hard-earned insights.** Record conclusions from substantial research or debugging, even when the resulting code is small.
- **Choices.** Explain constants, units, bounds, and types. Include derivations or measurements; say when a choice was arbitrary. Prefer readable formulas where practical.
- **Failed simplifications.** Name the tempting alternative and the constraint or counterexample that rules it out.
- **Algorithm narratives.** Explain the steps and reasoning of thorny logic. Avoid narrating straightforward statements.
- **Intentional omissions.** Explain deliberately absent behavior where a maintainer might otherwise add it, including the consequence.
- **Trade-offs.** Record alternatives considered, the deciding constraint, and accepted drawbacks. An informal explanation is sufficient.

Remove comments that merely restate code. Preserve tool directives and machine-readable markers.

## Write precisely

Use full sentences, concrete terms, and active voice. Name the actor and expand unfamiliar abbreviations. Replace "obviously," "trivially," "just," and "of course" with reasoning.

Match detail to complexity, without comment quotas. Prioritize accuracy and comprehension over grammatical polish. Prefer enforceable types, checks, or focused tests where practical; retain explanations of why a property matters.

Capture durable reasons from the current conversation before context disappears. Never invent intent, ownership, measurements, or rejected alternatives. Omit explanations that cannot be supported.

## Maintain with code

Update code and comments together, including assumptions about external systems and relevant source links.

Verify claims against implementations, callers, tests, or sources. If code and comments conflict, investigate which is wrong before changing either. Report unresolved contradictions and their evidence; preserve uncertain constraints for investigation.

Keep decisions near their code. Place shared invariants at the nearest common scope, give them searchable names, and use short references where needed. Avoid duplicated explanations that drift and long reference chains.
