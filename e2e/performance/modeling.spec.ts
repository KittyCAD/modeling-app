import { prepareModeling } from '@e2e/performance/scenarios'
import {
  expectInteractionBudget,
  finishCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import { expect, test } from '@e2e/performance/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

test.beforeEach(async ({ page, homePage, scene, fs, folderSetupFn }) => {
  await prepareModeling({ page, homePage, scene, fs, folderSetupFn })
})

test('harness waits for usable pane content', async ({
  page,
  tronApp,
}, testInfo) => {
  await page.getByTestId(interactions.codePaneClose.testId).click()
  await expect(page.locator('#code-pane')).toHaveCount(0)
  await startCapture(page)
  let report: InteractionReport
  try {
    for (const { definition, selector } of [
      {
        definition: interactions.codePaneOpen,
        selector: '#code-pane .cm-content',
      },
      {
        definition: interactions.filesPaneOpen,
        selector: '#files-pane [role="treeitem"]',
      },
    ]) {
      // Delay visibility on the real pane, without replacing its content or handlers.
      const style = await page.addStyleTag({
        content: `${selector} { visibility: hidden !important; }`,
      })
      try {
        await style.evaluate((element) => {
          document.addEventListener(
            'click',
            () => {
              setTimeout(() => element.parentNode?.removeChild(element), 250)
            },
            { once: true, capture: true }
          )
        })
        await page.getByTestId(definition.testId).click()
        await waitForSample(page, definition.id, 1)
      } finally {
        await style.evaluate((element) =>
          element.parentNode?.removeChild(element)
        )
      }
    }
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.delayed-pane-content',
      {
        [interactions.codePaneOpen.id]: 1,
        [interactions.filesPaneOpen.id]: 1,
      },
      tronApp
    )
  }
  expect(report.errors).toEqual([])
  expect(() => expectInteractionBudget(report)).toThrow(
    'Interaction latency budget exceeded'
  )
  for (const definition of [
    interactions.codePaneOpen,
    interactions.filesPaneOpen,
  ]) {
    expect(
      report.coverage.find((row) => row.id === definition.id)?.maximumMs
    ).toBeGreaterThanOrEqual(250)
  }
})
