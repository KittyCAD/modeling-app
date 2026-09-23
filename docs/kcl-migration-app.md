# Sponsored KCL migration: app implementation draft

Status: planning draft. No client implementation or user-facing behavior is
included yet. This document scopes the app work for
[text-to-cad#4257](https://github.com/KittyCAD/text-to-cad/issues/4257), alongside
[API #4696](https://github.com/KittyCAD/api/pull/4696) and
[TTC #4314](https://github.com/KittyCAD/text-to-cad/pull/4314).

## Intended user flow

1. Offer migration for an eligible KCL 2 project, with explicit consent for the
   `3.0-preview` target. The API remains the authority on eligibility; do not add
   a paid-tier restriction while that product decision is unresolved.
2. Capture an immutable, complete project snapshot, including unsaved editor
   buffers, imports, settings, and unchanged auxiliary files. Keep the original
   bytes locally throughout review and apply.
3. Start one sponsored operation. Show its server-reported status and deadline,
   and provide Cancel. The contract does not promise percentage progress.
4. On success, stage the candidate separately and show the file changes and
   validation summary. Failure, timeout, cancellation, or an unsupported project
   must leave the project unchanged.
5. Before Apply, compare the live project identity, file set, and bytes against
   the original snapshot. Any edit, addition, deletion, rename, or project switch
   invalidates the candidate for application. Offer a new capture and review.
6. On explicit acceptance, apply the candidate as one coordinated project
   operation, refresh editor and execution state, and expose project-level Undo.
   Undo must detect later edits rather than silently overwriting them.

## Contract and lifecycle

Use the authenticated public `/ws/ml/kcl-migration` endpoint. Its client messages
are `headers`, `start`, `status`, `cancel`, and `ping`; do not use the ordinary
Copilot edit stream or send internal TTC worker grants.

The start request contains a UUID `request_id`, complete `current_files`, a
project-relative `entrypoint`, `project_snapshot`, `target: "3.0-preview"`, and
`allow_preview: true`. Preserve the stable namespaced project identity (`local:`
or `cloud:`); allocate a new snapshot identity for each new captured project.
Retried delivery must reuse the same request ID and identical request bytes.

The API currently admits at most 256 files / 8 MiB and gives preparation,
conversion, and validation one shared 300-second deadline. Surface its admission
errors and deadline without extending the budget locally. Only a successful
operation with matching identity and validation evidence can enter review.

Own the connection, cancellation, and candidate in a project-scoped lifecycle.
Ignore messages belonging to a prior project, snapshot, or operation. On
reconnection, query `status` for the known operation instead of automatically
starting another attempt. Disconnect currently cancels running work; status
recovery does not imply resumable conversion. Clear ownership on project switch
and teardown, and settle cancellation even during connection setup.

Suggested lifecycle: `idle -> capturing -> running -> review -> applying -> applied`.
Failure and cancellation end the attempt; stale snapshots enter a conflict state.

## Integration points to inspect during implementation

| Area | Existing code | Work still required |
| --- | --- | --- |
| Snapshot collection | [`collectProjectFiles`](../src/machines/systemIO/utils.ts), [`snapshotContext`](../src/machines/systemIO/snapshotContext.ts) | Audit filtering, unreadable files, binary preservation, and all unsaved buffers. The ordinary prompt collector is not yet a migration snapshot contract. |
| Transport/authentication | [`Socket`](../src/lib/socket.ts), [`withAPIBaseURL`](../src/lib/withBaseURL.ts) | Add a dedicated migration client with typed public frames, cancellation, and status recovery. |
| Availability | [`userFeaturesMachine`](../src/machines/userFeaturesMachine.ts) | Integrate the published migration feature capability and keep the action unavailable when the backend is not ready. |
| Apply and rollback | [`FileOperations`](../src/lib/fileSystem/fileOperations.ts), [`systemIOMachine`](../src/machines/systemIO/systemIOMachine.ts) | Define project-wide compare-and-apply coordination, restore original bytes after partial failure, and synchronize editors/watchers. Existing per-path operations do not establish an atomic multi-file transaction. |
| Undo | [`editor/historyConfig`](../src/editor/historyConfig.ts) | Establish a project-level restore boundary; editor history alone does not restore a multi-file migration. |

## Implementation checklist

- [ ] Capture a complete byte-preserving snapshot with stable project ownership.
- [ ] Add the dedicated client and lifecycle using the generated public API types.
- [ ] Add preview consent, status/cancel, and candidate review UI.
- [ ] Reject stale candidates immediately before writing any project files.
- [ ] Implement coordinated apply, partial-write recovery, and guarded Undo.
- [ ] Cover unsaved/nested/binary files, path handling, and incomplete snapshots.
- [ ] Cover duplicate delivery, reconnect, cancel/timeout races, project switches,
      late results, invalid candidates, and disabled rollout.
- [ ] Exercise apply/rollback/undo end to end on browser and desktop storage,
      including concurrent local edits, watcher events, and cloud synchronization.

## Dependencies and release boundary

Development can proceed against the reviewed API contract while the backend PRs
are open. Before release, consume published TypeScript SDK bindings containing
the migration messages and feature capability; verify compatible deployed API
and TTC versions plus their supported KCL runtime. The app's SDK dependency is
separate from TTC's Python `zoo-common` binding publication.

The backend gates are `zookeeper_kcl_migration` (API) and
`KCL_MIGRATION_ENABLED` (TTC), both default off. The worker also needs its
service-owned execution credential, which the app must never receive. Keep
customer rollout disabled until the review/apply/undo flow, internal end-to-end
checks, representative migration evals, and eligibility policy are ready.

The current worker supports a conservative subset of KCL 2 to 3 preview
migrations. An unsupported result is an expected outcome. Present its reason
without offering automatic application or ordinary paid chat as a continuation
of the sponsored operation.
