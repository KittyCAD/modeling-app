# Interaction performance

This milestone collects latency. Measurements at or above an interaction's
expectation produce warnings. Missing or unfinished outcomes, invalid data, and
dropped input records fail CI. Runs have no retries or Test Analysis Bot override.

## Registering an interaction

`src/lib/interactionPerformance/definitions.ts` owns each interaction's identity,
test ID, expected duration, and outcome description. `outcomes.ts` defines the
visible completion checks for instrumented builds. Expectations must
be positive and no greater than 150 ms. Use the same definition on the control:

```tsx
data-interaction-id={interactions.commandPaletteOpen.id}
data-testid={interactions.commandPaletteOpen.testId}
data-expect-interaction-ms={interactions.commandPaletteOpen.budgetMs}
```

The `zds/interaction-expectations` lint rule requires these three attributes to
reference the same central definition and prevents later props from overriding
them. TypeScript checks that the definition exists. Controls without interaction
annotations are not yet lint errors; adding mandatory coverage is a later stage.

The recorder captures trusted clicks during an explicitly started session:

- **Outcome latency** runs from the click timestamp until its declared result is
  ready after a rendering opportunity, including UI transitions and async work.
- **Event Timing** reports browser input delay, handler processing, and presentation
  delay. It also captures slow pointer handlers preceding a fast click. Browser
  durations are rounded to 8 ms; filtered or late entries remain unreported.

The initial outcomes are command-palette search becoming usable and the palette
closing. Native menus, keyboard shortcuts, engine completion, and other controls
need their own completion conditions and scenarios.

Normal release builds exclude the recorder, completion checks, and measurement
API. Test builds opt in with `VITE_INTERACTION_PERFORMANCE=1` while retaining
production optimization and the real UI. Even there, the recorder loads and
allocates state only when `start()` is explicitly called. Active samples stay in
memory until the test exports them; this does not collect customer telemetry.

## Running measurements

Prepare dependencies and matching Wasm artifacts using the normal repository
setup, then build and test the production Electron app:

```sh
npm ci
VITE_INTERACTION_PERFORMANCE=1 VITE_ZOO_BASE_DOMAIN=dev.zoo.dev npm run tronb:vite:prod
NODE_ENV=production TARGET=desktop VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  npm exec -- playwright test --config=playwright.performance.config.ts
```

The test process needs the existing development API token through the usual
credential setup. CI supplies it only to the test step. Linux runs use the same
Xvfb wrapper as the existing desktop tests.

The profile uses the existing Electron fixtures and authentication, with an empty
local project library and cloud synchronization disabled from startup. No cloud
feature flag or settings changes are needed. Before capture it verifies that Home
is ready and no project or engine session has started. It fixes the window size,
restores normal motion, waits for fonts, and disables traces, screenshots, and video.

Each scenario runs five times with a reloaded renderer and fresh project directory:

- First-use measures one open/close pair per renderer.
- Repeated-use measures ten pairs after one unscored warm-up pair per renderer.

Harness probes inject 250 ms click and pointerdown stalls, verify missing-data
errors, and check that secondary clicks remain unattributed across recorder
restart. Their 10 ms polling interval controls when tests read completed records;
the recorder owns the measurement timestamps.

The CI job summary shows every scenario's measurements and errors. Raw samples,
environment metadata, coverage, and all warnings are also retained in
`test-results/interaction-performance/` and `playwright-report/interaction-performance/`.
GitHub retains these artifacts for 30 days. After all scenarios finish, the TAB
reporter publishes one result per scenario containing every repetition, the
measurement summaries, raw measurement JSON, and workflow run/attempt identifiers.
TAB's duration field remains the total scenario runtime, not click latency.
Earlier workflow attempts remain in history; TAB uses the latest as its current
result. Its responses never override this workflow's collection failures.
Publication failures are logged and leave the local reports and test result intact.
Inspect the HTML report with:

```sh
npm exec -- playwright show-report playwright-report/interaction-performance
```

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

## Calibration and rollout

Repeat unchanged commits on a consistent runner before enforcing latency:

```sh
NODE_ENV=production TARGET=desktop npm exec -- playwright test \
  --config=playwright.performance.config.ts --repeat-each=20
```

Compare first-use and repeated-use separately: maxima, p50/p95, every warning,
collection failures, and environment metadata. Investigate variation instead of
adding retries or widening timeouts. The injected-delay probes must keep detecting
the regression.

For a confirmed runner or setup failure, use GitHub's **Re-run all jobs** on the
same commit. Preserve the failed attempt and rerun the complete workflow, not
individual tests or only failed jobs. A slow but valid sample is a measurement,
not a reason to rerun until it disappears.

Expand the interaction inventory and its scenarios first. Existing slow actions
remain warnings while they are improved; there are no higher-budget exceptions.
Then require registration and executed scenarios for new controls, resolve Event
Timing delivery gaps, and enforce the under-150-ms target. A PR must not be able to
raise its own passing threshold.
