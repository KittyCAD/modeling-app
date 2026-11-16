# Contributing Modeling tools

The project Modeling view currently uses a view-owned `modelingMachine` and its existing command handlers. Its source/history and native runtime come from the editor and scene adapters. [ADR 0002](../../dev-docs/adr/0002-machine-backed-modeling-transition.md) records why the editor transition retains these behaviors and how independent contributions can replace individual flows later.

## Add an argument editor mode

`toolDefinitions.ts` registers Extrude and Loft through `modelingToolsValueSpec`. Their definitions create `modelingDialog.ts` dialogs using the existing argument definitions and shared `ModelingArgumentFields` view. The dialog owns its temporary picking session; the view's ordinary selection stays unchanged.

`machine/dialogs.ts` matches the selected machine command to a contributed definition and supplies its submit callback. That callback submits resolved arguments through the command actor. It does not apply a second codemod alongside the machine handler. Commands without a matching contributed definition retain the shared legacy form.

When adding another definition, reuse its existing argument policy, command eligibility, and handler. Cover opening, cancellation, invalidation after execution, Form/Code round trips, and resolved submission. A new editor mode should preserve the argument values and the dialog's picking ownership.

## Port an interaction incrementally

The machine's sketch child remains the only owner of active sketch interaction. Do not start an independent native session beside it. The `codex/research-independent-modeling-tools` branch preserves the earlier tool/session experiments for future vertical slices; it is not a dependency of this migration.

Extract one existing behavior behind explicit dependencies, retain a legacy adapter, and test both consumers before replacing its machine flow. Keep selection/hover, snapping, modifier keys, preview ordering, repeated operations, Escape, tool switching, and cleanup in the slice. Toolbar actions and keybindings must resolve against the owning view's command actor rather than the global file route.

The feature tree and project export metadata still need explicit next-project adapters. Code/geometry correspondence is separate follow-up work; it must not silently change tool selection or navigate another view.
