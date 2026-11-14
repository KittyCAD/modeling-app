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
