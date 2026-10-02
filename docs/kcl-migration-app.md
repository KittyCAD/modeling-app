# Sponsored KCL project migration

Implements the app flow for [text-to-cad#4257](https://github.com/KittyCAD/text-to-cad/issues/4257), alongside [API #4696](https://github.com/KittyCAD/api/pull/4696) and [TTC #4314](https://github.com/KittyCAD/text-to-cad/pull/4314).

## User flow

The API's `zookeeper_kcl_migration` feature flag exposes **Migrate to KCL 3** in the Zookeeper pane only when the entrypoint explicitly declares KCL 2.0, including unsaved edits. Migration appears as a turn in the conversation, with later chat messages beneath it. The user consents to KCL 3 preview and starts a free migration with a server-enforced 20-minute deadline. Confirmed pre-conversion failures show that the attempt did not count toward the daily limit. API owns eligibility, quotas and billing; this PR adds no paid-tier restriction.

The app captures the complete project, including unsaved KCL buffers and unchanged binary/support files (excluding Git, internal filesystem metadata and the generated root `thumbnail.png`). It checks the explicit KCL 2 entrypoint and client support for `3.0-preview`. Unsupported paths, symbolic links, unreadable files, or projects over 256 files / 8 MiB fail before submission.

Conversion uses authenticated `/ws/ml/kcl-migration`. The migration turn shows live Zookeeper progress under **See reasoning** and the final outcome. Cancellation uses the normal red X in the chat composer. The existing conversation stays intact, and chat input is paused while migration is running or applying. Live progress requires API #4805 and TTC #4384; progress never applies candidate edits. After applying, ordinary chat continues using the updated project files; API #4812 supplies bounded earlier dialogue and migration outcomes to TTC #4385. These are background design intent, not a provider response-ID continuation. The current snapshot remains authoritative. Disconnect recovery queries the existing operation; it never silently starts another attempt. API cancellation on disconnect means conversion itself does not resume.

After the user starts a migration, a successful response with matching project/snapshot/operation identity and complete validation evidence applies automatically. There is no separate review/apply step. A changed project, cancellation, failed validation or mismatched result prevents application.

## Application and recovery

Immediately before writing, the app compares the project identity, complete file set, disk bytes and editor buffers with the captured source. A changed project requires a fresh capture. Apply pauses cloud sync and holds the existing filesystem's project-directory lock through all writes and rollback. Editors are synchronized before releasing the lock, preventing queued saves of old text from replacing the migration.

If a write fails, completed writes are restored where their bytes still match the attempted replacement. An unexpected external edit is preserved and reported. A failure to refresh the view after successful writes does not discard Undo.

Applying records one multi-file edit in the existing Zookeeper project history. The normal Undo/Redo buttons and keyboard shortcuts restore/reapply it in order with manual edits. Regenerating the project thumbnail does not invalidate Undo. New attempts reference the existing owned chat. Reloading restores read-only migration summaries in that conversation, positioned after the preceding ordinary prompt where available. History never applies candidate files or restores provider checkpoints. Live reasoning and file Undo history remain session-local. Clearing chat starts a new conversation without undoing applied files.

Successful local Apply, Undo and Redo send ordered, revision-fenced acknowledgements to API on separate short-lived connections. Failed acknowledgements leave files intact and offer a retry of the same revision before later changes are reported. History labels these as the last reported state, not proof of current file contents; an unacknowledged conversion is shown as application unconfirmed. Pending acknowledgements are session-local, so closing the app before confirmation can leave that state unconfirmed. This is coordinated application with recovery, not an operating-system transaction that survives a process crash. Other applications do not participate in the app's file lock.

## Integration and release

- `src/lib/kclMigration/`: public protocol, snapshot checks, connection, lifecycle and guarded writes. React renders this state in the Zookeeper pane. A registry service owns migration turns for the open project session, so conversion and automatic application continue when the pane closes. File history uses the existing Zookeeper undo machinery.
- Shared changes are limited to a directory-lock callback, no-follow file inspection, and a cloud-sync pause using the existing sync mutex.
- The public wire types are generated from API #4812 (stacked on #4805) with `scripts/generate-kcl-migration-types.mjs`. Replace this temporary generated subset with published SDK exports when available.
- Deploy API #4805, then API #4812 and TTC #4385 before this conversation integration. The base UI is a separate PR.
- Keep the API rollout flag off until compatible backends are deployed and a real backend-to-app smoke test passes. The app never receives internal worker grants or service credentials.

Tests cover transport and cancellation races, snapshot integrity, stale application, multi-file Undo/Redo ordering, rollback, and browser/desktop editor/storage integration. The UI end-to-end test uses controlled API responses; it does not establish converter quality or replace the real backend rollout check.
