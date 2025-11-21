import type { Page } from '@playwright/test'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Text-to-CAD tests', () => {
  test('basic lego happy case', async ({
    page,
    homePage,
    cmdBar,
    editor,
    scene,
  }) => {
    await page.setBodyDimensions({ width: 2000, height: 1000 })
    await expect(homePage.textToCadBtn).toBeEnabled()

    const prompt = 'a 2x4 lego'
    await sendPromptFromCommandBarAndSetNewProject(page, prompt, cmdBar)

    // Look out for the message
    const submittedMessage = page.getByText(prompt)
    await expect(submittedMessage.first()).toBeVisible()

    // Expect the code and model render
    await editor.expectEditor.toContain('startSketchOn', { timeout: 30000 })
    await scene.settled(cmdBar)
  })
  test('success model, then ignore success toast, user can create new prompt from command bar', async ({
    page,
    homePage,
    cmdBar,
  }) => {
    await page.setBodyDimensions({ width: 2000, height: 1000 })
    await expect(homePage.textToCadBtn).toBeEnabled()

    const prompt = 'a 2x6 lego'
    await sendPromptFromCommandBarAndSetNewProject(page, prompt, cmdBar)

    // Look out for the toast message
    const submittedMessage = page.getByText(prompt)
    await expect(submittedMessage.first()).toBeVisible()

    // Can send a new prompt from the command bar.
    const newPrompt = 'a 2x4 lego'
    await sendPromptFromCommandBarAndSetNewProject(page, newPrompt, cmdBar)
    const submittedMessageSecond = page.getByText(newPrompt)
    await expect(submittedMessageSecond.first()).toBeVisible()
  })
})

async function sendPromptFromCommandBarAndSetNewProject(
  page: Page,
  promptStr: string,
  cmdBar: CmdBarFixture,
  projectName = 'testDefault'
) {
  await page.waitForTimeout(1000)
  await test.step(`Send prompt from command bar: ${promptStr}`, async () => {
    await cmdBar.openCmdBar()
    await cmdBar
      .selectOption({ name: 'Create Project using Text-to-CAD' })
      .click()

    await cmdBar.expectState({
      commandName: 'Create Project using Text-to-CAD',
      stage: 'arguments',
      currentArgKey: 'method',
      currentArgValue: '',
      highlightedHeaderArg: 'method',
      headerArguments: {
        Method: '',
        Prompt: '',
      },
    })
    await cmdBar.progressCmdBar()

    await cmdBar.expectState({
      commandName: 'Create Project using Text-to-CAD',
      stage: 'arguments',
      currentArgKey: 'newProjectName',
      currentArgValue: '',
      highlightedHeaderArg: 'newProjectName',
      headerArguments: {
        Method: 'New project',
        NewProjectName: '',
        Prompt: '',
      },
    })
    await cmdBar.currentArgumentInput.fill(projectName)
    await cmdBar.progressCmdBar()

    await cmdBar.expectState({
      commandName: 'Create Project using Text-to-CAD',
      stage: 'arguments',
      currentArgKey: 'prompt',
      currentArgValue: '',
      highlightedHeaderArg: 'prompt',
      headerArguments: {
        Method: 'New project',
        NewProjectName: projectName,
        Prompt: '',
      },
    })
    await cmdBar.currentArgumentInput.fill(promptStr)
    await cmdBar.progressCmdBar()
  })
}

/**
 * Below there are twelve (12) tests for testing the navigation and file creation
 * logic around text to cad. The Text-to-CAD command is now globally available
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
    'Home Page -> Text-to-CAD -> New Project -> Stay in home page -> should navigate to file',
    { tag: '@desktop' },
    async ({ context, page }, testInfo) => {
      await page.setBodyDimensions({ width: 2000, height: 1000 })
      const u = await getUtils(page)
      const projectName = 'my-project-name'
      const prompt = '2x2x2 cube'
      await mockPageTextToCAD(page)

      // open commands
      await page.getByTestId('command-bar-open-button').click()

      // search Text To CAD
      await page.keyboard.type('Text-to-CAD')
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
})
