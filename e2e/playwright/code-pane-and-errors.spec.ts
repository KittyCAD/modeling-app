import { test, expect } from '@playwright/test'

import {
  getUtils,
  setup,
  setupElectron,
  tearDown,
  executorInputPath,
} from './test-utils'
import { join } from 'path'
import { bracket } from 'lib/exampleKcl'
import { TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW } from './storageStates'
import fsp from 'fs/promises'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Code pane and errors', () => {
  test('Typing KCL errors induces a badge on the code pane button', async ({
    page,
  }) => {
    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `// Extruded Triangle
sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([10, 0], %)
  |> line([-5, 10], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(5, sketch001)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

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
  }) => {
    await page.goto('http://localhost:3000')

    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, bracket)

    await page.setViewportSize({ width: 1200, height: 900 })
    await u.waitForAuthSkipAppStart()

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
    await u.openKclCodePanel()
    await page.getByText('thickness, bracketLeg1Sketch)').click()
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
    await u.openKclCodePanel()

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
  }) => {
    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW)

    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

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
          'sketch profile must lie entirely on one side of the revolution axis'
        )
        .first()
    ).toBeVisible()
  })

  test('When error is not in view WITH LINTS you can click the badge to scroll to it', async ({
    page,
  }) => {
    const u = await getUtils(page)

    // Load the app with the working starter code
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW)

    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await page.waitForTimeout(1000)

    // Ensure badge is present
    const codePaneButtonHolder = page.locator('#code-button-holder')
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have no errors in the gutter, since error out of view.
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // click in the editor to focus it
    await page.locator('.cm-content').click()

    await page.waitForTimeout(500)

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
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

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
  async ({ browserName }, testInfo) => {
    // Setup multiple projects.
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        const routerTemplateDir = join(dir, 'router-template-slate')
        const bracketDir = join(dir, 'bracket')
        await Promise.all([
          fsp.mkdir(routerTemplateDir, { recursive: true }),
          fsp.mkdir(bracketDir, { recursive: true }),
        ])
        await Promise.all([
          fsp.copyFile(
            executorInputPath('router-template-slate.kcl'),
            join(routerTemplateDir, 'main.kcl')
          ),
          fsp.copyFile(
            executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
            join(bracketDir, 'main.kcl')
          ),
        ])
      },
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

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
      await expect(page.getByText('New Project')).toBeVisible()
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

    await electronApp.close()
  }
)
