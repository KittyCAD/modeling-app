import { arch, cpus, platform, release, totalmem } from 'node:os'
import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const POLL_INTERVAL_MS = 10

interface EventTimingWitnessEntry {
  name: string
  startTime: number
  duration: number
  interactionId: number
  processingStart: number
  processingEnd: number
  observedAt: number
  delivery: 'callback' | 'before-stop-drain' | 'final-drain'
}

export async function startCapture(page: Page) {
  await page.evaluate(() => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    return recorder.start()
  })
}

export function readCapture() {
  const recorder = window.app.interactionPerformance
  if (!recorder) {
    throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
  }
  return recorder.snapshot()
}

export async function waitForSample(page: Page, id: string, count: number) {
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

export async function finishCapture(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  expected: Readonly<Record<string, number>>,
  tronApp: ElectronZoo | undefined
): Promise<InteractionReport> {
  const witness = await page.evaluateHandle(() => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    const entries: EventTimingWitnessEntry[] = []
    const collect = (
      records: PerformanceEntry[],
      delivery: EventTimingWitnessEntry['delivery']
    ) => {
      const observedAt = performance.now()
      for (const entry of records) {
        if (
          !('interactionId' in entry) ||
          typeof entry.interactionId !== 'number' ||
          !('processingStart' in entry) ||
          typeof entry.processingStart !== 'number' ||
          !('processingEnd' in entry) ||
          typeof entry.processingEnd !== 'number'
        ) {
          continue
        }
        entries.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
          interactionId: entry.interactionId,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          observedAt,
          delivery,
        })
      }
    }
    const observer = new PerformanceObserver((list) =>
      collect(list.getEntries(), 'callback')
    )
    observer.observe({ type: 'event', buffered: true, durationThreshold: 16 })
    try {
      collect(observer.takeRecords(), 'before-stop-drain')
      const stopStartedAt = performance.now()
      const snapshot = recorder.stop()
      const stoppedAt = performance.now()
      return { observer, entries, collect, stopStartedAt, stoppedAt, snapshot }
    } catch (error) {
      observer.disconnect()
      throw error
    }
  })
  try {
    const snapshot = await witness.evaluate(({ snapshot }) => snapshot)
    const report = reportInteractions(snapshot, expected)
    if (!tronApp) throw new Error('Interaction measurements require Electron.')
    const runtime = await tronApp.electron.evaluate(async ({ app }) => ({
      browser: process.versions.chrome,
      electron: process.versions.electron,
      gpu: await app.getGPUInfo('basic'),
      gpuFeatures: app.getGPUFeatureStatus(),
    }))
    console.log(JSON.stringify({ diagnosticGraphics: runtime.gpuFeatures }))
    const metadata = {
      scenario,
      appBuildRun: process.env.INTERACTION_DIAGNOSTIC_BUILD_RUN,
      diagnosticVariant: process.env.INTERACTION_DIAGNOSTIC_VARIANT,
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
      timing: 'pointerdown-to-outcome-observed-after-render',
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
        `Observed budget breaches: ${report.violations.length}`,
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
  } finally {
    try {
      // Observe only the existing metadata/attachment work, without extending capture.
      const evidence = await witness.evaluate((state) => {
        state.collect(state.observer.takeRecords(), 'final-drain')
        state.observer.disconnect()
        const finalSample = state.snapshot.samples.at(-1) ?? null
        const finalInteractionIds = new Set(
          state.entries
            .filter(
              (entry) =>
                entry.startTime === finalSample?.startTime &&
                entry.interactionId !== 0
            )
            .map((entry) => entry.interactionId)
        )
        return {
          stopStartedAt: state.stopStartedAt,
          stoppedAt: state.stoppedAt,
          observedThrough: performance.now(),
          snapshot: state.snapshot,
          entries: state.entries,
          finalSample,
          finalSampleEntries: state.entries.filter(
            (entry) =>
              entry.startTime === finalSample?.startTime ||
              finalInteractionIds.has(entry.interactionId)
          ),
        }
      })
      await testInfo.attach('event-timing-stop-witness', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await witness.dispose()
    }
  }
}

export function expectInteractionBudget(report: InteractionReport) {
  expect(
    report.errors,
    'Invalid collection is not a passing measurement'
  ).toEqual([])
  expect(report.violations, 'Interaction latency budget exceeded').toEqual([])
}
