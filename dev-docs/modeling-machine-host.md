# Machine-backed Modeling views

The project editor's Modeling view now uses the existing `modelingMachine` and its sketch child actors. The independent tool/session prototypes are deferred to follow-up branches. The primary migration retains the existing sketch interaction implementations. See [ADR 0002](../src/dev-docs/adr/0002-machine-backed-modeling-transition.md) for the transition and intended direction.

## Ownership

`src/lib/kcl/machine/host.ts` creates one owner for a completed scene execution. That owner contains a real `KclManager`, the modeling actor, and a command actor. It borrows the scene's existing `SceneInfra`, `ConnectionManager`, native context, and native operation queue. Constructing the manager does not allocate another renderer or native model.

The shared editor remains the authority for text, history, and persistence. The manager's hidden CodeMirror surface retains its existing AST, diagnostics, checkpoint listeners, and view-local selection behavior. Its document adapter forwards edits to the shared editor. The manager does not install another save listener, filesystem watcher, or scene-settings observer.

The generic executor remains responsible for captured project sources and settings. `runtime.borrowModel` acknowledges machine-produced source before the document publishes it, so an ordinary executor refresh does not execute the same edit again. A changed import, external document edit, or execution-setting change retires the machine owner before the executor runs a replacement model. Native work drains before its context is freed.

## Document and native history

`src/lib/kcl/machine/document.ts` forwards the legacy checkpoint effects into canonical document history with an owner identity. Only the matching live manager receives those native effects on undo/redo. Another view receives the text change and refreshes its own model instead of restoring foreign checkpoint IDs.

Native previews can change the document without creating history entries. Their final commit therefore records the last committed text and the final text through `committedDocumentPreview`. `src/lib/editors/historyReplay.ts` makes that commit undoable even after the originating native owner closes. The history data contains source text, effects, and an identity; it must not retain an editor view, actor, or native context.

Retirement first suspends document publication. The actor can then finish its existing sketch-exit and draft-cleanup flow without overwriting a newer document. Its hidden editing surface is destroyed after that flow and the native queue have settled.

## Picking and presentation

`createKclSceneSelection().handoff()` detaches the prototype click listener and suspends its engine-selection projection. The machine uses the shared engine subscriptions in `src/lib/scene/modelingMachineSubscriptions.ts`. The file route's hook delegates to the same subscription implementation.

The selection controller remains a read model for existing status and correspondence consumers. Clear and filter actions delegate to the machine. A dialog-owned picking session temporarily handles point queries and projection; the machine's ordinary selection remains untouched. Closing that session restores the machine's selection presentation. Delayed scene queries and stale handoff cleanup cannot take ownership back from a newer owner.

`ClientSideSceneView` reuses the existing Three.js input, geometry, labels, hover, drag, and constraint-editing views. Its explicit host supplies the manager, settings, toolbar configuration, and command actor. `ClientSideScene`, `EditingConstraintInput`, and `KclInput` retain small file-route adapters for their existing app lookups. `ModelingMachineContext` carries the supplied actor without importing its legacy provider.

The existing machine toolbar resolver supplies guards, smart Start/Edit Sketch behavior, plane-picking prompts, and child-actor state. Both routes use the existing toolbar presentation. Responsive semantic groups are a separate follow-up.

Modeling commands use the existing registered command handlers and shared legacy form dialog. Form/Code argument editors and independent command definitions are follow-up enhancements. The machine's sketch child owns its existing rendering, hover, selection, tools, and constraints; the primary migration does not replace those algorithms.

## Extending the transition

Published Modeling contributions still consume the selection, interaction, scene-query, and status interfaces. Actor construction, the mutable manager, picking handoff, and disposal belong to the internal view runtime.

Existing machine commands and toolbar actions remain the behavioral authority. A later migrated tool definition can supply argument editor modes while delegating submission to that command. The interaction session exposed to view extensions is a projection of machine state, not a second interaction state machine. Future interaction adapters should follow the same rule.

Project export metadata still needs an explicit adapter from the next project service. Native sketch creation uses the captured project already opened by the executor and does not require inventing a legacy `Project` wrapper. The feature-tree bridge and additional contributed interaction adapters remain future work at their existing extension boundaries.
