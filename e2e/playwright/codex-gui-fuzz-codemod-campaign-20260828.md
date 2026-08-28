# Codex GUI-fuzz codemod campaign handoff - 2026-08-28

## Scope

This handoff summarizes the point-and-click / GUI-fuzz codemod campaign that used Zoo Design Studio's native Playwright fixtures to find, minimize, file, and start fixing GUI-generated KCL rewrite issues.

Discovery is intentionally paused. Do not start new fuzzing from this document unless a human explicitly reopens the campaign.

## Operating method

The repeatable loop that worked:

1. Exercise a realistic GUI modeling path with the native Playwright fixtures.
2. Preserve browser screenshots, traces, console/network evidence, and the generated KCL.
3. Classify failures as test setup, staging/engine infrastructure, harness instability, or product behavior.
4. Minimize product failures into focused AST/codemod tests when possible.
5. File a GitHub issue with exact KCL before/after, plain-English impact, and fuzzer provenance.
6. Make a narrow PR that fixes one codemod family.
7. Run focused local tests first.
8. When a branch deploy is available, smoke the preview with the same GUI-fuzz scenario and add sanitized, plain-English verification evidence to the PR.

Do not include auth mechanism details in GitHub issues, PRs, comments, logs, screenshots, or repository files. It is enough to say that testing used an approved first-party preview-auth context.

Do not use macOS screen recording for evidence. Use Playwright/browser screenshots, traces, or intentionally generated browser videos instead.

## Main bug families found

### 1. Upstream edit retargets hidden inputs to downstream descendants

Several Feature Tree edit codemods rebuild hidden or unlabeled object inputs from the artifact graph instead of preserving the original input being edited. When `lastChildLookup` is allowed during edit, the lookup can choose a downstream child/descendant. That produces invalid topology, accidental dependency cycles, or semantically wrong KCL.

Confirmed examples:

- Translate: editing `translate(extrude001, x = 5)` could rewrite the input to downstream `pattern001`.
- Pattern 3D: editing an upstream pattern could retarget to a downstream pattern.
- Boolean Split: editing a split could retarget target/tool inputs to a downstream composite.
- Appearance: editing color/material could retarget the object input to a downstream union.
- Hole showed the same class earlier: an upstream hole edit could choose a downstream hole and form a cycle.

Practical fix shape:

- On edit, preserve hidden/unlabeled object inputs unless the command explicitly supports retargeting and the user actually changed the selection.
- Avoid descendant lookup for edit flows where the original source object should remain stable.
- Add focused AST tests with synthetic artifact graphs that include a downstream child to prove the edited node keeps its original input.

### 2. Variable-less source pipelines are not represented consistently

GUI selections can point at source expressions that are not named declarations. A number of codemods assumed selected inputs could be represented as simple variable names. The failures were usually invalid KCL, collapsed selections, or dropped bodies.

Confirmed examples:

- Clone from a variable-less pipe could emit invalid KCL.
- Boolean operations could collapse distinct variable-less pipe selections.
- Sweep could fail to preserve a selected variable-less path pipeline.
- Offset-plane selection codemods could reject variable-less planes.
- Transform codemods could drop one body for multi-selected variable-less source pipes.
- Hide/Delete could detach from selected variable-less source pipes.

Practical fix shape:

- Preserve selected source expressions, not only final variable declarations.
- For multi-select, keep each selected source path distinct.
- Add tests where two visually distinct selections originate from different variable-less pipelines.

### 3. Edit-context path offsets can target the wrong AST node

Some edit flows insert variables or otherwise mutate source before applying the user's change. If the codemod keeps using stale paths after insertion, it can edit the wrong node.

Confirmed example:

- GDT datum-variable edits could retarget the wrong AST node after codemod insertion.

Practical fix shape:

- Re-resolve the edit target after insertion/mutation, or apply the edit through a stable node identity instead of a stale path.
- Add regression tests that insert a helper variable before the edited expression and then assert the intended call is changed.

### 4. Fuzzer-adjacent measurement noise

Some point-and-click paths caused measurement/status requests that were not the intended modeling operation.

Confirmed examples:

- Distance measurement was attempted for `kind: "other"` selections such as regions.
- Body-details requests could fire against stale generated body ids after geometry regeneration.

Practical fix shape:

- Reject non-measurable selections before sending engine distance requests.
- Gate body-details requests by current selection/execution generation before sending them, not only before rendering results.

## Issue / PR ledger

| Area | Issue | PR | Current state at handoff | Local focused verification |
| --- | --- | --- | --- | --- |
| Measurement selection guard | [#13379](https://github.com/KittyCAD/modeling-app/issues/13379) | [#13381](https://github.com/KittyCAD/modeling-app/pull/13381) | PR clean in GitHub checks | Focused checks previously passed |
| Shell Feature Tree selection artifact | [#13383](https://github.com/KittyCAD/modeling-app/issues/13383) | none | Tracked as fuzzer-derived product candidate; no active PR | Screenshot/trace evidence preserved in GUI-fuzz artifacts |
| Translate upstream edit descendant input | [#13391](https://github.com/KittyCAD/modeling-app/issues/13391) | [#13392](https://github.com/KittyCAD/modeling-app/pull/13392) | PR blocked by broad CI at handoff | Focused codemod coverage added in PR |
| Pattern 3D upstream edit descendant input | [#13394](https://github.com/KittyCAD/modeling-app/issues/13394) | [#13392](https://github.com/KittyCAD/modeling-app/pull/13392) | Same PR as transform/pattern preservation | Focused codemod coverage added in PR |
| Upstream Helix descendant input | [#13397](https://github.com/KittyCAD/modeling-app/issues/13397) | related to [#13392](https://github.com/KittyCAD/modeling-app/pull/13392) / [#13402](https://github.com/KittyCAD/modeling-app/pull/13402) | Needs final owner mapping before merge | Focused edge-axis work exists separately |
| Clone edit appends duplicate declaration | [#13398](https://github.com/KittyCAD/modeling-app/issues/13398) | [#13400](https://github.com/KittyCAD/modeling-app/pull/13400) | PR blocked by broad CI at handoff | Focused clone edit-in-place checks added |
| Helix/Revolve edge-axis edit context | [#13401](https://github.com/KittyCAD/modeling-app/issues/13401) | [#13402](https://github.com/KittyCAD/modeling-app/pull/13402) | PR unstable with broad CI/e2e failures pending triage | Focused edge-axis checks added |
| Clone variable-less source pipeline | [#13403](https://github.com/KittyCAD/modeling-app/issues/13403) | [#13404](https://github.com/KittyCAD/modeling-app/pull/13404) | PR unstable with broad CI/e2e failures pending triage | Focused variable-less clone checks added |
| GDT datum edit path offset | [#13405](https://github.com/KittyCAD/modeling-app/issues/13405) | [#13406](https://github.com/KittyCAD/modeling-app/pull/13406) | PR unstable with broad CI/e2e failures pending triage | Focused datum edit checks added |
| Hide/Delete variable-less source pipe | [#13407](https://github.com/KittyCAD/modeling-app/issues/13407) | [#13408](https://github.com/KittyCAD/modeling-app/pull/13408) | PR unstable with broad CI/e2e failures pending triage | Focused variable-less Hide/Delete checks added |
| Boolean variable-less source pipes | [#13409](https://github.com/KittyCAD/modeling-app/issues/13409) | [#13410](https://github.com/KittyCAD/modeling-app/pull/13410) | PR unstable with broad CI/e2e failures pending triage | Focused Boolean variable-less checks added |
| Sweep variable-less path pipeline | [#13411](https://github.com/KittyCAD/modeling-app/issues/13411) | [#13412](https://github.com/KittyCAD/modeling-app/pull/13412) | PR unstable with broad CI/e2e failures pending triage | Focused Sweep path checks added |
| Variable-less plane selection | [#13413](https://github.com/KittyCAD/modeling-app/issues/13413) | [#13414](https://github.com/KittyCAD/modeling-app/pull/13414) | PR unstable with broad CI/e2e failures pending triage | Focused plane-selection checks added |
| Multi-selected variable-less transform inputs | [#13416](https://github.com/KittyCAD/modeling-app/issues/13416) | [#13417](https://github.com/KittyCAD/modeling-app/pull/13417) | PR unstable with broad CI/e2e failures pending triage | Focused multi-select transform checks added |
| Multi-selected variable-less Hide/Delete inputs | [#13418](https://github.com/KittyCAD/modeling-app/issues/13418) | [#13408](https://github.com/KittyCAD/modeling-app/pull/13408) or follow-up | Needs owner confirmation whether covered by existing Hide/Delete PR | Focused multi-select scenario identified |
| Boolean Split edit descendant input | [#13420](https://github.com/KittyCAD/modeling-app/issues/13420) | [#13421](https://github.com/KittyCAD/modeling-app/pull/13421) | PR blocked; local focused test passes, GitHub `npm-test-unit` needs log triage | `npm run test:unit -- src/lang/modifyAst/booleanSplitEdit.test.ts` passed locally |
| Appearance edit descendant input | [#13422](https://github.com/KittyCAD/modeling-app/issues/13422) | [#13423](https://github.com/KittyCAD/modeling-app/pull/13423) | PR open; checks were pending with no failures at initial readback | `npm run test:unit -- src/lang/modifyAst/appearanceEdit.test.ts` passed locally |

## Worktree / branch state at pause

- `codex/gui-fuzz-workflow`
  - Contains reusable GUI-fuzz Playwright coverage for clone edit-in-place and variable-less pipe codemods.
  - Existing untracked draft left intentionally untouched: `e2e/playwright/codex-fuzzer-clone-edit-appends-duplicate.issue.md`.
- `codex/fix-split-edit-inputs`
  - Contains Boolean Split fix and regression test.
  - Local focused verification passed.
  - GitHub CI needs `npm-test-unit` log triage before merge confidence.
- `codex/fix-appearance-edit-input`
  - Contains Appearance fix and regression test.
  - Local focused verification passed.
  - GitHub CI was still pending at handoff.
- `codex/edge-edit-codemod-audit`
  - Audit worktree was initialized only.
  - Discovery stopped before conclusions; do not treat it as evidence.

## Negative / cleared coverage

- Gear edit flows with inserted variables were audited with a focused integration scratch test and passed all covered cases.
- Flip Surface / Join Surface were not treated as active edit-flow targets for this bug class.
- Some Feature Tree editing of generated geometry remains intentionally hard to fix before rollback/cached pre-edit geometry exists. Those should be tracked as capability gaps, not forced into small codemod PRs.

## Verification interpretation

Focused AST/codemod tests are the strongest signal for these fixes because they isolate the rewrite from staging reliability, WebRTC startup noise, and broad e2e variance.

Preview-deploy GUI smoke tests are still valuable, but failures should be classified carefully:

- If focused codemod tests fail, treat as code regression.
- If focused tests pass and preview cannot start/connect, treat as preview/staging/auth/setup until proven otherwise.
- If preview runs and generated KCL is wrong, treat as product/codemod behavior.
- If preview runs and generated KCL is correct but screenshot/Feature Tree looks ambiguous, add DOM/KCL assertions before filing a visual issue.

Known recovered noise during this campaign included ICE 701/STUN lookup warnings, websocket auth-header warnings, and engine startup retry behavior. These should be logged but not counted as product failures when the scene settles and assertions pass.

## Recommended closeout path

1. Stop opening new fuzz branches until the current PR stack is triaged.
2. Merge small focused PRs independently once their targeted checks pass.
3. For blocked/unstable PRs, inspect the first failing GitHub check log before changing code.
4. Add or update PR comments only with sanitized test evidence and a plain-English statement of test intent.
5. Keep issue bodies clear that these are Codex GUI-fuzzer-derived paths, often only reachable by very fast automation or future high-speed computer-use workflows.
6. Reopen fuzz discovery only after the current retargeting and variable-less pipeline families have owners.
