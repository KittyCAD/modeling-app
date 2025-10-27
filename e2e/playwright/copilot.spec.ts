import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Copilot tests', () => {
  test('Happy path: new project, easy prompt, good result', async ({
    editor,
    homePage,
    scene,
    toolbar,
    cmdBar,
    copilot,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Submit prompt`, async () => {
      await toolbar.closePane('code')
      await toolbar.openPane('ttc')
      await copilot.conversationInput.fill(
        'Design a water bottle, use defaults'
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 120_000,
      })
    })
  })
})
