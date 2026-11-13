# Editor saves

The wildcard editor capability tracks each document against the text last loaded
or successfully saved. It contributes the tab's unsaved dot independently of the
selected mode. Code surfaces install Cmd/Ctrl+S; the host also handles the shortcut
when another editor mode has focus. The Save editor command uses that focused
document.

`editorOnSaveValueSpec` supplies ordered save handlers. The default
`persistToFiles` contribution writes the captured source and contents through
`fileOperations`, which routes local and cloud paths to their backing. It does
not determine save timing. Failed writes leave the buffer dirty, and typing during
a save remains dirty after the submitted snapshot is acknowledged.

`autosave` contributes a wildcard document capability with one debounce timer per
buffer, using `EDITOR_SAVE_DEBOUNCE_MS` (1.5 seconds). It is on by default for
local projects and can be disabled through the user Autosave setting. The setting
and behavior require the new project shell feature flag.
`editorAutosavePoliciesValueSpec` allows a host to require autosave independently
of that preference; cloud project sessions do so. Read-only documents pause their
timers and resume saving pending changes when editing becomes available.

Cloud snapshot adoption uses `editorSaveService.adopt` to advance the baseline
alongside a document update. Background adoption requires clean editors; a
revision conflict instead adopts remote contents using the cloud runtime's policy.
An in-flight save cannot overwrite a baseline supplied by that adoption.

An unnamed buffer needs a source before Save or autosave can persist it. Save As,
durable draft recovery, and confirmation before closing dirty buffers are
separate work.
