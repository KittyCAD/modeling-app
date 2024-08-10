import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown } from './test-utils'
import { bracket } from 'lib/exampleKcl'
import { TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW } from './storageStates'

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
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, bracket)

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
    await page.getByText('extrude(').click()
    await page.keyboard.press('Backspace')

    // Ensure that a badge appears on the button
    await expect(codePaneButtonHolder).toContainText('notification')

    // Ensure we have an error diagnostic.
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.getByText('Unexpected token').first()).toBeVisible()

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
    await expect(page.getByText('Unexpected token').first()).toBeVisible()
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
    await page.keyboard.type('const foo_bar = 1')
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
