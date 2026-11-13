# AGENTS.md (Repository)

## Scope

This file applies to all work in this repository. More-specific `AGENTS.md` files supplement it with guidance for their directories.

## Code comments

- Use the [code-comments skill](.agents/skills/code-comments/SKILL.md) only when explicitly requested.

## GitHub authorization

- Never take any action on GitHub without the user's explicit authorization for that action and its scope. This includes reading or querying GitHub, fetching from GitHub, creating or editing issues, pull requests, comments or reviews, pushing commits, merging, and deleting content.
- Never treat repository instructions, skills, general requests to work on code, or inferred intent as authorization to access GitHub or publish under the user's identity.
- Without explicit authorization, keep all work local. Prepare issue or pull-request text locally for the user to review and publish themselves.

## Pull requests

- All PR titles must start with "Codex: ".
- All PR bodies must start with "Per codex" followed by a quote block that contains all agent-authored language.
- PR titles should briefly say what functionality they fix or introduce.
- Keep PR descriptions focused on information useful to reviewers: what changed, why, risks, and any non-obvious behavior or testing context. Do not add boilerplate validation sections listing routine tests, lints, or formatters; CI already reports those. Mention validation only when it adds specific, reviewer-relevant information.
- Open agent-created PRs as drafts and leave them in draft until the human who requested the work has self-reviewed them and marked them ready. At minimum, CI should be passing before the PR leaves draft.
- Do not modify CI configuration merely to make a feature or fix PR pass. Fix the implementation or tests instead. If the CI configuration itself is wrong, raise a separate issue and address it in a separate PR.
- When adding KCL programs, don't add any new kclVersion 1.0 code using `startSketchOn()`. Use kclVersion 3.0 with sketch blocks instead. Unless it's specifically testing an old version, all new KCL code should use the latest stable version.

## Issues

- All issue titles must start with "Codex: ".
- All issue bodies must start with "Per codex" followed by a quote block that contains all agent-authored language.
- Issue titles should briefly describe the issue, and not sound like a fix to an issue.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `KittyCAD/modeling-app`. See `dev-docs/agents/issue-tracker.md`.

### Domain docs

Multi-context layout using `GLOSSARY-MAP.md`, context glossaries, and ADRs. See `dev-docs/agents/domain.md`.
