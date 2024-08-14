import { test, expect, Page } from '@playwright/test'

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

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

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

    await expect(page.getByText('Copied')).not.toBeVisible()

    // Hit copy to clipboard.
    const copyToClipboardButton = page.getByRole('button', {
      name: 'Copy to clipboard',
    })
    await expect(copyToClipboardButton).toBeVisible()

    copyToClipboardButton.click()

    // Expect the code to be copied.
    await expect(page.getByText('Copied')).toBeVisible()

    // Click in the code editor.
    await page.locator('.cm-content').click()

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

    // Find the toast close button.
    const closeButton = page.getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeVisible()
    closeButton.click()

    // The toast should disappear.
    await expect(successToastMessage).not.toBeVisible()
  })

  test('you can reject text-to-cad output and it does nothing', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

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
    const rejectButton = page.getByRole('button', { name: 'Reject' })
    await expect(rejectButton).toBeVisible()

    rejectButton.click()

    // The toast should disappear.
    await expect(successToastMessage).not.toBeVisible()

    // Expect no code.
    await expect(page.locator('.cm-content')).toContainText(``)
  })

  test('sending an bad prompt fails', async ({ page }) => {
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
    page.keyboard.type(
      'akjsndladf lajbhflauweyfa;wieufjn;wieJNUF;.wjdfn weh Fwhefb'
    )
    await page.waitForTimeout(1000)
    await page.keyboard.press('Enter')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible()

    const failureToastMessage = page.getByText(`No KCL code returned`)
    await expect(failureToastMessage).toBeVisible()

    // The toast should disappear.
    await expect(failureToastMessage).not.toBeVisible()
  })
})

async function sendPromptFromCommandBar(page: Page, promptStr: string) {
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
  page.keyboard.type(promptStr)
  await page.waitForTimeout(1000)
  await page.keyboard.press('Enter')
}
