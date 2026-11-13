# Cloud projects

This subsystem owns account-backed projects: remote identity, revision-checked
persistence, thumbnails, polling, reconnection, and cloud library workflows.
`runtime/` owns the project snapshots, account and revision state, save queues,
cloud API access, and recovery lifecycle. It uses `fs-zds/memory` for file bytes.

## Boundaries

- `service.ts` creates the cloud project runtime, coordinated file adapter, and
  thumbnail cache. It exposes a filesystem mount rather than constructing the
  application's local filesystem runtime.
- `registry/extension.ts` wires authentication and contributes the mount and cloud
  service. `registry/library.ts` contributes the Cloud library and its operations,
  including project storage addresses and thumbnail watchers for Home entries.
  Its refresh operation owns cloud connectivity and listing policy; Home invokes
  the selected library's refresh capability for both cloud and directory storage.
- `storage.ts` binds a cloud path to a `ProjectStorage` handle. Editors consume
  write availability, save state, watch events, and refresh through that handle;
  they do not derive storage policy from a cloud ID or path prefix.
- `registry/session.ts` owns connectivity listeners and reconciliation delivery.
  The project session owns applying an authoritative snapshot to editor buffers,
  the project tree, and Rust, including guards against superseded work. It also
  owns save retry and editor readback; the save badge only displays status and
  invokes the session action.
- `polling.ts` and `registry/polling.ts` own remote revision checks for the current
  project opening. Descriptive tree refreshes do not restart the poller; closing
  or replacing the opening disposes it. Dirty buffers postpone adoption.
- `cloneOpenedProjectToCloudLibrary.ts` owns the explicit workflow of cloning an
  existing project into Cloud for publication. Publication itself lives in
  `lib/publishing`.

The generic file-operations service routes paths to contributed mounts and asks
those mounts to batch edits when required. Each provider owns its runtime's
lifetime. Project sessions release their watch subscriptions; the cloud registry
items release their listeners, pollers, and runtime on disposal.
The project-session storage watcher owns backing-change refreshes independently
of React, and ignores callbacks from replaced or disposed project openings.

Cloud identity remains explicit where it is part of a user workflow or external
protocol, such as library entries, routes, publishing, and Zookeeper tool results.
Those boundaries can request operations on cloud projects without spreading
cloud persistence policy into the editor or filesystem coordinator.

## Autosave and concurrent writes

The new project shell forces autosave for cloud projects, using the same 1.5-second
inactivity timeout as KclManager. Local projects also autosave by default; users
with the project shell feature flag can disable Autosave in settings for manual
saving. Named documents share one autosave timer across their views and modes.

Cloud writes include the acknowledged revision. If the server rejects a write
with HTTP 409, the runtime downloads and adopts the remote project, replacing
local working files and open buffers. This follows the existing editor's policy:
concurrent edits are not merged or preserved in a recovery dialog. The Save
baseline follows the adopted snapshot, rather than the discarded submission.
Background polling still leaves dirty or saving buffers alone.

While offline, cloud documents are read-only in every mode. Both CodeMirror and
the backing document enforce that policy, including undo and redo. Pending edits
remain in memory, and autosave resumes after reconnecting. Failed cloud writes
are retried on reconnect; other failures remain visible in the project status.
A future CRDT extension can provide offline editing and reconciliation instead.

## New project shell

With `zds_project_shell_refactor` enabled, Shift-click a Personal Cloud card to
open `/project/:id`. The ID is the API project ID; the loader waits for auth,
opens the cloud storage mount, reads the project, and opens its initial editor
through the same helper as `/local/:path`. Failed or cancelled discovery leaves
the previous session selected. No local copy or default file is created.

`next/session.ts` binds polling to the captured session's abort signal. Accepted
snapshots update the file tree, editor contents, and Save baselines together.
Returning Home releases that opening's editors and poller.

### Smoke test

1. Open a disposable cloud project with Shift-click from Home. Edit Code and wait
   about 1.5 seconds. The unsaved dot should clear without Cmd/Ctrl+S; reloading
   should restore the saved text.
2. Disconnect the network. Code should become read-only and a compact status
   should explain why. Reconnect; pending edits should save and editing resume.
3. To exercise a concurrent write, edit the same project in two windows nearly
   simultaneously. A write against an outdated revision adopts the cloud version
   without a dialog. Use disposable work: the competing local edit is discarded.

`e2e/playwright/cloud-project-shell.spec.ts` exercises autosave, offline editing
restrictions, and remote adoption against an intercepted cloud API.
