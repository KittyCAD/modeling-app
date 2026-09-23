# Interaction performance

The controlled performance suite fails when a scored interaction meets or exceeds
its registered budget. First-use and repeated-use scenarios both enforce the
under-150-ms limit. Missing or unfinished outcomes, invalid data, and dropped input
records also fail CI. Runs have no retries or Test Analysis Bot override.

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
them. Toggle controls can select a definition through an immutable conditional
`const` alias; all three fields must use that same alias. TypeScript checks that
the definition exists. Controls without interaction annotations are not yet lint
errors; adding mandatory coverage is a later stage.

The recorder captures trusted clicks during an explicitly started session:

- **Outcome latency** runs from pointerdown (or the activation click when no
  pointerdown was captured) until its declared result is ready after a rendering
  opportunity, including UI transitions and async work. It includes button dwell;
  scored clicks have no intentional hold. This is an observation of usable DOM,
  not a guarantee that the compositor presented that frame.
- **Event Timing** reports browser input delay, handler processing, and presentation
  delay. It also captures slow pointer handlers preceding a fast click. Browser
  durations are rounded to 8 ms; filtered or late entries remain unreported.
  Observed breaches fail, but missing entries are not proof of a fast presentation.

After the controlled scenario's actions finish, the suite keeps the observer
active for a one-second reporting window before taking its final snapshot. This
captures presentation feedback that arrives after the last DOM outcome; it adds
no inputs and does not add the reporting wait to measured durations. Late entries
can increase a sample's Event Timing maximum. The window is recorded in measurement
metadata. It is not a delivery guarantee: filtered entries and feedback arriving
after the final snapshot remain unreported, not evidence of a fast presentation. Discovery does not use this reporting window.

The registered outcomes cover command-palette search becoming usable and the
palette closing, plus Code Editor and Project Files sidebar toggles. Code Editor
opening waits for visible, editable CodeMirror content; Project Files opening
waits for visible, enabled file entries. Empty file explorers do not yet have
a completion signal. Pane closing waits for unmount. Native menus,
keyboard shortcuts, engine completion, and panel-header close buttons need their
own completion conditions and scenarios.

Normal release builds exclude the recorder, completion checks, and measurement
API. Test builds opt in with `VITE_INTERACTION_PERFORMANCE=1` while retaining
production optimization and the real UI. Even there, the recorder loads and
allocates state only when `start()` is explicitly called. Active samples stay in
memory until the test exports them; this does not collect customer telemetry.

## Running measurements

Run desktop measurements in a normal visible Electron window with `HEADLESS`
unset. The windows can take focus. Keep the same machine and display setup when
comparing changes, and leave normal motion enabled.

The scored CI job uses the repository's established macOS desktop runner and
launches visible Electron directly. Compilation stays in a separate job. This
is a hosted desktop, so compare results within the same runner profile; a local
desktop pass does not establish the CI result. Earlier Linux/Xvfb measurements
remain separate evidence with different rendering and presentation costs.

Prepare dependencies and matching Wasm artifacts using the normal repository
setup, then build and test the production Electron app:

```sh
npm ci
cp rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm public/
VITE_INTERACTION_PERFORMANCE=1 VITE_ZOO_BASE_DOMAIN=dev.zoo.dev npm run tronb:vite:prod
NODE_ENV=production TARGET=desktop VITE_ZOO_BASE_DOMAIN=dev.zoo.dev \
  npm exec -- playwright test --config=playwright.performance.config.ts --headed
```

The test process needs the existing development API token through the usual
credential setup. CI supplies it only to the test step. Its measurement command
unsets `HEADLESS` and uses the same controlled configuration as the local run.

The profile uses the existing Electron fixtures and authentication, with cloud
synchronization disabled from startup. Home scenarios verify that Home is ready
and no project or engine session has started. Modeling scenarios open the existing
`named_views_hide_extrude` KCL fixture in a local project and wait for the engine
connection and scene before capture. Both profiles fix the window size, restore
normal motion, wait for fonts, and disable traces, screenshots, and video.

Each scenario runs five times with a reloaded renderer and fresh project directory:

- First-use measures one open/close pair per renderer.
- Repeated-use measures ten pairs after one unscored warm-up pair per renderer.

Home measures the command palette. Modeling measures the command palette, Code
Editor, and Project Files separately under their registered IDs, so the same
palette can be compared between Home and a loaded project. Modeling preserves
the shared Playwright layout: Code starts open and Files starts closed, so Code
is measured close-then-open. First-use means the first click on each control in
that renderer, not the first time a default-open pane mounted. These small-project
results do not establish performance in large projects.

Harness probes inject 250 ms click and pointerdown stalls, verify that the same
budget assertion rejects them, verify missing-data errors, and check that secondary clicks remain unattributed across recorder
restart. Another probe delays pane-content visibility to verify that mounting an
empty pane cannot complete a measurement. Their 10 ms polling interval controls
when tests read completed records; the recorder owns the measurement timestamps.

The CI job summary shows every scenario's measurements and errors. Raw samples,
environment metadata, coverage, and all budget breaches are also retained in
`test-results/interaction-performance/` and `playwright-report/interaction-performance/`.
GitHub retains these artifacts for 30 days. After all scenarios finish, the TAB
reporter publishes one result per scenario containing every repetition, the
measurement summaries, raw measurement JSON, and workflow run/attempt identifiers.
TAB's duration field remains the total scenario runtime, not click latency.
Earlier workflow attempts remain in history; TAB uses the latest as its current
result. Its responses never override this workflow's collection or latency failures.
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

Calibrate additional scenarios on a consistent runner before making them blocking:

```sh
NODE_ENV=production TARGET=desktop npm exec -- playwright test \
  --config=playwright.performance.config.ts --repeat-each=20
```

Compare first-use and repeated-use separately: maxima, p50/p95, every breach,
collection failures, and environment metadata. Investigate variation instead of
adding retries or widening timeouts. The injected-delay probes must keep detecting
the regression.

For a confirmed runner or setup failure, use GitHub's **Re-run all jobs** on the
same commit. Preserve the failed attempt and rerun the complete workflow, not
individual tests or only failed jobs. A slow but valid sample is a measurement,
not a reason to rerun until it disappears.

Expand the interaction inventory through discovery, improve slow actions, then
add them to the controlled suite. Discovery remains report-only; scored scenarios
have no higher-budget exceptions. Mandatory registration and executed scenarios
for every new control are a later stage. A PR cannot raise an interaction budget
above 150 ms.
