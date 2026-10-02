import { expect, test } from '@e2e/playwright/zoo-test'

for (const { method, args } of [
  { method: 'Point and normal', args: ['origin', 'normal', 'xAxis'] },
  { method: 'Axes and origin', args: ['origin', 'xAxis', 'yAxis'] },
  { method: 'Three points', args: ['points'] },
  { method: 'Equation', args: ['xAxis', 'a', 'b', 'c', 'd'] },
]) {
  test(
    `Construction plane: ${method} creates a sketchable plane`,
    { tag: '@web' },
    async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
      await homePage.goToModelingScene()
      await scene.settled()
      await cmdBar.openCmdBar()
      await cmdBar.cmdSearchInput.fill('Construction plane')
      await cmdBar.chooseCommand('Construction plane')
      await cmdBar.selectOption({ name: method, exact: true }).click()
      for (const arg of args) {
        await expect
          .poll(async () => {
            const state = await cmdBar.getState()
            return state.stage === 'arguments' ? state.currentArgKey : undefined
          })
          .toBe(arg)
        await cmdBar.progressCmdBar()
      }
      await expect
        .poll(async () => (await cmdBar.getState()).stage)
        .toBe('review')
      await cmdBar.submit()
      await editor.expectEditor.toContain('plane001 = plane(')
      await scene.settled()
      await toolbar.startSketchBtn.click()
      const operation = await toolbar.getFeatureTreeOperation('plane001', 0)
      await operation.click()
      await toolbar.waitUntilSketchingReady()
      await editor.expectEditor.toContain('sketch(on = plane001)')
      await expect(page.getByTestId('sketch-exit')).toBeVisible()
    }
  )
}
