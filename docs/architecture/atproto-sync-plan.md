# ATProto/ZDS Sync Plan Using @franknoirot.co Lexicons

## Summary

This document plans an AT Protocol backed ZDS project sync target and project
library type. It starts from the existing CAD lexicons published by
`@franknoirot.co`, then adds the minimum archive-first sync surface needed for
interoperability with the current ZDS projects API.

Status on 2026-08-22: the sync lexicon additions are complete under
`nyc.noirot.cad.*`. The publishing account is `@franknoirot.co`, but the
lexicon authority remains `cad.noirot.nyc`, resolved by the
`_lexicon.cad.noirot.nyc` DNS TXT record. No `co.franknoirot.*` migration is
needed for v1.

Implementation status on 2026-08-22: the branch now includes the local lexicon
catalog, pure ZDS/ATProto mappers, a tested ATProto project API adapter contract,
the provider-neutral `ConnectedIdentity` registry service, a Zoo auth identity
projection, and a minimal `atproto` project library type registration.

V1 sync is public and experimental. Private encrypted archives, archive
chunking, and file-record reconstruction are out of scope for the first pass.

## Current Lexicon Assessment

The existing `@franknoirot.co` lexicons are useful for CAD publishing and
inspection:

- `nyc.noirot.cad.project` is a mutable project metadata record with title,
  description, thumbnail, tags, manifest, Zoo reference, and timestamps.
- `nyc.noirot.cad.source` can represent one source file or artifact, including
  inline source text, an external URI, or a blob.
- `nyc.noirot.cad.release` is appropriate for immutable published versions.
- `nyc.noirot.cad.declaration` can serve as an account participation or
  discovery signal.
- `nyc.noirot.cad.defs` already includes reusable strong refs, file manifests,
  source-file descriptions, Zoo project refs, licenses, and geometry metadata.

Before the sync additions, they were not a clean ZDS bidirectional sync
contract:

- `project` uses `key: "tid"`, so the record key is not naturally the Zoo or ZDS
  project ID. The adapter must use the project AT URI as the remote ID.
- There was no first-class head archive pointer on the project record.
- There was no archive snapshot record carrying the exact whole-project archive
  fields ZDS needs.
- There was no exact `category_ids` equivalent; tags should not be overloaded
  for this because Zoo project categories are API metadata, not user tags.
- `entrypoint_path` and `project_toml_path` were missing, and they belong to a
  concrete archive snapshot rather than general project metadata.
- `source` can carry archive blobs, but depending on source records to rebuild a
  ZDS project would diverge from the current whole-archive sync engine.

The completed sync additions address the missing archive, head pointer,
category, and archive-path fields while keeping individual `source` records as a
publishing/inspection layer instead of the sync substrate.

## Lexicon Plan

### Existing Public Layer

Keep the current published CAD lexicons as the compatibility, publishing, and
sync baseline:

- `nyc.noirot.cad.project`: mutable public project metadata.
- `nyc.noirot.cad.source`: individual source/artifact sidecars.
- `nyc.noirot.cad.release`: immutable release metadata.
- `nyc.noirot.cad.declaration`: account participation/discovery.
- `nyc.noirot.cad.analysis`: derived analysis sidecars.
- `nyc.noirot.cad.defs`: shared definitions.
- `nyc.noirot.cad.archive`: immutable whole-project ZDS archive snapshots.
- `nyc.noirot.cad.authSync`: permission set for ZDS sync writes.

### New Sync Layer

Completed under the existing namespace:

- `nyc.noirot.cad.project` has optional sync fields for the current archive head,
  Zoo category IDs, and sync update time.
- `nyc.noirot.cad.defs` has shared strong-ref and archive manifest definitions.
- `nyc.noirot.cad.archive` is the immutable whole-project ZDS archive snapshot
  record.
- `nyc.noirot.cad.authSync` is the permission set for repo writes to the
  project, archive, declaration, and related CAD sync collections.

### Project Record Additions

Add optional fields only so existing records remain valid:

- `headArchive`: strong ref `{ uri, cid }` to the current archive snapshot.
- `categoryIds`: array of strings mapping exactly to
  `ProjectUploadBody.category_ids`.
- `syncUpdatedAt`: optional datetime updated when the current archive changes.

The project record remains mutable. Its record CID is the sync revision used for
guarded updates.

### Archive Record

The archive record is immutable and represents one complete project archive.
Required fields:

- `project`: strong ref to the owning project record.
- `archiveBlob`: blob reference for the zipped project archive.
- `archiveSha256`: lowercase hex SHA-256 digest of the archive bytes.
- `archiveByteSize`: byte size of the archive.
- `entrypointPath`: normalized path equivalent to `entrypoint_path`.
- `projectTomlPath`: normalized path equivalent to `project_toml_path`.
- `createdAt`: datetime.

Optional fields:

- `manifest`: file manifest using an array of entries rather than a dynamic map.
- `zdsSchemaVersion`: integer version for adapter behavior.
- `source`: optional string identifying the creating adapter or app version.

The archive record should not be updated in place. A project update creates a new
archive record, then compare-and-swap updates the project head to point at it.

### Manifest Shape

ZDS currently stores manifests as:

```ts
type ProjectManifest = {
  files: Record<string, { byteSize: number; sha256: string }>
}
```

Lexicon does not provide a typed arbitrary map shape for this use case, so the
ATProto manifest should use an array:

```ts
type ArchiveManifestEntry = {
  path: string
  byteSize: number
  sha256: string
}
```

The adapter converts between the Lexicon array and the local
`ProjectManifest.files` map.

## ZDS Interop Rules

The ATProto adapter should present the same behavior as the current Zoo project
API surface used by cloud sync.

- `RemoteProjectSummary.id` maps to the project AT URI:
  `at://<did>/<project-collection>/<rkey>`.
- `RemoteProjectSummary.title` maps to `project.title`.
- `RemoteProjectSummary.updated_at` maps to
  `project.syncUpdatedAt ?? project.updatedAt ?? project.createdAt`.
- `RemoteProjectSummary.revision` maps to the current project record CID.
- `ProjectUploadBody.title` maps to `project.title`.
- `ProjectUploadBody.description` maps to `project.description`.
- `ProjectUploadBody.category_ids` maps to `project.categoryIds`.
- `ProjectUploadBody.entrypoint_path` maps to `archive.entrypointPath`.
- `ProjectUploadBody.project_toml_path` maps to `archive.projectTomlPath`.
- `expected_revision` maps to `com.atproto.repo.putRecord.swapRecord` against
  the current project record CID.
- Download maps through `project.headArchive` to `archive.archiveBlob`.
- Project records without `headArchive` are catalog/publishing records, not
  sync-capable ZDS remote projects, unless the adapter can discover a compatible
  archive and explicitly upgrade the project.

The adapter should preserve the current archive-first invariant: ZDS sync reads
and writes whole project archives. Individual `source` records remain useful for
publishing, search, inspection, previews, and future deduplication, but they are
not the V1 sync substrate.

## ZDS Implementation Plan

### Branch Scope

This branch tracks the planning document and follow-up status. Implementation
has been split by concern across separate commits so the review can evaluate the
schema catalog, mapper layer, API adapter, identity layer, and library
registration independently.

### Lexicon Migration/Additions

Completed on 2026-08-22 using `goat lex`:

- [x] Keep the v1 sync vocabulary under `nyc.noirot.cad.*`.
- [x] Add `nyc.noirot.cad.defs` shared strong-ref and archive manifest
  definitions.
- [x] Add `nyc.noirot.cad.archive` as the archive-first ZDS sync record.
- [x] Update `nyc.noirot.cad.project` with optional `headArchive`,
  `categoryIds`, and `syncUpdatedAt`.
- [x] Add `nyc.noirot.cad.authSync` with repo write permissions for the project,
  archive, declaration, source, release, and analysis collections that ZDS
  intends to write.
- [x] Validate and publish schemas as `com.atproto.lexicon.schema` records from
  the `@franknoirot.co` DID.
- [x] Keep DNS authority at `_lexicon.cad.noirot.nyc`.
- [x] Commit the local schema catalog under `lexicons/nyc/noirot/cad/`.

The committed schema JSON files are the local catalog ZDS adapter fixtures
should validate against. The accidental nested `lexicons/lexicons/...` pull
output was removed before staging.

### Next Work Order

1. Add a real ATProto client implementation behind the tested
   `AtprotoCadSyncClient` interface.
2. Add the ATProto identity provider using OAuth and the `authSync` permission
   set.
3. Decide and implement remote delete semantics: delete record vs tombstone
   record hidden from listings.
4. Wire the `atproto` project library operations to the adapter once identity
   and client behavior are available.
5. Add Settings UI for connected accounts after Zoo and ATProto identities share
   the same service surface.

### Project API Adapter

Completed in `src/lib/atprotoSync`. The ATProto project API adapter matches the
current cloud sync remote API behavior rather than changing the sync engine
first:

- `listRemoteProjects`: enumerate sync-capable project records with
  `headArchive`.
- `getRemoteProject`: read one project record by AT URI.
- `downloadRemoteProjectArchive`: read `headArchive`, fetch `archiveBlob`, and
  return archive bytes.
- `createRemoteProject`: upload archive blob, create archive record, create
  project record.
- `updateRemoteProject`: upload archive blob, create archive record, then
  compare-and-swap update the project record using the expected project CID.
- `deleteRemoteProject`: delete or tombstone the project record and hide it from
  listings.

The adapter is responsible for mapping ATProto errors into the same categories
the cloud sync engine expects, especially stale revision failures, missing
project/archive failures, forbidden writes, and transient network errors.

Current status:

- [x] Pure mapper layer for `nyc.noirot.cad.project` and
  `nyc.noirot.cad.archive`.
- [x] Manifest conversion between Lexicon array shape and ZDS
  `ProjectManifest.files`.
- [x] Archive-first create, update, download, list, get, and delete adapter
  functions.
- [x] Guarded update tests using the project record CID as `expected_revision`.
- [ ] Live ATProto client implementation.
- [ ] Provider-neutral error mapping for live OAuth/PDS failures.

### Connected Identity

Completed for the registry service and Zoo auth projection. The next missing
piece is an ATProto OAuth provider that contributes identities into the same
service.

`ConnectedIdentity` should represent an authenticated account projection, not
the credential store itself:

- `id`: stable provider-scoped identity ID.
- `provider`: `zoo`, `atproto`, or future provider ID.
- `label`: user-facing account label.
- `handle`: optional handle such as `franknoirot.co`.
- `did`: optional ATProto DID.
- `capabilities`: provider-owned strings such as `projects:read`,
  `projects:write`, `lexicons:publish`.
- `status`: `connected`, `expired`, `revoked`, or `error`.

Implementation status:

- [x] Keep `authService` as the Zoo auth capability.
- [x] Add a `connectedIdentitiesService` for querying, connecting, disconnecting,
  and refreshing identities.
- [x] Add a value spec for providers to contribute identity providers and connection
  flows.
- [x] Publish the current Zoo auth session as a built-in `ConnectedIdentity`.
- [ ] Let the ATProto extension contribute OAuth connect/disconnect flows and
  identity state.
- [ ] Surface identity management in Settings as "Connected accounts".

### ATProto Project Library Type

The minimal `atproto` project library type is registered. It intentionally has
no project operations yet because live identity/client wiring is still missing.

- Library settings bind to a connected ATProto identity and optional repo DID.
- Remote projects materialize through the same archive flow as cloud-backed
  projects.
- Provider credentials stay in identity storage, not `project.toml`.
- Local project metadata stores an adapter remote ID and revision. For V1, the
  remote ID is the project AT URI.

Current status:

- [x] Register `type: "atproto"` through the project library registry.
- [x] Provide a default `atproto://franknoirot.co` library setting template.
- [x] Keep operations unavailable until live identity-backed adapter wiring
  exists.
- [ ] Add `readRealizations`, create/open/materialize, update, rename, and
  delete operations.

## Tests And Acceptance Criteria

### Lexicon

- [x] New or changed `nyc.noirot.cad.*` schemas validate with the lexicon CLI.
- [x] Existing `nyc.noirot.cad.*` records remain valid after optional-field
  additions.
- [x] A project record without `headArchive` validates but is ignored by ZDS sync
  listings.

### Adapter Fixtures

- [x] A fixture converts `ProjectUploadBody + ProjectArchiveFile[]` into
  `project + archive` records and back to `RemoteProjectSummary`,
  `ProjectUploadBody`, and `ProjectArchiveFile[]`.
- [x] Manifest conversion round-trips between the ATProto manifest entry array and
  `ProjectManifest.files`.
- [x] Downloading a project through `headArchive` returns the same archive bytes
  that were uploaded.

### Concurrency And Failure Modes

- [x] Guarded update succeeds when `expected_revision` matches the project record
  CID.
- [x] Guarded update fails when `expected_revision` is stale.
- [ ] Missing archive record produces a recoverable sync failure, not local data
  loss.
- [ ] Missing archive blob produces a recoverable sync failure, not local data loss.
- [ ] Forbidden write maps to the existing remote-upload-forbidden failure kind or a
  provider-neutral equivalent.

### Identity And Library

- [x] Zoo auth appears as a `ConnectedIdentity` without changing current Zoo auth
  consumers.
- [ ] ATProto OAuth success contributes an ATProto `ConnectedIdentity`.
- [ ] Settings shows Zoo and ATProto connected accounts in one management surface.
- [ ] The ATProto library type lists only sync-capable remote projects and
  materializes a selected archive into a valid local ZDS project.

## Open Follow-Ups

- Decide whether the project record should be deleted or tombstoned when ZDS
  deletes a remote project. The adapter must hide deleted/tombstoned projects
  either way.
- Define the maximum supported archive size for V1 based on the target PDS blob
  limits. Chunking is explicitly deferred.
- Decide whether `source` sidecar records should be emitted opportunistically
  for search and inspection after archive upload.

## References

- Current published lexicons: https://lexicon.garden/identity/franknoirot.co
- ATProto Lexicon spec: https://atproto.com/specs/lexicon
- ATProto NSID spec: https://atproto.com/specs/nsid
- ATProto Record Key spec: https://atproto.com/specs/record-key
- ATProto Blob spec: https://atproto.com/specs/blob
- ATProto Sync spec: https://atproto.com/specs/sync
- ATProto Permissions spec: https://atproto.com/specs/permission
- Current ZDS cloud sync types: `src/lib/cloudSync/types.ts`
- Current ZDS cloud project API adapter: `src/lib/cloudSync/cloudApi.ts`
- Current ZDS archive preparation: `src/lib/cloudSync/projectArchive.ts`
- Current ZDS cloud sync registry contract:
  `src/lib/cloudSync/registry/contract.ts`
- Current ZDS auth registry contract: `src/registry/contracts/auth.ts`
- Current ZDS project library contract:
  `src/registry/contracts/projectLibraries.ts`
