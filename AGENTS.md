# AGENTS.md (Repository)

## Scope

This file applies to all work in this repository. More-specific `AGENTS.md` files supplement it with guidance for their directories.

## Pull requests

- Keep PR descriptions focused on information useful to reviewers: what changed, why, risks, and any non-obvious behavior or testing context. Do not add boilerplate validation sections listing routine tests, lints, or formatters; CI already reports those. Mention validation only when it adds specific, reviewer-relevant information.
- Open agent-created PRs as drafts and leave them in draft until the human who requested the work has self-reviewed them and marked them ready. At minimum, CI should be passing before the PR leaves draft.
- Do not modify CI configuration merely to make a feature or fix PR pass. Fix the implementation or tests instead. If the CI configuration itself is wrong, raise a separate issue and address it in a separate PR.
