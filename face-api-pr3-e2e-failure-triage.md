# PR3 E2E Failure Triage

Source reports:

- `/home/kurt/Downloads/reports/report1.json`
- `/home/kurt/Downloads/reports/report3.json`
- `/home/kurt/Downloads/reports/report4.json`
- `/home/kurt/Downloads/reports/report6.json`

Summary after removing the hardcoded engine pool query parameter:

- Total failing test occurrences: 30
- Unique failing test titles: 30
- The previous shared readiness blocker is not present in this report set.
- Current dominant category: expected code/text drift in point-click and migration-sensitive tests.

## High Priority: Point-Click Code Expectation Drift

These are most likely real PR3 selection / new edge-specifier expectation updates. They should be checked against the intended new syntax rather than blindly snapshot-updated.

- [x] `point-click.spec.ts` - `Chamfer point-and-click`
- [x] `point-click.spec.ts` - `Chamfer point-and-click delete`
- [x] `point-click.spec.ts` - `Fillet point-and-click`
- [x] `point-click.spec.ts` - `Fillet point-and-click delete`
- [x] `point-click.spec.ts` - `Fillet with large radius should update code even if engine fails`
- [x] `point-click.spec.ts` - `Helix point-and-click around sweepEdge with edit and delete flows`
- [x] `point-click.spec.ts` - `Verify in-pipe extrudes in bracket can be edited`
- [x] `point-click-sketch-v1.spec.ts` - `Fillet point-and-click delete`
- [x] `point-click-sketch-v1.spec.ts` - `Verify in-pipe extrudes in bracket can be edited`

## High Priority: Selection-Oriented Feature Expectation Drift

These are likely related to PR3 selection payload changes, but they are broader modeling features rather than direct fillet/chamfer/helix edits.

- [x] `point-click.spec.ts` - `Appearance point-and-click`
- [x] `point-click.spec.ts` - `Flip Surface point-and-click`
- [x] `point-click.spec.ts` - `Join Surfaces point-and-click`
- [x] `point-click.spec.ts` - `Pattern Circular 3D point-and-click`
- [x] `point-click.spec.ts` - `Pattern Linear 3D point-and-click`
- [x] `point-click-assemblies.spec.ts` - `Point-and-click clone`
- [x] `point-click-sketch-v1.spec.ts` - `Translate point-and-click with segment-to-body coercion`

## Medium Priority: Boolean Operation Expectations

These are probably expected shape/code selection changes from the new selection model. They are grouped together because the same fix or expectation update may address all four.

- [x] `boolean-sketch-v1.spec.ts` - `Create boolean operation -- intersect`
- [x] `boolean-sketch-v1.spec.ts` - `Create boolean operation -- split`
- [x] `boolean-sketch-v1.spec.ts` - `Create boolean operation -- subtract`
- [x] `boolean-sketch-v1.spec.ts` - `Create boolean operation -- union`

## Medium Priority: Sketch Plane / Plane Selection Text Expectations

These used to be visual pixel failures in the earlier report set; now they are text expectation failures. That suggests the app reaches the relevant flow and the remaining issue is likely expected KCL/source text.

- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `XY`
- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `YZ`
- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `XZ`
- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `-XY`
- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `-YZ`
- [x] `can-create-sketches-on-all-planes-and-their-back-sides.spec.ts` - `-XZ`

## Medium Priority: Sketch-On-Face Expectations

Resolved. This was not just expectation drift. PR3 was routing face selections
through sketch-solve, but the Rust `new_sketch` path had regressed to generating
legacy `startSketchOn(extrude001, face = ...)` syntax for `faceOf(...)`
selections. That caused the app to enter sketch-solve with the wrong scene graph
sketch id and continue editing the original sketch.

The fix restores the main-branch `new_sketch` behavior: selected extrusion faces
are materialized as `face001 = faceOf(...)`, then the new sketch is created with
`sketch002 = sketch(on = face001) {}`. The app-side PR3 routing now consistently
sends face/plane selections to sketch-solve mode, and the e2e expectations were
updated to the new syntax.

- [x] `sketch-solve-edit.spec.ts` - `can sketch on extrude cap`
- [x] `sketch-solve-edit.spec.ts` - `can sketch on extrude wall`

Verified locally:

```bash
env -u ELECTRON_RUN_AS_NODE npx playwright test --config=playwright.electron.config.ts --project=chromium e2e/playwright/sketch-solve-edit.spec.ts --grep "can sketch on extrude wall"
```

Result: `1 passed`.

## Lower Priority: Isolated Behavior / Interaction Failures

These should be inspected individually after the code expectation groups, because they do not currently look like the same failure signature as the main groups.

- [ ] `sketch-solve-edit.spec.ts` - `can edit an existing sketch and edit it's segments`
- [ ] `regression-tests.spec.ts` - `Toolbar doesn't show modeling tools during sketch plane selection animation`

## Suggested Order

1. Start with `point-click.spec.ts` fillet/chamfer/helix failures. They are closest to the face-api edge syntax work and may reveal one shared expectation or codemod issue.
2. Then address the broader point-click selection features: appearance, surface ops, 3D patterns, clone, translate.
3. Update grouped boolean and sketch-plane expectations if they are straightforward received-code changes.
4. Leave the two isolated interaction/regression failures until after the expectation drift is reduced.
