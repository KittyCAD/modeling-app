import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import type { ComparisonContext } from '@e2e/performance/comparison'
import { interactions } from '@src/lib/interactionPerformance/definitions'

export type ScenarioFixtures = Pick<
  Fixtures,
  'homePage' | 'scene' | 'fs' | 'folderSetupFn'
> & { page: Page }

export async function prepareHome({
  page,
  homePage,
}: Pick<ScenarioFixtures, 'page' | 'homePage'>) {
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
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await expect(
    page.getByTestId(interactions.commandPaletteOpen.testId)
  ).toBeEnabled()
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
}

export async function prepareModeling({
  page,
  homePage,
  scene,
  fs,
  folderSetupFn,
}: ScenarioFixtures) {
  const projectName = 'interaction-performance'
  await folderSetupFn(async (dir) => {
    const projectDir = path.join(dir, projectName)
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'main.kcl'),
      new Uint8Array(
        await readFile(
          path.join(
            'rust',
            'kcl-lib',
            'tests',
            'named_views_hide_extrude',
            'input.kcl'
          )
        )
      )
    )
  })
  await homePage.waitForAuthentication()
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
  // Select the scored viewport before loading, including stream configuration.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setBodyDimensions({ width: 1200, height: 800 })
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
  await page.evaluate(() => document.fonts.ready)
  // Preserve the initial layout, so the first cycle contains the first pane inputs.
  await expect(
    page.getByTestId(interactions.codePaneClose.testId)
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByTestId(interactions.filesPaneOpen.testId)
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
  await expect(page.locator('#code-pane .cm-content')).toBeEditable()
}

export function scenarioActions(context: ComparisonContext, page: Page) {
  const palette = [
    {
      definition: interactions.commandPaletteOpen,
      verify: () => expect(page.getByTestId('cmd-bar-search')).toBeEditable(),
    },
    {
      definition: interactions.commandPaletteClose,
      verify: () =>
        expect(page.getByTestId('command-bar-wrapper')).toBeHidden(),
    },
  ]
  return context === 'home'
    ? palette
    : [
        ...palette,
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
}
