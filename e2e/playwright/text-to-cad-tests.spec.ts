import { Page } from '@playwright/test'
import { test, expect } from './zoo-test'
import { getUtils, createProject } from './test-utils'
import { join } from 'path'
import fs from 'fs'

test.describe('Text-to-CAD tests', { tag: ['@skipWin'] }, () => {
  test('basic lego happy case', async ({ page, homePage }) => {
    const u = await getUtils(page)

    await test.step('Set up', async () => {
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
    })

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible({ timeout: 15000 })

    // Hit accept.
    const copyToClipboardButton = page.getByRole('button', {
      name: 'Accept',
    })
    await expect(copyToClipboardButton).toBeVisible()

    await copyToClipboardButton.click()

    // Click in the code editor.
    await page.locator('.cm-content').click()

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`const`)

    // make sure a model renders.
    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()
  })

  test('success model, then ignore success toast, user can create new prompt from command bar', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await sendPromptFromCommandBar(page, 'a 2x6 lego')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible({ timeout: 15000 })

    // Can send a new prompt from the command bar.
    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    // Find the toast.
    // Look out for the toast message
    await expect(submittingToastMessage).toBeVisible()
    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    // Expect 2 success toasts.
    await expect(successToastMessage).toHaveCount(2, {
      timeout: 15000,
    })
    await expect(page.getByText('a 2x4 lego')).toBeVisible()
    await expect(page.getByText('a 2x6 lego')).toBeVisible()
  })

  test('you can reject text-to-cad output and it does nothing', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await sendPromptFromCommandBar(page, 'a 2x4 lego')

    // Find the toast.
    // Look out for the toast message
    const submittingToastMessage = page.getByText(
      `Submitting to Text-to-CAD API...`
    )
    await expect(submittingToastMessage).toBeVisible()

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible({ timeout: 15000 })

    // Hit copy to clipboard.
    const rejectButton = page.getByRole('button', { name: 'Reject' })
    await expect(rejectButton).toBeVisible()

    await rejectButton.click()

    // The toast should disappear.
    await expect(successToastMessage).not.toBeVisible()

    // Expect no code.
    await expect(page.locator('.cm-content')).toContainText(``)
  })

  test('sending a bad prompt fails, can dismiss', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByRole('option', { name: 'Text-to-CAD' })
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByRole('textbox', { name: 'Prompt' })
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    const randomPrompt = `aslkdfja;` + Date.now() + `FFFFEIWJF`
    await page.keyboard.type(randomPrompt)
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
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByRole('option', { name: 'Text-to-CAD' })
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByRole('textbox', { name: 'Prompt' })
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
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('ControlOrMeta')
    await page.keyboard.type('a 2x4 lego')

    // Submit the new prompt.
    await page.keyboard.press('Enter')

    // Make sure the new prompt works.
    // Find the toast.
    // Look out for the toast message
    await expect(submittingToastMessage).toBeVisible()

    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    await expect(successToastMessage).toBeVisible({ timeout: 15000 })
  })

  test('sending a bad prompt fails, can ignore toast, can start over from command bar', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByRole('option', { name: 'Text-to-CAD' })
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByRole('textbox', { name: 'Prompt' })
    await expect(prompt.first()).toBeVisible()

    const badPrompt = 'akjsndladflajbhflauweyf15;'

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

    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    await expect(successToastMessage).toBeVisible({ timeout: 15000 })

    // old failure toast should stick around.
    await expect(failureToastMessage).toBeVisible()
    await expect(page.getByText(`Text-to-CAD failed`)).toBeVisible()
  })

  test('ensure you can shift+enter in the prompt box', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const promptWithNewline = `a 2x4\nlego`

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByRole('option', { name: 'Text-to-CAD' })
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()

    // Enter the prompt.
    const prompt = page.getByRole('textbox', { name: 'Prompt' })
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

    const generatingToastMessage = page.getByText(
      `Generating parametric model...`
    )
    await expect(generatingToastMessage).toBeVisible({ timeout: 10000 })

    const successToastMessage = page.getByText(`Text-to-CAD successful`)
    await expect(successToastMessage).toBeVisible({ timeout: 15000 })

    await expect(page.getByText(promptWithNewline)).toBeVisible()
  })

  // This will be fine once greg makes prompt at top of file deterministic
  test.fixme(
    'can do many at once and get many prompts back, and interact with many',
    { tag: ['@skipWin'] },
    async ({ page, homePage }) => {
      // Let this test run longer since we've seen it timeout.
      test.setTimeout(180_000)

      const u = await getUtils(page)

      await page.setBodyDimensions({ width: 1000, height: 500 })

      await homePage.goToModelingScene()
      await u.waitForPageLoad()

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
      await expect(generatingToastMessage.first()).toBeVisible({
        timeout: 10_000,
      })

      const successToastMessage = page.getByText(`Text-to-CAD successful`)
      // We should have three success toasts.
      await expect(successToastMessage).toHaveCount(3, { timeout: 25_000 })

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
        name: 'Accept',
      })
      await expect(copyToClipboardButton.first()).toBeVisible()
      // Click the button.
      await copyToClipboardButton.first().click()

      // Do NOT do AI tests like this: "Expect the code to be pasted."
      // Reason: AI tests are NONDETERMINISTIC. Thus we need to be as most
      // general as we can for the assertion.
      // We can use Kolmogorov complexity as a measurement of the
      // "probably most minimal version of this program" to have a lower
      // bound to work with. It is completely by feel because there are
      // no proofs that any program is its smallest self.
      const code2x8 = await page.locator('.cm-content').innerText()
      await expect(code2x8.length).toBeGreaterThan(249)

      // Ensure the final toast remains.
      await expect(page.getByText(`a 2x10 lego`)).not.toBeVisible()
      await expect(page.getByText(`Prompt: "a 2x8 lego`)).not.toBeVisible()
      await expect(page.getByText(`a 2x4 lego`)).toBeVisible()

      // Ensure you can copy the code for the final model.
      await expect(copyToClipboardButton).toBeVisible()
      // Click the button.
      await copyToClipboardButton.click()

      // Expect the code to be pasted.
      const code2x4 = await page.locator('.cm-content').innerText()
      await expect(code2x4.length).toBeGreaterThan(249)
    }
  )

  test('can do many at once with errors, clicking dismiss error does not dismiss all', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

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
      name: 'Accept',
    })
    await expect(copyToClipboardButton.first()).toBeVisible()
    // Click the button.
    await copyToClipboardButton.first().click()

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`2x4`)
  })
})

async function sendPromptFromCommandBar(page: Page, promptStr: string) {
  await page.waitForTimeout(1000)
  await test.step(`Send prompt from command bar: ${promptStr}`, async () => {
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.hover()
    await commandBarButton.click()
    await page.waitForTimeout(1000)

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByText('Use the Zoo Text-to-CAD API')
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().scrollIntoViewIfNeeded()
    await textToCadCommand.first().click()
    await page.waitForTimeout(1000)

    // Enter the prompt.
    const prompt = page.getByRole('textbox', { name: 'Prompt' })
    await expect(prompt.first()).toBeVisible()

    // Type the prompt.
    await page.keyboard.type(promptStr)
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
  })
}

test(
  'Text-to-CAD functionality',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    const projectName = 'project-000'
    const prompt = 'lego 2x4'
    const textToCadFileName = 'lego-2x4.kcl'

    const { dir } = await context.folderSetupFn(async () => {})

    const fileExists = () =>
      fs.existsSync(join(dir, projectName, textToCadFileName))

    const { openFilePanel, openKclCodePanel, waitForPageLoad } = await getUtils(
      page,
      test
    )

    await page.setBodyDimensions({ width: 1200, height: 500 })

    // Locators
    const projectMenuButton = page
      .getByTestId('project-sidebar-toggle')
      .filter({ hasText: projectName })
    const textToCadFileButton = page.getByRole('listitem').filter({
      has: page.getByRole('button', { name: textToCadFileName }),
    })
    const textToCadComment = page.getByText(
      `// Generated by Text-to-CAD: ${prompt}`
    )

    // Create and navigate to the project
    await createProject({ name: 'project-000', page })

    // Wait for Start Sketch otherwise you will not have access Text-to-CAD command
    await waitForPageLoad()
    await openFilePanel()
    await openKclCodePanel()

    await test.step(`Test file creation`, async () => {
      await sendPromptFromCommandBar(page, prompt)
      // File is considered created if it shows up in the Project Files pane
      await expect(textToCadFileButton).toBeVisible({ timeout: 20_000 })
      expect(fileExists()).toBeTruthy()
    })

    await test.step(`Test file navigation`, async () => {
      await expect(projectMenuButton).toContainText('main.kcl')
      await textToCadFileButton.click()
      // File can be navigated and loaded assuming a specific KCL comment is loaded into the KCL code pane
      await expect(textToCadComment).toBeVisible({ timeout: 20_000 })
      await expect(projectMenuButton).toContainText(textToCadFileName)
    })

    await test.step(`Test file deletion on rejection`, async () => {
      const rejectButton = page.getByRole('button', { name: 'Reject' })
      // A file is created and can be navigated to while this prompt is still opened
      // Click the "Reject" button within the prompt and it will delete the file.
      await rejectButton.click()

      const submittingToastMessage = page.getByText(
        `Successfully deleted file "lego-2x4.kcl"`
      )
      await expect(submittingToastMessage).toBeVisible()
      expect(fileExists()).toBeFalsy()
      // Confirm we've navigated back to the main.kcl file after deletion
      await expect(projectMenuButton).toContainText('main.kcl')
    })
  }
)
