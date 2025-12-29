import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import type { Page } from '@playwright/test'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { CopilotFixture } from '@e2e/playwright/fixtures/copilotFixture'

test.describe('Zookeeper tests', () => {
  async function runZookeeperHappyPathTest({
    page,
    editor,
    homePage,
    scene,
    toolbar,
    cmdBar,
    copilot,
  }: {
    page: Page
    editor: EditorFixture
    homePage: HomePageFixture
    scene: SceneFixture
    toolbar: ToolbarFixture
    cmdBar: CmdBarFixture
    copilot: CopilotFixture
  }) {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Submit basic prompt`, async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.TTC)
      await copilot.conversationInput.fill(
        'make a 10x10x10cm cube centered on the origin'
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 120_000,
      })
      await expect(copilot.thinkingView).toBeVisible()
      await expect(copilot.thinkingView).not.toBeVisible({
        timeout: 120_000,
      })
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain('startSketchOn')
      await editor.expectEditor.toContain('extrude')
      await editor.expectEditor.toContain('10')
      await scene.settled(cmdBar)
      // TODO: maybe check for a sweep artifact in the debug pane?
    })
  }

  test(
    'Web copilot happy path: new project, easy prompt, good result',
    { tag: ['@web'] },
    async ({ page, editor, homePage, scene, toolbar, cmdBar, copilot }) => {
      await runZookeeperHappyPathTest({
        page,
        editor,
        homePage,
        scene,
        toolbar,
        cmdBar,
        copilot,
      })
    }
  )

  test(
    'Desktop copilot happy path: new project, easy prompt, good result',
    { tag: ['@desktop'] },
    async ({ page, editor, homePage, scene, toolbar, cmdBar, copilot }) => {
      await runZookeeperHappyPathTest({
        page,
        editor,
        homePage,
        scene,
        toolbar,
        cmdBar,
        copilot,
      })
    }
  )
})
