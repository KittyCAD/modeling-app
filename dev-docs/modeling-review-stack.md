# Modeling review sequence

The primary migration reuses `modelingMachine`, its sketch children, the legacy toolbar, and the legacy form dialogs inside independently owned editor views. Independent tool contributions remain the intended direction, recorded in [ADR 0002](../src/dev-docs/adr/0002-machine-backed-modeling-transition.md). They are not a prerequisite for the editor ownership change.

The review sequence keeps ownership changes separate from optional interaction and presentation changes. The current waves contain at most four PRs. Each wave follows the preceding one.

| Wave | Branch | PR | Review focus |
| --- | --- | --- | --- |
| Scene | `codex/review-scene-host` | #15213 | Owned connections and renderer hosts |
| Scene | `codex/review-scene-settings` | #15221 | Shared settings and declared execution refresh |
| Scene | `codex/review-kcl-scene` | #15268 | Shared source snapshots with independent native scenes |
| Selection and shared views | `codex/review-scene-selection` | #15303 | Execution-qualified selection and dialog picking |
| Selection and shared views | `codex/modeling-camera-keymaps` | #15361 | Registered camera commands and shortcut labels |
| Selection and shared views | `codex/review-status-views` | #15304 | Legacy status controls behind explicit hosts |
| Selection and shared views | `codex/explicit-execution` | #15329 | Explicit rendering and result freshness |
| Modeling adapters | `codex/review-modeling-status` | #15364 | View-owned Modeling footer |
| Modeling adapters | `codex/review-command-views` | #15365 | Shared toolbar and form-dialog views |
| Modeling adapters | `codex/review-machine-adapters` | #15368 | Explicit machine, command, native queue, and Three.js dependencies |
| Modeling adapters | `codex/review-machine-document` | #15369 | Shared document/history and adoption of an existing native model |
| Machine integration | `codex/modeling-machine-host` | Draft follows #15369 | Machine-backed Modeling view, picking handoff, and owner retirement |

Optional follow-ups cover contributed dialog modes, responsive tool groups, compact status layout, and Code/Modeling correspondence. Their branch names remain `codex/review-tool-dialog-modes` and the `codex/review-machine-*` presentation/correspondence branches. They require separate restacking and review before publication.

The initial editor transition can stop at `codex/modeling-machine-host`, which includes the stream-only sketch tint and opacity control. The former `codex/review-machine-sketch-presentation` cut is folded into that primary branch; its local ref is retained as an alias of its parent and needs no separate PR. The later branches are enhancements, not dependencies of that transition. Command reuse exposes the existing tool system; it does not establish tested parity for every command or renderer. Project export metadata and feature-tree integration remain explicit adapter work. Live stream, local GPU, and packaged desktop smoke tests remain necessary.

## Deferred independent-tool research

`codex/research-independent-modeling-tools` preserves the complete earlier prototype on top of the new machine migration, including shared Circle/move controllers, independent sketch sessions, tool contributions, and the previous presentation/correspondence work. It is a research continuation, not a proposed omnibus PR. Its prototype session factories remain inactive in the machine-backed view. Use it to extract future vertical slices under the ownership rule in ADR 0002.

The old `review-modeling-commands`, `review-sketch-scene`, `review-sketch-interactions`, `review-sketch-editor`, `review-sketch-gesture-fixes`, and `review-sketch-stream-presentation` refs retain the earlier development cuts. They are no longer prerequisites in the proposed review sequence. The original complete machine-backed stack is preserved at `codex/backup-machine-stack-before-arrangement-20261116`.

The primary branch deliberately keeps the original Circle/move algorithms. Optional extraction and gesture changes must state their behavior changes separately. Keeping that distinction allows reviewers to assess the ownership transition without also approving a new CAD interaction framework.
