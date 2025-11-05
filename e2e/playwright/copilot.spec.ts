import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Copilot tests', () => {
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
      await copilot.conversationInput.fill(
        'make a 10x10x10cm cube centered on the origin'
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 120_000,
      })
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain('startSketchOn')
      await editor.expectEditor.toContain('extrude')
      await editor.expectEditor.toContain('10')
      await scene.settled(cmdBar)
      // TODO: maybe check for a sweep artifact in the debug pane?
    })
  })
})
