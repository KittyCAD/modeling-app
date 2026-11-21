# Editor saves

The wildcard editor capability tracks each document against the text last loaded
or successfully saved. It contributes the tab's unsaved dot independently of the
selected mode. The save extension contributes Cmd/Ctrl+S through the registry keymap with the
`editor-focused` context. That context applies to any mounted editor view while
preserving independent Code and editable-control contexts. The Save editor
command uses the focused document, or the most recently focused editor when
invoked from the command palette. F2 is a global contributed Rename editor
binding. Both shortcuts honor user remapping and unbinding; double-click rename
remains a tab interaction.

`editorOnSaveFacet` supplies ordered save handlers. The default
`persistToFiles` contribution writes the captured source and contents through
`fileOperations`, which routes local and cloud paths to their backing. It does
not determine save timing. Failed writes leave the buffer dirty, and typing during
a save remains dirty after the submitted snapshot is acknowledged.

`autosave` contributes a wildcard document capability with one debounce timer per
buffer, using `EDITOR_SAVE_DEBOUNCE_MS` (1.5 seconds). It is on by default for
local projects and can be disabled through the user Autosave setting. The setting
and behavior require the new project shell feature flag.
`editorAutosavePoliciesFacet` allows a host to require autosave independently
of that preference; cloud project sessions do so. Any matching required policy
keeps autosave enabled. `editorReadOnlyPoliciesFacet` accepts independent
editing restrictions from hosts or extensions, including offline state. Editing
resumes only after every matching restriction is lifted. Read-only documents
pause their timers and resume saving pending changes when editing becomes
available.

Cloud snapshot adoption uses `editorSaveService.adopt` to advance the baseline
alongside a document update. Background adoption requires clean editors; a
revision conflict instead adopts remote contents using the cloud runtime's policy.
Adoption supersedes older save requests for the same source across all buffers.
Queued snapshots are discarded before writing; an in-flight handler may finish,
but its result cannot run later handlers or overwrite an adopted baseline. New
save requests can persist edits made after adoption.

Saving an unnamed buffer prompts for a project-relative file path in its tab.
Enter submits; Escape or leaving the input cancels without discarding the buffer.
Empty, absolute, and escaping paths are rejected. The ZDS save extension supplies
`.kcl` as the default extension for unnamed buffers: `bracket` first saves as
`bracket.kcl`, while explicit extensions and existing-file renames are preserved.
First saves use strict creation,
so existing files are never overwritten; failures leave the input available for
correction. Autosave never opens a naming prompt. New buffers follow the highest
priority matching mode after naming, so a first save as `.md` opens the registered
Markdown preview. Explicit mode choices remain in place across later renames.

After creation or rename succeeds, the project session amends its current
in-memory file tree with that confirmed operation. Open Editor immediately offers
the new path and drops the old name without rereading the backing. Unrelated
entries and metadata are retained, and operations from closed or replaced
openings are ignored. The editor source and tree membership are published together.

Double-clicking a tab or pressing F2 on a focused tab opens the same path input for renaming. Renames wait for
previously requested writes, reject existing destinations, and update every buffer
for the original source while preserving document text, history, and views.
Requests capture their project opening and stop adopting results when that opening
or the editor closes. Storage operations already started may still finish against
their captured path.

Save As, durable draft recovery, and confirmation before closing dirty buffers
are separate work.
