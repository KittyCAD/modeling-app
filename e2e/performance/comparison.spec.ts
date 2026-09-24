import {
  COMPARISON_ACTIONS,
  COMPARISON_PLAN,
  COMPARISON_WARM_CYCLES,
} from '@e2e/performance/comparison'
import {
  finishCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import {
  prepareHome,
  prepareModeling,
  scenarioActions,
} from '@e2e/performance/scenarios'
import { expect, test } from '@e2e/performance/test'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const calibrationFault = process.env.INTERACTION_CALIBRATION_FAULT ?? 'none'
if (!['none', 'first', 'warm', 'stall'].includes(calibrationFault)) {
  throw new Error('Unknown interaction calibration fault.')
}
if (
  calibrationFault !== 'none' &&
  (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    !process.env.INTERACTION_BASE_COMMIT ||
    process.env.INTERACTION_BASE_COMMIT !==
      process.env.INTERACTION_CANDIDATE_COMMIT)
) {
  throw new Error('Fault calibration requires a manual identical-build run.')
}

for (const session of COMPARISON_PLAN) {
  test.describe(`block ${session.block + 1} ${session.variant} ${session.context}`, () => {
    test.use({ performanceVariant: session.variant })

    test('collects first and repeated interactions', async ({
      page,
      homePage,
      scene,
      fs,
      folderSetupFn,
      tronApp,
    }, testInfo) => {
      if (session.context === 'home') {
        await prepareHome({ page, homePage })
      } else {
        await prepareModeling({ page, homePage, scene, fs, folderSetupFn })
      }
      const actions = scenarioActions(session.context, page)
      expect(actions.map(({ definition }) => definition.id)).toEqual(
        COMPARISON_ACTIONS[session.context]
      )
      await startCapture(page)
      let report: InteractionReport
      try {
        // The first cycle is retained as first-use; the next ten are warm.
        // No discarded inputs prepare this renderer for measurement.
        for (let cycle = 1; cycle <= COMPARISON_WARM_CYCLES + 1; cycle++) {
          for (const { definition, verify } of actions) {
            if (
              session.variant === 'candidate' &&
              session.context === 'home' &&
              definition.id === COMPARISON_ACTIONS.home[0] &&
              ((calibrationFault === 'first' && cycle === 1) ||
                (calibrationFault === 'warm' && cycle > 1) ||
                (calibrationFault === 'stall' && cycle === 6))
            ) {
              await page.evaluate(() => {
                document.addEventListener(
                  'click',
                  () => {
                    const deadline = performance.now() + 64
                    while (performance.now() < deadline) {
                      // A real, bounded input-handler regression for calibration.
                    }
                  },
                  { capture: true, once: true }
                )
              })
            }
            await page.getByTestId(definition.testId).click()
            await waitForSample(page, definition.id, cycle)
            await verify()
          }
        }
      } finally {
        report = await finishCapture(
          page,
          testInfo,
          `comparison.${session.context}`,
          Object.fromEntries(
            actions.map(({ definition }) => [
              definition.id,
              COMPARISON_WARM_CYCLES + 1,
            ])
          ),
          tronApp,
          session
        )
      }
      // Latency is judged by the reporter after the complete paired schedule.
      // Functional or collection failures still fail this session immediately.
      expect(report.errors, 'Invalid interaction collection').toEqual([])
    })
  })
}
