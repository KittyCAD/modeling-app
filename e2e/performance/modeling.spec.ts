import { startDiagnosticTrace } from '@e2e/performance/diagnostic-trace'
import {
  startInteractionDiagnostics,
  stopInteractionDiagnostics,
} from '@e2e/performance/diagnostics'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  expectInteractionBudget,
  finishCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import { expect, test } from '@e2e/playwright/zoo-test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

const projectName = 'interaction-performance'
const modelPath = path.join(
  'rust',
  'kcl-lib',
  'tests',
  'named_views_hide_extrude',
  'input.kcl'
)

// Keep engine startup and project loading outside every measured session.
test.beforeEach(async ({ page, homePage, scene, fs, folderSetupFn }) => {
  await folderSetupFn(async (dir) => {
    const projectDir = path.join(dir, projectName)
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'main.kcl'),
      new Uint8Array(await readFile(modelPath))
    )
  })
  await homePage.waitForAuthentication()
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
  await homePage.openProject(projectName)
  await scene.connectionEstablished()
  await scene.settled()
  await page.waitForFunction(() => {
    const editor = window.app.project?.executingEditor.value
    return (
      editor && !editor.isExecutingSignal.value && editor.artifactGraph.size > 0
    )
  })
  expect(
    await page.evaluate(() => window.app.project?.executingEditor.value?.errors)
  ).toEqual([])
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await page.evaluate(() => document.fonts.ready)

  // The shared Playwright layout starts with Code open and Files closed. Keep
  // that state so first-use includes the first sidebar click on each pane.
  await expect(
    page.getByTestId(interactions.codePaneClose.testId)
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByTestId(interactions.filesPaneOpen.testId)
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
  await expect(page.locator('#code-pane .cm-content')).toBeEditable()
})

for (const scenario of [
  { id: 'modeling.first-use', repetitions: 1, warm: false },
  { id: 'modeling.repeated-use', repetitions: 10, warm: true },
]) {
  test(scenario.id, async ({ page, tronApp }, testInfo) => {
    const actions = [
      {
        definition: interactions.commandPaletteOpen,
        verify: () => expect(page.getByTestId('cmd-bar-search')).toBeEditable(),
      },
      {
        definition: interactions.commandPaletteClose,
        verify: () =>
          expect(page.getByTestId('command-bar-wrapper')).toBeHidden(),
      },
      {
        definition: interactions.codePaneClose,
        verify: () => expect(page.locator('#code-pane')).toHaveCount(0),
      },
      {
        definition: interactions.codePaneOpen,
        verify: () =>
          expect(page.locator('#code-pane .cm-content')).toBeEditable(),
      },
      {
        definition: interactions.filesPaneOpen,
        verify: () =>
          expect(
            page.getByRole('treeitem', { name: 'main.kcl', exact: true })
          ).toBeVisible(),
      },
      {
        definition: interactions.filesPaneClose,
        verify: () => expect(page.locator('#files-pane')).toHaveCount(0),
      },
    ]
    if (scenario.warm) {
      for (const { definition, verify } of actions) {
        await page.getByTestId(definition.testId).click()
        await verify()
      }
    }

    const diagnostics = !scenario.warm
      ? await startInteractionDiagnostics(page)
      : undefined
    const stopTrace = !scenario.warm
      ? await startDiagnosticTrace(tronApp, testInfo)
      : undefined
    await startCapture(page)
    let report: InteractionReport
    try {
      for (let index = 1; index <= scenario.repetitions; index++) {
        for (const { definition, verify } of actions) {
          await page.getByTestId(definition.testId).click()
          await waitForSample(page, definition.id, index)
          await verify()
        }
      }
    } finally {
      report = await finishCapture(
        page,
        testInfo,
        scenario.id,
        Object.fromEntries(
          actions.map(({ definition }) => [definition.id, scenario.repetitions])
        ),
        tronApp
      )
      if (diagnostics) {
        // Diagnostic tail only: observe entries that arrive after capture stops.
        await page.evaluate(
          () => new Promise<void>((resolve) => setTimeout(resolve, 500))
        )
        await stopInteractionDiagnostics(diagnostics, testInfo)
      }
      await stopTrace?.()
    }
    expectInteractionBudget(report)
  })
}

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
