import { arch, cpus, platform, release, totalmem } from 'node:os'
import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page, TestInfo } from '@playwright/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const OPEN = interactions.commandPaletteOpen.id
const CLOSE = interactions.commandPaletteClose.id
const POLL_INTERVAL_MS = 10
const INJECTED_HANDLER_MS = 250
const MIN_INJECTED_DURATION_MS = INJECTED_HANDLER_MS - 50

async function startCapture(page: Page) {
  await page.evaluate(() => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    return recorder.start()
  })
}

function readCapture() {
  const recorder = window.app.interactionPerformance
  if (!recorder) {
    throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
  }
  return recorder.snapshot()
}

async function waitForSample(page: Page, id: string, count: number) {
  await page.waitForFunction(
    ({ id, count }) =>
      window.app.interactionPerformance
        ?.snapshot()
        .samples.filter(
          (sample) => sample.id === id && sample.status === 'complete'
        ).length === count,
    { id, count },
    { timeout: 10_000, polling: POLL_INTERVAL_MS }
  )
}

async function waitForInjectedDuration(page: Page) {
  // Wait for the injected delay to reach Event Timing. The longest event in the
  // gesture can include the stall as presentation delay instead of processing.
  await page.waitForFunction(
    (minimumDurationMs) =>
      window.app.interactionPerformance
        ?.snapshot()
        .samples.some(
          (sample) =>
            sample.eventTiming !== null &&
            sample.eventTiming.durationMs >= minimumDurationMs
        ),
    MIN_INJECTED_DURATION_MS,
    { timeout: 10_000, polling: POLL_INTERVAL_MS }
  )
}

async function finishCapture(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  expected: Readonly<Record<string, number>>,
  tronApp: ElectronZoo | undefined
): Promise<InteractionReport> {
  const snapshot = await page.evaluate(() => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    return recorder.stop()
  })
  const report = reportInteractions(snapshot, expected)
  if (!tronApp) throw new Error('Interaction measurements require Electron.')
  const runtime = await tronApp.electron.evaluate(() => ({
    browser: process.versions.chrome,
    electron: process.versions.electron,
  }))
  const metadata = {
    scenario,
    repeatIndex: testInfo.repeatEachIndex,
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    runner: process.env.RUNNER_NAME ?? 'local',
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    ...runtime,
    viewport: page.viewportSize(),
    motion: 'no-preference',
    timing: 'input-to-outcome-observed-after-render',
  }
  // Preserve raw records before assertions so a failed collection is inspectable.
  await testInfo.attach('interaction-measurements', {
    body: JSON.stringify({ metadata, snapshot, report }, null, 2),
    contentType: 'application/json',
  })
  const duration = (value: number | null) =>
    value === null ? 'unreported' : `${value.toFixed(1)} ms`
  await testInfo.attach('interaction-summary', {
    body: [
      `Scenario: ${scenario}`,
      `Collection errors: ${report.errors.length}`,
      `Observed expectation breaches: ${report.violations.length} (warnings)`,
      `Unattributed clicks: ${report.unattributed}`,
      ...report.coverage.map(
        (row) =>
          `${row.id}: expectation under ${row.budgetMs} ms, measured ${row.measured}/${row.expected ?? 'not scheduled'}, outcome maximum ${duration(row.maximumMs)}, p50 ${duration(row.p50Ms)}, p95 ${duration(row.p95Ms)}, Event Timing reported ${row.eventTimingMeasured}/${row.exercised}, responsiveness maximum ${duration(row.responsivenessMaximumMs)}`
      ),
      ...report.errors,
    ].join('\n'),
    contentType: 'text/plain',
  })
  return report
}

test.beforeEach(async ({ page, homePage, cmdBar }) => {
  await homePage.waitForAuthentication()
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
  await homePage.expectIsCurrentPage()
  await homePage.projectsLoaded()
  expect(
    await page.evaluate(() => ({
      desktop: Boolean(window.electron),
      hasProject: window.app.project !== undefined,
      engineStarted: window.app.engineCommandManager.started,
    }))
  ).toEqual({ desktop: true, hasProject: false, engineStarted: false })
  // The shared functional fixture requests reduced motion. Score normal motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await expect(cmdBar.cmdBarOpenBtn).toBeEnabled()
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
})

// Each of five repeats reloads the renderer with a fresh project directory.
// Repeated-use scores ten pairs after one unscored warm-up pair in that renderer.
for (const scenario of [
  { id: 'command-palette.first-use', repetitions: 1, warm: false },
  { id: 'command-palette.repeated-use', repetitions: 10, warm: true },
]) {
  test(scenario.id, async ({ page, cmdBar, tronApp }, testInfo) => {
    const close = page.getByTestId(interactions.commandPaletteClose.testId)
    if (scenario.warm) {
      await cmdBar.cmdBarOpenBtn.click()
      await expect(page.getByTestId('cmd-bar-search')).toBeVisible()
      await close.click()
      await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
    }

    await startCapture(page)
    let report: InteractionReport
    try {
      for (let index = 1; index <= scenario.repetitions; index++) {
        await cmdBar.cmdBarOpenBtn.click()
        await waitForSample(page, OPEN, index)
        await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
        await close.click()
        await waitForSample(page, CLOSE, index)
        await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
      }
    } finally {
      report = await finishCapture(
        page,
        testInfo,
        scenario.id,
        { [OPEN]: scenario.repetitions, [CLOSE]: scenario.repetitions },
        tronApp
      )
    }
    expect(
      report.errors,
      'Invalid collection is not a passing measurement'
    ).toEqual([])
    // The first milestone collects debt; it does not enforce the latency budget.
  })
}

test('harness detects a delayed real command-palette click', async ({
  page,
  cmdBar,
  tronApp,
}, testInfo) => {
  await startCapture(page)
  await page.evaluate((delayMs) => {
    document.addEventListener(
      'click',
      () => {
        // Scoped fault injection into the actual app path, removed after one click.
        const deadline = performance.now() + delayMs
        while (performance.now() < deadline) {
          // Hold the main thread so input-to-outcome must include this delay.
        }
      },
      { capture: true, once: true }
    )
  }, INJECTED_HANDLER_MS)

  let report: InteractionReport
  try {
    await cmdBar.cmdBarOpenBtn.click()
    await waitForSample(page, OPEN, 1)
    await waitForInjectedDuration(page)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.delayed-click',
      { [OPEN]: 1 },
      tronApp
    )
  }
  expect(report.errors).toEqual([])
  const outcomeViolation = report.violations.find(
    (violation) => violation.metric === 'outcome'
  )
  expect(outcomeViolation?.id).toBe(OPEN)
  expect(outcomeViolation?.durationMs).toBeGreaterThanOrEqual(
    INJECTED_HANDLER_MS
  )
  const responsivenessViolation = report.violations.find(
    (violation) => violation.metric === 'responsiveness'
  )
  expect(responsivenessViolation?.id).toBe(OPEN)
  expect(responsivenessViolation?.durationMs).toBeGreaterThanOrEqual(
    MIN_INJECTED_DURATION_MS
  )
})

test('harness detects a delayed pointerdown before the command-palette click', async ({
  page,
  cmdBar,
  tronApp,
}, testInfo) => {
  await startCapture(page)
  await page.evaluate((delayMs) => {
    document.addEventListener(
      'pointerdown',
      () => {
        const deadline = performance.now() + delayMs
        while (performance.now() < deadline) {
          // The click may be fast even though an earlier event in its gesture is slow.
        }
      },
      { capture: true, once: true }
    )
  }, INJECTED_HANDLER_MS)

  let report: InteractionReport
  try {
    await cmdBar.cmdBarOpenBtn.hover()
    await page.mouse.down()
    // Let the slow pointerdown finish its frame before creating a fresh click.
    // Otherwise queued pointerup/click input can inherit the same input delay.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 0)
          })
        })
    )
    await page.mouse.up()
    await waitForSample(page, OPEN, 1)
    await waitForInjectedDuration(page)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.delayed-pointerdown',
      { [OPEN]: 1 },
      tronApp
    )
  }
  expect(report.errors).toEqual([])
  const responsivenessViolation = report.violations.find(
    (violation) => violation.metric === 'responsiveness'
  )
  expect(responsivenessViolation?.id).toBe(OPEN)
  expect(responsivenessViolation?.durationMs).toBeGreaterThanOrEqual(
    MIN_INJECTED_DURATION_MS
  )
})

test('harness rejects a missing measurement', async ({
  page,
  tronApp,
}, testInfo) => {
  await startCapture(page)
  const report = await finishCapture(
    page,
    testInfo,
    'harness.missing-click',
    { [OPEN]: 1 },
    tronApp
  )
  expect(report.errors).toContain(`Expected 1 samples for ${OPEN}; received 0.`)
  expect(report.coverage.find((row) => row.id === OPEN)?.maximumMs).toBeNull()
})

test('recorder does not attribute secondary clicks and restart clears prior samples', async ({
  page,
  cmdBar,
  tronApp,
}, testInfo) => {
  await startCapture(page)
  let report: InteractionReport
  try {
    await cmdBar.cmdBarOpenBtn.click({ button: 'right' })
    await page.waitForFunction(
      () => {
        const samples =
          window.app.interactionPerformance?.snapshot().samples ?? []
        return (
          samples.length > 0 &&
          samples.every((sample) => sample.status !== 'pending')
        )
      },
      undefined,
      { timeout: 10_000, polling: POLL_INTERVAL_MS }
    )
    const discovery = await page.evaluate(readCapture)
    const discoveryReport = reportInteractions(discovery, {})
    await testInfo.attach('secondary-click-discovery', {
      body: JSON.stringify(
        { snapshot: discovery, report: discoveryReport },
        null,
        2
      ),
      contentType: 'application/json',
    })
    expect(discovery.samples.every((sample) => sample.id === null)).toBe(true)
    await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
    expect(discoveryReport.errors).toEqual([])
    expect(discoveryReport.unattributed).toBe(discovery.samples.length)
    expect(discoveryReport.unattributed).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
    await startCapture(page)
    const restarted = await page.evaluate(readCapture)
    expect(restarted.samples).toEqual([])
    await cmdBar.cmdBarOpenBtn.click()
    await waitForSample(page, OPEN, 1)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.secondary-click-restart',
      { [OPEN]: 1 },
      tronApp
    )
  }
  expect(report.errors).toEqual([])
  expect(report.unattributed).toBe(0)
  expect(report.coverage.find((row) => row.id === OPEN)?.measured).toBe(1)
})
