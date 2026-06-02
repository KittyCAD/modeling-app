# OPFS Cloud Backing

`opfsCloud.ts` is a local-first `fs-zds` backing. User-visible file system operations go through OPFS first, while cloud replication runs in the background through a durable metadata store and outbox.

## Data Syncing Flow

```mermaid
flowchart TD
  Call["fs-zds call"] --> Operation{"Operation type"}

  Operation -->|"readFile / readdir / stat"| LocalRead["Read OPFS through localFs"]
  LocalRead --> ReturnRead["Return local result immediately"]
  ReturnRead --> MaybeScheduleRead{"Cloud enabled and path is syncable?"}
  MaybeScheduleRead -->|"Yes"| ScheduleRead["Schedule background sync"]
  MaybeScheduleRead -->|"No"| DoneRead["Done"]

  Operation -->|"writeFile / mkdir / cp"| LocalMutation["Apply OPFS mutation first"]
  LocalMutation --> UpsertMutation["Register project upsert"]
  UpsertMutation --> PersistOutbox["Persist project metadata and outbox entry"]
  PersistOutbox --> ScheduleWrite["Schedule background sync"]
  ScheduleWrite --> ReturnWrite["Return local success"]

  Operation -->|"rm"| LocalRemove["Remove from OPFS first"]
  LocalRemove --> RootDelete{"Removed project root?"}
  RootDelete -->|"Yes"| Tombstone["Persist tombstone and delete outbox entry"]
  RootDelete -->|"No"| UpsertMutation
  Tombstone --> ScheduleWrite

  Operation -->|"rename"| LocalRename["Rename in OPFS first"]
  LocalRename --> RenameProject{"Renamed project root?"}
  RenameProject -->|"Yes"| MoveMetadata["Move metadata to new project path"]
  RenameProject -->|"No"| UpsertMutation
  MoveMetadata --> UpsertMutation

  ScheduleRead --> Sync["runCloudSync"]
  PersistOutbox --> Sync
  Tombstone --> Sync

  Sync --> InitialScan["Enqueue existing local projects once per identity"]
  InitialScan --> RemoteIndex["Refresh remote project index"]
  RemoteIndex --> UnknownRemote{"Remote project known locally?"}
  UnknownRemote -->|"No"| CloneRemote["Download archive and clone to unique OPFS path"]
  UnknownRemote -->|"Yes"| CheckRemoteRevision{"Remote revision newer than base?"}
  CheckRemoteRevision -->|"No"| SyncOutbox["Sync queued local project mutations"]
  CheckRemoteRevision -->|"Yes"| SyncProject["Reconcile project"]
  CloneRemote --> MarkRemoteSynced["Persist base manifest and remote revision"]
  MarkRemoteSynced --> SyncOutbox

  SyncOutbox --> LatestMutation{"Latest queued mutation"}
  LatestMutation -->|"delete / tombstone"| DeleteRemote["Delete remote project if it exists"]
  DeleteRemote --> ClearDeleted["Clear outbox and metadata"]

  LatestMutation -->|"upsert or remote pull"| CollectLocal["Collect local files and local manifest"]
  CollectLocal --> HasRemote{"Has remote project id?"}
  HasRemote -->|"No"| CreateRemote["Create remote project archive"]
  CreateRemote --> MarkSynced["Store remote id, revision, and base manifest"]

  HasRemote -->|"Yes"| FetchRemote["Fetch remote project metadata"]
  FetchRemote --> Compare{"Compare base, local, and remote"}
  Compare -->|"Local changed, remote unchanged"| PushGuarded["Upload archive with expected_revision"]
  Compare -->|"Local clean, remote changed"| PullRemote["Download archive and replace local project"]
  Compare -->|"Both unchanged or manifests equal"| ClearClean["Clear outbox"]
  Compare -->|"Both changed"| Conflict["Keep local primary and write remote conflict copy"]

  PushGuarded --> MarkSynced
  PullRemote --> MarkSynced
  ClearClean --> MarkSynced
  Conflict --> Blocked["Persist conflict metadata and block sync"]
```

## Persistent State

Cloud sync state is stored outside React state so it can survive page reloads and tab closes.

- `ProjectMetadata.remoteProjectId` binds a local project directory to a cloud project.
- `ProjectMetadata.remoteRevision` stores the last cloud-acknowledged remote revision for the local base.
- `ProjectMetadata.remoteUpdatedAt` stores the cloud project's last updated timestamp for Home sorting while the local cache is clean.
- `ProjectMetadata.baseManifest` stores the last cloud-acknowledged local file manifest.
- `ProjectMetadata.tombstone` records an explicit local project delete.
- `ProjectMetadata.conflict` records a blocked sync and the local path of the remote conflict copy.
- `ProjectMetadata.lastFailure` records the latest sync error without clearing dirty state.
- The outbox records durable `upsert` and `delete` work by project path.

## Versioning Considerations

The backing treats `remoteRevision` plus `baseManifest` as the sync base. The base is updated only after a successful cloud create, guarded cloud update, clean remote pull, or equality check.

Local dirtiness is detected by comparing the current OPFS manifest with `baseManifest`. Remote dirtiness is detected by comparing the cloud project revision with `remoteRevision`. The cloud API's `revision` field is preferred; `updated_at` is only a fallback for older responses.

The OPFS directory modified time represents local cache writes. For cloud-backed projects, Home uses `remoteUpdatedAt` as the modified sort key only when the durable outbox has no pending local changes for that project. Pending local writes keep using the OPFS directory modified time so local edits sort immediately.

Remote updates use optimistic concurrency by sending `expected_revision`. The upload is only valid if the server is still at the revision recorded in `ProjectMetadata.remoteRevision`. If the server revision changed, the API must reject the update so this backing does not overwrite newer remote data.

Remote creates do not have an expected revision because there is no remote base yet. After create succeeds, the returned remote id and revision become the local sync base.

Remote deletes are intentionally not revision-guarded. A project-root `rm` records an explicit tombstone, then the sync worker deletes the remote project if it exists and ignores missing remote projects. Missing local directories are not treated as destructive cloud deletes unless there is a tombstone or queued delete.

Remote hydration is only allowed to replace OPFS when the local project is clean relative to `baseManifest`, or when an unknown remote project is being cloned into a new local path. If both local and remote changed since the base, the local project remains primary and the remote archive is written to a conflict project.

This implementation is whole-project archive based. It does not attempt file-level merging because the cloud API does not expose file-level revisions. A remote revision must therefore change on every successful project archive update; otherwise a remote change can be missed.

When a cloud title changes, the title is written into `project.toml` only when that can be done without overwriting local edits. The local project directory name is treated as an implementation detail and may differ from the cloud title when uniqueness requires it.
