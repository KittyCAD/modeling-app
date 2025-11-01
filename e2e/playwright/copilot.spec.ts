import { expect, test } from '@e2e/playwright/zoo-test'

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
      await toolbar.openPane('ttc')
      await copilot.conversationInput.fill('make a cube')
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 120_000,
      })
      await toolbar.openPane('code')
      await editor.expectEditor.toContain('cube')
      await editor.expectEditor.toContain('extrude')
      await scene.settled(cmdBar)
    })
  })
})
