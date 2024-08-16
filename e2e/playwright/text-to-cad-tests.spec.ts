import { test, expect, Page } from '@playwright/test'
import * as fsp from 'fs/promises'
import { getUtils, setup, setupElectron, tearDown } from './test-utils'
import { join } from 'path'

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

    await test.step('Set up', async () => {
      await page.setViewportSize({ width: 1000, height: 500 })
      await u.waitForAuthSkipAppStart()
    })

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

    await copyToClipboardButton.click()

    // Expect the code to be copied.
    await expect(page.getByText('Copied')).toBeVisible()

    // Click in the code editor.
    await page.locator('.cm-content').click()

    // Paste the code.
    await page.keyboard.press('ControlOrMeta+KeyV')

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`const`)

    // make sure a model renders.
    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Find the toast close button.
    const closeButton = page
      .getByRole('status')
      .locator('div')
      .filter({ hasText: 'Text-to-CAD successfulPrompt' })
      .first()
      .getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()

    // The toast should disappear.
    await expect(successToastMessage).not.toBeVisible()
  })

  test('success model, then ignore success toast, user can create new prompt from command bar', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    await sendPromptFromCommandBar(page, 'a 2x6 lego')

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

    await expect(successToastMessage).toBeVisible()

    // Can send a new prompt from the command bar.
    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    // Find the toast.
    // Look out for the toast message
    await expect(submittingToastMessage).toBeVisible()

    await page.waitForTimeout(5000)

    await expect(generatingToastMessage).toBeVisible()

    // Expect 2 success toasts.
    await expect(successToastMessage).toHaveCount(2)
    await expect(page.getByText('a 2x4 lego')).toBeVisible()
    await expect(page.getByText('a 2x6 lego')).toBeVisible()
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

    await rejectButton.click()

    // The toast should disappear.
    await expect(successToastMessage).not.toBeVisible()

    // Expect no code.
    await expect(page.locator('.cm-content')).toContainText(``)
  })

  test('sending a bad prompt fails, can dismiss', async ({ page }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Text-to-CAD')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    await page.keyboard.type('akjsndladf ghgsssswefiuwq22262664')
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

    const failureToastMessage = page.getByText(
      `The prompt must clearly describe a CAD model`
    )
    await expect(failureToastMessage).toBeVisible()

    await page.waitForTimeout(1000)

    // Make sure the toast did not say it was successful.
    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).not.toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()

    // Find the toast dismiss button.
    const dismissButton = page.getByRole('button', { name: 'Dismiss' })
    await expect(dismissButton).toBeVisible()
    await dismissButton.click()

    // The toast should disappear.
    await expect(failureToastMessage).not.toBeVisible()
  })

  test('sending a bad prompt fails, can start over from toast', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Text-to-CAD')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    const badPrompt = 'akjsndladf lajbhflauweyfaaaljhr472iouafyvsssssss'

    // Type the prompt.
    await page.keyboard.type(badPrompt)
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

    const failureToastMessage = page.getByText(
      `The prompt must clearly describe a CAD model`
    )
    await expect(failureToastMessage).toBeVisible()

    await page.waitForTimeout(1000)

    // Make sure the toast did not say it was successful.
    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).not.toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()

    // Click the edit prompt button to try again.
    const editPromptButton = page.getByRole('button', { name: 'Edit prompt' })
    await expect(editPromptButton).toBeVisible()
    await editPromptButton.click()

    // The toast should disappear.
    await expect(failureToastMessage).not.toBeVisible()

    // Make sure the old prompt is still there and can be edited.
    await expect(page.locator('textarea')).toContainText(badPrompt)

    // Select all and start a new prompt.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyA')
    await page.keyboard.up(CtrlKey)
    await page.keyboard.type('a 2x4 lego')

    // Submit the new prompt.
    await page.keyboard.press('Enter')

    // Make sure the new prompt works.
    // Find the toast.
    // Look out for the toast message
    await expect(submittingToastMessage).toBeVisible()

    await page.waitForTimeout(5000)

    await expect(generatingToastMessage).toBeVisible()

    await expect(successToastMessage).toBeVisible()
  })

  test('sending a bad prompt fails, can ignore toast, can start over from command bar', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Text-to-CAD')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    const badPrompt = 'akjsndladf lajbhflauweyfa;wieufjn---4;'

    // Type the prompt.
    await page.keyboard.type(badPrompt)
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

    const failureToastMessage = page.getByText(
      `The prompt must clearly describe a CAD model`
    )
    await expect(failureToastMessage).toBeVisible()

    await page.waitForTimeout(1000)

    // Make sure the toast did not say it was successful.
    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).not.toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()

    // They should be able to try again from the command bar.
    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    // Find the toast.
    // Look out for the toast message
    await expect(submittingToastMessage).toBeVisible()

    await page.waitForTimeout(5000)

    await expect(generatingToastMessage).toBeVisible()

    await expect(successToastMessage).toBeVisible()

    await expect(page.getByText('Copied')).not.toBeVisible()

    // old failure toast should stick around.
    await expect(failureToastMessage).toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()
  })

  test('ensure you can shift+enter in the prompt box', async ({ page }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const promptWithNewline = `a 2x4\nlego`

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Text-to-CAD')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    await page.keyboard.type('a 2x4')
    await page.waitForTimeout(1000)
    await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift')
    await page.keyboard.type('lego')
    await page.waitForTimeout(1000)
    await page.keyboard.press('Enter')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    await page.waitForTimeout(1000)

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible()
    await page.waitForTimeout(5000)

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible()

    await expect(page.getByText(promptWithNewline)).toBeVisible()
  })

  test('can do many at once and get many prompts back, and interact with many', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    await sendPromptFromCommandBar(page, 'a 2x8 lego')

    await sendPromptFromCommandBar(page, 'a 2x10 lego')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage.first()).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage.first()).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    // We should have three success toasts.
    await expect(successToastMessage).toHaveCount(3, { timeout: 15000 })

    await expect(page.getByText('Copied')).not.toBeVisible()

    await expect(page.getByText(`a 2x4 lego`)).toBeVisible()
    await expect(page.getByText(`a 2x8 lego`)).toBeVisible()
    await expect(page.getByText(`a 2x10 lego`)).toBeVisible()

    // Ensure if you reject one, the others stay.
    const rejectButton = page.getByRole('button', { name: 'Reject' })
    await expect(rejectButton.first()).toBeVisible()
    // Click the reject button on the first toast.
    await rejectButton.first().click()

    // The first toast should disappear, but not the others.
    await expect(page.getByText(`a 2x10 lego`)).not.toBeVisible()
    await expect(page.getByText(`a 2x8 lego`)).toBeVisible()
    await expect(page.getByText(`a 2x4 lego`)).toBeVisible()

    // Ensure you can copy the code for one of the models remaining.
    const copyToClipboardButton = page.getByRole('button', {
      name: 'Copy to clipboard',
    })
    await expect(copyToClipboardButton.first()).toBeVisible()
    // Click the button.
    await copyToClipboardButton.first().click()

    // Expect the code to be copied.
    await expect(page.getByText('Copied')).toBeVisible()

    // Click in the code editor.
    await page.locator('.cm-content').click({ position: { x: 10, y: 10 } })

    // Paste the code.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyV')
    await page.keyboard.up(CtrlKey)

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`2x8`)

    // Find the toast close button.
    const closeButton = page
      .getByRole('status')
      .locator('div')
      .filter({ hasText: 'Text-to-CAD successfulPrompt' })
      .first()
      .getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()

    // Ensure the final toast remains.
    await expect(page.getByText(`a 2x10 lego`)).not.toBeVisible()
    await expect(page.getByText(`a 2x8 lego`)).not.toBeVisible()
    await expect(page.getByText(`a 2x4 lego`)).toBeVisible()

    // Ensure you can copy the code for the final model.
    await expect(copyToClipboardButton).toBeVisible()
    // Click the button.
    await copyToClipboardButton.click()

    // Expect the code to be copied.
    await expect(page.getByText('Copied')).toBeVisible()

    // Click in the code editor.
    await page.locator('.cm-content').click({ position: { x: 10, y: 10 } })

    // Paste the code.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyA')
    await page.keyboard.up(CtrlKey)
    await page.keyboard.press('Backspace')
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyV')
    await page.keyboard.up(CtrlKey)

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`2x4`)

    // Expect the toast to disappear.
    // Find the toast close button.
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await expect(successToastMessage).not.toBeVisible()
  })

  test('can do many at once with errors, clicking dismiss error does not dismiss all', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    await sendPromptFromCommandBar(page, 'alkjsdnlajshdbfjlhsbdf a;askjdnf')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage.first()).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage.first()).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    // We should have three success toasts.
    await expect(successToastMessage).toHaveCount(1, { timeout: 15000 })

    await expect(page.getByText('Copied')).not.toBeVisible()

    const failureToastMessage = page.getByText(
      `The prompt must clearly describe a CAD model`
    )
    await expect(failureToastMessage).toBeVisible()

    // Make sure the toast did not say it was successful.
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()

    await expect(page.getByText(`a 2x4 lego`)).toBeVisible()

    // Ensure if you dismiss the error the others stay.
    const dismissButton = page.getByRole('button', { name: 'Dismiss' })
    await expect(dismissButton).toBeVisible()
    // Click the dismiss button on the first toast.
    await dismissButton.first().click()

    // Make sure the failure toast disappears.
    await expect(failureToastMessage).not.toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).not.toBeVisible()

    // The first toast should disappear, but not the others.
    await expect(page.getByText(`a 2x4 lego`)).toBeVisible()

    // Ensure you can copy the code for one of the models remaining.
    const copyToClipboardButton = page.getByRole('button', {
      name: 'Copy to clipboard',
    })
    await expect(copyToClipboardButton.first()).toBeVisible()
    // Click the button.
    await copyToClipboardButton.first().click()

    // Expect the code to be copied.
    await expect(page.getByText('Copied')).toBeVisible()

    // Click in the code editor.
    await page.locator('.cm-content').click({ position: { x: 10, y: 10 } })

    // Paste the code.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyV')
    await page.keyboard.up(CtrlKey)

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`2x4`)

    // Find the toast close button.
    const closeButton = page
      .getByRole('status')
      .locator('div')
      .filter({ hasText: 'Text-to-CAD successfulPrompt' })
      .first()
      .getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()

    // Expect the toast to disappear.
    await expect(page.getByText('Copied')).not.toBeVisible()
    await expect(successToastMessage).not.toBeVisible()
  })
})

async function sendPromptFromCommandBar(page: Page, promptStr: string) {
  await test.step(`Send prompt from command bar: ${promptStr}`, async () => {
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Use the Zoo Text-to-CAD API ')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByText('Prompt')
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    await page.keyboard.type(promptStr)
    await page.waitForTimeout(1000)
    await page.keyboard.press('Enter')
  })
}
