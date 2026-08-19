import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// See zookeeper/text_to_cad/zookeeper_magic_bypass.py
const ZK_MOCK_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'

const STEP_PART_SOURCE =
  'rust/kcl-lib/e2e/executor/inputs/mcmaster-parts/91251a404-bolt.step'

const populatePartProject = async (
  projectsDirectory: string,
  projectName: string,
  partCount: number
) => {
  const [fsp, path] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ])
  const projectDirectory = path.join(projectsDirectory, projectName)
  await fsp.mkdir(projectDirectory, { recursive: true })
  await fsp.writeFile(path.join(projectDirectory, 'main.kcl'), '')
  await Promise.all(
    Array.from({ length: partCount }, (_, index) =>
      fsp.copyFile(
        STEP_PART_SOURCE,
        path.join(
          projectDirectory,
          `part${String(index + 1).padStart(3, '0')}.step`
        )
      )
    )
  )
}

test.describe('Zookeeper tests', { tag: ['@desktop', '@web'] }, () => {
  test('Happy path: new project, easy prompt, good result', async ({
    page,
    editor,
    homePage,
    scene,
    toolbar,
    cmdBar,
    copilot,
  }) => {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step('Submit basic prompt', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await copilot.setMode('fast')
      await copilot.conversationInput.fill(
        `make a 10x10x10cm cube centered on the origin, name the last variable "cube" [${ZK_MOCK_REPLY_MARKER}]`
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 30_000,
      })

      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await expect(editor.codeContent).toContainText('sketch')

      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await scene.settled()
      const extrude = await toolbar.getFeatureTreeOperation('cube', 0)
      await expect(extrude).toBeVisible()
    })
  })
  test(
    'Chat history can be cleared',
    { tag: ['@desktop', '@web'] },
    async ({ page, homePage, scene, toolbar, cmdBar, copilot }) => {
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()

      await test.step('Submit placeholder prompt', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
        await copilot.conversationInput.fill(
          `This is a test prompt [${ZK_MOCK_REPLY_MARKER}]`
        )
        await copilot.submitButton.click()
        await expect(copilot.placeHolderResponse).toBeVisible()
      })

      await test.step('Clear the chat history', async () => {
        await copilot.clearChatButton.click()
        await expect(copilot.welcomeSection).not.toBeVisible()
        await expect(copilot.welcomeSection).toBeVisible({ timeout: 30_000 })

        await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(0)
        await expect(page.getByTestId('ml-response-chat-bubble')).toHaveCount(0)
        await expect(copilot.clearChatButton).not.toBeVisible()
      })
    }
  )
})

test.describe('Zookeeper large project tests', { tag: '@desktop' }, () => {
  test('Zookeeper keeps the same conversation as a project grows from 20 to 35 STEP parts', async ({
    page,
    folderSetupFn,
    homePage,
    scene,
    toolbar,
    copilot,
  }) => {
    test.setTimeout(180_000)
    const projectName = 'many-parts'
    let projectsDirectory = ''

    await folderSetupFn((directory) => {
      projectsDirectory = directory
      return populatePartProject(directory, projectName, 20)
    })
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.openProject(projectName)
    await scene.settled()

    const submitPrompt = async (partCount: number) => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await copilot.conversationInput.fill(
        `Confirm this project has ${partCount} parts [${ZK_MOCK_REPLY_MARKER}]`
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible({
        timeout: 130_000,
      })
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 130_000,
      })
    }

    await submitPrompt(20)

    await populatePartProject(projectsDirectory, projectName, 35)
    await submitPrompt(35)

    await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(2)
  })
})
