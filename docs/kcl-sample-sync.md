# KCL sample sync and review submission (first version)

`scripts/sync_kcl_samples.py` imports samples from the modeling-app manifest using
the existing multipart project APIs. Python 3.11+ is sufficient; no dependencies
or API/schema changes are needed. The sync uploads a draft and calls `POST /user/projects/{id}/publish` to submit
its current version for moderation. That endpoint requests review; it does not
approve the sample or make it a public Aquarium entry. The sync never approves
or deletes projects.

## Try it locally

Validate one sample without credentials or API calls:

```sh
python3 scripts/sync_kcl_samples.py \
  --samples-root public/kcl-samples --sample angle-gauge
```

Omit `--sample` to validate the entire catalog offline. To import one sample into
a dedicated Zoo sample account on a test API, set `ZOO_API_TOKEN` in your shell
and supply the URL explicitly:

```sh
python3 scripts/sync_kcl_samples.py \
  --samples-root public/kcl-samples \
  --sample angle-gauge --api-url https://api.dev.zoo.dev \
  --state /tmp/zoo-sample-test-state.json --apply --initialize-state
```

The command prints the project ID and review submission. Inspect the moderation
queue in the admin dashboard or the project through `GET /user/projects/{id}` using that account. Run the same
command again without `--initialize-state`: unchanged samples are skipped.
Edit a sample locally and rerun to update the same project ID. Use `--all` instead
of `--sample` to explicitly allow applying the entire catalog.

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
| Checkpoint artifact | `kcl-sample-sync-state-development` | `kcl-sample-sync-state-production` |

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

For the first development CI upload, select `apply` and `bootstrap_state`.
The staging environment secret `KCL_SAMPLE_SYNC_BOOTSTRAP_STATE` is populated
with the checkpoint from the existing local Wing Spar test, so CI reuses its API
project ID. Leave
`initialize_state` unchecked. Subsequent runs restore the saved artifact and
need neither bootstrap nor initialization.

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

Existing version-1 slug checkpoints migrate automatically when the old directories
still exist. Migrate before renaming a directory if you have such a checkpoint;
unresolvable legacy slugs fail rather than creating duplicate projects.

CI restores the latest nonexpired artifact for the selected environment on
`main`, serializes uploads per environment, and checkpoints every successful
upload. Review submissions are checkpointed separately by revision. A failed
submission retries on the next run without re-uploading; legacy draft checkpoints
are submitted too. Even a partially failed run saves its checkpoint. Subsequent runs skip
unchanged samples. Missing state blocks uploads unless initialization or initial
bootstrap is explicitly selected; API URL and account mismatches block uploads.

Artifacts expire after 90 days: download and retain the latest state before
expiry. Do not initialize again or reuse the initial bootstrap after subsequent
imports; either can create duplicate projects. Recover from a current backup or
reconcile existing API IDs. Do not run local uploads concurrently with CI.

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
concurrency groups and checkpoint streams. Pull requests have no environment
credentials and always validate offline.

## Rollout checklist and production approval hold

1. Commit and merge the workflow, scripts, and sample IDs. The existing staging
   and Production environments are configured separately, with automatic uploads
   disabled. Run the first development upload with
   `bootstrap_state` to transfer the existing Wing Spar checkpoint.
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
7. Enable automatic sample sync after validating the full cycle, and retain a
   durable checkpoint backup before CI artifacts expire.

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
  unmapped project. Reconcile that project's ID/revision into the state before
  retrying; create requests are deliberately not automatically retried.
- The website still renders its local sample catalog. Production imports can
  enter moderation, but hold their approvals until gallery deduplication and
  old sample-slug routes are handled during cutover.

Validation:

```sh
python3 -m unittest discover -s scripts/tests -p test_sync_kcl_samples.py
```

Related catalog issue: https://github.com/KittyCAD/api/issues/4829.
