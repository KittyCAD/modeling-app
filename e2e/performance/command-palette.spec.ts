import { arch, cpus, platform, release, totalmem } from 'node:os'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page, TestInfo } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const OPEN = 'zds.commandPalette.open'
const CLOSE = 'zds.commandPalette.close'

test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })

async function waitForSample(page: Page, id: string, count: number) {
  await page.waitForFunction(
    ({ id, count }) =>
      window.app.interactionPerformance
        .snapshot()
        .samples.filter(
          (sample) => sample.id === id && sample.status === 'complete'
        ).length === count,
    { id, count },
    { timeout: 10_000, polling: 100 }
  )
}

async function waitForInjectedHandler(page: Page) {
  // The injected 250 ms handler must produce an entry. Wait for delivery, not
  // an assumed frame count; leave margin for browser timestamp precision.
  await page.waitForFunction(
    () =>
      window.app.interactionPerformance
        .snapshot()
        .samples.some(
          (sample) =>
            sample.eventTiming !== null &&
            sample.eventTiming.processingMs >= 200
        ),
    undefined,
    { timeout: 10_000, polling: 100 }
  )
}

async function finishCapture(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  expected: Readonly<Record<string, number>>
): Promise<InteractionReport> {
  const snapshot = await page.evaluate(() =>
    window.app.interactionPerformance.stop()
  )
  const report = reportInteractions(snapshot, expected)
  const metadata = {
    scenario,
    repeatIndex: testInfo.repeatEachIndex,
    commit: process.env.GITHUB_SHA ?? null,
    runner: process.env.RUNNER_NAME ?? 'local',
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    browser: page.context().browser()?.version() ?? null,
    viewport: page.viewportSize(),
    motion: 'no-preference',
    timing: 'input-to-outcome-observed-after-render',
  }
  // Preserve raw records before assertions so a failed collection is inspectable.
  await testInfo.attach('interaction-measurements', {
    body: JSON.stringify({ metadata, snapshot, report }, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('interaction-summary', {
    body: [
      `Scenario: ${scenario}`,
      `Collection errors: ${report.errors.length}`,
      `Metric violations at or above ${report.budgetMs} ms: ${report.violations.length} (report only)`,
      `Unattributed clicks: ${report.unattributed}`,
      ...report.coverage.map(
        (row) =>
          `${row.id}: measured ${row.measured}/${row.expected ?? 'not scheduled'}, outcome maximum ${row.maximumMs ?? 'missing'} ms, outcome p50 ${row.p50Ms ?? 'missing'} ms, outcome p95 ${row.p95Ms ?? 'missing'} ms, Event Timing reported ${row.eventTimingMeasured}/${row.exercised}, responsiveness maximum ${row.responsivenessMaximumMs ?? 'unreported'} ms`
      ),
      ...report.errors,
    ].join('\n'),
    contentType: 'text/plain',
  })
  return report
}

test.beforeEach(async ({ page, homePage, cmdBar }) => {
  await homePage.waitForAuthentication()
  await homePage.expectIsCurrentPage()
  await homePage.projectsLoaded()
  // The shared functional fixture requests reduced motion. Score normal motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await expect(cmdBar.cmdBarOpenBtn).toBeEnabled()
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
})

for (const scenario of [
  { id: 'command-palette.first-use', repetitions: 1, warm: false },
  { id: 'command-palette.repeated-use', repetitions: 10, warm: true },
]) {
  test(scenario.id, async ({ page, cmdBar }, testInfo) => {
    const close = page.getByTestId('command-bar-close-button')
    if (scenario.warm) {
      await cmdBar.cmdBarOpenBtn.click()
      await expect(page.getByTestId('cmd-bar-search')).toBeVisible()
      await close.click()
      await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
    }

    await page.evaluate(() => window.app.interactionPerformance.start())
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
      report = await finishCapture(page, testInfo, scenario.id, {
        [OPEN]: scenario.repetitions,
        [CLOSE]: scenario.repetitions,
      })
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
}, testInfo) => {
  await page.evaluate(() => window.app.interactionPerformance.start())
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      () => {
        // Scoped fault injection into the actual app path, removed after one click.
        const deadline = performance.now() + 250
        while (performance.now() < deadline) {
          // Hold the main thread so input-to-outcome must include this delay.
        }
      },
      { capture: true, once: true }
    )
  })

  let report: InteractionReport
  try {
    await cmdBar.cmdBarOpenBtn.click()
    await waitForSample(page, OPEN, 1)
    await waitForInjectedHandler(page)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(page, testInfo, 'harness.delayed-click', {
      [OPEN]: 1,
    })
  }
  expect(report.errors).toEqual([])
  const outcomeViolation = report.violations.find(
    (violation) => violation.metric === 'outcome'
  )
  expect(outcomeViolation?.id).toBe(OPEN)
  expect(outcomeViolation?.durationMs).toBeGreaterThanOrEqual(250)
  expect(
    await page.evaluate(
      () =>
        window.app.interactionPerformance.snapshot().samples[0]?.eventTiming
          ?.processingMs
    )
  ).toBeGreaterThanOrEqual(200)
})

test('harness detects a delayed pointerdown before the command-palette click', async ({
  page,
  cmdBar,
}, testInfo) => {
  await page.evaluate(() => window.app.interactionPerformance.start())
  await page.evaluate(() => {
    document.addEventListener(
      'pointerdown',
      () => {
        const deadline = performance.now() + 250
        while (performance.now() < deadline) {
          // The click may be fast even though an earlier event in its gesture is slow.
        }
      },
      { capture: true, once: true }
    )
  })

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
    await waitForInjectedHandler(page)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.delayed-pointerdown',
      { [OPEN]: 1 }
    )
  }
  expect(report.errors).toEqual([])
  const responsivenessViolation = report.violations.find(
    (violation) => violation.metric === 'responsiveness'
  )
  expect(responsivenessViolation?.id).toBe(OPEN)
  expect(responsivenessViolation?.durationMs).toBeGreaterThanOrEqual(
    report.budgetMs
  )
  expect(
    await page.evaluate(
      () =>
        window.app.interactionPerformance.snapshot().samples[0]?.eventTiming
          ?.processingMs
    )
  ).toBeGreaterThanOrEqual(200)
})

test('harness rejects a missing measurement', async ({ page }, testInfo) => {
  await page.evaluate(() => window.app.interactionPerformance.start())
  const report = await finishCapture(page, testInfo, 'harness.missing-click', {
    [OPEN]: 1,
  })
  expect(report.errors).toContain(`Expected 1 samples for ${OPEN}; received 0.`)
  expect(report.coverage.find((row) => row.id === OPEN)?.maximumMs).toBeNull()
})

test('secondary clicks remain discovery records and restart clears the session', async ({
  page,
  cmdBar,
}, testInfo) => {
  await page.evaluate(() => window.app.interactionPerformance.start())
  let report: InteractionReport
  try {
    await cmdBar.cmdBarOpenBtn.click({ button: 'right' })
    await page.waitForFunction(
      () => {
        const { samples } = window.app.interactionPerformance.snapshot()
        return (
          samples.length > 0 &&
          samples.every((sample) => sample.status !== 'pending')
        )
      },
      undefined,
      { timeout: 10_000, polling: 100 }
    )
    const discovery = await page.evaluate(() =>
      window.app.interactionPerformance.snapshot()
    )
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
    const restarted = await page.evaluate(() => {
      window.app.interactionPerformance.start()
      return window.app.interactionPerformance.snapshot()
    })
    expect(restarted.samples).toEqual([])
    await cmdBar.cmdBarOpenBtn.click()
    await waitForSample(page, OPEN, 1)
    await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.secondary-click-restart',
      { [OPEN]: 1 }
    )
  }
  expect(report.errors).toEqual([])
  expect(report.unattributed).toBe(0)
  expect(report.coverage.find((row) => row.id === OPEN)?.measured).toBe(1)
})
