# KCL sample sync and review submission

`scripts/sync_kcl_samples.py` imports samples from the modeling-app manifest using
the existing multipart project APIs. Python 3.11+ is sufficient; no dependencies
or API/schema changes are needed. The sync uploads a draft and calls `POST /user/projects/{id}/publish` to submit
its current version for moderation. That endpoint requests review; it does not
approve the sample or make it a public Aquarium entry. The sync never approves
or deletes projects.

CI commits the source UUID to cloud project ID mapping, revisions, file lists,
and content hashes through draft PRs into `main` in this repository:

- `sample-sync/development.json`
- `sample-sync/production.json`

These files are the durable checkpoint. They contain no API tokens. The workflow
reads the latest merged file for its environment before every upload. It aborts
before Zoo API calls if that environment already has an open checkpoint PR,
including a draft or a manual recovery PR changing the checkpoint file. Merge
the PR after self-review and CI before uploading again. The other
environment can proceed independently. Unchanged state creates no commit or PR.
There are no checkpoint artifacts or retention deadlines.

Each run with changes creates a temporary branch named
`kcl-sample-sync-ids-<target>-<run-id>-<attempt>` and opens a draft PR changing only
its checkpoint file. This also happens after a partial sync failure, so completed
uploads are recorded before retrying. Once merged, the branch can be deleted like
any other PR branch. There is no long-lived state branch to maintain.

## Try it locally

Validate one sample without credentials or API calls:

```sh
python3 scripts/sync_kcl_samples.py \
  --samples-root public/kcl-samples --sample angle-gauge
```

Omit `--sample` to validate the entire catalog offline. To import one sample into
a dedicated Zoo sample account on a test API, set `ZOO_API_TOKEN` in your shell
and supply the URL explicitly. For an account already used by CI, first restore
its current committed checkpoint:

```sh
gh api 'repos/KittyCAD/modeling-app/contents/sample-sync/development.json?ref=main' \
  --jq .content | python3 -c 'import base64, sys; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read()))' \
  > /tmp/zoo-sample-test-state.json
```

Then run:

```sh
python3 scripts/sync_kcl_samples.py \
  --samples-root public/kcl-samples \
  --sample angle-gauge --api-url https://api.dev.zoo.dev \
  --state /tmp/zoo-sample-test-state.json --apply
```

The command prints the project ID and review submission. Inspect the moderation
queue in the admin dashboard or the project through `GET /user/projects/{id}` using that account. Run the same
command again: unchanged samples are skipped.
Edit a sample locally and rerun to update the same project ID. Use `--all` instead
of `--sample` to explicitly allow applying the entire catalog.

For a genuinely empty test account, use a new state path and add
`--initialize-state`. The Python script only updates its local state file; the
CI workflow creates checkpoint PRs. If uploading locally to the CI sample
account, first check for an open checkpoint PR, then include the resulting local
state in a draft PR for the corresponding file on `main` and merge it before the
next CI run. Never run local uploads concurrently with CI.

Category display names are matched case-insensitively to the API's active
categories. Unknown names fail before uploads. For aliases, use
`--category-map /path/to/categories.json` containing an object like
`{"Parametric": "<active-category-uuid>"}`. The workflow uses exact display-name
matching; test API categories must exist before a workflow import.

All files under each sample directory are included, including imported geometry
and `project.toml`. The sample screenshot becomes `thumbnail.png`. Content,
metadata, category IDs, and screenshots contribute to the change hash.

## Manual CI test

Run **Sync KCL samples for review** in modeling-app's Actions tab. Select a target:
`development` or `production`. The default is an offline dry run of `wing-spar`.
Uploads must run from `main`; other branches can validate offline.

Each target uses its own GitHub environment (the existing `staging` and
`Production`) with these settings:

| Setting | Development | Production |
| --- | --- | --- |
| Secret `ZOO_SAMPLE_SYNC_TOKEN` | Development ZooTeam token | Production ZooTeam token |
| Variable `KCL_SAMPLE_SYNC_API_URL` | `https://api.dev.zoo.dev` | `https://api.zoo.dev` |
| Variable `KCL_SAMPLE_SYNC_ENABLED` | Initially `false` | Initially `false` |
| Committed checkpoint | `sample-sync/development.json` | `sample-sync/production.json` |

Reuse the existing `staging` environment for the development API and
`Production` for production. Keep their existing protection rules intact. An
administrator may be needed to save environment secrets and variables. These
settings are configured, with automatic uploads disabled. To reconfigure them
from a checkout of modeling-app:

```sh
gh variable set KCL_SAMPLE_SYNC_API_URL --env staging --body https://api.dev.zoo.dev
gh variable set KCL_SAMPLE_SYNC_API_URL --env Production --body https://api.zoo.dev
gh variable set KCL_SAMPLE_SYNC_ENABLED --env staging --body false
gh variable set KCL_SAMPLE_SYNC_ENABLED --env Production --body false
gh secret set ZOO_SAMPLE_SYNC_TOKEN --env staging
gh secret set ZOO_SAMPLE_SYNC_TOKEN --env Production
gh secret set KCL_SAMPLE_SYNC_BOOTSTRAP_STATE --env staging < /tmp/zoo-kcl-sync-dev-0772b320.json
```

The token commands prompt for the appropriate environment's ZooTeam token. The
bootstrap command uses the local development checkpoint; securely transfer the
file if the administrator is running on another machine.

For the first development CI upload with committed state, select `apply` and `bootstrap_state`.
The staging environment secret `KCL_SAMPLE_SYNC_BOOTSTRAP_STATE` is populated
with the checkpoint from the existing local Wing Spar test, so CI reuses its API
project ID. Leave
`initialize_state` unchecked. CI validates the imported checkpoint against the
account and opens a draft PR recording it. Merge that PR before another upload.
Subsequent runs load the file from `main` and need neither bootstrap nor
initialization. Once a checkpoint has been merged,
the workflow rejects bootstrap and initialization instead of replacing its history.

If an environment already has artifact-backed imports, download its **latest**
checkpoint and use that file to update `KCL_SAMPLE_SYNC_BOOTSTRAP_STATE` before
this one-time migration. The original Wing Spar secret is only valid while it
accounts for every existing upload. Do not use an older bootstrap after further
imports. Remove the migration secret once its checkpoint PR is merged.

For production's first import into an empty sample account, select `apply` and
`initialize_state` instead. Never initialize an account with existing imports.
Bootstrap and initialization cannot be selected together. The configured API
URL must match the selected target; checkpoint account/URL checks provide a
second guard against mixing environments.

Sync checkpoints are keyed by each sample's committed `settings.meta.id` UUID
from `project.toml`, with the current directory slug stored as metadata. Renaming
the directory/title does not create another API project. The API assigns its own
project ID on initial upload; the source UUID maps to that stable API ID. All
samples must have unique valid source IDs before sync, and CI enforces this even
for new sample directories absent from the generated manifest.

Before any upload or review submission, the sync lists the account's cloud
projects (including all pages) and checks their IDs against the checkpoint.
Untracked cloud projects, checkpoint IDs missing from the account, or multiple
sample UUIDs mapped to one cloud project stop the run before writes. This also
means `--initialize-state` verifies that the account is empty. Use a dedicated
sample account: unrelated projects in that account must be resolved separately.
The inventory check runs even when selecting just one sample, so an incomplete
bootstrap cannot silently create duplicates for the rest of the catalog.

Existing version-1 slug checkpoints migrate automatically when the old directories
still exist. Migrate before renaming a directory if you have such a checkpoint;
unresolvable legacy slugs fail rather than creating duplicate projects.

CI loads the selected environment's latest state from `main`,
serializes uploads per environment, and checkpoints every successful upload
locally. Review submissions are checkpointed separately by revision. A failed
submission retries on the next run without re-uploading; legacy draft checkpoints
are submitted too. A final step opens a draft checkpoint PR after successful and
partially failed runs. Subsequent runs skip
unchanged samples. Missing state blocks uploads unless initialization or initial
bootstrap is explicitly selected; API URL and account mismatches block uploads.

Development and production use separate files and pending-PR checks. The helper
starts each temporary branch from the latest `main`, preserving unrelated merges,
and refuses to propose state if its own checkpoint changed during the upload.
It checks again for an open checkpoint PR before creating one. It never
force-pushes or merges a PR. Checkpoint-only merges do not trigger another upload;
after merging a checkpoint from a partial failure, rerun the upload manually.

The workflow uses the existing `MODELING_APP_GH_APP_ID` and
`MODELING_APP_GH_APP_PRIVATE_KEY` secrets to create a token scoped to this
repository with content and pull request write permissions. The app token lets
the PR trigger normal CI. Credentials are checked before uploads and refreshed
afterward so a long sync does not leave an expired token for PR creation.
The normal `GITHUB_TOKEN`, validation, and pull request jobs retain read-only
permissions. No branch protection changes are required.

If committing or creating the PR fails, the workflow fails and includes the
updated JSON in its job summary for recovery. A commit already made remains on
the run's temporary branch. Recover it through a PR before another upload. Do
not close a checkpoint PR without merging or reconciling its state: its IDs may
already refer to successful cloud uploads. To identify an
untracked project's source sample, download its authenticated project archive
and read `settings.meta.id` in `project.toml`; titles and directory names are not
identities. Preserve the cloud project ID returned by the API, its current
revision, and file list in the recovered checkpoint. Do not mark content as
unchanged or submitted without verifying it. The merged files on `main` remain
the source of truth after temporary PR branches are deleted.

## Sample merges

The workflow lives in `KittyCAD/modeling-app`, alongside its script and tests.
It runs on pushes to `main` changing `public/kcl-samples/**`, and validates sample
and sync-script changes in pull requests. Pull requests always run offline.
There is no cross-repository workflow call or API repository checkout.

`generate-website-docs.yml` no longer triggers on sample changes or copies
`public/kcl-samples` into documentation. Language/standard-library documentation
still syncs normally. Existing documentation samples remain until the website
cutover; stopping future copies does not remove them from the Aquarium gallery.

Merge runs validate the entire catalog and evaluate both environments
independently. Each stays offline until its environment variable
`KCL_SAMPLE_SYNC_ENABLED` is `true`. Manually import and verify the full catalog
in that environment before enabling uploads on merges. Unchanged samples are
skipped by hash. Development and production can run independently, with separate
concurrency groups and checkpoint files. Checkpoint-only commits do not change
sample sources, so they do not trigger another sample upload. Pull requests have no environment
credentials and always validate offline.

## Rollout checklist and production approval hold

1. Commit and merge the workflow, scripts, and sample IDs. The existing staging
   and Production environments are configured separately, with automatic uploads
   disabled. Run the first development upload with
   `bootstrap_state` to open a PR for the existing Wing Spar checkpoint. Verify
   `sample-sync/development.json` contains its cloud project ID and merge the PR.
2. Bring development categories into alignment, retain/transfer the existing
   Wing Spar test checkpoint, and import the remaining samples for review. Verify
   all source UUIDs map to one project each, previews/files are correct, and a
   repeated full run performs no uploads.
3. Test moderation and a subsequent source update. The sync submits newly
   uploaded versions for review, including updates to pending or published
   samples; approval stays with the moderation team.
4. **Before any production submission/review rollout, remind Persis that ZooTeam
   sample approvals must be held until the website stops adding docs samples to
   the Aquarium gallery.** Import/submission alone must not create public duplicates.
5. Prepare the website cutover: use API samples in the gallery, stop appending
   docs-manifest samples there, and preserve existing sample slug URLs/downloads
   through the source-UUID/slug-to-project mapping. Do not delete sample docs or
   KCL source files just to remove gallery duplication.
6. Once the docs-gallery source is disabled on the deployed website, lift the
   approval hold, approve the imported ZooTeam samples, and verify counts,
   categories, routes, previews, and downloads. Coordinate deployment/approvals
   so the gallery gap is as short as possible.
7. Enable automatic sample sync after validating the full cycle. Confirm that
   both environments' checkpoint PRs are merged and that an unchanged run
   performs neither uploads nor checkpoint commits.

The approval hold is a human release gate requested by Persis, not currently an
API enforcement mechanism. Call it out again before step 4; do not assume
production import or sample approval is authorized by a development test.

## Prototype limitations

- Automatic approval is outside this workflow. Updated pending/published
  projects are submitted for another review; no admin approval endpoint is called.
- Changed drafts are protected with the last saved revision and
  `expected_revision`; human edits require manual resolution. Declared deleted
  files are removed during replacement; missing source samples are retained.
- State provides incremental identity, not server-side create idempotency. A
  create accepted by the API whose response/checkpoint is lost can leave an
  unmapped project. The next run detects its untracked cloud ID and stops.
  Reconcile that project's ID/revision into the state before retrying; create
  requests are deliberately not automatically retried. The inventory check
  cannot prevent simultaneous runs from both creating the same source sample.
- A runner terminated before the final checkpoint PR can leave successful uploads
  uncommitted. The next run detects unknown cloud IDs; recover those mappings
  before retrying. A failed commit or PR creation reports the local checkpoint in
  the job summary.
- The website still renders its local sample catalog. Production imports can
  enter moderation, but hold their approvals until gallery deduplication and
  old sample-slug routes are handled during cutover.

Validation:

```sh
python3 -m unittest discover -s scripts/tests -p test_sync_kcl_samples.py
```

Related catalog issue: https://github.com/KittyCAD/api/issues/4829.
