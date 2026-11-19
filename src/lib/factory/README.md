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
It saves open editors, clones Directory projects through the project-library
contribution contract, and captures the cloud snapshot once for the batch.
The snapshot and address revision are retained after a rejected submission.
Revisions change specifications while retaining the already-submitted files and
delivery selection, using POST `/user|org/factory/jobs/{id}/versions`.

## API dependency: explicit entry points

The existing Factory intake API chooses `main.kcl`, falling back to the first
KCL file. It ignores unknown top-level JSON properties. This feature requires
an intake change before it can ship: accept `entrypoint_path` in the JSON `body`
part, normalize it as a project-relative path, require that it names a submitted
KCL file, and use it for the immutable Factory Project snapshot. Omission must
retain the current selection behavior. All jobs in a batch upload identical
project bytes; only the entry point and per-job specifications differ.

Do not enable submissions against the existing API: it would manufacture the
wrong entry point for a multi-file project. The availability guard must remain false until the companion API is deployed.
The plugin is off by default during this rollout.

## Review checks

- Exercise personal and organization accounts, including an organization member
  who cannot edit billing. Confirm the address is pinned to the correct owner.
- Select two nested KCL entry points, set different quantities/materials/finishes
  and notes, then submit once. Inspect both immutable Factory snapshots and
  confirm they execute different entry points with identical file bytes.
- Repeat from a Directory library and confirm the local source remains intact
  and exactly one cloud copy is created for the batch.
- Close/reopen, switch projects, revise one job, and follow its website link.
- Simulate a rejection after the first successful job and an uncertain network
  response. Confirm no successful job is automatically resubmitted.
- Verify the popover stays within narrow and short viewports and can scroll.
