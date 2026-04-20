# Sketch Solve Drag Stability Plan

## Recommendation

Yes, the UX goal is sound: while the user is actively dragging, we should keep the sketch anchored to the last known good solve and only surface the failure as warning/error styling. The current behavior is jarring because the drag preview accepts every `editSegments` result, including results that carry solver issues, and the move tool then commits the last attempted preview on mouse-up.

The checkpoint/head-sync concern is real. A frontend-only visual fallback is not sufficient if Rust continues advancing its internal sketch head during preview edits and we never reconcile that head on mouse-up.

I still do not think a Rust `isDragging` flag is the first thing we need, but I do think the plan must explicitly include Rust resynchronization at the end of the drag. The current frontend already has enough information to ship most of the behavior:

- drag preview updates already flow through `src/machines/sketchSolve/tools/moveTool/moveTool.ts`
- solver failure styling already comes from `sceneGraphDelta.exec_outcome.issues`
- preview writes already avoid disk/history via `writeToDisk: false`

That means the first implementation can still be mostly TypeScript, but with one extra requirement:

- cache the last good preview outcome for rendering
- capture a pre-drag checkpoint or equivalent baseline for Rust
- on mouse-up, explicitly reconcile Rust back to the last good state before creating the final committed checkpoint

Without that final reconciliation step, the visible sketch and Rust checkpoint state can drift.

## Current Behavior

### What happens today

1. `createOnDragCallback` builds `segmentsToEdit` and calls `rustContext.editSegments(...)` on every drag frame.
2. If the call resolves, it always sends `update sketch outcome`, even when `sceneGraphDelta.exec_outcome.issues` is non-empty.
3. `updateSketchOutcome` syncs both the preview KCL text and the returned scene graph into the sketch-solve state.
4. `updateSceneGraphFromDelta` uses the returned graph for geometry and `exec_outcome.issues` for red conflict styling.
5. On mouse-up, `onDragEnd` commits `lastPreviewSegmentsToEdit`, which is currently the last attempted drag preview, not the last valid one.

### Why checkpoints make this more subtle

- Preview drags do not create history checkpoints, which is correct.
- But `editSegments(...)` still mutates Rust's current sketch state even when the preview is transient.
- If TypeScript decides to ignore an invalid preview result visually, Rust may still be sitting at that invalid preview head.
- Undo/redo relies on Rust checkpoints matching the committed sketch state, so mouse-up has to bring Rust back to the same last-good state the user sees.

### Why that causes the explosion

- Brittle sketches can still produce a serialized `sceneGraphDelta` even when the solver is in a bad state.
- We immediately render that bad graph, so coincident/tangent structure appears to break apart.
- Because the move tool stores the latest attempted preview edit, mouse-up can preserve the invalid position instead of snapping back to the last valid state.

## Target Behavior

During an active drag:

- if the preview solve is valid, update code and geometry normally
- if the preview solve has exec-outcome issues, do not advance code or geometry past the last known good preview
- still render the sketch in error styling while the pointer remains down

On mouse-up:

- if the final preview was valid, commit it
- if the final preview was invalid, commit the last known good preview
- if no valid preview happened after drag start, revert to the drag-start baseline
- once the drag ends and we commit the last good state, normal coloring should return

## Phase 1: Frontend-First Implementation

### Phase 1 Checklist

- [ ] Add an explicit drag reconciliation invariant
- [ ] Add drag preview state for last-known-good results
- [ ] Treat exec-outcome issues as an invalid drag preview
- [ ] Commit the last good preview on drag end
- [ ] Prefer restore-then-commit over trusting transient Rust head
- [ ] Keep preview failures toast-free

### 0. Add an explicit drag reconciliation invariant

The invariant for this feature should be:

- during drag, visible geometry may be derived from cached last-good preview state
- on drag end, the final committed editor text, final visible scene, Rust sketch head, and newly-created checkpoint must all describe the same state

If that invariant is hard to guarantee with existing APIs, then a small Rust-side API addition becomes justified.

### 1. Add drag preview state for last-known-good results

Update `src/machines/sketchSolve/tools/moveTool/moveTool.ts` to track:

- `lastGoodPreviewOutcome`
  - the last preview result with zero `exec_outcome.issues`
  - should include `kclSource`, `sceneGraphDelta`, and the exact `segmentsToEdit` that produced it
- `dragStartOutcome`
  - the baseline sketch outcome at mouse-down
  - used when the very first preview step is already invalid
- `lastPreviewIssues`
  - the latest preview `exec_outcome` from an invalid solve
  - used only for temporary red styling
- `preDragCheckpointId`
  - the checkpoint representing the committed sketch state before drag start
  - used to restore Rust to a known baseline before final commit when the drag ends in an invalid region

This should replace the current `lastPreviewSegmentsToEdit` single-slot behavior.

If there is not already a public way to obtain the current committed sketch checkpoint, add one. Using the current committed checkpoint is preferable to inventing drag-only history entries.

### 2. Treat exec-outcome issues as an invalid drag preview

In `createOnDragCallback`:

- call `editSegments(...)` as today
- inspect `result.sceneGraphDelta.exec_outcome.issues`
- if there are no issues:
  - store this as `lastGoodPreviewOutcome`
  - advance `lastSuccessfulDragFromPoint`
  - send the result through `onNewSketchOutcome`
- if there are issues:
  - do not replace `lastGoodPreviewOutcome`
  - do not advance `lastSuccessfulDragFromPoint`
  - send a synthetic preview outcome that keeps the last good geometry/code but swaps in the failing `exec_outcome`

Recommended synthetic preview shape:

- `sourceDelta.text`: use the last good preview text, or the drag-start text if no good preview exists yet
- `sceneGraphDelta.new_graph`: use the last good preview graph, or the drag-start graph if no good preview exists yet
- `sceneGraphDelta.exec_outcome`: use the failing preview `exec_outcome`

That preserves stable geometry while keeping the current red-color pipeline unchanged.

Important: this synthetic preview is only for the visible/editor-side state during drag. It does not remove the need to reconcile Rust on mouse-up.

### 3. Commit the last good preview on drag end

In `createOnDragEndCallback` / `onComplete`:

- if a snapping constraint is being applied, keep the current snapping flow
- otherwise:
  - if the final preview is valid, commit it as normal with `createCheckpoint: true`
  - if the final preview is invalid:
    - restore `preDragCheckpointId` first, or otherwise restore Rust to the pre-drag committed state
    - then apply `lastGoodPreviewOutcome.segmentsToEdit` with `createCheckpoint: true`
  - if there was no valid preview after drag start:
    - restore `preDragCheckpointId`
    - do not create a new checkpoint
    - send the restored baseline outcome back through `update sketch outcome`

This is the key behavior change: mouse-up should never commit the last invalid preview attempt, and Rust should never be left at an invisible invalid preview head.

### 3a. Prefer restore-then-commit over trusting transient Rust head

Even if Rust has seen a sequence of transient preview edits, the safest path on invalid mouse-up is:

1. restore the pre-drag checkpoint
2. apply the last good edit from that known baseline
3. create the new committed checkpoint from there

That avoids subtle drift if the internal solver/frontend state after many transient edits is not identical to "baseline + last good edit".

### 4. Keep preview failures toast-free

No major behavior change is needed here. The current drag path already uses `suppressExecOutcomeIssues: true`, which is correct for high-frequency drag preview failures. Keep that behavior.

## Phase 2: Small Sketch-Solve State Cleanup

### Phase 2 Checklist

- [ ] Make preview intent explicit in the event payload
- [ ] Keep geometry-vs-issues responsibilities clear
- [ ] Surface checkpoint access deliberately

### 5. Make preview intent explicit in the event payload

Extend `UpdateSketchOutcomeEvent` in `src/machines/sketchSolve/sketchSolveImpl.ts` with preview metadata such as:

- `previewMode?: 'drag'`
- `preserveGeometryFromPreviousOutcome?: boolean`

This is optional for the first pass, but it would make the behavior easier to reason about than relying on ad hoc synthetic deltas inside the move tool.

### 6. Keep geometry-vs-issues responsibilities clear

The stable rule should be:

- geometry source: last valid preview or drag-start baseline
- issue source: latest attempted preview

If this logic starts spreading beyond the move tool, add a helper near `updateSketchOutcome` or in a small move-tool utility module to build the hybrid preview outcome in one place.

### 6a. Surface checkpoint access deliberately

If the move tool needs the current committed checkpoint but `KclManager` keeps that internal, add a narrow accessor or a small modeling/sketch-solve helper instead of reaching into private state indirectly.

The move tool should not guess what checkpoint Rust considers committed.

## Phase 3: Optional Rust API Follow-Up

This phase is optional and should only happen if the frontend-first approach proves insufficient.

### Phase 3 Checklist

- [ ] Add an explicit drag-preview mutation mode
- [ ] Decide whether Rust-side preview behavior is justified

### 7. Add an explicit drag-preview mutation mode

If we want the solver/frontend boundary to understand interaction intent, introduce an optional edit mode:

- TypeScript: `src/lib/rustContext.ts`
- wasm wrapper: `rust/kcl-wasm-lib/src/api.rs`
- frontend trait/api: `rust/kcl-lib/src/frontend/sketch.rs`
- implementation: `rust/kcl-lib/src/frontend.rs`

Possible shape:

```ts
editSegments(version, sketchId, segments, settings, {
  interaction: 'drag-preview'
})
```

Possible Rust enum:

```rust
enum SketchEditInteraction {
    Default,
    DragPreview,
}
```

### 8. Only use the Rust flag for solver-specific behavior

Good reasons to add the Rust mode later:

- different solver heuristics for preview vs commit
- lighter-weight responses for drag preview
- a formal `preview_valid` / `preview_invalid` status instead of inferring from `exec_outcome.issues`
- avoiding transient mutation of Rust head during drag in the first place

Bad reason:

- merely to stop the frontend from accepting invalid preview results

The frontend can already do that today.

## Testing Plan

### TypeScript tests

Add or update tests in:

- `src/machines/sketchSolve/tools/moveTool/moveTool.spec.ts`
- `src/machines/sketchSolve/sketchSolveImpl.spec.ts`

Key cases:

1. Valid drag preview updates code and geometry normally.
2. Invalid drag preview keeps the previous geometry but still reports exec-outcome issues.
3. Invalid drag preview does not advance `lastSuccessfulDragFromPoint`.
4. Mouse-up after an invalid preview commits the last good preview, not the invalid one.
5. Mouse-up after only invalid previews restores the drag-start baseline.
6. Red styling is visible during invalid drag preview and clears after release.
7. Snapping still commits correctly when the snapped result is valid.
8. After invalid drag release, Rust is restored/reconciled before the committed checkpoint is created.
9. Undo after a recovered drag returns to the expected pre-drag checkpointed state.

### Rust tests

Only needed if Phase 3 happens.

Add tests near existing `edit_segments` coverage in `rust/kcl-lib/src/frontend.rs` for:

- default edit behavior unchanged
- drag-preview mode returns the expected validity metadata
- drag-preview mode does not regress current segment edit semantics

## Rollout Notes

### Suggested order

1. [ ] Implement the move-tool caching and hybrid preview outcome.
2. [ ] Add pre-drag checkpoint capture plus restore-on-invalid-release reconciliation.
3. [ ] Add regression tests around invalid preview handling and undo/checkpoint behavior.
4. [ ] Validate against the brittle KCL example from the bug report.
5. [ ] Only then decide whether a Rust-side drag-preview mode is still necessary.

### Success criteria

- dragging a brittle sketch no longer causes the visible geometry to explode
- the sketch still turns red while the cursor is held in a non-solvable position
- releasing the mouse returns the sketch to the last valid state
- after release, Rust and the visible sketch agree on that last valid state
- no extra toasts or history noise are introduced

## Open Questions

1. Should red styling during invalid drag apply to the whole sketch, or only the objects involved in the failed drag?
2. If a drag enters an invalid region and then re-enters a valid region, should we continue from the current cursor position or from the last valid anchor point? The current move-tool math is based on the last successful point, which is probably the safer behavior for the first pass.
3. Do we want a small non-toast status hint during invalid drag, or is red styling alone enough?
