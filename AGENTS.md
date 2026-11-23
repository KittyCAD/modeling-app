# AGENTS.md (Repository)

## Scope

This file applies to all work in this repository. More-specific `AGENTS.md` files supplement it with guidance for their directories.

## Code comments

- Use the [code-comments skill](.agents/skills/code-comments/SKILL.md) only when explicitly requested.

## Keyboard shortcuts

- Implement application shortcuts as registered commands with keymap facet contributions. Add a keymap context when availability depends on focus, mode, or interaction state.
- Route editor commands to the focused editor view through explicit dependencies.
- Before adding a keyboard handler, inspect the existing keymap extension and reuse its dispatch and customization mechanisms.
- Reserve direct keyboard handlers for intrinsic widget interactions, such as arrow-key navigation, Escape dismissal, and text editing. Do not use them to implement application shortcuts.
- Cover focus routing, command availability, and user remapping when adding shortcuts.
- See the [Modeling camera contributions](src/lib/kcl/registry/cameraCommands.ts) for command, scope, and keymap registration, and the [focus adapter](src/lib/kcl/modeling/cameraCommands.ts) for targeting a view.

## Verification

For routine checks, use the verification commands in [CONTRIBUTING.md](CONTRIBUTING.md#verifying-without-updating-results). Use update commands when intentionally changing expected results, inspect the diff, then rerun verification.

## Pull requests

- Keep PR descriptions focused on information useful to reviewers: what changed, why, risks, and any non-obvious behavior or testing context. Do not add boilerplate validation sections listing routine tests, lints, or formatters; CI already reports those. Mention validation only when it adds specific, reviewer-relevant information.
- Open agent-created PRs as drafts and leave them in draft until the human who requested the work has self-reviewed them and marked them ready. At minimum, CI should be passing before the PR leaves draft.
- Do not modify CI configuration merely to make a feature or fix PR pass. Fix the implementation or tests instead. If the CI configuration itself is wrong, raise a separate issue and address it in a separate PR.
- When adding KCL programs, don't add any new kclVersion 1.0 code using `startSketchOn()`. Use kclVersion 3.0 with sketch blocks instead. Unless it's specifically testing an old version, all new KCL code should use the latest stable version.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `KittyCAD/modeling-app`. See `dev-docs/agents/issue-tracker.md`.

### Domain docs

Multi-context layout using `GLOSSARY-MAP.md`, context glossaries, and ADRs. See `dev-docs/agents/domain.md`.
