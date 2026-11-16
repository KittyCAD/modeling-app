# Modeling review sequence

The primary migration reuses `modelingMachine`, its sketch children, the legacy toolbar, and the legacy form dialogs inside independently owned editor views. Independent tool contributions remain the intended direction, recorded in [ADR 0002](../src/dev-docs/adr/0002-machine-backed-modeling-transition.md). They are not a prerequisite for the editor ownership change.

Each wave contains at most four branches. Each row is based on the preceding row, including across waves. Existing foundations remain PRs #15158, #15159, and #15160; no duplicate foundation PRs are needed. This arrangement is local. Previously published review refs have not been updated.

| Wave | Branch | Review focus |
| --- | --- | --- |
| Scene | `codex/review-scene-host` | Owned connections and renderer hosts; based on `franknoirot/add-executors` |
| Scene | `codex/review-scene-settings` | Shared scene settings and declared execution refresh |
| Scene | `codex/review-kcl-scene` | Executor-owned KCL models, project source capture, focus recovery |
| Scene | `codex/review-scene-selection` | Execution-qualified selection and dialog picking |
| Shared views | `codex/review-status-views` | Legacy status controls behind explicit hosts |
| Shared views | `codex/review-modeling-status` | View-owned extensible Modeling footer |
| Shared views | `codex/review-command-views` | Shared toolbar, form dialog, and codemod dependencies |
| Shared views | `codex/review-machine-adapters` | View-local actor binding, toolbar resolver, command registration, native queue, and shared Three.js views |
| Machine migration | `codex/review-machine-document` | Canonical document/history adapter and adoption of an already-executed native model |
| Machine migration | `codex/modeling-machine-host` | Actual machine-backed Modeling view, exclusive picking handoff, source acknowledgement, retirement, and ADR 0002 |
| Machine migration | `codex/review-tool-dialog-modes` | Optional contributed Extrude/Loft Form/Code editors submitting through the machine |
| Presentation | `codex/review-responsive-tool-groups` | Optional semantic groups and responsive toolbar presentation |
| Presentation | `codex/review-compact-status-bars` | Optional compact status layout |
| Correspondence | `codex/review-artifact-correspondence` | Artifact-backed provenance query policies |
| Correspondence | `codex/review-editor-selection-bridges` | Explicit Code/Modeling links, decorations, and constrained cross-view command picking |
| Correspondence | `codex/local-entity-styling` | Arbitrary local entity styling and source-view correspondence hues |
| Correspondence | `codex/sketch-correspondence` | Correspondence through the machine's native sketch context |

The initial editor transition can stop at `codex/modeling-machine-host`. The later branches are enhancements, not dependencies of that transition. Command reuse exposes the existing tool system; it does not establish tested parity for every command or renderer. Project export metadata and feature-tree integration remain explicit adapter work. Live stream, local GPU, and packaged desktop smoke tests remain necessary.

## Deferred independent-tool research

`codex/research-independent-modeling-tools` preserves the complete earlier prototype on top of the new machine migration, including shared Circle/move controllers, independent sketch sessions, tool contributions, and the previous presentation/correspondence work. It is a research continuation, not a proposed omnibus PR. Its prototype session factories remain inactive in the machine-backed view. Use it to extract future vertical slices under the ownership rule in ADR 0002.

The old `review-modeling-commands`, `review-sketch-scene`, `review-sketch-interactions`, `review-sketch-editor`, `review-sketch-gesture-fixes`, and `review-sketch-stream-presentation` refs retain the earlier development cuts. They are no longer prerequisites in the proposed review sequence. The original complete machine-backed stack is preserved at `codex/backup-machine-stack-before-arrangement-20261116`.

The primary branch deliberately keeps the original Circle/move algorithms. Optional extraction and gesture changes must state their behavior changes separately. Keeping that distinction allows reviewers to assess the ownership transition without also approving a new CAD interaction framework.
