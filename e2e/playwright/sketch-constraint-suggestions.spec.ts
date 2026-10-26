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

  test('offers a next sketch idea without selecting an edge', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
}
`
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode('', code)
    await scene.settled()

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

    const centeredCircle = page.getByRole('button', {
      name: 'Add centered circle',
    })
    await expect(centeredCircle).toBeVisible()
    await centeredCircle.click()
    await editor.expectEditor.toContain('circle(')
    await expect(centeredCircle).not.toBeVisible()
  })

  test('offers an idea after drawing a square in the current sketch', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode(
      '',
      '@settings(kclVersion = 3.0)\nsketch001 = sketch(on = XY) {}'
    )
    await scene.settled()

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
    await toolbar.closeFeatureTreePane()

    await expect(
      page.getByRole('button', { name: 'Add centered circle' })
    ).not.toBeVisible()
    await toolbar.rectangleBtn.click()
    const stream = await scene.streamWrapper.boundingBox()
    if (!stream) throw new Error('Sketch viewport is missing')
    const centerX = stream.x + stream.width / 2
    const centerY = stream.y + stream.height / 2
    await page.mouse.click(centerX - 60, centerY - 60)
    await expect(
      page.getByRole('button', { name: 'Add centered circle' })
    ).not.toBeVisible()
    await page.mouse.move(centerX + 60, centerY + 60)
    await page.mouse.click(centerX + 60, centerY + 60)

    const centeredCircle = page.getByRole('button', {
      name: 'Add centered circle',
    })
    await expect(centeredCircle).toBeVisible()
    await centeredCircle.click()
    await editor.expectEditor.toContain('circle(')
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
  line(start = [var 0mm, var 0mm], end = [var 10.01mm, var 0.1mm])
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
    if (testingPocPreview) {
      await expect(
        page.getByText('Ranked by trained model · experimental')
      ).toBeVisible()
    }
    const horizontal = page.getByRole('button', { name: 'Make horizontal' })
    await expect(horizontal).toBeVisible()
    await expect(
      page
        .getByRole('group', { name: 'Constraint suggestions' })
        .getByRole('button')
        .first()
    ).toHaveText('Make horizontal')
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

  for (const { relation, secondLine } of [
    {
      relation: 'parallel',
      secondLine:
        'line(start = [var 0mm, var 5mm], end = [var 10mm, var 5.15mm])',
    },
    {
      relation: 'perpendicular',
      secondLine:
        'line(start = [var 8mm, var -6mm], end = [var 8.1mm, var 2mm])',
    },
  ] as const) {
    test(`suggests ${relation} for two nearly aligned lines`, async ({
      page,
      homePage,
      scene,
      editor,
      toolbar,
    }) => {
      const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0.25mm])
  line2 = ${secondLine}
}
`
      await page.setBodyDimensions({ width: 1200, height: 600 })
      await homePage.goToModelingScene()
      await scene.settled()
      await editor.openPane()
      await editor.replaceCode('', code)
      await scene.settled()

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
      await expect(handles).toHaveCount(4)
      const boxes = await Promise.all(
        [0, 1, 2, 3].map((index) => handles.nth(index).boundingBox())
      )
      if (boxes.some((box) => box === null)) {
        throw new Error('Sketch point handles are missing from the scene')
      }
      const point = (index: number) => {
        const box = boxes[index]
        if (!box) {
          throw new Error('Sketch point handle is missing from the scene')
        }
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      const firstStart = point(0)
      const firstEnd = point(1)
      const secondStart = point(2)
      const secondEnd = point(3)
      await page.mouse.click(
        (firstStart.x + firstEnd.x) / 2,
        (firstStart.y + firstEnd.y) / 2
      )
      await page.mouse.click(
        (secondStart.x + secondEnd.x) / 2,
        (secondStart.y + secondEnd.y) / 2
      )

      const suggest = page.getByRole('button', { name: 'Suggest', exact: true })
      await expect(suggest).toBeEnabled()
      await suggest.click()
      await page.getByRole('button', { name: `Make ${relation}` }).click()
      await editor.expectEditor.toContain(`${relation}([line1, line2])`)
    })
  }
})
