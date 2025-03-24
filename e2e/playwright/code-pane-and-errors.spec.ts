import { bracket } from '@src/lib/exampleKcl'
import fsp from 'fs/promises'
import { join } from 'path'

import { TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW } from '@e2e/playwright/storageStates'
import {
  executorInputPath,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Code pane and errors', { tag: ['@skipWin'] }, () => {
  test('Typing KCL errors induces a badge on the code pane button', async ({
    page,
    homePage,
    scene,
  }) => {
    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
// Extruded Triangle
sketch001 = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> line(end = [10, 0])
  |> line(end = [-5, 10])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 5)`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // Ensure no badge is present
    const codePaneButtonHolder = page.locator('#code-button-holder')
    await expect(codePaneButtonHolder).not.toContainText('notification')

    // Delete a character to break the KCL
    await u.openKclCodePanel()
    await page.getByText('extrude(').click()
    await page.keyboard.press('Backspace')

    // Ensure that a badge appears on the button
    await expect(codePaneButtonHolder).toContainText('notification')
  })

  test('Opening and closing the code pane will consistently show error diagnostics', async ({
    page,
    homePage,
    editor,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, bracket)

    await page.setBodyDimensions({ width: 1200, height: 900 })
    await homePage.goToModelingScene()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Ensure we have no errors in the gutter.
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Ensure no badge is present
    const codePaneButton = page.getByRole('button', { name: 'KCL Code pane' })
    const codePaneButtonHolder = page.locator('#code-button-holder')
    await expect(codePaneButtonHolder).not.toContainText('notification')

    // Delete a character to break the KCL
    await editor.openPane()
    await editor.scrollToText('bracketLeg1Sketch, length = thickness)')
    await page
      .getByText('extrude(bracketLeg1Sketch, length = thickness)')
      .click()
    await page.keyboard.press('Backspace')

    // Ensure that a badge appears on the button
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have an error diagnostic.
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.locator('.cm-tooltip').first()).toBeVisible()

    // Close the code pane
    await codePaneButton.click()

    await page.waitForTimeout(500)

    // Ensure that a badge appears on the button
    await expect(codePaneButtonHolder).toContainText('notification')
    // Ensure we have no errors in the gutter.
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Open the code pane
    await editor.openPane()

    // Go to our problematic code again (missing closing paren!)
    await editor.scrollToText('extrude(bracketLeg1Sketch, length = thickness')

    // Ensure that a badge appears on the button
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have an error diagnostic.
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.locator('.cm-tooltip').first()).toBeVisible()
  })

  test('When error is not in view you can click the badge to scroll to it', async ({
    page,
    homePage,
    context,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    // Load the app with the working starter code
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW)

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    await page.waitForTimeout(1000)

    // Ensure badge is present
    const codePaneButtonHolder = page.locator('#code-button-holder')
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have no errors in the gutter, since error out of view.
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Click the badge.
    const badge = page.locator('#code-badge')
    await expect(badge).toBeVisible()
    await badge.click()

    // Ensure we have an error diagnostic.
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()

    // Hover over the error to see the error message
    await page.hover('.cm-lint-marker-error')
    await expect(
      page
        .getByText(
          'Modeling command failed: [ApiError { error_code: InternalEngine, message: "Solid3D revolve failed:  sketch profile must lie entirely on one side of the revolution axis" }]'
        )
        .first()
    ).toBeVisible()
  })

  test('When error is not in view WITH LINTS you can click the badge to scroll to it', async ({
    context,
    page,
    homePage,
  }) => {
    // Load the app with the working starter code
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW)

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // FIXME: await scene.waitForExecutionDone() does not work. It still fails.
    // I needed to increase this timeout to get this to pass.
    await page.waitForTimeout(10000)

    // Ensure badge is present
    const codePaneButtonHolder = page.locator('#code-button-holder')
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have no errors in the gutter, since error out of view.
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // click in the editor to focus it
    await page.locator('.cm-content').click()

    await page.waitForTimeout(2000)

    // go to the start of the editor and enter more text which will trigger
    // a lint error.
    // GO to the start of the editor.
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.type('foo_bar = 1')
    await page.waitForTimeout(2000)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2000)

    // ensure we have a lint error
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // Click the badge.
    const badge = page.locator('#code-badge')
    await expect(badge).toBeVisible()
    await badge.click()

    // Ensure we have an error diagnostic.
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()

    // Hover over the error to see the error message
    await page.hover('.cm-lint-marker-error')
    await expect(
      page
        .getByText(
          'sketch profile must lie entirely on one side of the revolution axis'
        )
        .first()
    ).toBeVisible()
  })
})

test(
  'Opening multiple panes persists when switching projects',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    // Setup multiple projects.
    await context.folderSetupFn(async (dir) => {
      const routerTemplateDir = join(dir, 'router-template-slate')
      const bracketDir = join(dir, 'bracket')
      await Promise.all([
        fsp.mkdir(routerTemplateDir, { recursive: true }),
        fsp.mkdir(bracketDir, { recursive: true }),
      ])
      await Promise.all([
        fsp.copyFile(
          executorInputPath('cylinder-inches.kcl'),
          join(routerTemplateDir, 'main.kcl')
        ),
        fsp.copyFile(
          executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
          join(bracketDir, 'main.kcl')
        ),
      ])
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await test.step('Opening the bracket project should load', async () => {
      await expect(page.getByText('bracket')).toBeVisible()

      await page.getByText('bracket').click()

      await u.waitForPageLoad()
    })

    // If they're open by default, we're not actually testing anything.
    await test.step('Pre-condition: panes are not already visible', async () => {
      await expect(page.locator('#variables-pane')).not.toBeVisible()
      await expect(page.locator('#logs-pane')).not.toBeVisible()
    })

    await test.step('Open multiple panes', async () => {
      await u.openKclCodePanel()
      await u.openVariablesPane()
      await u.openLogsPane()
    })

    await test.step('Clicking the logo takes us back to the projects page / home', async () => {
      await page.getByTestId('app-logo').click()

      await expect(page.getByRole('link', { name: 'bracket' })).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('Create project')).toBeVisible()
    })

    await test.step('Opening the router-template project should load', async () => {
      await expect(page.getByText('router-template-slate')).toBeVisible()

      await page.getByText('router-template-slate').click()

      await u.waitForPageLoad()
    })

    await test.step('All panes opened before should be visible', async () => {
      await expect(page.locator('#code-pane')).toBeVisible()
      await expect(page.locator('#variables-pane')).toBeVisible()
      await expect(page.locator('#logs-pane')).toBeVisible()
    })
  }
)

test(
  'external change of file contents are reflected in editor',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    const PROJECT_DIR_NAME = 'lee-was-here'
    const { dir: projectsDir } = await context.folderSetupFn(async (dir) => {
      const aProjectDir = join(dir, PROJECT_DIR_NAME)
      await fsp.mkdir(aProjectDir, { recursive: true })
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await test.step('Open the project', async () => {
      await expect(page.getByText(PROJECT_DIR_NAME)).toBeVisible()
      await page.getByText(PROJECT_DIR_NAME).click()
      await u.waitForPageLoad()
    })

    await u.openFilePanel()
    await u.openKclCodePanel()

    await test.step('Write to file externally and check for changed content', async () => {
      const content = 'ha he ho ho ha blap scap be dap'
      await fsp.writeFile(
        join(projectsDir, PROJECT_DIR_NAME, 'main.kcl'),
        content
      )
      await u.editorTextMatches(content)
    })
  }
)
