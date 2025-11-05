import { expect, test } from '@e2e/playwright/zoo-test'
import type { SidebarId } from '@src/components/layout/areas'

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
      await toolbar.closePane('code')
      // TODO: fix the 'as' this it's not making sense
      await toolbar.openPane('ttc' as SidebarId)
      await copilot.conversationInput.fill(
        'make a 10x10x10cm cube centered on the origin'
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 120_000,
      })
      await toolbar.openPane('code')
      await editor.expectEditor.toContain('startSketchOn')
      await editor.expectEditor.toContain('extrude')
      await editor.expectEditor.toContain('10')
      await scene.settled(cmdBar)
      // TODO: maybe check for a sweep artifact in the debug pane?
    })
  })
})
