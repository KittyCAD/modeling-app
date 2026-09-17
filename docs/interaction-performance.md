# Interaction performance

The first milestone measures latency and validates collection. A measurement at
or above 150 ms is reported and retained; it does not fail CI yet. Missing,
unfinished, malformed, dropped, or background-tab outcome measurements fail
collection.
The workflow preserves failures and has no retry or Test Analysis Bot override.

## What is measured

The application-owned `interactionPerformance` service captures trusted DOM
clicks during an explicitly started session. Each sample starts at the browser's
input event timestamp, so a busy main thread contributes to latency. A stable
`data-interaction-id` connects the input to a registered visible outcome.

Two measurements serve different purposes. Either can violate the budget:

- **Event Timing** supplies supplementary browser-reported input delay, handler
  processing, and presentation delay. Browsers omit fast events below their
  reporting threshold and can deliver entries after outcome completion. A null
  entry means unreported, not zero or proof of a fast gesture. Coverage includes
  the number of samples with delivered Event Timing. Reported durations have
  8 ms granularity.
- **Outcome latency** starts at the click timestamp and records when the declared
  outcome can be observed after a render opportunity. This is an upper-bound
  observation using animation-frame scheduling and a task, not an exact hardware
  presentation timestamp. It covers asynchronous UI changes that a handler or
  first paint alone would miss. It does not count the time a person chooses to
  hold a mouse button down. Event Timing separately measures slow pointer handlers
  earlier in that gesture.

The initial registered outcomes are opening the command palette until the search
input is usable and its transition has finished, and closing it until the palette
is absent. The browser scenario uses real app buttons and the existing typed
Playwright app fixtures. The profile uses a production-optimized web build with
the existing development/test backend at `https://api.dev.zoo.dev`. It measures
local UI interactions and does not launch a modeling engine. Before creating test
pages, each worker fetches the real account from the test API once. Fresh contexts
reuse those exact response bytes from memory for authenticated `GET /user` calls.
The auth machine still runs; the benchmark does not exercise browser auth
transport or measure backend/network performance. Other startup requests still
use the test backend and can fail independently of interaction latency.

This bootstrap keeps remote auth variation outside the Home route's five-second
feature-gate deadline, which can otherwise send setup into demo modeling. A
failed bootstrap fails the run. The fixture attaches no credentials or account
response bodies. Failures include a bounded startup-state attachment with
route category and auth/feature state, without their contexts or account data.

The scenarios fix the feature set to `OPFS_CLOUD_FEATURE_FLAG`, which selects the
Projects home route instead of the release web app's demo modeling route. The
profile then uses the app's settings service to disable cloud synchronization and
select an empty local project library after startup settings settle. It waits for
those settings, the Home UI, and dismissal of the setup toasts before capture.
This gives each scenario the same initial UI and avoids starting an engine
session during setup.

Unattributed clicks remain in the raw snapshot with their target element tag.
Labels, input values, document text, and DOM paths are not collected. Registered
but unexercised actions remain visible in coverage. This inventory describes
exercised paths only; it cannot discover controls on screens nobody visited.

Native menus, keyboard interactions, streamed geometry completion, large-project
workflows, and other app controls are not covered by the initial scenarios.
Engine completion needs a scene revision correlated to the displayed frame;
neither a command acknowledgment nor the next arbitrary video frame is sufficient.

## Running the measurement job

Prepare dependencies and the Wasm artifacts using the repository's normal build
setup. With those artifacts present:

```sh
npm ci
npm exec -- playwright install chromium
VITE_ZOO_BASE_DOMAIN=dev.zoo.dev npm exec -- vite build
NODE_ENV=production npm exec -- playwright test --config=playwright.performance.config.ts
```

Vite still builds in production mode; the domain override selects the test
backend without enabling development rendering or a development server.

The test process needs the existing `VITE_ZOO_API_TOKEN` for the development API.
Provide it to the test process through the usual local credential setup; do not
include it in the production build or commit it. The CI job passes the existing
repository secret only to the test step. The unchanged shared app fixture supplies
the development session cookie before navigating. The performance context fixture
checks the outgoing credential before serving its in-memory account response.

The config serves the production build at `http://localhost:3000`, an origin
allowed by the test API's CORS policy. It requires that exact port and refuses to
reuse an already-running server. It uses Playwright's locked Chromium revision,
one worker, no retries, a fixed viewport, and no trace, screenshot, or video
recording while scoring. The scenarios restore normal motion after the shared
functional fixtures request reduced motion. They wait for application state and
fonts before capture. There are no fixed sleeps in the scored scenarios.

Stopping capture drains already-queued Event Timing entries. There is no browser
API to acknowledge delivery for every event, including filtered fast events; a
fixed number of frames did not reliably flush entries in browser validation.
Normal scenarios therefore require complete outcome measurements and expose
Event Timing gaps. The fault tests know their 250 ms handlers must produce entries
and await those entries before stopping. They verify correlation and handler
attribution, not complete delivery for arbitrary gestures. This gap must be
resolved before enforcing a budget across every event in a gesture. See the
[Event Timing processing model](https://www.w3.org/TR/event-timing/#sec-processing-model).

Each scenario runs in five fresh contexts. First-use has one open/close pair;
repeated-use has ten scored pairs after an explicit unscored warm-up. First-use
results are kept separately, so warming cannot hide them. Four additional harness
self-tests verify that 250 ms main-thread stalls during a real click and its
preceding pointerdown each breach the budget, and that an absent click is
classified as missing data. They also verify secondary clicks stay unattributed,
leave the palette closed, and are cleared when recording restarts before a
primary click. The deliberate stalls are labeled `harness.delayed-click` and
`harness.delayed-pointerdown`, not product baselines.

Artifacts are written to `test-results/interaction-performance/` and
`playwright-report/interaction-performance/`. Each test attaches the complete raw
snapshot, coverage, every observed budget violation, summary percentiles, and the browser,
OS, CPU, memory, viewport, scenario, and repeat index. All repetitions count;
successful later samples never erase earlier slow samples. Inspect the HTML
report with:

```sh
npm exec -- playwright show-report playwright-report/interaction-performance
```

Run these pure report-validation tests independently of the app and engine:

```sh
npm run test:unit -- src/lib/interactionPerformance/report.test.ts
```

## Calibrating before enforcement

CI uses an existing eight-core Linux runner profile with compilation in a separate
job. That isolates the workload; it does not establish stable physical hardware or
prove a latency distribution. Record repeated runs of the same commit on the same
profile before turning a budget into a required check:

```sh
NODE_ENV=production npm exec -- playwright test --config=playwright.performance.config.ts --repeat-each=20
```

Compare first-use and repeated-use separately, including maxima, p50/p95, every
150 ms violation, and collection failures. Compare the machine/browser metadata
before pooling results. Investigate variance, background work, or collection
failures rather than adding retries or widening timeouts. The deliberate-delay
self-test must consistently detect the injected regression.

An unchanged commit repeatedly passing is calibration evidence, not a claim that
every customer click is below 150 ms. Do not infer runner stability from one run.
Keep normal app work comfortably below the budget before enabling a strict
every-sample gate. A 149 ms baseline has effectively no margin.

## Extending coverage and then ratcheting

For each additional action, register an identity and a concrete visible outcome,
mark its existing control, and add a scenario that asserts the real app result.
Use existing fixtures and app services rather than putting tracking objects on
`window`. Keep first-use, repeated-use, project-size, and platform cases separate.
Do not declare a spinner to be the completed outcome of a longer operation.

The next rollout stages are:

1. Expand discovery and scenarios to inventory the actual workflows, including
   unattributed clicks and registered actions that have no scenario.
2. Resolve Event Timing delivery gaps and calibrate unchanged-commit variance for
   each runner/scenario combination before enforcing whole-gesture latency.
3. Record reviewed legacy ceilings keyed by action, scenario, and platform, then
   require new interactions to stay below 150 ms. Missing scenario execution must
   fail alongside missing measurements.
4. Lower each legacy ceiling as fixes land and remove its exception below 150 ms.
   Compare exceptions with the target branch so a PR cannot raise its own budget.

The ledger, changed-code coverage gate, and latency enforcement are intentionally
not enabled in this report-only milestone. No claim of complete app coverage or
flake-free enforcement should be made until those stages have their own evidence.
