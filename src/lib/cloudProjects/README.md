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
- `storage.ts` binds a cloud path to a `ProjectStorage` handle. Editors consume
  write availability, save state, watch events, and refresh through that handle;
  they do not derive storage policy from a cloud ID or path prefix.
- `registry/session.ts` owns connectivity listeners and reconciliation delivery.
  The project session owns applying an authoritative snapshot to editor buffers,
  the project tree, and Rust, including guards against superseded work.
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

Cloud identity remains explicit where it is part of a user workflow or external
protocol, such as library entries, routes, publishing, and Zookeeper tool results.
Those boundaries can request operations on cloud projects without spreading
cloud persistence policy into the editor or filesystem coordinator.
