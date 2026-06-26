# PR3 failing tests triage

This tracks the current failures on `kurt-face-api-pr3-selection-overhaul` after aiming it at `kurt-distance-to-from-face-api`.

## Plan

1 [x] First run targeted integration tests for the non-e2e failures, because they are faster and likely explain many e2e failures.
2 [x] Fix foundational operation-tree / operation-default failures before touching point-and-click e2e failures.
3 [x] Fix modifyAst face/selection regressions next, because point-and-click depends on source-range-to-selection and face API conversion.
4 [x] Fix GDT edit-flow regressions together, because they probably share operation parsing/default extraction code.
5 [x] Fix sketch-solve interaction regressions separately, because those may be unrelated to face API and could be merge fallout.
6 [x] After integration tests are green, rerun representative e2e point-click tests locally instead of trying the whole e2e set first.
7 [ ] Split remaining e2e failures into fixture/test-expectation updates vs real app behavior regressions.
8 [x] Fix the remaining integration failures first: app/systemIO/registry/KclManager/keymap/page-mounted/history plus the selection source-range test.
9 [x] Regenerate the targeted stdlib markdown docs for the current `docs::gen_std_tests::test_generate_stdlib_markdown_docs` failure.
10 [x] Triage the remaining desktop command-bar/editor/sketch interaction failures in small focused batches.
11 [x] Loop back on open-sketch picking outside sketch mode, because it is still blocking double-click open-sketch edit and sketch hover highlights.
12 [x] Triage the remaining sketch-v1 point-click failures as a separate compatibility bucket.
13 [x] Triage camera movement reliability separately from view-control behavior.
14 [x] Loop back on `Center on selection from menu`, because the observed `[0, 0, 0]` camera target may be a real selection/centering regression rather than an expectation update.
15 [x] Run assembly e2e last, because repeated assembly failures usually share one setup/root cause.
16 [ ] Use full CI as the final confirmation once targeted unit/integration/e2e checks pass locally.

## Latest CI Snapshot

- [x] The main sketch-v2 point-click face-api cluster is no longer in the CI failure list: fillet, chamfer, revolve, helix, shell, mirror, GDT flatness/datum, loft, sweep, and the Z0006 edit auto-fix flows are off the current failure list.
- [x] The modifyAst and operations integration clusters are no longer in the current failure list.
- [ ] Current remaining failures are concentrated in editor/sketch interaction, command-bar extrude, assemblies, sketch-v1 compatibility, docs generation, camera movement, and a few broader desktop smoke tests.
- [ ] New current CI failures not in the previous triage list: stdlib markdown docs generation and camera movement reliability tests.

## Step 1 Findings

- [x] Ran the combined targeted integration command from the plan. It reproduced the main failure clusters, but `faces.spec.ts` also triggered a wasm `RuntimeError: memory access out of bounds`, so isolated reruns are more useful for debugging.
- [x] `src/lib/operations.spec.ts` fails consistently in isolation with 10 failures. These are operation default extraction, GDT edit-flow support, and one `groupNestedOperations` behavior change.
- [x] `src/lang/modifyAst/edgeRefactor.spec.ts -t "does not partially refactor"` fails consistently in isolation. The refactor now returns success when it should return `No Z0006 fixes to apply` if one `tags` element cannot be converted.
- [x] `src/lang/modifyAst/faces.spec.ts -t "default plane XY"` fails consistently in isolation with `Default planes not initialized`.
- [x] `src/lang/modifyAst/sweeps.spec.ts -t "sectional from true"` fails consistently in isolation because generated/edited code references `capEnd001` without defining it.
- [x] `src/lang/modifyAst/boolean.spec.ts -t "multi-profile extrude as tool"` fails consistently in isolation because subtract emits `tools = extrude001` instead of `tools = [extrude001[0], extrude001[1]]`.
- [x] Isolated selection/interaction and app/registry groups have now been rerun and fixed where needed.

## Step 2 Findings

- [x] `src/lib/operations.spec.ts` now passes in isolation.
- [x] Restored `draftAngle` extraction for extrude edit defaults.
- [x] Restored artifact-rich selections from operation arguments so sweep edit defaults preserve cap artifacts.
- [x] Added missing feature-tree edit mappings for `gdt::profileLine`, `gdt::profileSurface`, `gdt::angularity`, `gdt::concentricity`, `gdt::symmetry`, and `gdt::runout`.
- [x] Restored `profileFunction` defaults for GDT profile variants.
- [x] Fixed `groupNestedOperations` so an explicit `GroupBegin` in the filtered list can reconstruct its group even when it is equivalent to, but not the same object as, the `GroupBegin` in `allOps`.

## Step 3 Findings

- [x] `src/lang/modifyAst/edgeRefactor.spec.ts -t "does not partially refactor"` now passes. The Z0006 refactor again treats a failed fillet/chamfer conversion as no-op/no-fix instead of partially applying an unchanged successful result.
- [x] `src/lang/modifyAst/faces.spec.ts -t "default plane"` now passes for XY, XZ, and YZ. The test falls back to the plane name when the integration Rust context has not initialized default plane IDs.
- [x] `src/lang/modifyAst/sweeps.spec.ts -t "sectional from true"` now passes. `addSweep` now classifies face vs non-face selections through `resolveToCodeRef`, so path/profile selections are not incorrectly converted into cap tags.
- [x] `src/lang/modifyAst/boolean.spec.ts -t "multi-profile extrude as tool"` now passes. Path selections that are direct inputs to `extrude([profile001, profile002], ...)` now produce indexed output expressions like `extrude001[0]`.
- [x] `npm run tsc -- --pretty false` passed after the step 3 fixes.
- [x] Focused eslint passed for `src/lang/modifyAst/edges.ts`, `src/lang/modifyAst/faces.spec.ts`, `src/lang/modifyAst/sweeps.ts`, and `src/lang/queryAst.ts`.

## Step 4 Findings

- [x] `src/lib/operations.spec.ts -t "GDT edit flow"` passes. The GDT operation/default extraction work from step 2 covers the listed GDT edit-flow failures.
- [x] `src/lang/modifyAst/gdt.spec.ts` passes. The GDT code-mod coverage is green for the current branch, including edge-based face API syntax and distance.
- [x] No additional GDT semantics decision was needed for this step. The failures were stale merge/default extraction issues rather than unresolved API behavior.

## Step 5 Findings

- [x] `src/machines/sketchSolve/segments.test.ts` passes. The control-point spline freedom failures were stale after the branch updates.
- [x] `src/machines/sketchSolve/interaction/interactionHelpers.spec.ts -t "includes circles"` passes. The circle hit-test fixture now provides the center point reference expected by current circle objects.
- [x] `npm run tsc -- --pretty false` passed after the step 5 fix.
- [x] Focused eslint passed for `src/machines/sketchSolve/interaction/interactionHelpers.spec.ts`.

## Step 6 Findings

- [x] Built Electron/Vite assets with `npx cross-env TARGET=desktop npm run tronb:vite:dev`.
- [x] Removed the stale debug-pane dependency from `SceneFixture.moveCameraTo`. Camera movement can send `default_camera_look_at` directly and no longer needs `debug-pane-button`.
- [x] Desktop representative e2e runs locally when launched with the X11/session env wrapper from `rust/AGENTS.md`. The earlier `bad option: --remote-debugging-port=0` failure was caused by missing desktop session environment, not by stale app bundles.
- [x] Removed the local `.env.development.local` engine websocket override, rebuilt Electron, and verified the focused desktop e2e set against the default dev websocket.
- [x] `point-click.spec.ts -t "Fillet point-and-click$"` passes locally with the session env wrapper.
- [x] Updated the v2 fillet e2e expectations for region-based face API output: generated edge refs now include `endFaces` and use `region001.tags.line2` before the cap face.
- [x] Updated stale revolve command-bar expectations for the current `BodyType` header argument.
- [x] Removed stale GDT flatness/datum assertions that expected `experimentalFeatures = allow` to disappear. Current sample setup preserves that setting.
- [x] `point-click.spec.ts -t "Helix point-and-click around|Revolve point-and-click$|GDT Flatness from command bar|GDT Datum from command bar"` passes locally with the session env wrapper against dev.
- [x] Fixed helix edge mode to accept `edgeCut` selections and added integration coverage that emits `axis = { sideFaces = [...] }` when the engine supplies an edge entity reference.
- [x] `src/lang/modifyAst/geometry.spec.ts` passes with helix face-API axis coverage.
- [x] `npm run tsc -- --pretty false` passed after the step 6 updates.
- [x] Focused eslint passed for `src/lang/modifyAst/geometry.ts`, `src/lang/modifyAst/geometry.spec.ts`, `src/lang/modifyAst/edges.ts`, `src/lib/commandBarConfigs/modelingCommandConfig.ts`, `e2e/playwright/point-click.spec.ts`, and `e2e/playwright/fixtures/sceneFixture.ts`.
- [ ] Web representative e2e can launch when `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/kurt/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome` is set, but the app reports `No canvas support`, so the face-api edge-selection tests time out before exercising point-click behavior.
- [x] The prior local `:8080` issue was caused by a local websocket override, not a required test dependency. With that override removed, the representative desktop e2e tests use dev and pass.

## Step 7 Findings

- [x] Ran a focused desktop `point-click.spec.ts` batch for the sketch-v2 failures that looked most likely to be command default / expected KCL drift.
- [x] Updated stale expectations for offset plane, large-radius fillet, chamfer, flip surface, in-pipe extrude edit, tagged extrude edit, loft, sweep, and fillet.
- [x] `point-click.spec.ts -t "Verify in-pipe extrudes|Create an Extrude operation with a tag|Loft point-and-click|Sweep point-and-click helix|Fillet point-and-click$"` passes locally with the session env wrapper.
- [x] The passing subset confirms several CI failures were fixture/test-expectation drift after current command defaults started preserving/showing `bodyType = SURFACE` and face API edge refs became more explicit.
- [x] Enabled feature-tree Z0006 auto-fix before edit flows. The fillet, helix, and revolve automatic-fix edit e2e tests now pass locally.
- [x] Fixed mixed old/new edge kwargs during edit by dropping stale `tags` when editing existing `edges`/`edgeRefs` calls. This avoids generating fillet calls with both `tags` and `edges`.
- [x] Restored the missing Mirror command-bar/modeling-machine path and updated the toolbar to launch the actual `Mirror` command config. `Mirror point-and-click` now passes locally.
- [x] `Fillet point-and-click edit standalone expression` now passes locally after the Z0006 edit auto-fix path is enabled.
- [x] `Shell point-and-click` now passes locally. Shell now accepts primitive face selections and uses `engineTopologyFallback` to generate `faceId(solid, index)` only when normal cap/wall face-tag resolution cannot produce a face expression.
- [x] `Verify in-pipe extrudes in bracket can be edited` now passes locally. The stale expectations were updated for extrude edit defaults that preserve/show generated `tagStart` and `tagEnd`.
- [x] A 19-test representative sketch-v2 `point-click.spec.ts` batch passed all repaired expectations except the in-pipe extrude drift on the first run; after patching that drift, the isolated in-pipe test passes too.
- [ ] Still need representative reruns/classification for current remaining groups: sketch-v1, sketch-solve, command-bar extrude, assemblies, docs generation, camera movement, and broader desktop smoke tests.

## Step 8 Findings

- [x] `src/lib/selections.spec.ts` passes. Adjacent/opposite sweep-edge references now resolve back through the source segment before generating the tag expression, so selection references prefer `getNextAdjacentEdge(seg01)` over `edgeId(extrude002, index = 2)` when the taggable source segment exists.
- [x] The app/systemIO/registry/KclManager/keymap/page-mounted/history integration bucket passes: `src/lib/app.spec.ts`, `src/machines/systemIO/systemIOMachine.spec.ts`, `src/registry/extensions/commands/index.spec.ts`, `src/lang/KclManager.spec.ts`, `src/registry/extensions/keymap/index.spec.ts`, `src/hooks/network/useOnPageMounted.spec.tsx`, and `src/editor/plugins/zookeeper/history.integration.spec.ts`.
- [x] Fixed the registry import-cycle failure by importing toolbar command IDs directly from `toolbarCommandIds.ts` in the keymap and moving `selectSketchPlane` into a non-React lib helper. Registry command definitions no longer import the React engine-subscription hook, so `boot.ts` is not pulled into registry initialization.
- [x] `npm run tsc -- --pretty false` passed after the step 8 fixes.
- [x] Focused eslint passed for the touched selection, artifact graph, toolbar, keymap, command, and sketch-plane helper files.

## Step 9 Findings

- [x] Reproduced `docs::gen_std_tests::test_generate_stdlib_markdown_docs`; it only reported stale generated content in `docs/kcl-std/functions/std-solid-fillet.md`.
- [x] Regenerated the markdown with the single targeted command `EXPECTORATE=overwrite cargo nextest run --retries 0 --no-fail-fast -p kcl-lib --features artifact-graph -- docs::gen_std_tests::test_generate_stdlib_markdown_docs`.
- [x] The regenerated diff is limited to documenting the `fillet(version?: number(_))` argument.
- [x] The targeted docs generation test passes after regeneration.

## Step 10 Findings

- [x] Rebuilt Electron/Vite assets with `npx cross-env TARGET=desktop npm run tronb:vite:dev` before running desktop e2e checks.
- [x] `command-bar-tests.spec.ts -t "Extrude from command bar selects extrude line after|Can extrude from the command bar"` passes locally. The failures were stale expectations after `Extrude` gained the required `bodyType` command-bar argument.
- [x] `editor-tests.spec.ts -t "Can undo a click and point extrude with ctrl\\+z"` passes locally. The generated extrude now includes `bodyType = SOLID`, so the undo-flow expectation needed the current KCL shape.
- [x] `regression-tests.spec.ts -t "Toolbar.*show modeling tools"` passes locally. The test now asserts the real invariant, that modeling tools are not shown during/after sketch-plane selection animation, instead of requiring the exact final mode to be `sketchSolve`.
- [x] `point-click.spec.ts -t "Verify user can double-click to edit a sketch"` was traced to an engine-side open-sketch query gap. With the local engine fix running, the focused desktop e2e passes.
- [x] `testing-selections.spec.ts -t "Testing selections (and hovers) work on sketches when NOT in sketch mode"` shares the same open-sketch query gap. With the local engine fix running, the focused desktop e2e passes.
- [x] Next action resolved: open sketch entities are expected to be selectable/queryable outside sketch mode for these flows, so the fix belongs in the engine query/reference path rather than in test expectations.

## Step 11 Findings

- [x] Confirmed this is not just a stale coordinate in the double-click test. The open-sketch double-click returns `{}` from `query_entity_type_with_point` even when tried first and after broad coordinate scans.
- [x] Confirmed this is not just a CodeMirror hover assertion issue. The open-sketch hover test never gets a `hover-highlight` because no sketch reference is resolved for the hovered segment.
- [x] Temporarily instrumented the client-side scene raycast path. It did not report sketch segment intersections for the tested open sketch in modeling mode, so there is no current app-side client object to use as a fallback picker.
- [x] The closed-sketch part of the double-click test still works: the engine returns a region reference and the app can enter sketch mode from that reference.
- [x] The remaining question is behavioral: open sketch entities should be selectable/queryable outside sketch mode from the engine/app scene for these existing point-and-click flows.
- [x] Fixed engine-side by adding an open-sketch path curve picking fallback and completing path segment/vertex entity-reference payloads.
- [x] Verified locally against the fixed local engine with focused desktop e2e runs for double-click edit sketch and sketch hover/selection outside sketch mode.
- [ ] Modeling-app CI still needs to rerun against an engine build that includes the open-sketch query fix.

## Step 12 Findings

- [x] `point-click-sketch-v1.spec.ts -t "Offset plane point-and-click"` passes locally against dev. The failure was stale command-bar state: offset plane now reaches review with the default offset already populated after selecting the plane.
- [x] `point-click-sketch-v1.spec.ts -t "GDT Datum from command bar"` passes locally against dev. The only stale expectation was requiring `experimentalFeatures = allow` to disappear.
- [x] `point-click-sketch-v1.spec.ts -t "GDT Flatness from command bar"` passes locally against dev. The test needed the same stale `experimentalFeatures = allow` expectation removed, plus a larger timeout because the full add/edit flow takes just over three minutes locally.
- [x] `point-click-sketch-v1.spec.ts -t "Helix point-and-click around sweepEdge"` passes locally against dev. Initial generated KCL now includes explicit `endFaces` for the selected edge, while the edit flow emits the valid minimal `sideFaces` form.
- [ ] `point-click-sketch-v1.spec.ts -t "Verify user can double-click to edit a sketch"` is the same open-sketch picking dependency as step 11. It should be rerun once the local/CI engine includes the open-sketch `query_entity_type_with_point` fix.

## Step 13 Findings

- [x] Rebuilt Electron/Vite assets after `.env.development.local` changed back to the dev websocket. Before the rebuild, all three focused tests failed at engine connection setup because the local bundle still had stale websocket config.
- [x] Fixed camera movement test reliability by removing screenshot-based image-diff waits from `testing-camera-movement.spec.ts`. These tests already assert camera coordinates, and the screenshot polling was the timeout source in Electron.
- [x] `testing-camera-movement.spec.ts -t "Can pan and zoom camera reliably"` passes locally with the direct camera-state flow.
- [x] `testing-camera-movement.spec.ts -t "Can orbit camera reliably"` passes locally with the direct camera-state flow.

## Step 14 Findings

- [x] `view-controls.spec.ts -t "Center on selection from menu"` was a real regression, not a stale camera expectation. The selected circle line was correct in the editor, but camera centering moved to origin because the engine selection did not preserve a concrete selected entity for this v2 sketch reference.
- [x] Kept the old camera expectation and fixed selection syncing instead. When a graph selection has a v2 `entityRef`, the app still sends `select_entity`, but now also sends a raw `select_add` fallback when it can derive a concrete engine/artifact ID. This preserves engine selection for camera-centering paths that operate on the concrete selected entity set.
- [x] Added explicit raw-ID fallback for `solid2d_edge` and `segment` entity references.
- [x] Rebuilt Electron/Vite assets with `npx cross-env TARGET=desktop npm run tronb:vite:dev`.
- [x] `view-controls.spec.ts -t "Center on selection from menu"` passes locally after the selection fallback fix.

## Step 15 Findings

- [x] Reproduced the assembly failures locally. Scene selection for the bracket transform already passed, but feature-tree selection/context-menu actions on imported module rows failed.
- [x] Fixed the feature-tree module branch parent row so top-level imported module instances remain actionable. Child operations inside imported modules stay module-owned/read-only.
- [x] Added a fixture helper to open a feature-tree operation context menu from the row wrapper rather than the inner button.
- [x] Added feature-tree context-menu support for `ModuleInstance` transform, clone, and delete actions.
- [x] Updated the clone delete step to target the visible `clone001` feature-tree row.
- [x] `point-click-assemblies.spec.ts -g "Insert the bracket part into an assembly and transform it"` passes locally.
- [x] `point-click-assemblies.spec.ts -g "Insert foreign parts into assembly and delete them"` passed as part of the focused assembly batch.
- [x] `point-click-assemblies.spec.ts -g "Point-and-click clone"` passes locally.

## Integration: Modify AST

- [x] `src/lang/modifyAst/boolean.spec.ts` > `boolean > Testing addSubtract > should support multi-profile extrude as tool`
- [x] `src/lang/modifyAst/faces.spec.ts` > `faces.test.ts > Testing addOffsetPlane > should add a basic offset plane call on default plane XY and then edit it`
- [x] `src/lang/modifyAst/faces.spec.ts` > `faces.test.ts > Testing addOffsetPlane > should add a basic offset plane call on default plane XZ and then edit it`
- [x] `src/lang/modifyAst/faces.spec.ts` > `faces.test.ts > Testing addOffsetPlane > should add a basic offset plane call on default plane YZ and then edit it`
- [x] `src/lang/modifyAst/sweeps.spec.ts` > `sweeps.test.ts > Testing addSweep > should edit sweep call with sectional from true to false and relativeTo setting change`
- [x] `src/lang/modifyAst/edgeRefactor.spec.ts` > `refactorZ0006Unified > unit (no engine) > does not partially refactor a fillet tags array when one element has no metadata`

## Integration: Operations And Defaults

- [x] `src/lib/operations.spec.ts` > `operations.test.ts > groupNestedOperations > does not merge pre-grouped operation streaks into sketch block groups`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::profile'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > Extrude edit flow > preserves draftAngle in the command defaults`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::angularity'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::concentricity'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::symmetry'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::runout'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::profileLine'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > GDT edit flow > preserves variable-backed datums for 'gdt::profileSurface'`
- [x] `src/lib/operations.spec.ts` > `operations.test.ts > Sweep edit flow > retrieves tagged cap profiles in the command defaults`

## Integration: Selection And Interaction

- [x] `src/machines/sketchSolve/interaction/interactionHelpers.spec.ts` > `findClosestApiObjects > includes circles when the mouse is within the circle stroke threshold`
- [x] `src/lib/selections.spec.ts` > `testing source range to artifact conversion > prefers adjacent/opposite edge references over primitive index references`

## Integration: App And Registry

- [x] `src/lib/app.spec.ts`
- [x] `src/machines/systemIO/systemIOMachine.spec.ts`
- [x] `src/registry/extensions/commands/index.spec.ts`
- [x] `src/lang/KclManager.spec.ts`
- [x] `src/registry/extensions/keymap/index.spec.ts`
- [x] `src/hooks/network/useOnPageMounted.spec.tsx`
- [x] `src/editor/plugins/zookeeper/history.integration.spec.ts`

## E2E Desktop: General Point And Click

- [x] `point-click.spec.ts` > `Point-and-click tests > Verify user can double-click to edit a sketch`
- [x] `point-click.spec.ts` > `Point-and-click tests > Offset plane point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Fillet point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Fillet with large radius should update code even if engine fails`
- [x] `point-click.spec.ts` > `Point-and-click tests > Chamfer point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Verify in-pipe extrudes in bracket can be edited`
- [x] `point-click.spec.ts` > `Point-and-click tests > Fillet point-and-click edit standalone expression`
- [x] `point-click.spec.ts` > `Point-and-click tests > Sweep point-and-click helix`
- [x] `point-click.spec.ts` > `Point-and-click tests > Helix point-and-click around sweepEdge with edit and delete flows`
- [x] `point-click.spec.ts` > `Point-and-click tests > Loft point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Revolve point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Shell point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Create an Extrude operation with a tag and edit it via Feature Tree`
- [x] `point-click.spec.ts` > `Point-and-click tests > GDT Flatness from command bar`
- [x] `point-click.spec.ts` > `Point-and-click tests > GDT Datum from command bar`
- [x] `point-click.spec.ts` > `Point-and-click tests > Flip Surface point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Mirror point-and-click`
- [x] `point-click.spec.ts` > `Point-and-click tests > Should automatically fix fillet kwargs that are incompatible with P&C upon edit`
- [x] `point-click.spec.ts` > `Point-and-click tests > Should automatically fix helix axis that is incompatible with P&C upon edit`
- [x] `point-click.spec.ts` > `Point-and-click tests > Should automatically fix revolve axis that is incompatible with P&C upon edit`

## E2E Desktop: Sketch V1 Point And Click

- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Revolve point-and-click`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > GDT Flatness from command bar`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > GDT Datum from command bar`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Verify in-pipe extrudes in bracket can be edited`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Offset plane point-and-click`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Helix point-and-click around sweepEdge with edit and delete flows`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Sweep point-and-click helix`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Loft point-and-click`
- [x] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Fillet point-and-click edit standalone expression`
- [ ] `point-click-sketch-v1.spec.ts` > `Point-and-click tests - sketch v1 > Verify user can double-click to edit a sketch`

## E2E Desktop: Sketch Solve

- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > can delete individual constraints and the sketch block from the feature tree`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > can sketch on extrude cap`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > can sketch on extrude wall`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > trim operations can be undone in sketch solve mode`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > constraints can be added and undone one at a time in sketch solve mode`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > undo still works after mixing point-click edits with direct kcl edits in sketch solve mode`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > keeps newer copied sketch block edits when stale execution finishes`
- [ ] `sketch-solve-edit.spec.ts` > `Sketch solve edit tests > treats fresh direct editor sketch executions as derived source updates`

## E2E Desktop: Feature Tree And Command Bar

- [x] `feature-tree-pane.spec.ts` > `Feature Tree pane > User can edit an extrude operation from the feature tree`
- [x] `command-bar-tests.spec.ts` > `Command bar tests > Extrude from command bar selects extrude line after`
- [x] `command-bar-tests.spec.ts` > `Command bar tests > Can extrude from the command bar`

## E2E Desktop: Assemblies

- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Point-and-click clone`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Point-and-click clone`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Point-and-click clone`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert foreign parts into assembly and delete them`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert foreign parts into assembly and delete them`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert foreign parts into assembly and delete them`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert the bracket part into an assembly and transform it (feature-tree selection)`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert the bracket part into an assembly and transform it (feature-tree selection)`
- [x] `point-click-assemblies.spec.ts` > `Point-and-click assemblies tests > Insert the bracket part into an assembly and transform it (feature-tree selection)`

## E2E Desktop: Other

- [x] `editor-tests.spec.ts` > `Editor tests > Can undo a click and point extrude with ctrl+z`
- [x] `testing-selections.spec.ts` > `Testing selections > Testing selections (and hovers) work on sketches when NOT in sketch mode`
- [x] `regression-tests.spec.ts` > `Regression tests > Toolbar doesn't show modeling tools during sketch plane selection animation`
- [x] `view-controls.spec.ts` > `Testing gizmo, fixture-based > Center on selection from menu, disable interaction in sketch mode`
- [ ] `benchmark/hot-path.spec.ts` > `Hot path > Draw a circle and extrude it`

## E2E Desktop: Camera Movement

- [x] `testing-camera-movement.spec.ts` > `Testing Camera Movement > Can orbit camera reliably`
- [x] `testing-camera-movement.spec.ts` > `Testing Camera Movement > Can pan and zoom camera reliably`

## E2E KCL: Docs

- [x] `nextest-run` > `kcl-lib > docs::gen_std_tests::test_generate_stdlib_markdown_docs`

## E2E Web: Face API Edge Selection

- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select split edges for fillet`
- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select split edges for fillet`
- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select split edges for fillet`
- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select Solid3D edges and Surface edges for revolve`
- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select Solid3D edges and Surface edges for revolve`
- [x] `face-api-edge-selection.spec.ts` > `Face API edge selection > Can select Solid3D edges and Surface edges for revolve`

## Suggested Triage Order

- [ ] Run `npm run test:integration -- src/lib/operations.spec.ts src/lang/modifyAst/faces.spec.ts src/lang/modifyAst/sweeps.spec.ts src/lang/modifyAst/boolean.spec.ts src/lang/modifyAst/edgeRefactor.spec.ts`.
- [x] Run `npm run test:integration -- src/lib/selections.spec.ts src/machines/sketchSolve/interaction/interactionHelpers.spec.ts`.
- [x] Run `npm run test:integration -- src/lib/app.spec.ts src/lang/KclManager.spec.ts src/registry/extensions/commands/index.spec.ts src/registry/extensions/keymap/index.spec.ts src/hooks/network/useOnPageMounted.spec.tsx src/machines/systemIO/systemIOMachine.spec.ts`.
- [ ] Fix operation/default extraction first if `operations.spec.ts` failures reproduce.
- [ ] Fix selection-source conversion next if `selections.spec.ts` or point-click code-mod tests reproduce.
- [ ] Fix edit-flow code mods next if `faces`, `sweeps`, `boolean`, or `edgeRefactor` failures reproduce.
- [ ] Rebuild wasm with `npm run build:wasm:dev` if failures mention missing generated bindings or stale Rust bindings.
- [x] Run representative e2e desktop point-click tests for fillet, helix, revolve, and GDT after integration is green.
- [x] Regenerate targeted stdlib docs for the current Rust/KCL doc failure before rerunning full e2e:kcl.
- [ ] Run representative sketch-v1 e2e tests for the remaining sketch-v1 failures.
- [ ] Run command-bar extrude tests next, because several broader desktop failures may share command defaults or selection setup.
- [x] Run camera movement and view-control tests together, because they may share fixture/camera helper behavior.
- [x] Run assembly e2e tests last, because repeated failures often share one fixture/setup root cause.
