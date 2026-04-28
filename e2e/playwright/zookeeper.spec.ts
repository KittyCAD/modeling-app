import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

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
    await scene.settled(cmdBar)

    await test.step(`Submit basic prompt`, async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.TTC)
      await copilot.setMode('fast')

      await copilot.conversationInput.fill(
        'make a basic cube (ignore: 2026-04-28)'
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

      await toolbar.closePane(DefaultLayoutPaneID.TTC)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await expect(editor.codeContent).toContainText('sketch')
    })
  })
})
