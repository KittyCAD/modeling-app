# Contributing Modeling tools

A Modeling view owns an executor and its scene. Contributions receive that view's
`ModelingViewContext`; focus does not choose their document, connection, or model.
The [scene-host ADR](../../dev-docs/adr/0001-app-owned-scene-host.md) records the
ownership decision and the intended future zoo-web-view boundary. This guide is
for implementation recipes, rather than architectural decisions.

## Add a command and dialog

1. Reuse the command's existing argument schema and codemod. See `stdlibTools.ts`
   and the Extrude/Loft definitions in `toolDefinitions.ts`.
2. Wrap the definition with `defineStdlibModelingTool` and contribute it through
   `modelingToolsValueSpec` in the extension that owns the command. The view host
   opens commands by stable ID; adding another dispatch branch is unnecessary.
3. Reuse the shared argument fields and `ModelingDialogView`. Extract a missing
   dependency and adapt its legacy caller before adding another view implementation.
4. Use dialog-owned picking arguments. Picks belong to a captured scene execution;
   execution invalidates them and requires repicking. Cancellation leaves ordinary
   view selection untouched. Unclaimed scene picks remain temporary dialog state.
5. Let the existing dialog host validate arguments, review the codemod in its mock
   context, and publish one undoable document transaction. A command definition
   should not save files, execute the visible scene, or look up a focused editor.

Definitions may need additional argument-kind adapters. The shared dialog does
not make every legacy command immediately portable. Add those adapters to the
shared fields and retain a legacy consumer when one exists.

## Add view UI

Contribute status items through `modelingStatusItemsValueSpec`, supplying an ID,
side, order, and component. The component receives its owning view explicitly.
Keep network/version/project-wide controls in the project footer. Keybindings
belong beside the owning extension's command contribution, but focused-view
keyboard routing has not been installed for these tools yet.

## Migration and review rules

- Preserve existing geometry, gesture, and presentation behavior when extracting
  shared code. Keep legacy adapters and useful unused paths until a separate
  behavior change has been agreed. Mark a concrete gap with a TODO instead of
  silently substituting a smaller interaction.
- Separate extraction and new-consumer review. State the short list of intended
  observable changes; do not count moving functions as changed user behavior.
- Await pending native work before releasing its scene or replacing its tool.
  Guard replies against source changes, execution changes, and editor disposal.
- Exercise the owning view and a sibling view, cancellation, re-execution,
  imported buffers, and undo. Check both streamed and local presentation paths.

## Current capability matrix

| Capability | Scope |
| --- | --- |
| Extrude and Loft | Shared dialogs, Form/Code arguments, dialog-owned picking, reviewed codemods, one undoable publication |
| Additional modeling commands | Definition/registration seam is available; schemas, codemods, and missing field adapters still need porting |
| View status | Contributions reuse the legacy view components and target the owning execution |
| Tool keybindings | Contribution can live with its extension; focused-view routing remains follow-up work |
| Scene presentation | Streamed and local paths share ownership; changing renderer currently requires reopening the Modeling view |

Native tests use mocked engine acknowledgements. They check ownership and native
geometry but do not establish live stream, GPU, or packaged-desktop parity.

## Port a sketch tool

Start with `sketch/tools.ts`, the Circle adapter in `sketch/circle.ts`, and the
shared controller under `machines/sketchSolve/tools/circleController.ts`.

1. Contribute a stable `SketchToolDefinition` through `sketchToolsValueSpec`.
   `create(host)` returns a prompt signal plus async `escape` and `dispose`.
   The host belongs to one sketch editing session; acquiring a focused file or
   a global modeling actor inside the tool would break that ownership.
2. Extract the existing legacy interaction behind explicit geometry, input,
   settings, mutation, preview, and result callbacks. Both consumers should use
   the same behavior. Keep the legacy machine as a lifecycle/event adapter when
   the existing route needs it; do not create an actor-shaped compatibility object.
3. Use the owning runtime's serialized mutations. Render draft results through
   `host.render`; publish committed source through `host.accept`. The session
   checks source/view ownership and makes the editor transaction. The tool should
   not edit the editor independently, save, or execute the visible scene.
4. Dispose input once, drain pending native work, and remove drafts before the
   next tool starts. A late reply must not reset the next tool's callbacks or
   replace externally edited source. Circle and the shared move host have tests
   for these cases.
5. Keep gesture state in the controller. The toolbar consumes contributed actions
   and prompt state; it should not reproduce the controller's transitions.

The move interaction uses `MoveToolHost` for current geometry, selection, native
checkpoints, and publication. Its existing algorithms still handle drag anchors,
snapping, multi-selection, labels, and invalid-solve recovery. Additional tools
may need additional runtime operations. Add a narrow explicit mutation adapter
rather than importing `KclManager` or passing the entire modeling machine.

For a new sustained interaction, contribute `modelingInteractionsValueSpec` with
an entry that creates an owned `ModelingInteractionSession`. Start/Edit Sketch
shows how to accept preselection or acquire a target afterward and release scene
input on exit. The current contract still includes default-plane visibility;
that is a provisional sketch-shaped part of the interface, not a requirement to
invent another editor presentation mode.

## Sketch capability matrix

| Capability | Scope |
| --- | --- |
| Start/Edit Sketch | Default planes, planar faces, and existing local sketches; target picking is session-owned |
| Circle | Shared thin controller, drafts, snapping, repeat, and awaited teardown |
| Existing geometry | Shared move interaction for points, lines, circles, arcs, multi-selection, and labels |
| Native publication | Preview state stays outside the document; accepted results produce undoable transactions |
| Execution/source changes | End the native editing lease; stale selections/results are discarded |
| In-sketch undo/redo | Document undo works but currently ends sketch editing |
| Constraint editing UI | Native/runtime seams exist; the complete editor-owned UI is follow-up work |
| Imported sketches | Open their source editor before editing; cross-file editing is not supplied |

Exercise free and partially constrained geometry, arcs and tangency, support
geometry, origin constraints, non-mm units, and failed solves. Test release,
Escape, tool switching, source edits, and scene teardown while native work is
pending. Preserve legacy behavior in extraction PRs; isolate deliberate fixes
with focused regression tests.

Gesture settlement waits for the pending valid preview before committing. A first
preview failure restores the baseline without publishing a formatting-only edit.

## Toolbar groups

Contribute categories through `modelingToolGroupsValueSpec` and give tools a
`groupId`. Stable category IDs, parent IDs, order, and collapse priority describe
semantics; the toolbar chooses inline, split-button, or submenu presentation from
container width. Command and sketch behavior do not belong to that layout state.
The responsive presentation can be adopted independently of adding another tool.

### Consuming active selection

Tools and status contributions use `context.selection.items`, `canClear`, and
`clear()` for the current interaction's selection. Model references retain their
scene/execution identity; sketch references retain their session/sketch identity.
Consumers requiring a particular geometry domain narrow the item's `kind`.
The facade delegates to the owner; it does not copy selection into a global store.
`context.session.resource.value?.selection.selected` remains the underlying view
selection, suitable for seeding a new dialog. Clearing active dialog or sketch
selection does not clear that underlying selection.

### Geometry/source correspondence

`createArtifactCorrespondence(graph)` queries the executed artifact graph; it
creates no second provenance store. Results identify the target entity, source
artifact, module-qualified source range, and relationship: `defined-by`,
`generated-by`, `derived-from`, or `imported-through`. Explanation policies may
include every relationship. Picking accepts only direct definitions/generators
and must resolve each selected source location to exactly one compatible target.
A multiple argument permits multiple unambiguous source selections, not arbitrary
expansion of an ambiguous expression. No segment-to-wall or face-to-profile
coercion occurs in this query layer.

The `/file/:id` consumer still uses the extracted `legacyCorrespondence` policy,
with its previous traversal and ordering. Region solver IDs, pattern copies, and
KCL import-site provenance require further artifact support; they are explicit
TODOs rather than guessed correspondences. Module IDs are local to an execution.

### Connecting Code and Modeling views

The independently discovered `kclCorrespondence` registry item installs the
`kcl.correspondence` factory, which registers
`correspondenceCodeExtension` on each Code surface. The KCL view factory registers
a Modeling adapter while `kclCorrespondenceEndpointsService` is available.
Withdrawing correspondence removes its adapters without closing Modeling views
or their executors. Generic
`editorSelectionLinksService` connects their view instances under the
`kcl.correspondence` bridge definition. Views of the same backing editor link automatically; other links
are explicit `link('kcl.correspondence', codeViewId, modelingViewId)` calls with returned cleanup.
Links support multiple endpoints in either direction. Imported files require an
explicit link and exact bytes from the target execution's source snapshot;
module IDs are resolved through that execution's filenames, never compared
across executions. Editing source or re-executing clears stale projections.

The bridge decorates code without moving cursors or scrolling. In local rendering, geometry correspondence uses generic entity-styling groups
while ordinary view selection and dialog arguments remain unchanged. Streamed
rendering retains the existing selection presentation fallback. During picking, dialog
highlights take priority over correspondence highlights. Local correspondence uses stable per-source-view OKLCH hues converted to sRGB,
9% interior opacity, 40% outline opacity, and a one-pixel outline. Selection and
hover have higher application-assigned priority. The renderer receives only
opaque styling groups; it does not know about correspondence or view identities.
Streaming still uses the selection appearance.

Intentional Code selection (`select` transactions) can offer a direct,
unambiguous candidate to an active picking argument. Programmatic selection,
source edits, and decoration updates do not offer picks. A single linked
Modeling view is the default destination. With several links, the caller must
use `setPickingTarget('kcl.correspondence', codeViewId, modelingViewId)`; global focus and the order
of open dialogs never choose a destination. Unsupported/ambiguous mappings
remain explanatory highlights and expose an error through `kclCorrespondenceStatusService`.

`SceneSelectionController.promoteCorrespondence()` is a documented programmatic
operation, tested but deliberately unused by UI. It refuses promotion while a
dialog owns picking. Navigation is separate and no automatic navigation is
installed.

TODO extension points are marked beside the bridge: feature-tree candidate
submission, link/destination controls, and native sketch correspondence. Sketch
selection already participates in `context.selection`, but solver source deltas
need an execution-qualified correspondence endpoint before they can safely
participate in the Code bridge. Do not interpret solver IDs as engine artifacts.


### Bridge ownership and extensibility

`editors.selection-bridges` is domain-independent. Adapters contribute endpoint
kind pairs through `editorSelectionBridgeDefinitions`; it owns connections and
picking destinations, not selection payloads or mapping semantics. KCL drawing
mode can contribute another pair with its own adapter, as can a non-KCL editor.
`editorSelectionEndpointsService` grants registration only;
`editorSelectionLinksService` grants connection controls only. Neither exposes
owner disposal. Register cleanup with the view's lifetime host.

KCL Code providers receive an endpoint-scoped handle (`select`, `invalidate`,
`dispose`), so they cannot submit intent on behalf of another endpoint. Modeling
providers lend the bridge execution snapshots, selection reads, and validated
projection/picking callbacks; the bridge receives no native scene or executor
lifecycle controls. The host retains the full `ModelingViewRuntime`, while
contributions receive `ModelingViewContext` with read-only controller state and
borrowed native operations. Disposal, model-identity mutation, and correspondence
projection are excluded from the contribution-facing types. Native operations
are still explicit capabilities; these types are ownership boundaries, not a
security sandbox.

Policy registry contributions remain a future extension idea, marked beside
`explanationPolicy`: a learning-oriented Code view could request full provenance
while a feature inspector requests only the generating operation.

The current streaming-renderer limitation and shared Rendering API requirements
are recorded in [the scene guide](../scene/README.md#rendering-api-limitation-arbitrary-entity-styling).

### Correspondence smoke test

In the new project shell, open a saved KCL file with an extruded solid. Keep its
first view in Modeling. Use Open editor for the same file again (reusing the
buffer), and set the second view to Code. Select an extruded wall in Modeling,
then switch tabs to see source decorations without cursor movement. Select a
geometry-producing expression in Code, then return to Modeling to see projected
highlights without changing ordinary selection. Independent buffers containing
the same text do not auto-link. Switching a single view between modes is not a
parallel-view test. Native sketch/solver-region correspondence remains a TODO.


Correspondence groups retain source-view identity through the bridge until the
view adapter acquires opaque renderer group handles. Opening a picking dialog
suppresses those groups; closing it restores the same source hues. Unlinking a
source, leaving its mode, re-executing, or closing a view releases/invalidates
its groups. The per-view hue uses a WeakMap keyed by the view instance, so
remounting Code preserves its hue without retaining closed views.
