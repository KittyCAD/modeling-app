import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'keeps body and sketch features expanded after sketch editing',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }) => {
    const code = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
body001 = extrude(region001, length = 5mm)`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.openFeatureTreePane()

    const branch = page.getByTestId('feature-tree-body-branch').first()
    const bodyToggle = branch.getByRole('button', {
      name: 'Toggle Body 1 features',
      exact: true,
    })
    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'false')
    await bodyToggle.click()
    const sketchToggle = branch.getByTestId('operation-group-caret').first()
    await sketchToggle.click()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'true')

    await branch.getByRole('button', { name: 'Sketch', exact: true }).dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.exitSketch()
    await scene.settled()

    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(branch.getByTestId('feature-tree-body-features')).toBeVisible()
  }
)
