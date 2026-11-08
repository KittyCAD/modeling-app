# Automerge editor capability

This optional extension binds one Automerge document to each editor and persists
its edit history under the project-shell feature flag. Multiple views share that
editor directly; they do not require a collaboration plugin or separate CRDT replicas.
Independent buffers still receive independent histories. No network adapter or
remote server is configured by this prototype.

`collaborationService.ready(editor)` exposes the document handle for future peer
integration. Collaboration actor identities remain owned by Automerge rather than
the editor/view contracts.

## Project-local history

Writable projects create this directory on demand through `fileOperations`:

```text
.zoo/
  .gitignore                 # ignores .zoo contents
  automerge/
    .gitignore
    index.json               # stable IDs, relative paths, last disk checkpoint
    <documentId>.automerge    # binary document including its change history
```

Changes are persisted after a short debounce, independently of plain-text saves.
`collaborationService.flush()` waits for queued history writes and reports failures.
The project session owns the repository lifetime; final writes retain their
captured root when switching projects. Read-only projects perform no history writes.
The project reader and file chooser omit `.zoo`.

Reopening a named buffer restores its draft if disk still matches its last known
checkpoint. If the source file changed externally, that text becomes a new CRDT
edit. A save handler updates the checkpoint after disk persistence succeeds.
Renaming a buffer preserves its document ID. Unnamed histories are retained in the
index, but this prototype does not yet provide a draft-recovery chooser.

Loading happens inside the capability; editor creation stays synchronous. Edits made while history loads are retained when the document binding becomes ready. Corrupt history is reported without replacing it. History-write errors
appear in the contributed tab indicator. Incoming reconciliation transactions are excluded from local document undo history. The binding follows the document, not any one Code surface.

## WebAssembly

Both web and Electron renderer Vite configurations enable `vite-plugin-wasm`
alongside their existing top-level-await plugin, including the worker pipeline. This supports transitive ESM WASM
imports from other bundled extensions as well as Automerge. Runtime-loaded third-party
plugins still need browser-ready bundles or an explicit host loading contract.
