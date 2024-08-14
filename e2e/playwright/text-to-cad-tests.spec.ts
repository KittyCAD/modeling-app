import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown } from './test-utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

const CtrlKey = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('Text-to-CAD tests', () => {
  test('basic lego happy case', async ({ page }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Text-to-CAD')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    page.keyboard.type('a 2x4 lego')
    await page.keyboard.press('Enter')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    await page.waitForTimeout(5000)

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible()

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible()

    // Hit copy to clipboard.
    const copyToClipboardButton = page.getByRole('button', { name: 'Accept' })
    await expect(copyToClipboardButton).toBeVisible()

    copyToClipboardButton.click()

    // Click in the code editor.
    await page.locator('textarea').click()

    // Paste the code.
    page.keyboard.down(CtrlKey)
    page.keyboard.press('KeyV')
    page.keyboard.up(CtrlKey)

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`const`)

    // make sure a model renders.
    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()
  })
})
