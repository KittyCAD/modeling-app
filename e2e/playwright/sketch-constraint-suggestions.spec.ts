import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'

const testingPocPreview =
  process.env.VERCEL_ENV === 'preview' &&
  process.env.VERCEL_GIT_COMMIT_REF ===
    'codex/sketch-constraint-suggestions-poc'

test.describe('Sketch constraint suggestions', { tag: '@web' }, () => {
  test.use({
    userFeatures: testingPocPreview ? [] : [EXPERIMENTAL_POINT_AND_CLICK_FLAG],
  })

  test('previews and applies a horizontal constraint to the selected line', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }, testInfo) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  line(start = [var 0mm, var 0mm], end = [var 9.9mm, var 0.1mm])
}
`
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode('', code)
    await scene.settled()
    await editor.expectEditor.toContain('sketch001 = sketch(on = XY)')

    await toolbar.openFeatureTreePane()
    await expect(page.getByText('Building feature tree')).not.toBeVisible({
      timeout: 10_000,
    })
    const sketchOperation = await toolbar.getFeatureTreeOperation(
      'sketch001',
      0
    )
    await sketchOperation.dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()

    const handles = page.locator('[data-handle="sketch-point-handle"]')
    await expect(handles).toHaveCount(2)
    const start = await handles.nth(0).boundingBox()
    const end = await handles.nth(1).boundingBox()
    if (!start || !end) {
      throw new Error('Sketch point handles are missing from the scene')
    }
    await page.mouse.click(
      (start.x + start.width / 2 + end.x + end.width / 2) / 2,
      (start.y + start.height / 2 + end.y + end.height / 2) / 2
    )

    const suggest = page.getByRole('button', { name: 'Suggest', exact: true })
    await expect(suggest).toBeEnabled()
    await suggest.click()
    const horizontal = page.getByRole('button', { name: 'Make horizontal' })
    await expect(horizontal).toBeVisible()
    const bounds = await horizontal.boundingBox()
    expect(bounds).not.toBeNull()
    if (bounds) {
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1200)
    }
    await testInfo.attach('suggestions-before-accept', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await horizontal.click()
    await editor.expectEditor.toContain('horizontal(')
  })
})
