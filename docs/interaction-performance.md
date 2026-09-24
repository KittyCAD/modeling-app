# Interaction performance

The controlled suite compares the PR merge against its first parent on the same
visible macOS Electron runner. It detects added latency in a fixed workload, while
reporting the absolute 150 ms target separately. Existing target breaches remain
visible as performance debt; a single noisy click does not decide the PR result.
No retries, discarded warm-up inputs, or Test Analysis Bot overrides are allowed.

## What is measured

Home measures command-palette open and close. A loaded small modeling project
measures those actions plus Code Editor and Project Files open and close. Modeling
starts with Code open and Files closed, so Code runs close-then-open. The fixture
is `rust/kcl-lib/tests/named_views_hide_extrude/input.kcl` from the selected harness.
Large projects, keyboard shortcuts, native menus, panel-header close buttons, and
new controls outside this inventory are not covered by this gate.

`definitions.ts` fixes the identities and 150 ms targets. `outcomes.ts` matches
existing test IDs and pre-click toggle state, then checks usable content or
unmount. Code opening requires visible editable CodeMirror content; Files opening
requires visible enabled entries. The same collector and outcome definitions are
built into both revisions. Candidate interaction annotations cannot change the
comparison's coverage or expectations. Existing annotations are additionally
checked by `zds/interaction-expectations`.

- **Outcome latency** spans trusted pointerdown through the declared usable DOM
  outcome, observed after a rendering opportunity. This includes transitions and
  asynchronous work, but is not proof that a frame reached the physical display.
- **Event Timing** includes browser input delay, handler processing, and
  presentation delay, including preceding pointer handlers. Durations are rounded
  to 8 ms. Filtered or late entries stay unreported, never zero. A one-second final
  observation window adds no inputs or measured delay, and is not a delivery
  guarantee. Only fully observed presentation strata receive a comparison verdict;
  incomplete strata remain explicitly unavailable. Every outcome stratum is required.

Normal release builds exclude the recorder, completion checks, and measurement
API. Optimized test builds opt in with `VITE_INTERACTION_PERFORMANCE=1`; even then
recording starts only when the harness requests it. There is no customer telemetry
or application appearance change.

## Paired decision

The fixed schedule has ten paired blocks, five base-first and five candidate-first,
with one fresh Electron process per context and variant. Every renderer performs
one first-use cycle and ten repeated cycles. All 1,760 ordinary clicks are retained.
First-use means the first input to the control in that renderer, not a cold host
GPU cache or the first mount of a default-open pane.

For each interaction and context, compare first-use latency, the median of its ten
repeated inputs, and their maximum. The renderer/session is the sampling unit;
ten clicks in one renderer are not ten independent trials. The maximum protects
against repeated-use stalls that a mean or median would hide.

The provisional regression rule requires a median paired increase of at least
24 ms, a positive increase in at least nine of ten pairs, and positive median
increases in both execution-order groups. Apply it to every outcome stratum and
fully observed Event Timing stratum. This is an engineering rule requiring native
A/A and injected-delay calibration, not a statistical guarantee for all changes.
Smaller or rare slowdowns outside the sampled workload can escape detection.

Missing sessions, outcomes, duplicates, unexpected inputs, invalid records,
visibility interruptions, retries, repeats, skipped probes, changed order, and
partial CLI selections fail collection. Timing decisions happen after the complete
schedule so a slow sample cannot restart a worker and alter subsequent conditions.
Five mandatory harness probes then run on each build: delayed click, delayed
pointerdown, missing measurement, secondary-click/restart, and delayed pane content.
They exercise the real application and verify that the collector rejects bad data
and includes injected delays.

## Builds and trust

CI resolves immutable baseline, candidate merge, PR-head, and harness commits.
The baseline is the tested merge's first parent, with its second parent required
to match the event PR head. The event's base SHA is retained and must be an
ancestor of that baseline; main may have advanced before GitHub created the merge.
Each app uses its own locked dependencies, Wasm, generated bindings, and Electron
runtime. Both receive the same six-file test-instrumentation overlay. Workload,
selectors, collector, schedule, and comparison policy come from the base revision.
The initial rollout explicitly uses the candidate harness when the base has no
comparison entrypoint. An incompatible existing base harness fails rather than
silently switching policy.

The automatic `interaction-performance-regression.yml` workflow runs only for PRs
and pushes. The existing `interaction-performance.yml` workflow accepts manual
dispatches only: every source checkout uses the dispatched `github.sha`, and
baseline override inputs are rejected. Automatic comparisons retain distinct
baseline and candidate commits.

Source selection stays explicit in each workflow. Three local composite actions
share the post-checkout Wasm build, application build, and native measurement
steps; their implementation comes from a separate checkout of that run's
`github.sha`. Each variant still builds independently and uses its selected
harness and locked dependencies. Both workflows deny GitHub cache reads and
writes with `cache-mode: none`, disable automatic dependency caching, and use
isolated Namespace runner cache identities. The shared Wasm workflow keeps its
existing behavior.

Source, locks, workload, harness files, and built artifacts are hashed and checked
before measurements. Build failures fail the final check. The raw comparison,
missing presentation evidence, 150 ms breaches, metadata, and all attempts are
retained for 30 days. TAB receives the final aggregate decision with every capture;
its responses cannot change CI's result.
Manual calibration is retained in GitHub artifacts and never published to TAB,
whose result identity does not distinguish calibration runs from PR comparisons.
This prevents either a passing control or an injected failure replacing PR health.

This prevents ordinary test edits in a feature PR from weakening that PR's
comparison. It is not a security boundary against a malicious PR that rewrites the
workflow or app to recognize a benchmark. Workflow/harness changes require review,
and the final check must be required by repository protection before claiming that
GitHub prevents merging a regression. The PR itself cannot enable repository rules.

## Running measurements

Use visible Electron with `HEADLESS` unset, normal motion, the fixed 1200×800
viewport, and traces/video/screenshots disabled. Readiness waits cover settings,
authentication, fonts, and (for modeling) engine connection and scene execution.
Cloud sync is disabled from startup. These waits do not exercise scored controls.

The CI workflow builds and verifies both revisions automatically. For a local
same-app diagnostic, prepare the normal dependencies and matching Wasm, then:

```sh
cp rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm public/
VITE_INTERACTION_PERFORMANCE=1 VITE_ZOO_BASE_DOMAIN=dev.zoo.dev npm run tronb:vite:prod
NODE_ENV=production TARGET=desktop VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  env -u HEADLESS npm exec -- playwright test --config=playwright.performance.config.ts --headed
```

The normal development API credential is needed through the existing credential
setup. CI requires `INTERACTION_BASE_APP_DIR` and `INTERACTION_CANDIDATE_APP_DIR`;
local runs default both to the current checkout. Local results are diagnostic and
do not establish native CI calibration or independently built source provenance.

Inspect `test-results/interaction-performance/comparison.json`, the workflow
summary, or the HTML report:

```sh
npm exec -- playwright show-report playwright-report/interaction-performance
```

## Calibration and rollout

Before treating this gate as stable, run a predeclared set of independent manual
A/A workflows against the exact same commit, preserving every attempt. Dispatch
the **Interaction performance calibration** workflow at the selected revision
with `calibration-fault: none`; no baseline ref is accepted. Both builds use that
run's immutable `github.sha`. Verify artifact identity before calling it an
identical-build comparison. The injected modes
`first`, `warm`, and `stall` add 64 ms to the candidate Home palette's real click
handler on its first input, every repeated input, or one of ten repeated inputs
respectively. They are allowed only for manual A/A runs and must fail the ordinary
comparison. They never convert an expected failure into a green performance check.

Manual jobs are named `Interaction performance calibration (<mode>)` so deliberate
failed calibration jobs are distinct from the PR's `Interaction performance
regression` check.

Examine the whole gate's false failures and detection results, not only individual
medians. Record all artifacts and the calibrated sensitivity. Passing a few A/A
runs cannot prove zero flakes; preserve the ability to diagnose future failures.

For a confirmed runner/setup failure, rerun the complete workflow on the same
commit and retain the failed attempt. A valid slow measurement is evidence, not a
reason to retry until green. Do not use `--repeat-each`, `--grep`, multiple workers,
or skipped probes to produce a passing gate.

## Discovery during functional tests

Ordinary web and Electron Playwright tests can collect additional report-only
samples. Build with `VITE_INTERACTION_PERFORMANCE=1`, then opt in to the fixture
with `PLAYWRIGHT_INTERACTION_DISCOVERY=1`. For example, after the optimized
Electron build above:

```sh
NODE_ENV=production TARGET=desktop VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  PLAYWRIGHT_INTERACTION_DISCOVERY=1 INTERACTION_DISCOVERY_BUILD=optimized \
  npm exec -- playwright test --config=playwright.electron.config.ts \
  --grep=@desktop --workers=1
```

Each test gets raw JSON and a readable summary attachment. The reporter also
writes `test-results/interaction-discovery/discovery.jsonl` and `summary.txt`,
including scenario, project, attempt, worker, platform, build label, motion, and
viewport metadata. Unknown controls remain unattributed. Latency warnings,
collection errors, and unsupported instrumentation never change the functional
test's status. A normal release build reports `instrumentation-not-built`.

Discovery is partial: it covers the main page after fixture setup, checkpoints
once per second, and retains up to 32 documents per test. Full navigation can
lose inputs before the next checkpoint; same-document routes retain their
session. The final snapshot can precede delayed Event Timing delivery. Profile
changes observed at checkpoints exclude that document from aggregate summaries,
but changes between checkpoints can be missed. Raw snapshots remain available.

These results help expand the interaction inventory. Their fixtures, traces,
parallel workers, and partially observed profiles differ from the controlled
performance suite, so they are not enforcement measurements. Discovery is off by
default and explicitly disabled in `playwright.performance.config.ts` to avoid
competing recording sessions.
