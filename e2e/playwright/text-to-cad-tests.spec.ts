import fs from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'

import {
  createProject,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

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
    const acceptButton = page.getByRole('button', {
      name: 'Accept',
    })
    await expect(acceptButton).toBeVisible()

    await acceptButton.click()

    // Click in the code editor.
    await page.locator('.cm-content').click()

    // Expect the code to be pasted.
    await expect(page.locator('.cm-content')).toContainText(`startSketchOn`)

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
  test(
    'can do many at once and get many prompts back, and interact with many',
    { tag: ['@skipWin'] },
    async ({ page, homePage }) => {
      test.fixme(orRunWhenFullSuiteEnabled())
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
    test.fixme(orRunWhenFullSuiteEnabled())
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

test.describe('Mocked Text-to-CAD API tests', { tag: ['@skipWin'] }, () => {
  async function mockPageTextToCAD(page: Page) {
    await page.route(
      'https://api.dev.zoo.dev/ai/text-to-cad/glb?kcl=true',
      async (route) => {
        const json = {
          id: 'bfc0ffc0-46c6-48bc-841e-1dc08f3428ce',
          created_at: '2025-04-24T16:50:48.857892376Z',
          user_id: '85de7740-3e38-4e86-abb5-e5afbb8a2183',
          status: 'queued',
          updated_at: '2025-04-24T16:50:48.857892376Z',
          prompt: '1x1x1 cube',
          output_format: 'glb',
          model_version: '',
          kcl_version: '0.2.63',
          model: 'kcl',
          feedback: null,
          mocked: true,
        }
        await route.fulfill({ json })
      }
    )
    await page.route(
      'https://api.dev.zoo.dev/user/text-to-cad/*',
      async (route) => {
        const json = {
          mocked: true,
          id: '6ecbb863-2766-47f0-95cb-7122ad7560ce',
          created_at: '2025-04-24T16:52:00.360Z',
          started_at: '2025-04-24T16:52:00.360Z',
          completed_at: '2025-04-24T16:52:00.363Z',
          user_id: '85de7740-3e38-4e86-abb5-e5afbb8a2183',
          status: 'completed',
          updated_at: '2025-04-24T16:52:00.360Z',
          prompt: '2x2x2 cube',
          outputs: {},
          output_format: 'step',
          model_version: '',
          kcl_version: '0.2.63',
          model: 'kcl',
          feedback: null,
          code: '/*\nGenerated by Text-to-CAD:\n2x2x2 cube\n*/\n@settings(defaultLengthUnit = mm)\n\n// Define the dimensions of the cube\ncubeSide = 2\n\n// Start a sketch on the XY plane\ncubeSketch = startSketchOn(XY)\n  |> startProfileAt([0, 0], %)\n  |> line(end = [cubeSide, 0])\n  |> line(end = [0, cubeSide])\n  |> line(end = [-cubeSide, 0])\n  |> close()\n\n// Extrude the sketch to create a 3D cube\ncube = extrude(cubeSketch, length = cubeSide)',
        }
        await route.fulfill({ json })
      }
    )
  }

  test(
    'Home Page -> Text To CAD -> New Project -> Stay in home page -> Reject -> Project should be deleted',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Reject' }).click()

      // Expect the entire project to be deleted
      await expect(
        page.getByText('Successfully deleted "my-project-name"')
      ).toBeVisible()
      // Project DOM card has this test id
      await expect(page.getByTestId(projectName)).not.toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Stay in home page -> Accept -> should navigate to file',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Accept' }).click()

      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )

      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube.kcl')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Stay in home page -> Reject -> should delete single file',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      await expect(page.getByText('1 file')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await page.waitForTimeout(5000)
      await expect(page.getByText('2 file')).toBeVisible()

      await page.getByRole('button', { name: 'Reject' }).click()

      await expect(page.getByText('1 file')).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Stay in home page -> Accept -> should navigate to file',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Accept' }).click()

      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to the project -> Reject -> should go to home page',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      // Go into the project that was created from Text to CAD
      await page.getByText(projectName).click()

      // Just to make sure we route, don't actually need the stream or anything...
      await page.waitForTimeout(3000)

      await page.getByRole('button', { name: 'Reject' }).click()

      // Make sure we went back home
      await expect(
        page.getByText('No Projects found, ready to make your first one?')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to the project -> Accept -> should stay in same file',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      // Go into the project that was created from Text to CAD
      await page.getByText(projectName).click()

      await page.getByRole('button', { name: 'Accept' }).click()

      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )
    }
  )

  test(
    'Home Page -> Text To CAD -> Exisiting Project -> Navigate to the project -> Reject -> should load main.kcl',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      // Go into the project that was created from Text to CAD
      // This only works because there is only 1 project. Each project has the same value of `data-test-id='project-title'`
      await page.getByTestId('project-title').click()

      await page.getByRole('button', { name: 'Reject' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      // Check file is deleted
      await u.openFilePanel()
      await expect(page.getByText('2x2x2-cube.kcl')).not.toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Exisiting Project -> Navigate to the project -> Accept -> should load 2x2x2-cube.kcl',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      // Go into the project that was created from Text to CAD
      // This only works because there is only 1 project. Each project has the same value of `data-test-id='project-title'`
      await page.getByTestId('project-title').click()

      await page.getByRole('button', { name: 'Accept' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube.kcl')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to different project -> Reject -> should stay in project',
    { tag: '@electron' },
    async ({ context, page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: unrelatedProjectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await homePage.openProject(unrelatedProjectName)
      // Check that we opened the unrelated project
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await page.getByRole('button', { name: 'Reject' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      // File should be deleted
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube.kcl')
      ).not.toBeVisible()

      await u.goToHomePageFromModeling()

      // Project should be deleted
      await expect(
        page.getByTestId('home-section').getByText(projectName)
      ).not.toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to different project -> Accept -> should go to new project',
    { tag: '@electron' },
    async ({ context, page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: unrelatedProjectName, page, returnHome: true })

      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('New project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await homePage.openProject(unrelatedProjectName)
      // Check that we opened the unrelated project
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await page.getByRole('button', { name: 'Accept' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube.kcl')
      ).toBeVisible()

      await expect(
        page.getByTestId('file-tree-item').getByText('main.kcl')
      ).not.toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Navigate to different project -> Reject -> should stay in same project',
    { tag: '@electron' },
    async ({ context, page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: unrelatedProjectName, page, returnHome: true })
      await expect(page.getByText('Your Projects')).toBeVisible()

      await createProject({ name: projectName, page, returnHome: true })
      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await homePage.openProject(unrelatedProjectName)
      // Check that we opened the unrelated project
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await page.getByRole('button', { name: 'Reject' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await u.goToHomePageFromModeling()

      await expect(
        page.getByTestId('home-section').getByText(projectName)
      ).toBeVisible()

      await expect(
        page.getByTestId('home-section').getByText(unrelatedProjectName)
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Navigate to different project -> Accept -> should navigate to new project',
    { tag: '@electron' },
    async ({ context, page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: unrelatedProjectName, page, returnHome: true })
      await expect(page.getByText('Your Projects')).toBeVisible()

      await createProject({ name: projectName, page, returnHome: true })
      await expect(page.getByText('Your Projects')).toBeVisible()

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text To CAD')
      await page.keyboard.press('Enter')

      // new project
      await page.keyboard.type('Existing project')
      await page.keyboard.press('Enter')

      // write name
      await page.keyboard.type(projectName)
      await page.keyboard.press('Enter')

      // prompt
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      await homePage.openProject(unrelatedProjectName)
      // Check that we opened the unrelated project
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        unrelatedProjectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await page.getByRole('button', { name: 'Accept' }).click()

      // Check header is populated with the project and file name
      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        '2x2x2-cube.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube.kcl')
      ).toBeVisible()
      await expect(
        page.getByTestId('file-tree-item').getByText('main.kcl')
      ).toBeVisible()
    }
  )
})
