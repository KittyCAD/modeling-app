# Local GUI fuzzing

This workflow exercises the deployed Zoo Design Studio UI with this repository's native Playwright fixtures. It uses a fresh browser context and an isolated OPFS project on each test run.

## Setup

1. Install repository dependencies with `npm install`.
2. Set `VITE_ZOO_API_TOKEN` in the environment or in the ignored `.env.development.local` file. The runner also promotes an exported `ZOO_API_TOKEN` to `VITE_ZOO_API_TOKEN` without printing it.
3. For a Vercel-protected deployment, prefer `VERCEL_AUTOMATION_BYPASS_SECRET`.
   If only the shared visitor password is available, set
   `VERCEL_VISITOR_PASSWORD` instead. The runner submits the visitor-password
   gate once and then continues through the normal app/auth setup.
4. Ensure branded Google Chrome is installed.

The native web fixture does not reuse the interactive Chrome profile. This keeps runs deterministic and means an authenticated browser tab is not a substitute for the API token.

## Run

```sh
npm run test:gui-fuzz
```

The default target is `https://app.dev.zoo.dev`. Override it with `VERCEL_BASE_URL`. All arguments after the npm separator are passed to Playwright, for example:

```sh
npm run test:gui-fuzz -- --headed
npm run test:gui-fuzz -- --repeat-each=10
```

Select another scenario with `ZDS_GUI_FUZZ_SPEC`:

```sh
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts npm run test:gui-fuzz
```

Run against a Vercel-protected PR preview with an env-only visitor password:

```sh
TARGET=web \
VERCEL_BASE_URL=https://modeling-app-git-branch-name.vercel.dev.zoo.dev \
VERCEL_VISITOR_PASSWORD='<visitor password>' \
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts \
npm run test:gui-fuzz
```

To reuse the token from Jordan's existing text-to-CAD environment without duplicating or logging the secret:

```sh
set -a
source /Users/jordan/github/text-to-cad/.env
set +a
ZDS_GUI_FUZZ_SPEC=e2e/playwright/gui-fuzz-knife.spec.ts npm run test:gui-fuzz
```

Each run gets a UTC-stamped directory under `test-results/gui-fuzz/` containing discrete step screenshots, an always-on Playwright trace, the HTML and JSON reports, runtime warning/request diagnostics, and the engine logs attached by the shared fixture. This workflow does not use macOS screen recording.

For an explicitly requested browser-only video, enable Playwright WebM capture:

```sh
PLAYWRIGHT_GUI_FUZZ_VIDEO=1 npm run test:gui-fuzz
```

Video capture uses the scenario's 1400 by 900 viewport, remains off by default,
and does not invoke macOS screen recording.
Set `PLAYWRIGHT_GUI_FUZZ_VIDEO_ANNOTATE=1` to draw a high-contrast pointer,
action banners, and persistent numbered modeling-canvas click markers without
adding deliberate waits.
Set `PLAYWRIGHT_GUI_FUZZ_VIDEO_PACED=1` as well when human-visible pauses and
labeled click markers are more important than preserving the scenario's normal
automation timing.

## Run an iterative QA campaign

The campaign manifest at `e2e/playwright/gui-fuzz-campaign.json` separates active deterministic scenarios from the planned coverage queue. Run all active scenarios with:

```sh
npm run test:gui-fuzz:campaign
```

Inspect the queue without opening a browser:

```sh
npm run test:gui-fuzz:campaign -- --dry-run
```

Run a subset by stable scenario ID:

```sh
npm run test:gui-fuzz:campaign -- --only rectangle-control,knife-line-profile
```

Each campaign writes `campaign.json`, `findings.md`, per-scenario reports, logs, traces, and screenshots beneath `test-results/gui-fuzz/campaigns/<UTC timestamp>/`. The rectangle control runs first. A control setup or staging failure stops the campaign so later cases are not reported as false product failures. An unclassified candidate failure stops as `needs_review` for trace and screenshot inspection.

After inspecting the evidence, record the human visual conclusion in the same ledger:

```sh
node scripts/run-gui-fuzz-campaign.mjs \
  --review-campaign test-results/gui-fuzz/campaigns/<UTC timestamp> \
  --scenario rectangle-control \
  --classification test_setup \
  --summary "Vercel visitor authentication blocked app startup." \
  --next-action "Provide VERCEL_AUTOMATION_BYPASS_SECRET or VERCEL_VISITOR_PASSWORD and rerun the control."
```

Reviewed classifications are `pass`, `test_setup`, `staging_infrastructure`, `test_harness`, and `product_candidate`.

After reviewing a campaign, create one deterministic spec for the highest-priority uncovered feature or for a minimized suspected issue. Add it to `scenarios`, move the hypothesis out of `queue`, rerun the control plus candidate, and record the visual conclusion in the QA handoff. Never promote `needs_triage` directly to a product issue.

## Turn a GUI fuzz finding into a code-mod investigation

Treat generated KCL as a first-class diagnostic artifact. A point-and-click
failure can be a deterministic AST-modification bug even when the visible
symptom looks like missing geometry or an engine failure.

Use this investigation loop:

1. Start with a realistic feature chain and capture the KCL before and after
   the suspect GUI action. Keep screenshots and runtime diagnostics aligned to
   the same step numbers.
2. Minimize along both axes: reduce the feature count until the failure stops,
   and reduce the edit itself until an unchanged submit is enough to reproduce.
   Run a smaller passing control beside the minimum failure.
3. Identify the first violated source invariant. Examples include an upstream
   operation consuming its own descendant, a selected face or region pointing
   outside its regenerated profile, or a feature-tree operation disappearing
   while its command reports success.
4. Search from the emitted KCL call into the AST modification path. For a Hole
   operation, useful starting points are:

   ```sh
   rg -n "function addHole|buildSolidsAndFacesExprs|lastChildLookup|setCallInAst" src/lang
   ```

5. Follow the replacement call through the shared modifier helpers. Check
   separately how the code chooses the unlabeled solid input, labeled command
   arguments, selections, variable names, and insertion or replacement path.
6. State the invariant before changing code. If the edit UI cannot change an
   operation's input solid, editing that operation must preserve its existing
   unlabeled input and only replace editable arguments.
7. Add the smallest AST-level regression and prove that it fails before the
   fix for the same reason as the GUI reproduction. Execute the resulting AST;
   do not rely only on a recast string assertion.
8. Apply the narrowest fix, then validate in layers: focused regression, nearby
   integration suite, type/format checks, and the original screenshot-only GUI
   replay. Keep recovered connection warnings separate from the result.

### Case study: upstream Hole edit creates a dependency cycle

The original fuzz seed created a four-hole mounting plate and edited the first
Hole into a countersink. The scene lost every hole. Minimization established:

- four-hole upstream edit failed;
- two-hole upstream edit failed repeatedly;
- two-hole unchanged resubmit still failed;
- one-hole edit passed;
- the rectangle and extrusion control passed.

The two-hole KCL was valid before the edit:

```kcl
hole001 = hole::hole(extrude001, ...)
hole002 = hole::hole(hole001, ...)
```

After resubmitting `hole001`, the GUI-generated modification produced:

```kcl
hole001 = hole::hole(hole002, ...)
hole002 = hole::hole(hole001, ...)
```

That made the visual disappearance secondary evidence; the first concrete
failure was an invalid dependency graph and the diagnostic `` `hole002` is not
defined ``. The code investigation then showed that `addHole` rebuilt the
unlabeled solid input with `lastChildLookup: true`. Excluding the edited node
still allowed lookup to choose its final downstream child, and `setCallInAst`
installed that child as the edited node's new input.

The regression constructed `extrude001 -> hole001 -> hole002`, edited
`hole001`, asserted that both original inputs remained intact, and executed the
modified AST. The fix used the existing replacement convention where a `null`
unlabeled argument means "preserve the existing input" during an edit. The
minimum GUI replay then retained both cuts, both Feature Tree operations, one
body, and zero editor diagnostics.

See [issue #13248](https://github.com/KittyCAD/modeling-app/issues/13248) and
[PR #13250](https://github.com/KittyCAD/modeling-app/pull/13250) for the
published reproduction and fix.

## Published GUI-fuzz handoff ledger

Use this ledger to avoid refiling known fuzz-derived findings and to recover
the local evidence behind each GitHub handoff.

| Date (UTC) | Campaign or run | Finding | Classification | GitHub handoff | Fix status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-28 | `test-results/gui-fuzz/campaigns/20260828T022719Z`, `sweep-helix-edit` follow-up | Measurement distance target accepts non-measurable `kind: "other"` selections. | Product candidate, defensive source-level follow-up. | [Issue #13379](https://github.com/KittyCAD/modeling-app/issues/13379), [PR #13381](https://github.com/KittyCAD/modeling-app/pull/13381). | Open PR, branch `codex/measurement-ignore-other-distance`, commit `b386c2b5b1`. Local Biome and focused unit test passed. | Guard `getMeasurementTarget` so region/default-plane/unknown selections do not send unsupported automatic `entity_get_distance` requests. |
| 2026-08-28 | `test-results/gui-fuzz/campaigns/20260828T022719Z`, `sweep-helix-edit` | Sweep/Helix Feature Tree edit leaves correct final geometry but logs stale BRep body-detail requests. | Product candidate. | [Issue #13380](https://github.com/KittyCAD/modeling-app/issues/13380), [PR #13382](https://github.com/KittyCAD/modeling-app/pull/13382). | Open PR, branch `codex/measurement-gate-stale-body-details`, commit `9470d6a974`. Local Biome and focused unit test passed; full `tsc --noEmit` still hit existing generated API/baseline drift outside the patch. | Related but not duplicate: [issue #13231](https://github.com/KittyCAD/modeling-app/issues/13231). Gate automatic body-detail measurements against the current graph selection before sending `volume`, `surface_area`, and `center_of_mass` engine commands. |
| 2026-08-28 | `test-results/gui-fuzz/campaigns/20260828T035012Z`, `shell-upstream-edit`; minimized run `test-results/gui-fuzz/20260828T035235Z` | Shell Feature Tree edit preserves geometry and KCL but leaves selected `shell001` as a graph selection without an artifact; footer shows `1 other` and console logs path-to-node/non-sketch selection warnings. | Product candidate, low-priority selection/telemetry correctness. | [Issue #13383](https://github.com/KittyCAD/modeling-app/issues/13383). | Open issue, no PR. | No engine or geometry failure. Reproduces with and without downstream `patternLinear3d`, so the boundary is Shell edit selection/artifact mapping rather than pattern regeneration. |

## Failure classification

Review the last successful screenshot, `runtime-events.json`, the shared `logs` attachment, and `trace.zip` together:

- **Test setup:** API-token or Vercel protection redirects, missing or incorrect
  `VERCEL_AUTOMATION_BYPASS_SECRET`/`VERCEL_VISITOR_PASSWORD`, missing
  dependencies or browser, selector/API drift between this checkout and the
  deployed app, or a click that resolves outside the stream.
- **Staging infrastructure:** `internal_api: modeling service unavailable; please retry`, connection teardown followed by the built-in retry, STUN/TURN/ICE host-lookup errors such as code 701, or a trace showing the scene never reached a settled connection.
- **Product:** the scene settled without an infrastructure signal, the fixture performed the intended visible action, and the UI or generated geometry then entered the wrong state or violated an assertion.

Do not classify a recovered startup retry as a product failure. Keep the diagnostics as a staging reliability signal and continue evaluating the GUI result.
