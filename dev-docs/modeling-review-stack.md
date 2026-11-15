# Local Modeling review sequence

This is the local review plan for the scene and Modeling extension work. Publish one wave at a time; each wave contains at most four PRs. Later waves use the previous wave's final branch until that wave lands, then can be retargeted to main. The local ancestry remains connected so the complete feature can be exercised. No remote branches or PRs were changed by this reorganization.

## Base and preserved history

- Fetched main: `5303033040`.
- `codex/review-foundation-save`, `codex/review-foundation-project`, and `codex/review-base` are local rebased copies of the existing save, project, and executor foundations. They are preparation for updating the existing PRs, not three additional feature PRs.
- The previous development branches retain their original tips. `codex/backup-compact-status-before-reorg-20261114` preserves the formerly uncommitted layout work. `codex/backup-modeling-source-on-main-20261114` preserves the complete original stack replayed onto fetched main.
- Yesterday's sketch-on-face fix, PR #15152 (`1dadedc191`), was already in the original foundation and remains included. The four newer main commits are included as well.

## Branches and intended behavior changes

Extraction branches keep the legacy adapters and existing control flow. Their goal is to expose dependencies, not simplify algorithms or opportunistically clean up behavior. New consumers and intentional fixes have separate branches.

### Wave 1: Scene foundations (4 branches)

Initial base: `codex/review-base`.

1. `codex/review-scene-host`
   - PR base: `codex/review-base`.
   - Extract owned scene connections and renderer hosts.
   - Existing routes use adapters over the extracted connection and renderer boundaries.
   - Camera and overlay resources are released with their owning scene.
2. `codex/review-scene-settings`
   - PR base: `codex/review-scene-host`.
   - Share native scene settings and refresh declarations.
   - Setting declarations opt into the existing execution/cache-refresh policy.
   - Fix the crossed grid/backface command flags; no intended change to other legacy settings.
3. `codex/review-kcl-scene`
   - PR base: `codex/review-scene-settings`.
   - Contribute executor-owned KCL scenes and focus recovery.
   - New project-shell Modeling views own streamed/local scenes and native execution.
   - Executors can declare dependent inputs; stale views refresh current sources on focus.
4. `codex/review-scene-selection`
   - PR base: `codex/review-kcl-scene`.
   - Scope scene selection and dialog picking to executions.
   - New views own their selections and dialog picking sessions.
   - Selection is replaced without an intermediate streamed clear and is invalidated on execution.

### Wave 2: Modeling contributions (4 branches)

Initial base: `codex/review-scene-selection`.

1. `codex/review-status-views`
   - PR base: `codex/review-scene-selection`.
   - Extract shared status controls with legacy host adapters.
   - Legacy status controls retain their presentation and actions through explicit host adapters.
   - No new status contribution or compact layout is introduced here.
2. `codex/review-modeling-status`
   - PR base: `codex/review-status-views`.
   - Contribute execution-scoped Modeling view status bars.
   - The new Modeling view receives its own extensible footer.
   - Status commands target that view; app-wide items stay in the project footer.
3. `codex/review-command-views`
   - PR base: `codex/review-modeling-status`.
   - Extract modeling toolbar dialog and codemod view dependencies.
   - Legacy toolbar and dialog consumers use the shared presentation through adapters.
   - No new tool consumer is introduced in this extraction.
4. `codex/review-modeling-commands`
   - PR base: `codex/review-command-views`.
   - Contribute Extrude and Loft through editor-owned tool dialogs.
   - New views register commands and open shared Form/Code dialogs with scoped picking.
   - Scene clicks fill the focused or first compatible empty picking argument; document writes are guarded and undoable.

### Wave 3: Sketch editing (4 branches)

Initial base: `codex/review-modeling-commands`.

1. `codex/review-sketch-scene`
   - PR base: `codex/review-modeling-commands`.
   - Extract shared sketch geometry input and native operations.
   - Existing sketch geometry, mouse input, and native Circle operations receive explicit dependencies.
   - The legacy Start/Edit Sketch button shares its presentation metadata; no new editor consumer is introduced.
2. `codex/review-sketch-interactions`
   - PR base: `codex/review-sketch-scene`.
   - Share Circle selection and move behavior behind legacy adapters.
   - Legacy Circle uses one shared controller through a lifecycle adapter.
   - Move and picking dependencies become explicit; its existing release/recovery decisions remain for separate review.
3. `codex/review-sketch-editor`
   - PR base: `codex/review-sketch-interactions`.
   - Contribute editor-owned sketch sessions Circle and dragging.
   - New Modeling views can start/edit sketches and use the shared Circle/move interactions.
   - The native lease owns source publication, units, cancellation, and per-view selection; no alternate Circle implementation is introduced.
4. `codex/review-sketch-gesture-fixes`
   - PR base: `codex/review-sketch-editor`.
   - Preserve valid drag candidates on release and failed previews.
   - Release waits for the pending preview before invalidating its candidate.
   - A rejected first preview restores the baseline without a source-only formatting edit.

### Wave 4: Optional UI presentation (2 branches)

Initial base: `codex/review-sketch-gesture-fixes`.

1. `codex/review-responsive-tool-groups`
   - PR base: `codex/review-sketch-gesture-fixes`.
   - Adapt semantic tool groups to their view container.
   - Tool categories collapse to existing split buttons and nested menus as space decreases.
   - Last-used commands and menu state survive resizing; visual order remains deterministic.
2. `codex/review-compact-status-bars`
   - PR base: `codex/review-responsive-tool-groups`.
   - Flow compact status bars across their zones.
   - Below 40rem, status zones flatten into one wrapping list without changing keyboard order.
   - Compact menus are kept within their bar; wide left/right presentation is retained.

## Contributor guide placement

The [contributor guide](../src/lib/kcl/CONTRIBUTING.md) is introduced on `codex/review-modeling-commands` for the command/dialog recipe, extended on `codex/review-sketch-editor` for porting sketch tools and the capability matrix, and updated with the small gesture fix and optional group presentation. The existing [scene-host ADR](../src/dev-docs/adr/0001-app-owned-scene-host.md) explains the architectural choice. How-to recipes and the changing capability matrix belong in the guide rather than a new ADR.

Existing glossary terms distinguish editor modes, Modeling interaction contexts, sketch editing sessions, view selection, dialog picking sessions, and tool groups. No additional domain term was needed for this cut.

## Verification and review focus

Every branch tip passed TypeScript and a focused behavioral test set in an isolated checkout. The final production tree was compared against the preserved source-on-main tree; only contributor/review documentation differs.

- Scene wave: exercise two views of one document, unsaved imports, independent cameras, close/reopen, settings refresh, and focus recovery. The render-setting flag correction is called out explicitly in its branch.
- Modeling wave: compare the legacy toolbar/status/dialog presentation before and after extraction, then use the new consumer to pick, cancel, edit Form/Code, and undo in the owning view.
- Sketch wave: compare legacy gestures through the shared adapters; exercise Circle and dragging with free/constrained geometry, arcs, tangency, origin constraints, inch units, pending work, cancellation, and external edits. The release-candidate and rejected-first-preview changes belong only to the gesture-fix branch.
- UI wave: resize each pane independently, retain open menus and last-used tools, check keyboard order, and verify compact status menus stay within the bar.

Native tests use the existing built WASM bundle and mocked engine acknowledgements. Live stream/GPU interactions and packaged-desktop smoke testing remain release checks; this reorganization does not claim new parity.

The broader final lint sweep still reports six pre-existing unnecessary type
assertions in `src/lib/selections.spec.ts`. That file is byte-for-byte identical
to the preserved source-on-main version. They were left for a separate type-only
cleanup rather than mixed into extraction or behavior changes.

## Wave 5: Selection consumers and source correspondence

Stack locally after `codex/review-compact-status-bars`:

1. `codex/review-active-selection`: mode-independent active selection reads and
   clearing, with model/dialog/sketch adapters and an updated selection status item.
2. `codex/review-artifact-correspondence`: unchanged legacy mapping extraction,
   explicit provenance policies, and conservative direct picking resolution.
3. `codex/review-code-modeling-bridge`: N-to-N view links, code decorations,
   geometry highlight projection, imported-source snapshot checks, and scoped
   command picking from intentional Code selections. Includes glossary and guide
   updates. Feature-tree wiring, a link/destination chooser, and native sketch
   correspondence are documented TODOs; selection promotion is available but
   unused by UI.

4. `codex/review-editor-selection-bridges`: generic registry-composed endpoint
   links and picking destinations, an independently composed KCL correspondence
   adapter, scoped provider handles, and narrower contribution-facing lifecycle
   authority. This completes the four-branch fifth wave. Also records the current
   streaming-renderer limitation for a future shared Rendering API with distinct
   arbitrary entity-styling groups, colors, and opacity.

The legacy `/file/:id` selection/navigation behavior remains unchanged. In the
new project shell, correspondence highlighting does not move a cursor, scroll a
pane, or alter the receiving view's selection. Linked Code picking can update
an argument only while its target session is accepting picks.


## Wave 6: Local entity styling

Stack locally after `codex/review-editor-selection-bridges`:

1. `codex/local-entity-styling`: scene-owned generic styling leases and a shared
   local compositor, with the existing selection/hover presentation as an adapter.
   Includes explicit straight-alpha conversion so configured opacity matches
   compositing, and preserves borrowed geometry during target/group cleanup.
2. `codex/local-correspondence-styling`: source-view grouping, stable per-view hues,
   and faint local correspondence. Streaming retains its existing fallback and
   exposes the arbitrary-styling capability as unsupported.

3. `codex/webgl-entity-styling`: generic typed styling targets and a WebGL backend
   for borrowed meshes and fat lines, with non-pickable overlays and owned cleanup.
4. `codex/sketch-correspondence`: execution-qualified native source mapping,
   bidirectional Code/sketch correspondence in both presentations, and
   UTF-8/UTF-16 boundary conversion. Native solver selection
   remains unchanged by correspondence; preview/source mismatches suspend it.

The isolated browser GPU smoke checks verify actual pixel colors, group clearing,
selection precedence, and reset. The renderer still needs protocol support before
this styling is available for remote geometry in Zoo streaming. Native sketch
geometry is rendered client-side in both presentations and supports it already.
