import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ComparisonContext } from '@e2e/performance/comparison'
import type { PerformanceModelProfile } from '@e2e/performance/models'
import {
  assertModelLoaded,
  appendProfileError,
  copyProfileModelFiles,
  modelCodeForProfile,
  isErrorProfile,
} from '@e2e/performance/models'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { ModelingDialogFixture } from '@e2e/playwright/fixtures/modelingDialogFixture'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionDescription } from '@src/lib/interactionPerformance/types'

export type ScenarioFixtures = Pick<
  Fixtures,
  'homePage' | 'scene' | 'fs' | 'folderSetupFn'
> & { page: Page; modelProfile?: PerformanceModelProfile }

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

export async function prepareModeling(
  {
    page,
    homePage,
    scene,
    fs,
    folderSetupFn,
    modelProfile = 'small',
  }: ScenarioFixtures,
  { code }: { code?: string } = {}
) {
  const projectName = 'interaction-performance'
  await folderSetupFn(async (dir) => {
    const projectDir = path.join(dir, projectName)
    await fs.mkdir(projectDir, { recursive: true })
    await copyProfileModelFiles(fs, projectDir, modelProfile)
    await fs.writeFile(
      path.join(projectDir, 'main.kcl'),
      new TextEncoder().encode(
        modelCodeForProfile(
          code ??
            (await readFile(
              path.join(
                'rust',
                'kcl-lib',
                'tests',
                'named_views_hide_extrude',
                'input.kcl'
              ),
              'utf8'
            )),
          modelProfile
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
  const loadStartedAt = Date.now()
  await homePage.openProject(projectName)
  // The socket can be ready before the initial execution or its automatic
  // reconnect finishes. Wait for usable modeling tools before validating it.
  await scene.connectionEstablished()
  await expect(scene.startEditSketchBtn).toBeEnabled({ timeout: 90_000 })
  const successfulLoad = await assertModelLoaded({
    page,
    modelProfile: isErrorProfile(modelProfile) ? 'large' : modelProfile,
  })
  await appendProfileError({ page, modelProfile })
  const evidence = await assertModelLoaded({ page, modelProfile })
  await scene.settled({ expectError: isErrorProfile(modelProfile) })
  await page.evaluate(() => document.fonts.ready)
  await test.info().attach('model-setup', {
    body: JSON.stringify({
      ...evidence,
      successfulLoad: isErrorProfile(modelProfile) ? successfulLoad : undefined,
      modelLoadMs: Date.now() - loadStartedAt,
    }),
    contentType: 'application/json',
  })
  // Preserve the initial layout, so the first cycle contains the first pane inputs.
  await expect(
    page.getByTestId(interactions.codePaneClose.testId)
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByTestId(interactions.filesPaneOpen.testId)
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
  await expect(page.locator('#code-pane .cm-content')).toBeEditable()
  await expect(
    page.getByTestId(interactions.featureTreeOpen.testId)
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByRole('button', { name: /transform: open menu$/ })
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId(interactions.extrudeOpen.testId)).toBeEnabled()
}

interface ScenarioAction {
  definition: InteractionDescription
  control?: Locator
  verify: () => Promise<void>
}

export function scenarioActions(
  context: ComparisonContext,
  page: Page
): ScenarioAction[] {
  const modelingDialog = new ModelingDialogFixture(page)
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
        {
          definition: interactions.featureTreeOpen,
          verify: async () => {
            await expect(
              page
                .locator('#operations-list-pane')
                .getByTestId('feature-tree-operation-item')
                .first()
            ).toBeVisible()
            await expect(
              page.getByTestId('operation-group-caret').first()
            ).toHaveAttribute('aria-expanded', 'false')
          },
        },
        {
          definition: interactions.sketchGroupExpand,
          control: page.getByTestId('operation-group-caret').first(),
          verify: async () => {
            const control = page.getByTestId('operation-group-caret').first()
            await expect(control).toHaveAttribute('aria-expanded', 'true')
            const panelId = await control.getAttribute('aria-controls')
            expect(panelId).toBeTruthy()
            await expect(
              page
                .locator(`[id="${panelId}"]`)
                .getByTestId('feature-tree-operation-item')
                .first()
            ).toBeVisible()
          },
        },
        {
          definition: interactions.sketchGroupCollapse,
          control: page.getByTestId('operation-group-caret').first(),
          verify: async () => {
            const control = page.getByTestId('operation-group-caret').first()
            await expect(control).toHaveAttribute('aria-expanded', 'false')
            await expect(control).not.toHaveAttribute('aria-controls')
          },
        },
        {
          definition: interactions.featureTreeClose,
          verify: () =>
            expect(page.locator('#operations-list-pane')).toHaveCount(0),
        },
        {
          definition: interactions.transformMenuOpen,
          control: page.getByRole('button', {
            name: /transform: open menu$/,
          }),
          verify: async () => {
            for (const tool of ['translate', 'rotate']) {
              await expect(page.getByTestId(`dropdown-${tool}`)).toBeVisible()
              await expect(page.getByTestId(`dropdown-${tool}`)).toBeEnabled()
            }
          },
        },
        {
          definition: interactions.transformMenuClose,
          control: page.getByRole('button', {
            name: /transform: open menu$/,
          }),
          verify: async () => {
            await expect(page.getByTestId('dropdown-translate')).toBeHidden()
            await expect(page.getByTestId('dropdown-rotate')).toBeHidden()
          },
        },
        {
          definition: interactions.extrudeOpen,
          verify: async () => {
            if (await modelingDialog.locator.isVisible()) {
              await expect(modelingDialog.locator).toHaveAccessibleName(
                'Extrude'
              )
              await expect(modelingDialog.selection('Profiles')).toBeVisible()
              await expect(modelingDialog.selection('Profiles')).toBeEnabled()
              await expect(modelingDialog.cancelButton).toBeVisible()
              await expect(modelingDialog.cancelButton).toBeEnabled()
            } else {
              await expect(page.getByTestId('command-name')).toHaveText(
                'Extrude'
              )
              await expect(page.locator('#arg-form label')).toContainText(
                /Please select|regions? selected/
              )
              await expect(
                page.locator('#arg-form input[name="selection"]')
              ).toBeEnabled()
              await expect(
                page.getByTestId(interactions.commandPaletteClose.testId)
              ).toBeEnabled()
            }
          },
        },
        {
          definition: interactions.extrudeCancel,
          control: modelingDialog.cancelButton.or(
            page.getByTestId(interactions.commandPaletteClose.testId)
          ),
          verify: async () => {
            await expect(modelingDialog.locator).toHaveCount(0)
            await expect(page.getByTestId('command-bar-wrapper')).toHaveCount(0)
          },
        },
      ]
}
