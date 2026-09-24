# Sponsored KCL project migration

Implements the app flow for [text-to-cad#4257](https://github.com/KittyCAD/text-to-cad/issues/4257), alongside [API #4696](https://github.com/KittyCAD/api/pull/4696) and [TTC #4314](https://github.com/KittyCAD/text-to-cad/pull/4314).

## User flow

The API's `zookeeper_kcl_migration` feature flag exposes **Migrate to KCL 3** in the project header only when the entrypoint explicitly declares KCL 2.0, including unsaved edits. Existing migration results and Undo stay accessible after applying KCL 3. The user consents to KCL 3 preview and starts a free migration with a server-enforced 20-minute deadline. Confirmed pre-conversion failures show that the attempt did not count toward the daily limit. API owns eligibility, quotas and billing; this PR adds no paid-tier restriction.

The app captures the complete project, including unsaved KCL buffers and unchanged binary/support files (excluding Git and internal filesystem metadata). It checks the explicit KCL 2 entrypoint and client support for `3.0-preview`. Unsupported paths, symbolic links, unreadable files, or projects over 256 files / 8 MiB fail before submission.

Conversion uses authenticated `/ws/ml/kcl-migration`. The dialog shows status, deadline and cancellation. Disconnect recovery queries the existing operation; it never silently starts another attempt. API cancellation on disconnect means conversion itself does not resume.

Only a successful response with matching project/snapshot/operation identity and complete validation evidence enters review. Users inspect file diffs and the validation summary, then explicitly apply. Original and candidate ZIP downloads are available.

## Application and recovery

Immediately before writing, the app compares the project identity, complete file set, disk bytes and editor buffers with the captured source. A changed project requires a fresh capture. Apply pauses cloud sync and holds the existing filesystem's project-directory lock through all writes and rollback. Editors are synchronized before releasing the lock, preventing queued saves of old text from replacing the migration.

If a write fails, completed writes are restored where their bytes still match the attempted replacement. An unexpected external edit is preserved and reported, with original/candidate downloads retained for recovery. A failure to refresh the view after successful writes does not discard Undo.

**Undo Migration** restores the captured project only if its current contents still match the applied candidate. Review, backup and Undo state belong to the open project session; download the original before closing/reloading if a persistent backup is needed. This is coordinated application with recovery, not an operating-system transaction that survives a process crash. Other applications do not participate in the app's file lock.

## Integration and release

- `src/lib/kclMigration/`: public protocol, snapshot checks, connection, lifecycle and guarded writes. React renders this state through the header registry contribution.
- Shared changes are limited to a directory-lock callback, no-follow file inspection, and a cloud-sync pause using the existing sync mutex.
- The public wire types are generated from API #4696 with `scripts/generate-kcl-migration-types.mjs`. Replace this temporary generated subset with published SDK exports when available.
- Keep the API rollout flag off until compatible backends are deployed and a real backend-to-app smoke test passes. The app never receives internal worker grants or service credentials.

Tests cover transport and cancellation races, snapshot integrity, stale application/Undo, rollback, and browser/desktop editor/storage integration. The UI end-to-end test uses controlled API responses; it does not establish converter quality or replace the real backend rollout check.
