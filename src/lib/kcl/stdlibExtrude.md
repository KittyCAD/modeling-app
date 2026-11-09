# Stdlib Extrude proof

`stdlibExtrude.ts` exercises the existing Extrude operation against an explicit
editor and execution snapshot. It adds no dialog or scene-picking interface.

The shared `extrudeCommandConfig` is the complete existing stdlib-derived
argument and presentation definition, including UI overrides, advanced parameters, conditional selection
requirements, defaults, documentation, and edit-flow arguments. The legacy
modeling command configuration uses that definition and adds its existing
machine-bound review adapter. The new host supplies review through `validate`.

`modelingCommandCodemods.Extrude.transform` invokes the existing `addExtrude`.
Its stdlib argument completeness checks remain in place. The legacy machine's
`run` adapter delegates to that transform, supplying its manager's artifact graph.
Both hosts also share experimental-feature annotation preparation.

## Prepare and apply

The caller supplies resolved `ExtrudeCommandArgs`, the current editor, an atomic
source/execution snapshot, and mock review validation for that snapshot:

```ts
const prepared = await prepareStdlibExtrude({
  editor,
  args,
  getExecution: () => currentExecution,
  wasmInstance,
  validate: (proposedAst, snapshot) => analysis.validate(proposedAst, snapshot),
});
if (prepared instanceof Error) return prepared;
return prepared.commit();
```

The source must match the execution snapshot. Preparation and commit reject a
changed document, source path, execution snapshot, or closed target (represented
by `getExecution()` returning `undefined`). Moving the cursor is permitted.

The codemod still returns an AST and uses the existing recaster, which can change
formatting. CodeMirror's `diff` computes the separate text ranges between the
original document and the printed result. One transaction applies that `ChangeSet`
and maps the current selection; it does not replace the entire buffer. The
transaction is isolated from ordinary typing history. Saving and execution remain
the responsibility of the editor's contributions.

## Viewer runtime and argument editing

The Modeling mode contributes the stdlib Extrude command as a tool in the
`modelingTools` toolbar. Its button opens a temporary argument editor in a
compact, draggable dialog. The Model choice binds an editor and its displayed
execution. Reexecuting, editing, renaming, or closing that target invalidates the
choice; changing focus does not retarget the command.

The shared argument definition supplies defaults, documentation, conditional
requirements, advanced parameters, and language-version availability. Selection
inputs query the bound viewer. KCL inputs reuse `CommandKclInput` with an explicit
source/model contract instead of a modeling actor. Numeric expressions can use
variables from the executed model, including imported values.

Form mode reuses the legacy dialog's stdlib-derived argument controls. Code mode
edits their JSON document directly. Both modes share one buffer and undo history;
the dialog's Submit button resolves and reviews that document before applying the
codemod. Cancelling discards the draft. Neither opening Form nor a background
review changes the source model.

`runtime.ts` creates a persistent app-WASM context for each viewer session. Its
engine callbacks send commands through that viewer's connection. `transport.ts`
correlates websocket replies by request ID so camera and ICE messages cannot
complete unrelated KCL requests. Native execution manages its own scene cache;
the session must not clear the scene behind that cache.

Mock review uses a separate native context and the same captured project files.
Successful `executeMock` writes cached variables even when `usePrevMemory` is
false, so sharing the live context would change subsequent argument calculations.
Review's engine callbacks reject attempts to contact the visible engine.
Execution, evaluation, review, and preference updates are sequenced by the
session. Disposal closes the transport and waits for borrowed WASM contexts
before freeing them.

## Evidence and smoke test

Tests use the compiled WASM with engine lifecycle acknowledgements for numeric
models. They cover model-variable evaluation, imported files, independent session
memory, and both successful and failed mock review without engine traffic.
The command actor test opens the argument editor, submits from Code mode, and
commits a real codemod into the selected editor. Separate tests cover stale
execution choices, localized changes, cursor mapping, undo/redo, reply
correlation, and session cleanup. These checks do not establish real engine
geometry or browser picking; those still need a live-engine smoke test.

With the project-shell feature enabled, open this file in Modeling mode:

```kcl
@settings(kclVersion = 3.0, defaultLengthUnit = mm)
height = 24mm
s = sketch(on = XY) {
  c = circle(start = [10mm, 0mm], center = [0mm, 0mm])
  radius(c) == 10mm
}
```

After execution, click Extrude, activate Profiles, and click inside the circle.
Enter `height / 2` in Length, then submit. The source editor should gain the stdlib
codemod's region/extrusion code and the viewer should reexecute it. Before
submitting, switch the dialog to Code and back: the expression and selections
should remain intact. Submitting from Code should work too. Cancel a second
draft to confirm it leaves the source unchanged. The applied source change can
be undone in one step.
