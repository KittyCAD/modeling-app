import type { Page } from '@playwright/test'

import { createProject, getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'

test.describe('Text-to-CAD tests', () => {
  test('basic lego happy case', async ({ page, homePage, cmdBar }) => {
    const u = await getUtils(page)

    await test.step('Set up', async () => {
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
    })

    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x4 lego',
      cmdBar
    )

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x6 lego',
      cmdBar
    )

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
    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x4 lego',
      cmdBar
    )

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x4 lego',
      cmdBar
    )

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const randomPrompt = `aslkdfja;` + Date.now() + `FFFFEIWJF`
    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      randomPrompt,
      cmdBar
    )

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const badPrompt = 'akjsndladf lajbhflauweyfaaaljhr472iouafyvsssssss'
    await sendPromptFromCommandBarAndSetExistingProject(page, badPrompt, cmdBar)

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const badPrompt = 'akjsndladflajbhflauweyf15;'
    await sendPromptFromCommandBarAndSetExistingProject(page, badPrompt, cmdBar)

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
    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x4 lego',
      cmdBar
    )

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
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    const projectName = await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const promptWithNewline = `a 2x4\nlego`

    await test.step('Get to the prompt step to test', async () => {
      await cmdBar.openCmdBar()
      await cmdBar.selectOption({ name: 'Text-to-CAD Create' }).click()

      await cmdBar.currentArgumentInput.fill('existing')
      await cmdBar.progressCmdBar()

      await cmdBar.currentArgumentInput.fill(projectName)
      await cmdBar.progressCmdBar()

      await cmdBar.expectState({
        commandName: 'Text-to-CAD Create',
        stage: 'arguments',
        currentArgKey: 'prompt',
        currentArgValue: '',
        highlightedHeaderArg: 'prompt',
        headerArguments: {
          Method: 'Existing project',
          ProjectName: projectName,
          Prompt: '',
        },
      })
    })

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

  test('can do many at once with errors, clicking dismiss error does not dismiss all', async ({
    page,
    homePage,
    cmdBar,
  }) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'a 2x4 lego',
      cmdBar
    )

    await sendPromptFromCommandBarAndSetExistingProject(
      page,
      'alkjsdnlajshdbfjlhsbdf a;askjdnf',
      cmdBar
    )

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
      timeout: 10000,
    })

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

// Added underscore if we need this for later.
async function _sendPromptFromCommandBar(page: Page, promptStr: string) {
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

    const textToCadCommand = page.getByRole('option', {
      name: 'Text-to-CAD Create',
    })
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

async function sendPromptFromCommandBarAndSetExistingProject(
  page: Page,
  promptStr: string,
  cmdBar: CmdBarFixture,
  projectName = 'testDefault'
) {
  await page.waitForTimeout(1000)
  await test.step(`Send prompt from command bar: ${promptStr}`, async () => {
    await cmdBar.openCmdBar()
    await cmdBar.selectOption({ name: 'Text-to-CAD Create' }).click()

    await cmdBar.expectState({
      commandName: 'Text-to-CAD Create',
      stage: 'arguments',
      currentArgKey: 'method',
      currentArgValue: '',
      highlightedHeaderArg: 'method',
      headerArguments: {
        Method: '',
        Prompt: '',
      },
    })
    await cmdBar.currentArgumentInput.fill('existing')
    await cmdBar.progressCmdBar()

    await cmdBar.expectState({
      commandName: 'Text-to-CAD Create',
      stage: 'arguments',
      currentArgKey: 'projectName',
      currentArgValue: '',
      highlightedHeaderArg: 'projectName',
      headerArguments: {
        Method: 'Existing project',
        ProjectName: '',
        Prompt: '',
      },
    })
    await cmdBar.currentArgumentInput.fill(projectName)
    await cmdBar.progressCmdBar()

    await cmdBar.expectState({
      commandName: 'Text-to-CAD Create',
      stage: 'arguments',
      currentArgKey: 'prompt',
      currentArgValue: '',
      highlightedHeaderArg: 'prompt',
      headerArguments: {
        Method: 'Existing project',
        ProjectName: projectName,
        Prompt: '',
      },
    })
    await cmdBar.currentArgumentInput.fill(promptStr)
    await cmdBar.progressCmdBar()
  })
}

/**
 * Below there are twelve (12) tests for testing the navigation and file creation
 * logic around text to cad. The Text to CAD command is now globally available
 * within the application and is the same command for all parts of the application.
 * There are many new user scenarios to test because we can navigate to any project
 * you can accept and reject the creation and everything needs to be updated properly.
 *
 *
 * Gotcha: The API requests for text to CAD are mocked! The return values are
 * from real API requests which are copied and pasted below
 *
 * Gotcha: The exports OBJ etc... are not in the output they are massive.
 *
 * Gotcha: Yes, the 3D render preview will be broken because the exported models
 * are not included. These tests do not care about this.
 *
 */
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
    { tag: '@desktop' },
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
    { tag: '@desktop' },
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
        'main.kcl'
      )

      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('main.kcl')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Stay in home page -> Reject -> should delete single file',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await homePage.expectIsCurrentPage()

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

      await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible()
      await expect(page.getByText('2 file')).toBeVisible()

      await page.getByRole('button', { name: 'Reject' }).click()

      await expect(page.getByText('1 file')).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Stay in home page -> Accept -> should navigate to file',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await homePage.expectIsCurrentPage()

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
        'main.kcl'
      )

      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to the project -> Reject -> should go to home page',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
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
      await homePage.openProject(projectName)

      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )

      await page.getByRole('button', { name: 'Reject' }).click()

      // Make sure we went back home
      await homePage.expectIsCurrentPage()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to the project -> Accept -> should stay in same file',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
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
      await homePage.openProject(projectName)

      await page.getByRole('button', { name: 'Accept' }).click()

      await expect(page.getByTestId('app-header-project-name')).toBeVisible()
      await expect(page.getByTestId('app-header-project-name')).toContainText(
        projectName
      )
      await expect(page.getByTestId('app-header-file-name')).toBeVisible()
      await expect(page.getByTestId('app-header-file-name')).toContainText(
        'main.kcl'
      )
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Navigate to the project -> Reject -> should load main.kcl',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await homePage.expectIsCurrentPage()

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
    'Home Page -> Text To CAD -> Existing Project -> Navigate to the project -> Accept -> should load 2x2x2-cube.kcl',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({ name: projectName, page, returnHome: true })

      await homePage.expectIsCurrentPage()

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
        'main.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> New Project -> Navigate to different project -> Reject -> should stay in project',
    { tag: '@desktop' },
    async ({ homePage, page }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({
        name: unrelatedProjectName,
        page,
        returnHome: true,
      })

      await homePage.expectIsCurrentPage()

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
    { tag: '@desktop' },
    async ({ page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({
        name: unrelatedProjectName,
        page,
        returnHome: true,
      })

      await homePage.expectIsCurrentPage()

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
        'main.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('main.kcl')
      ).toBeVisible()
    }
  )

  test(
    'Home Page -> Text To CAD -> Existing Project -> Navigate to different project -> Reject -> should stay in same project',
    { tag: '@desktop' },
    async ({ page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({
        name: unrelatedProjectName,
        page,
        returnHome: true,
      })
      await homePage.expectIsCurrentPage()

      await createProject({ name: projectName, page, returnHome: true })
      await homePage.expectIsCurrentPage()

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
    { tag: '@desktop' },
    async ({ page, homePage }, testInfo) => {
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const unrelatedProjectName = 'unrelated-project'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // Create and navigate to the project then come home
      await createProject({
        name: unrelatedProjectName,
        page,
        returnHome: true,
      })
      await homePage.expectIsCurrentPage()

      await createProject({ name: projectName, page, returnHome: true })
      await homePage.expectIsCurrentPage()

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
        'main.kcl'
      )

      // Check file is created
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText('2x2x2-cube')
      ).toBeVisible()
      await expect(
        page.getByTestId('file-tree-item').getByText('main.kcl')
      ).toBeVisible()
    }
  )
})
