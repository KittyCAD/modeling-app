import {
  expectInteractionBudget,
  finishCapture,
  readCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const OPEN = interactions.commandPaletteOpen.id
const CLOSE = interactions.commandPaletteClose.id
const POLL_INTERVAL_MS = 10
const INJECTED_HANDLER_MS = 250
const MIN_INJECTED_DURATION_MS = INJECTED_HANDLER_MS - 50

test.afterEach(async ({ page, cmdBar }, testInfo) => {
  // Diagnostic branch only: let Chromium flush its startup trace after scoring.
  await new Promise((resolve) => setTimeout(resolve, 25_000))
  await cmdBar.cmdBarOpenBtn.click()
  await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  await expect(
    page.locator('[data-testid="command-bar-wrapper"] > div')
  ).toHaveCSS('opacity', '1')
  await testInfo.attach('palette-appearance', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await testInfo.attach('presentation-trace', {
    path: testInfo.outputPath('presentation-trace.json'),
    contentType: 'application/json',
  })
})

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
  // Diagnostic-only variants isolate palette raster/compositing costs.
  const variant = process.env.INTERACTION_DIAGNOSTIC_VARIANT
  if (variant === 'composite' || variant === 'shadowless') {
    await page.addStyleTag({
      content:
        variant === 'composite'
          ? '[data-testid="command-bar-wrapper"] > div { will-change: transform, opacity; }'
          : '[data-testid="command-bar"] { box-shadow: none !important; }',
    })
  }

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

    await page.evaluate(() => performance.mark('diagnostic-capture-start'))
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
    expectInteractionBudget(report)
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
  expect(() => expectInteractionBudget(report)).toThrow(
    'Interaction latency budget exceeded'
  )
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
  expect(() => expectInteractionBudget(report)).toThrow(
    'Interaction latency budget exceeded'
  )
  // This is the final gesture: response timing must retain the pointerdown
  // stall even when its optional Event Timing record has not arrived at stop.
  const outcomeViolation = report.violations.find(
    (violation) => violation.metric === 'outcome'
  )
  expect(outcomeViolation?.id).toBe(OPEN)
  expect(outcomeViolation?.durationMs).toBeGreaterThanOrEqual(
    INJECTED_HANDLER_MS
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
  expect(() => expectInteractionBudget(report)).toThrow(
    'Invalid collection is not a passing measurement'
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
  expectInteractionBudget(report)
  expect(report.unattributed).toBe(0)
  expect(report.coverage.find((row) => row.id === OPEN)?.measured).toBe(1)
})
