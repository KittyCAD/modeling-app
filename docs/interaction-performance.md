# Interaction performance

The controlled suite compares the PR merge against its first parent on the same
visible macOS Electron runner. It detects added latency in a fixed workload, while
reporting the absolute 150 ms target separately. Existing target breaches remain
visible as performance debt; a single noisy click does not decide the PR result.
No retries, discarded warm-up inputs, or Test Analysis Bot overrides are allowed.

## What is measured

The paired contexts are `home`, `modeling-small`, `modeling-large`,
`modeling-large-syntax-error`, and `modeling-large-engine-error`. Home measures
command-palette open and close. All four modeling profiles measure those actions
plus:

- Code Editor and Project Files open and close.
- Feature Tree open and close, including expanding and collapsing its first
  sketch group.
- Transform tools menu open and close.
- Extrude launch from the toolbar and cancellation from its selection prompt.

These controls are chosen from core modeling workflows, not usage telemetry.
Modeling starts with Code open and Files/Feature Tree closed, so Code runs
close-then-open. Each cycle restores that layout without discarded setup clicks.
All modeling profiles retain the interaction geometry from
`rust/kcl-lib/tests/named_views_hide_extrude/input.kcl`: one visible cube and its
first sketch group. The three large profiles also copy the multi-file
`public/kcl-samples/cpu-cooler` project into `large-model/` and append its import
to the same main file. Existing file settings are preserved. Shared setup waits
for successful execution, matching current/last-successful code, a populated
artifact graph, drained engine commands, scene readiness, and fonts before capture.
Large-model evidence additionally requires the executed module path and more
imported-module artifacts than main-module artifacts. Source text alone is not
proof of a loaded large model.

Both error profiles first execute that same large model successfully, then use
the real editor to append a failing statement at EOF. Loading an already-broken
file is not equivalent:

- `large-syntax-error` leaves an expression unclosed. It requires the parser-error
  flag and the expected parser diagnostic at the intentionally broken tail.
- `large-engine-error` attempts an oversized fillet on the existing cube. It must
  parse successfully, then produce a real `KCLError.kind === 'engine'` with the
  expected fillet-failure message and a root-module source range in the appended
  statement. Syntax, semantic, transport, and unrelated engine errors do not
  satisfy this profile.

Before capture, the harness requires the specific error, idle execution, drained
commands, and retained large-model artifacts. After every measured interaction it
requires that same error category and origin to remain, with unchanged
last-successful code and the error-state artifact count. Clearing the error or
successfully executing the failing buffer fails collection, even if the UI was
fast. If a parser or engine fix makes the fixture succeed, the profile must fail;
the harness does not silently accept success or substitute another error.

File switching, typing, keyboard shortcuts, native menus, panel-header close
buttons, camera motion, and completed modeling operations remain outside the
paired regression workload. The separate absolute-budget audit below covers
additional interaction types.

`definitions.ts` fixes the identities and 150 ms targets. `outcomes.ts` matches
existing test IDs and pre-click toggle state, then checks usable content or
unmount. Code opening requires visible editable CodeMirror content; Files opening
requires visible enabled entries. Feature Tree and sketch-group opening require
visible operation buttons, enabled unless a parser error makes the cached tree
read-only; expanding a caret alone is insufficient.
Transform opening requires usable Translate and Rotate choices. Extrude opening
requires its visible selection prompt and enabled input, whose transparent overlay
is intentional. Cancellation and search-palette closing have distinct identities.
These are UI readiness endpoints, not engine-result measurements.
The same collector and outcome definitions are
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
  guarantee. Only fully observed presentation strata receive a comparison verdict.
  Every outcome and presentation stratum is required for a passing gate; incomplete
  coverage remains unavailable and makes the result inconclusive unless another
  stratum already demonstrates a regression. Both results fail the check.

Normal release builds exclude the recorder, completion checks, and measurement
API. Optimized test builds opt in with `VITE_INTERACTION_PERFORMANCE=1`; even then
recording starts only when the harness requests it. There is no customer telemetry
or application appearance change.

## Paired decision

The fixed schedule has ten paired blocks, five base-first and five candidate-first,
with one fresh Electron process per context and variant: **100 renderer sessions**
across the five contexts. Every renderer performs one first-use cycle and ten
repeated cycles. All **12,760 ordinary clicks** are retained: 20 variant sessions
per context × 11 cycles × (2 Home + 14 actions for each of four model profiles).
First-use means the first input to the control in that renderer, not a cold host
GPU cache or the first mount of a default-open pane.

For each interaction and context, compare first-use latency, the median of its ten
repeated inputs, and their maximum. The renderer/session is the sampling unit;
ten clicks in one renderer are not ten independent trials. The maximum protects
against repeated-use stalls that a mean or median would hide.
The 58 context/action combinations produce **348 comparison strata**: three
phases × outcome and Event Timing. Missing presentation coverage is still a
missing stratum, not a reason to reduce the required schedule.

The provisional regression rule requires a median paired increase of at least
24 ms, a positive increase in at least nine of ten pairs, and positive median
increases in both execution-order groups. Apply it to every outcome stratum and
fully observed Event Timing stratum. This is an engineering rule requiring native
A/A and injected-delay calibration, not a statistical guarantee for all changes.
Smaller or rare slowdowns outside the sampled workload can escape detection.
Missing Event Timing cannot remove a comparison and turn a regression green.
The [Event Timing API](https://www.w3.org/TR/2026/WD-event-timing-20260223/)
filters events below its minimum 16 ms threshold and has no per-input delivery
acknowledgment. A legitimately fast or unreported event can therefore make this
gate inconclusive. Diagnose that measurement gap; do not label it a regression,
substitute zero, or retry it away.

Missing sessions, outcomes, duplicates, unexpected inputs, invalid records,
visibility interruptions, retries, repeats, skipped probes, changed order, and
partial CLI selections fail collection. Timing decisions happen after the complete
schedule so a slow sample cannot restart a worker and alter subsequent conditions.
Eight mandatory harness probes then run on each build: delayed click, delayed
pointerdown, missing measurement, secondary-click/restart, and delayed modeling
content (Code, Files, Feature Tree, sketch children, transform tools, and Extrude)
with each of the four model profiles. The complete schedule contains **116 test
attempts**: 100 comparison sessions plus eight probes on each build.
They exercise the real application and verify that the collector rejects bad data
and includes injected delays.

## Builds and trust

CI resolves immutable baseline, candidate merge, PR-head, and harness commits.
The baseline is the tested merge's first parent, with its second parent required
to match the event PR head. The event's base SHA is retained and must be an
ancestor of that baseline; main may have advanced before GitHub created the merge.
Each app uses its own locked dependencies, Wasm, generated bindings, and Electron
runtime. Both receive the same nine-file test-instrumentation overlay. Workload,
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

## Absolute-budget audit

`playwright.interaction-budget.config.ts` runs the audited interactions and the
original 14 core modeling actions against the candidate application with the same
opt-in recorder and **150 ms absolute budget**. This is separate from the paired
regression schedule: unchanged latency debt must fail these checks, not disappear
into a green before/after comparison.
There are no expected-failure markers, synthetic delays, retries, or raised
budgets. Fixing the underlying latency should make the same tests pass.

The audit covers sketch entry/editing, orientation-cube faces/edges/corners,
viewport dimming, variable and Settings dialogs, tooltip behavior, notification
badges, toast effects, streamed Zookeeper text, editor execution, density
updates, folder drag-hover, geometry-to-code highlighting, stream resizing,
default-plane visibility, and keyboard-chord expiry. Each endpoint describes
what is actually ready; text-field echo alone does not prove committed settings,
updated physical analysis, or completed model execution.

Every registered modeling-screen case inherits `modeling-small`,
`modeling-large`, `modeling-large-syntax-error`, and `modeling-large-engine-error`
automatically, including Settings and the core controls. Future modeling cases
inherit all four unless explicitly
declared Home-only or unavailable with errors. They use the shared model setup
described above; initial model loading and execution are complete **before
capture starts** and their durations stay in the separate `model-setup`
attachment. Settings opening and closing have independent spans, and closing
preparation waits for the real panel and backdrop to finish opening. Geometry
creation explicitly starts empty and creates the selected profile. The diagnostic
badge case intentionally appends an error after a successful load and verifies
that the previously executed profile's geometry remains cached and idle.

Actions that inherently require a valid AST or replace the erroneous buffer have
explicit `unavailableWithErrors` reasons. These include sketch creation/editing,
convert-to-variable, successful editor execution, and the default-plane geometry
creation/removal cases. Their error-profile combinations are retained in the
unsupported inventory as **unmeasured**, not silently repaired, skipped as passing,
or assigned invented latency. Other interactions must preserve the specific error
and cached geometry through the post-action guard.

`error-profile.spec.ts` checks both guards through the real editor: each case
deliberately removes its failing tail, waits for successful execution, and requires
`assertErrorModelPreserved` to reject the repaired state. These are guard
self-tests, not expected-failure markers or passing latency measurements.

Click measurements start at trusted pointerdown where available. Double-click,
typing, hover, drag, resize, and keyboard cases use their declared native
activation event. Repeated dragovers form one hover gesture; a trailing resize
starts at the last native resize. Animation lifecycle metrics start at the
browser's native animation/transition event, with positive CSS animation delays
included. They measure visual effects, **not button-handler responsiveness**;
toast display lifetimes and keyboard multi-key detection are not mislabeled as
click latency. Missing Event Timing remains unknown for these inputs.
Keyboard-chord expiry starts at the trusted prefix-key release, not keydown:
the existing global keymap handler consumes prefix keydown events before document
listeners can observe them. This is a key-release-to-expiry span, not a claim
about keydown-handler responsiveness.

Removed legacy UI and the dormant retry countdown remain explicitly unsupported;
they are not passing measurements. The native backface color picker has a metric
definition but no automated case: Playwright's color-input fill dispatches
untrusted synthetic events, and the existing fixtures cannot operate the native
picker. It is listed as unsupported rather than recording a fake native input.
The web-only startup handoff has its own
headed Chrome measurement in `playwright.interaction-browser-budget.config.ts`.
It arms native transition listeners before navigation and measures transition
start through a settled post-render outcome, excluding page loading,
authentication, and API-response time. It records no invented Event Timing.
Browser-managed smooth scrolling and engine-internal timings with no declared
duration are not assigned invented results.

After preparing an optimized measurement build as above, run:

```sh
NODE_ENV=production TARGET=desktop VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  env -u HEADLESS npm exec -- playwright test --config=playwright.interaction-budget.config.ts --headed

NODE_ENV=production TARGET=web VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  env -u HEADLESS npm exec -- playwright test --config=playwright.interaction-browser-budget.config.ts --headed
```

Each case gets a fresh renderer, and raw samples are attached before budget
assertions. Results are retained in `test-results/interaction-budget` and
`playwright-report/interaction-budget`; the browser configuration uses the
corresponding `interaction-browser-budget` directories. The browser configuration
serves the existing optimized renderer output rather than building it. Collection
or setup failures are not proof of a latency breach. A currently fast interaction
stays green; do not manufacture a failure to match an audit assumption. These
diagnostic runs do not establish native CI calibration or an independently built
merge-base comparison. The expanded model matrix still requires native calibration;
the presence of tests or a successful build does not establish measured results.
The existing native measurement jobs still have a 15-minute limit. Local
four-profile setup times indicate that the expanded paired schedule needs a
separate CI runtime-budget review alongside calibration before rollout; this
audit does not change those workflows or claim the full schedule fits that limit.

### Local fail-first checkpoint (2026-10-19)

Headed, optimized Electron diagnostics against the unchanged application recorded
these Settings spans, with initial model loading excluded:

| Model | Open | Close |
| --- | ---: | ---: |
| Small | 749.3 ms | 450.5 ms |
| Large | 10,186.5 ms | 911.3 ms |
| Large with syntax error | 749.2 ms | 453.2 ms |
| Large with engine error | 20,974.2 ms | 18,137.7 ms |

The error-profile runs preserved their expected errors and cached geometry, and
both real-editor guard self-tests rejected accidentally successful execution.
Large-model Physical Analysis remained on `Analyzing...` beyond its 30-second
preparation wait, so that density case is an **unmeasured readiness failure**, not
proof of a latency breach. Raw attempts, including invalid setup attempts, remain
in `test-results/interaction-budget`. These local results do not establish CI
calibration or independently built merge-base provenance.

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
