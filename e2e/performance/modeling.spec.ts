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

test('harness waits for usable modeling content', async ({
  page,
  tronApp,
}, testInfo) => {
  await page.getByTestId(interactions.codePaneClose.testId).click()
  await expect(page.locator('#code-pane')).toHaveCount(0)
  const delayedContent = [
    {
      definition: interactions.codePaneOpen,
      selector: '#code-pane .cm-content',
      control: page.getByTestId(interactions.codePaneOpen.testId),
    },
    {
      definition: interactions.filesPaneOpen,
      selector: '#files-pane [role="treeitem"]',
      control: page.getByTestId(interactions.filesPaneOpen.testId),
    },
    {
      definition: interactions.featureTreeOpen,
      selector:
        '#operations-list-pane [data-testid="feature-tree-operation-item"] > button',
      control: page.getByTestId(interactions.featureTreeOpen.testId),
    },
    {
      definition: interactions.sketchGroupExpand,
      selector:
        '#operations-list-pane [id^="headlessui-disclosure-panel-"] [data-testid="feature-tree-operation-item"] > button',
      control: page.getByTestId('operation-group-caret').first(),
    },
    {
      definition: interactions.transformMenuOpen,
      selector:
        '[data-testid="dropdown-translate"], [data-testid="dropdown-rotate"]',
      control: page.getByRole('button', {
        name: /transform: open menu$/,
      }),
    },
    {
      definition: interactions.extrudeOpen,
      selector: '#arg-form label',
      control: page.getByTestId(interactions.extrudeOpen.testId),
    },
  ]
  await startCapture(page)
  let report: InteractionReport
  try {
    for (const { definition, selector, control } of delayedContent) {
      // Delay the real content without replacing its UI or event handlers.
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
        await control.click()
        await waitForSample(page, definition.id, 1)
      } finally {
        await style.evaluate((element) =>
          element.parentNode?.removeChild(element)
        )
      }
      if (definition.id === interactions.transformMenuOpen.id) {
        await control.click()
        await waitForSample(page, interactions.transformMenuClose.id, 1)
      }
    }
  } finally {
    report = await finishCapture(
      page,
      testInfo,
      'harness.delayed-pane-content',
      {
        ...Object.fromEntries(
          delayedContent.map(({ definition }) => [definition.id, 1])
        ),
        [interactions.transformMenuClose.id]: 1,
      },
      tronApp
    )
  }
  expect(report.errors).toEqual([])
  expect(() => expectInteractionBudget(report)).toThrow(
    'Interaction latency budget exceeded'
  )
  for (const { definition } of delayedContent) {
    expect(
      report.coverage.find((row) => row.id === definition.id)?.maximumMs
    ).toBeGreaterThanOrEqual(250)
  }
})
