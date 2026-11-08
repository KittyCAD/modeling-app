# Editor modes

An editor owns one live buffer and CodeMirror state. Its tab selects a contributed
`editorViewValueSpec` mode; every mode shares that buffer's contents and identity.
The project shell uses one main editor pane, with Code as its wildcard fallback.

Matching modes are ordered by descending `priority`, with registration order
breaking ties. An explicit selection takes precedence while it still matches.
Code has priority `-100`, allowing domain-specific modes to open by default.

Plain modes use `defineEditorView({ id, label, matches, Component })`. Modes with
additional context use `defineEditorView(provider)({ id, label, matches, Component })`.
The component receives the provider's inferred context type through `context`.
Providers receive the editor and `onDispose`, which registers resource cleanup.

A provider runs when its mode is first selected. Its context survives mode
switches and React remounts. Closing the editor, removing the contribution, or
no longer matching releases that context. Content-driven binding is deferred
until the current CodeMirror update finishes. Providers can supply execution,
collaboration, or other context without the editors extension depending on them.

Cleanup runs once in reverse registration order, including failed initialization.
Synchronous setup and cleanup cannot manage buffers through the editors service;
commands and UI own those actions. Deferred plugin code is not sandboxed.
The registry rolls back a partially constructed CodeMirror view if a capability
factory fails. Bound modes report `unbound`, `ready`, or `error` explicitly; the
pane supplies only editor/visibility props, while the binding supplies context.

See [classification and ownership](../../../docs/editor-contributions.md) for
language descriptors, explicit language choices, and the provider boundary.
