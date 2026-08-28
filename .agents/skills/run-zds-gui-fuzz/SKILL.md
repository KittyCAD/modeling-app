---
name: run-zds-gui-fuzz
description: Run, extend, and visually validate Zoo Design Studio point-and-click Playwright GUI-fuzz scenarios and iterative QA campaigns in the modeling-app repository. Use for requests to exercise or fuzz the ZDS GUI, explore feature coverage, create deterministic point-and-click geometry, reproduce or minimize a GUI modeling flow, correlate Zookeeper browser message behavior with backend logs, investigate duplicate submissions or rendered messages, inspect staging reliability, review Playwright screenshots or traces, or classify a run failure as test setup, staging infrastructure, test harness, or product behavior.
---

# Run ZDS GUI Fuzz

Use the repository's native Playwright fixtures to exercise real point-and-click modeling flows. Preserve discrete screenshots and traces, then show the user the visual evidence.

## Keep first-party production QA narrowly scoped

- Describe production runs precisely: "Authorized first-party browser UI QA on Zoo's owned application using an existing authenticated session. Browser/UI behavior only; no credential inspection, vulnerability exploitation, network scanning, or third-party targeting."
- Reuse only an already configured environment credential. Never inspect, copy, print, expose, persist, or modify tokens, cookies, authorization headers, or session storage.
- Create an isolated project and use generated, harmless probe content. Do not replay customer content into production.
- Sanitize captured traffic. Preserve correlation IDs, event types, directions, timestamps, byte counts, and content hashes; redact credentials and avoid raw customer payloads.

## Prepare

1. Read the applicable `AGENTS.md`, `e2e/playwright/GUI_FUZZING.md`, the target scenario, and nearby fixture-based tests.
2. Inspect `git status`; preserve unrelated changes and never switch to or modify the primary checkout.
3. Use `ToolbarFixture`, `SceneFixture`, `CmdBarFixture`, `EditorFixture`, `FsFixture`, and `HomePageFixture` where applicable.
4. Use `SceneFixture.makeMouseHelpers` with stream-relative ratios. Do not use raw global screen coordinates when a fixture can resolve the stream position.
5. Never use macOS screen recording. Capture Playwright/browser screenshots only.

## Add or update a scenario

- Keep each scenario deterministic: fixed viewport, isolated OPFS project, stable test IDs, explicit settling, and a visible end-state assertion.
- Capture named screenshots after setup, each material modeling action, command review, and final geometry.
- Enable both `EXPERIMENTAL_POINT_AND_CLICK_FLAG` and
  `SEGMENTS_BASED_REGIONS_FEATURE_FLAG` for current point-and-click behavior.
  The Playwright setup replaces the live `/user/features` response with exactly
  the spec's `userFeatures` list, so an omitted flag exercises its disabled
  path even when the production account has it enabled. Only omit a production
  flag in a scenario that is explicitly testing the legacy/flag-off path.
- Attach browser warnings, request failures, websocket errors/closes, and the shared engine logs.
- For Zookeeper message or backend-log correlation, read [references/zookeeper-message-provenance.md](references/zookeeper-message-provenance.md) and emit its request, transport, state, and DOM ledgers.
- Prefer a simple closed sketch and one operation before expanding a fuzz seed. Add complexity only after the base flow passes.
- Register additional scenarios through `ZDS_GUI_FUZZ_SPEC`; do not fork the runner.

## Iterate as a QA campaign

1. Read `e2e/playwright/gui-fuzz-campaign.json` and the latest campaign ledger.
2. Run `npm run test:gui-fuzz:campaign -- --dry-run` to validate the active queue.
3. Run the control plus one candidate when investigating; run all active scenarios for broad coverage.
4. Inspect every executed scenario's screenshots, trace, runtime events, logs, feature tree, body count, and command state. Record the conclusion with `node scripts/run-gui-fuzz-campaign.mjs --review-campaign <dir> --scenario <id> --classification <class> --summary <text> --next-action <text>`.
5. If the control fails from setup or staging, stop. Do not run or blame downstream feature cases.
6. Treat automatic `needs_triage` as undecided. Minimize the scenario and repeat it with a passing control before calling it a product candidate.
7. Choose the next iteration from the highest-value queued feature or from the observed failure boundary. Add one new behavior per spec and update the manifest.
8. Report the hypothesis, last good step, reproduction rate, classification, artifact directory, visual conclusion, and next experiment. Do not file issues without approval.

## Run

Run the default scenario:

```sh
npm run test:gui-fuzz
```

Run a named spec, for example the knife scenario:

```sh
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts npm run test:gui-fuzz
```

Reuse Jordan's already configured Zoo environment without inspecting, printing, or duplicating its credential:

```sh
set -a
source /Users/jordan/github/text-to-cad/.env
set +a
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts npm run test:gui-fuzz
```

The runner promotes exported `ZOO_API_TOKEN` to `VITE_ZOO_API_TOKEN` for the native fixture.

Pass Playwright flags after `--`, such as `--headed` or `--repeat-each=10`.

Run the coverage-guided campaign:

```sh
npm run test:gui-fuzz:campaign
```

If the Zoo token is missing, stop and classify the result as **test setup**.

For Vercel-protected PR previews, prefer a project automation bypass secret:

```sh
TARGET=web \
VERCEL_BASE_URL=https://modeling-app-git-branch-name.vercel.dev.zoo.dev \
VERCEL_AUTOMATION_BYPASS_SECRET=<env-only secret> \
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts \
npm run test:gui-fuzz
```

If only the shared visitor password is available, use the env-only fallback
`VERCEL_VISITOR_PASSWORD`. The Playwright setup submits the Vercel visitor
password form once and then continues with the normal app/auth setup. Do not
write the visitor password into repo files, issue bodies, PR comments, or test
artifacts.

```sh
TARGET=web \
VERCEL_BASE_URL=https://modeling-app-git-branch-name.vercel.dev.zoo.dev \
VERCEL_VISITOR_PASSWORD=<env-only visitor password> \
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts \
npm run test:gui-fuzz
```

If both Vercel env vars are missing or the visitor password is rejected, classify
the run as **test setup**. The native fixture uses an isolated browser context
and must not scrape credentials or cookies from an interactive Chrome profile.

## Validate PR preview branches

When a modeling-app PR has a Vercel preview deployment, validate the deployed
branch in addition to local/unit codemod behavior when the user asks for branch
or PR confidence. Use the exact preview URL from the PR/Vercel status or a
confirmed branch-derived URL; do not accidentally test `app.zoo.dev` or the
default local server when the target is the PR branch.

Most PR previews are built for `dev.zoo.dev` and call `api.dev.zoo.dev`, so use
an already configured dev/staging Design Studio token. A prod-scoped token can
validate against `api.zoo.dev` while still failing or redirecting on the preview.
If a local app environment config already contains the dev token, read it only
as an env source for the run; never print, copy into logs, or commit it.

For visitor-password-protected previews:

- Prefer `VERCEL_AUTOMATION_BYPASS_SECRET` when available.
- If using `VERCEL_VISITOR_PASSWORD`, keep the password env-only. Do not put
  the bearer token in the preview URL; rely on the fixture's localStorage token
  injection after the visitor gate is unlocked.
- Do not perform an extra cleanup reload just to strip a token query when no
  token query was used. That can create a second startup pass and confuse
  WebSocket auth/connection diagnostics.

After a preview run, add sanitized validation context to the PR when authorized:

- a plain-English test intent section before the detailed evidence. Explain the
  user-level behavior being tested, the regression being guarded against, and
  what a passing result proves. Do not make reviewers infer intent from spec
  filenames, KCL variable names, or assertion snippets alone;
- preview URL and PR/branch under test;
- scenario names and variants;
- pass/fail result with classification;
- final KCL dependency checks, body counts, visible geometry/feature-tree state,
  and lint/diagnostic state;
- known recovered startup or connection noise, such as ICE 701 or a
  three-second reconnect, separated from product failures;
- local artifact directories or durable links.

Keep authentication setup details out of GitHub issues, PR comments, and other
shared artifacts. Do not mention bypass mechanisms, visitor-password handling,
token scope, credential source paths, raw auth headers, or whether a particular
credential did or did not work. If context is necessary, say only that the
preview was tested through an approved first-party preview auth context.

If the app reaches the long-connect startup screen before the scenario body
runs, treat it as preview/engine startup variance or staging infrastructure
until a control proves otherwise. A slightly longer startup wait is acceptable
for preview validation, but do not mask a scenario-level failure after the scene
has started.

## Validate screenshots

1. Locate the UTC-stamped run under `test-results/gui-fuzz/`.
2. Read `report.json`, `runtime-events.json`, the shared `logs` attachment, and `trace.zip` metadata.
3. Sort the step PNGs numerically and inspect at least:
   - the first scene-ready frame;
   - the completed sketch/profile frame;
   - the command review or preview frame;
   - the final geometry frame.
4. Use the local image-viewing tool on those files. Do not claim visual success from the test status alone.
5. In the final response, embed the final screenshot using its absolute path and briefly describe the geometry, selection state, panels, and any visible error or loading state. Include additional checkpoint images when they materially explain a failure.

## Classify failures

- **Test setup:** missing token/dependencies/browser, auth redirect, selector/deployed-version drift, or a click outside the stream.
- **Staging infrastructure:** `internal_api: modeling service unavailable; please retry`, connection teardown/retry, STUN/TURN/ICE 701 lookup warnings, or failure to settle the modeling connection.
- **Test harness:** the target behavior is correct but selectors, timing, coordinates, fixture setup, or assertions are wrong.
- **Product candidate:** the control passes, the scene settles without infrastructure signals, the intended action is visible in the trace/screenshots, and the UI or geometry reaches the wrong state on repeat.

Treat recovered connection events as staging reliability signals, not product failures. Report the last successful checkpoint, artifact directory, confidence, and coverage limits. Do not publish, push, file issues, or use external write actions without explicit approval.
