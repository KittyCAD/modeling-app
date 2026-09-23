# Standalone palette presentation diagnostic

This never-merge diagnostic renders a captured Home palette using the installed
React and Headless UI versions. It preserves the captured content, classes,
fonts, geometry, autofocus, 100 ms opacity/scale enter transition, 75 ms leave
transition, panel shadow, and native popover tooltip. It does not boot Zoo's
business logic, authentication, project storage, or Home background. Its Electron
session rejects network requests and receives no application credentials.

The fixture was captured locally from an available optimized application build
whose source commit could not be verified. The checked-out palette presentation
sources and lockfile matched `d5328e2c1e`; this is not a claim that the local build
is the immutable CI artifact. The fixture contains only allowlisted UI markup
and static command text, appearance readings, and CSS/font hashes. The builder
rejects an input artifact whose CSS bytes or font bytes differ from that capture,
and records expected and observed hashes in `metadata.json` even on mismatch.

After installing the existing locked dependencies and obtaining the application
artifact, run from the repository root:

```sh
node e2e/performance/palette-reduction/build.cjs .vite/renderer/main_window
env -u HEADLESS -u ELECTRON_RUN_AS_NODE -u ELECTRON_OVERRIDE_DIST_PATH \
  node ./node_modules/@playwright/test/cli.js test \
  --config=playwright.palette-reduction.config.ts --headed
```

The first command accepts another artifact renderer directory as its first
argument. The default output is `test-results/palette-reduction-build`. The second
command runs five sequential first-use open/close pairs without retries or
warm-up interactions, with a four-minute global limit. Each repeat creates its
own headed Electron process and isolated user/session profile. This does not
control host-wide GPU caches or hold hosted CPU/GPU hardware constant. CPU,
Electron/Chrome, GPU information exposed by Electron, runner, viewport, focus,
visibility, and device pixel ratio are recorded for each repeat.

The reduction uses the existing interaction recorder, outcome predicates,
reporter, and 150 ms budgets. Its extra animation-frame observations make these
diagnostic timings, not calibration. The observer remains active for the same
1,000 ms post-action reporting window used by the application suite. Missing
Event Timing entries remain missing presentation evidence. No app-facing
recorder or production instrumentation is added.

After the final repetition's scoring stops, the test opens the palette again solely to compare its
geometry, option count, autofocus, and computed appearance with the captured
fixture. This validation waits for Headless UI to remove its enter classes;
the scored readiness predicate is unchanged. The pointer moves away during this
unscored check so hover styles are compared in the same state. A mismatch fails the diagnostic
and is attached alongside the raw timing evidence. This validation open is not
a timing sample, and no additional open occurs before a later scored pair.
Earlier repetitions explicitly defer fidelity validation to the final repetition;
if its successful validation is missing, the run has no validated timing conclusion.
A reporter guard fails otherwise-passing executed subsets that omit that final
validation. Listing tests does not execute this requirement.
Do not run the source-capture spec or the full application on
the native runner before the diagnostic measurement.

A slow reduction can establish that the removed business logic is unnecessary
for that observed delay. A passing reduction does not establish an application
fix, explain a failing full-app sample, or justify changing its strict budget.

Outputs are under `test-results/palette-reduction` and
`test-results/palette-reduction-build/metadata.json`.
