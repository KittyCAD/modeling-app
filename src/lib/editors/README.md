# Editor modes and view instances

An editor owns a working document and its undo history. A view instance owns one
presentation of that document: its selected mode, Code cursor, and viewport. The
project shell presents view instances as tabs. Opening a file again creates another
view of its existing buffer; `openEditor(src, contents)` remains available for
creating a deliberately independent document.

Closing one view leaves other views of its editor alive. Closing the last view
releases the document and its capabilities. Hiding or remounting the pane does not
close its views. Project shutdown releases all documents and presentations.

Modes are components contributed through `editorViewValueSpec`. Matching modes
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
per matching editor. Native CodeMirror extensions use `codeEditorExtensionValueSpec`
and are installed separately in each Code surface. Code selections remain available
to selection listeners without being mirrored into another surface. Shared edits
map other surfaces' selections through the changes and enter one document history.

Context setup and registered cleanup cannot manage editor or view ownership through
the editors service. Failed initialization releases acquired resources; bound modes
report `unbound`, `ready`, or `error` to the host.

See [classification and ownership](../../../docs/editor-contributions.md) for the
contribution contracts, language descriptors, and explicit language choices.
