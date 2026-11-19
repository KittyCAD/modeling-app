# Factory submissions

The `factory` plugin contributes one Top Bar item through `appHeaderItemsFacet`.
The `factory_portal` feature controls activation through `createZdsPlugin`.
Its Factory owns account/project workspaces until the plugin is removed. Closing
the popover preserves the draft; switching projects preserves confirmed jobs in
memory. Signing out or changing accounts disposes the workspaces. Nothing is
stored in project files or browser storage.

`jobs.ts` is the independent batch coordinator. It splits a captured project
snapshot into one request per entry point and shares the delivery-address
revision. Confirmed jobs remain visible after a partial failure. Writes run once;
uncertain responses block another submission and link to Manufacturing Jobs.
Disposal prevents late results from publishing state or starting another job.

`registry/projects.ts` adapts live app capabilities at the submission boundary.
It supplies the form with captured account/project capabilities, saves open editors, clones Directory projects through the project-library
contribution contract, and captures the cloud snapshot once for the batch.
The snapshot and address revision are retained after a rejected submission.
Revisions change specifications while retaining the already-submitted files and
delivery selection, using POST `/user|org/factory/jobs/{id}/versions`.

## API contract and rollout

Creation uses POST `/user/factory/project-jobs`. Its JSON `body` part requires
`entrypoint_path`, normalized as a project-relative path naming a submitted KCL
file. Every job in a batch uploads identical project bytes; only the entry point
and per-job specifications differ. Studio's generated root `thumbnail.png` is
omitted so Factory can generate a preview for the selected entry point. The companion API branch is
`codex/factory-entrypoint` in KittyCAD/api.

The distinct route is intentional: an older API rejects it with 404 instead of
silently ignoring the entry-point field and manufacturing the wrong model.
There is no fallback to ordinary Factory intake. The existing `factory_portal`
feature controls availability, including the plugin setting.

## Review checks

- Exercise personal and organization accounts, including an organization member
  who cannot edit billing. Confirm the address is pinned to the correct owner.
- Select two nested KCL entry points, set different quantities/materials/finishes
  and notes, then submit once. Inspect both immutable Factory snapshots and
  confirm they execute different entry points with identical model/dependency bytes.
  Each Factory-owned manifest receives its own cloud identity.
- Repeat from a Directory library and confirm the local source remains intact
  and exactly one cloud copy is created for the batch.
- Close/reopen, switch projects, revise one job, and follow its website link.
- Simulate a rejection after the first successful job and an uncertain network
  response. Confirm no successful job is automatically resubmitted.
- Verify the popover stays within narrow and short viewports and can scroll.
