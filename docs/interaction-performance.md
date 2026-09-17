# Interaction performance

This milestone collects latency. Measurements at or above an interaction's
expectation produce warnings. Missing or unfinished outcomes, invalid data, and
dropped input records fail CI. Runs have no retries or Test Analysis Bot override.

## Registering an interaction

`src/lib/interactionPerformance/definitions.ts` owns each interaction's identity,
test ID, expected duration, and visible completion condition. Expectations must
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

## Running measurements

Prepare dependencies and matching Wasm artifacts using the normal repository
setup, then build and test the production Electron app:

```sh
npm ci
VITE_ZOO_BASE_DOMAIN=dev.zoo.dev npm run tronb:vite:prod
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
Inspect the HTML report with:

```sh
npm exec -- playwright show-report playwright-report/interaction-performance
```

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

Expand the interaction inventory and its scenarios first. Existing slow actions
remain warnings while they are improved; there are no higher-budget exceptions.
Then require registration and executed scenarios for new controls, resolve Event
Timing delivery gaps, and enforce the under-150-ms target. A PR must not be able to
raise its own passing threshold.
