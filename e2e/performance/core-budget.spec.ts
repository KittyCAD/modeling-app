import {
  expectInteractionBudget,
  finishCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import {
  assertErrorModelPreserved,
  assertModelLoaded,
  MODEL_PROFILES,
} from '@e2e/performance/models'
import { prepareModeling, scenarioActions } from '@e2e/performance/scenarios'
import { test } from '@e2e/performance/test'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

// Reuse the paired suite's action list so new registered modeling controls also
// inherit all four model profiles in the absolute budget checks.
for (const profile of MODEL_PROFILES) {
  test.describe(`modeling-${profile}`, () => {
    test.use({ modelProfile: profile })

    test('existing modeling controls stay under budget', async ({
      page,
      homePage,
      scene,
      fs,
      folderSetupFn,
      tronApp,
      modelProfile,
    }, testInfo) => {
      await prepareModeling({
        page,
        homePage,
        scene,
        fs,
        folderSetupFn,
        modelProfile,
      })
      const actions = scenarioActions(`modeling-${profile}`, page)
      const before = await assertModelLoaded({ page, modelProfile })
      await startCapture(
        page,
        actions.map(({ definition }) => definition.id)
      )
      let report: InteractionReport
      try {
        for (const { definition, control, verify } of actions) {
          await (control ?? page.getByTestId(definition.testId)).click()
          await waitForSample(page, definition.id, 1)
          await verify()
          await assertErrorModelPreserved({ page, modelProfile }, before)
        }
      } finally {
        report = await finishCapture(
          page,
          testInfo,
          `budget.${profile}.existing-controls`,
          Object.fromEntries(
            actions.map(({ definition }) => [definition.id, 1])
          ),
          tronApp,
          undefined,
          profile
        )
      }
      expectInteractionBudget(report)
    })
  })
}
