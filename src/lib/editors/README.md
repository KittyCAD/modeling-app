# Editor modes and view instances

An editor owns a working document and its undo history. A view instance owns one
presentation of that document: its selected mode, Code cursor, and viewport. The
project shell presents view instances as tabs. Opening a file again creates another
view of its existing buffer; `openEditor(src, contents)` remains available for
creating a deliberately independent document.

Closing one view leaves other views of its editor alive. Closing the last view
releases the document and its capabilities. Hiding or remounting the pane does not
close its views. Project shutdown releases all documents and presentations.

Every mounted editor view exposes its host element independently of its mode.
Clicking a noninteractive background focuses that host; focusable controls retain
their normal focus behavior. Saving resolves the document from the event's view
host, so Mod-S works in Modeling as well as Code and cannot fall back to another
document merely because Code has not been focused. Unmounting clears the host
reference without closing the view's resources.

Undo and Redo resolve the focused presentation's document in every mode, including
Electron's Edit menu. Native text controls keep their own text history. A closed
view or an empty document history never redirects the action to another model.

Modes are components contributed through `editorViewsValueSpec`. Matching modes
are ordered by descending `priority`, with registration order breaking ties. Each
view retains its explicit choice while that mode matches. Code is the wildcard
fallback with priority `-100`; domain-specific modes can open by default.

Plain modes use `defineEditorView({ id, label, matches, Component })`. Modes with
context use `defineEditorView(provider)({ id, label, matches, Component })`. The
provider receives `editor`, the view `instance`, and `onDispose`; its return type
determines the component's `context` prop. A context survives mode switches and
React remounts, and closes with its view, contribution withdrawal, or loss of its
match. Component props identify the editor, view instance, and active state.

Document capabilities use `editorCapabilityValueSpec` and acquire resources once
per matching editor. Native CodeMirror extensions use `codeEditorsExtensionValueSpec`
and are installed separately in each Code surface. Code selections remain available
to selection listeners without being mirrored into another surface. Shared edits
map other surfaces' selections through the changes and enter one document history.

Context setup and registered cleanup cannot manage editor or view ownership through
the editors service. Failed initialization releases acquired resources; bound modes
report `unbound`, `ready`, or `error` to the host.

See [classification and ownership](../../../docs/editor-contributions.md) for the
contribution contracts, language descriptors, and explicit language choices.

## Atomic document updates

`editor.subscribe` receives one `EditorUpdate` after a document update finishes.
Committing an interactive edit or correcting an undo can require several
CodeMirror transactions.
Subscribers receive the completed update so saving and other views do not observe
an intermediate document.

Use `state` to read the final shared document and undo history. `changes` combines
the text changes, and `docChanged` reports whether any transaction changed text.
Code surfaces apply the combined changes once. The ordered `transactions` also
retain effects needed by specialized consumers; their intermediate states can
differ from the final shared state.

`EditorUpdate` is part of the editor contract used by Code surfaces, Save, and
autosave. It remains useful when KclManager and modelingMachine are replaced:
tools that change text during an interaction still need a completed update with
undo history. The [legacy modeling document adapter](../kcl/machine/document.ts)
interprets checkpoint effects in the transactions and forwards them to the
owning machine's editor. Those checkpoint rules belong to that adapter.

The fields use CodeMirror types, as does the rest of the current `Editor` API.
Exposing full transactions gives consumers more detail than most need. A narrower
effect interface could replace that field while preserving the contract that
subscribers receive one completed update.

An [interactive edit](../../GLOSSARY.md#interactive-edit) is one user operation,
such as dragging a sketch point, that can update the shared document several times
before it finishes. Each movement changes the text without adding a separate undo
entry. Committing supplies `committedInteractiveEdit` with the starting and final
text and records the operation as one undoable edit. The final text may already
be present, so the commit can consist entirely of history effects.

Cancellation restores the starting text and its earlier undo history. Ordinary
recorded edits end the pending interactive edit history, while editor configuration
changes remain installed. Closing the document releases the saved starting state.

Undo and redo work after the tool's native session closes. When replay needs an
additional text correction, `replayInteractiveEdit` applies it after CodeMirror's
own history transition, then publishes one update. This keeps earlier undo and
redo entries mapped to the correct document length and avoids exposing a temporary
rollback to save, cloud, or view observers.
