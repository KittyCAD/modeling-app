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
projection, an SDK-backed ATProto browser OAuth connector, derived plugin
activation from non-boolean settings, a gated `atproto-sync` project library
plugin, and a live XRPC-backed ATProto sync client behind the tested adapter
interface. The OAuth session now produces the API config used by ATProto project
library operations, and the library can list, create, open/materialize, rename,
and delete ATProto-backed projects. The cloud sync engine now has provider hooks
for remote project APIs and `project.toml` bindings, with Zoo as the default and
ATProto adapters available. The `atproto-sync` plugin activates only when
`auth.atproto` contains a sync-capable connected identity.

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

1. Finalize production OAuth client metadata hosting and callback behavior. The
   browser connector works through `@atproto/oauth-client-browser`, but the
   production `client_id` and metadata document still need a product decision.
2. Add the unified Settings "Connected accounts" surface for Zoo and ATProto
   identities.
3. Surface ATProto sync conflicts and recovery actions in UI. The runtime now
   detects remote divergence before upload, but conflict state is still reported
   through errors rather than a user-managed resolution flow.
4. Broaden provider-neutral error mapping for live OAuth/PDS failures.

### Sync Engine Generalization

The existing cloud sync engine remains named `cloudSync`, and its core
remote-project dependency is provider-configurable. Zoo cloud is the default
provider, preserving existing behavior. Other providers can supply:

- `CloudSyncRemoteProjectApi`: list/get/create/update/download/delete remote
  projects plus provider error classifiers for not-found, forbidden upload, and
  retry-after handling.
- `CloudSyncProjectBinding`: the `project.toml` binding strategy for remote
  project IDs and the project library types this engine should treat as
  syncable.

The ATProto side now provides:

- `createAtprotoCloudSyncRemoteApi`, adapting `nyc.noirot.cad.project +
  archive` operations to the sync engine's remote API shape.
- `atprotoCloudSyncProjectBinding`, using `[atproto].project_id` instead of
  `[cloud.<environment>].project_id`.
- Archive upload cleanup that strips local `[atproto]` materialization metadata
  before writing a remote snapshot.
- An isolated `atproto-sync` runtime instance owned by the ATProto plugin. It
  subscribes to shared filesystem mutation events, watches only ATProto
  materialization directories, and uploads changed local archives through the
  ATProto remote adapter.

Current status:

- [x] Route the sync engine's remote list/get/create/update/download/delete
  calls through a configured provider API, with Zoo as the default.
- [x] Route project binding reads/writes and downloaded archive metadata through
  a configured binding strategy, with Zoo as the default.
- [x] Reset provider hooks when runtime config omits them so a prior provider
  cannot leak into the default Zoo path.
- [x] Add ATProto remote API and binding adapters.
- [x] Test remote-only rename through a configured non-Zoo provider path.
- [x] Use multiple isolated provider runtime instances rather than one active
  global provider.
- [x] Wire the `atproto-sync` plugin to start the isolated ATProto runtime after
  OAuth-gated plugin activation.
- [x] Add durable ATProto base revision/manifest state so local edit uploads do
  not overwrite remote changes made after the local materialization base.
- [ ] Surface ATProto conflict state and local/remote resolution actions in UI.

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
- [x] Live XRPC client implementation for list/get/put/delete records,
  uploadBlob, and sync.getBlob.
- [x] XRPC tests for pagination, auth headers, blob CID extraction, Retry-After,
  and `InvalidSwap` to stale-revision mapping.
- [ ] Provider-neutral error mapping for live OAuth/PDS failures beyond stale
  revision and generic XRPC metadata.

### Connected Identity

Completed for the registry service, Zoo auth projection, ATProto
settings-backed provider surface, and the concrete browser SDK OAuth connector
behind that provider.

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
- [x] Let the ATProto extension contribute OAuth connect/disconnect flows and
  identity state through an injected connector.
- [x] Add `auth.atproto` as a settings-backed identity snapshot with a
  Connect/Disconnect settings component.
- [x] Plug in `@atproto/oauth-client-browser` for popup sign-in, session restore,
  and revocation.
- [ ] Surface identity management in Settings as "Connected accounts".

### ATProto Project Library Type

The minimal `atproto` project library type is registered behind the gated
`atproto-sync` plugin. The plugin activates from the `auth.atproto` identity
setting when the connected identity has the sync permission set and blob-upload
scope. It binds operations to the current OAuth identity by asking the ATProto
connector for an OAuth-backed project API config. The browser SDK session fetch
handler is the bridge that signs XRPC requests for the adapter.

- Library settings bind to a connected ATProto identity and optional repo DID.
- Remote projects materialize through the same archive flow as cloud-backed
  projects.
- Provider credentials stay in identity storage, not `project.toml`.
- Local `project.toml` stores the remote ID as the project AT URI in
  `[atproto].project_id`.
- Local `._atproto_sync` metadata stores the trusted base revision and upload
  manifest. The file is excluded from archive uploads.
- Uploads strip local ATProto metadata from the archive before writing the
  remote snapshot, so local materialization markers do not become portable
  project data.
- V1 delete semantics directly delete the remote project record. Tombstone
  records can be revisited if discovery or audit requirements need them.

Current status:

- [x] Register `type: "atproto"` through the project library registry.
- [x] Provide a default `atproto://franknoirot.co` library setting template.
- [x] Gate the `atproto-sync` plugin from the `auth.atproto` object setting
  instead of a dedicated boolean plugin toggle.
- [x] Keep project library operations behind live identity-backed adapter
  wiring.
- [x] Add Home project entries for sync-capable remote ATProto projects.
- [x] Open remote-only projects by downloading `headArchive`, creating a local
  project, and writing the `[atproto].project_id` marker.
- [x] Create local projects and publish them through `project + archive`
  records.
- [x] Rename local-backed and remote-only projects through the archive-first
  adapter.
- [x] Delete local materializations and their remote project records.
- [x] Add the ATProto remote API and `[atproto].project_id` binding adapters
  needed by the generalized sync engine.
- [x] Configure the authenticated ATProto plugin runtime to use those adapters
  for local file edit uploads.
- [x] Add durable base tracking so local edit uploads cannot overwrite remote
  changes that happened after the local materialization base.
- [ ] Add a user-visible conflict resolution path for ATProto sync.

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
- [x] Local ATProto uploads use a durable saved base revision instead of the
  latest remote revision.
- [x] Local ATProto uploads stop before blob upload when the remote project CID
  has moved since the saved base and local files have changed.
- [ ] Missing archive record produces a recoverable sync failure, not local data
  loss.
- [ ] Missing archive blob produces a recoverable sync failure, not local data loss.
- [ ] Forbidden write maps to the existing remote-upload-forbidden failure kind or a
  provider-neutral equivalent.

### Identity And Library

- [x] Zoo auth appears as a `ConnectedIdentity` without changing current Zoo auth
  consumers.
- [x] ATProto OAuth connector success contributes an ATProto `ConnectedIdentity`.
- [x] A concrete ATProto OAuth SDK or desktop bridge completes the real auth
  flow.
- [ ] Settings shows Zoo and ATProto connected accounts in one management surface.
- [x] The ATProto library type lists only sync-capable remote projects and
  materializes a selected archive into a valid local ZDS project.

## Open Follow-Ups

- Revisit direct delete vs tombstone records if ATProto project discovery needs
  auditability or soft-delete behavior. V1 uses direct project-record deletion.
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
- ATProto OAuth spec: https://atproto.com/specs/oauth
- ATProto OAuth patterns guide: https://atproto.com/guides/oauth-patterns
- ATProto Sync spec: https://atproto.com/specs/sync
- ATProto Permissions spec: https://atproto.com/specs/permission
- ATProto browser OAuth client:
  https://www.npmjs.com/package/@atproto/oauth-client-browser
- ATProto repo XRPC lexicons:
  https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto/repo
- ATProto sync XRPC lexicons:
  https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto/sync
- Current ZDS cloud sync types: `src/lib/cloudSync/types.ts`
- Current ZDS cloud project API adapter: `src/lib/cloudSync/cloudApi.ts`
- Current ZDS archive preparation: `src/lib/cloudSync/projectArchive.ts`
- Current ZDS cloud sync registry contract:
  `src/lib/cloudSync/registry/contract.ts`
- Current ZDS auth registry contract: `src/registry/contracts/auth.ts`
- Current ZDS project library contract:
  `src/registry/contracts/projectLibraries.ts`
