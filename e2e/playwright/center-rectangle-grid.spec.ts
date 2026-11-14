import { expect, test } from '@e2e/playwright/zoo-test'
import type { SettingsType } from '@src/lib/settings/initialSettings'

test.describe('Center rectangle grid precision', { tag: '@web' }, () => {
  test('preserves decimal corners through preview, creation, and reload', async ({
    page,
    homePage,
    toolbar,
    scene,
    editor,
    fs,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
    await scene.settled()
    await editor.replaceCode(
      '',
      '@settings(defaultLengthUnit = mm, kclVersion = 3.0)\n\nsketch001 = sketch(on = XY) {}'
    )
    await scene.settled()

    for (const [setting, value] of [
      ['cameraProjection', 'orthographic'],
      ['showSketchGrid', true],
      ['fixedSizeGrid', true],
      ['majorGridSpacing', 2.7],
      ['minorGridsPerMajor', 1],
      ['snapsPerMinor', 1],
      ['snapToGrid', true],
    ] satisfies [
      keyof SettingsType['modeling'],
      boolean | number | 'orthographic',
    ][]) {
      await page.waitForFunction(() =>
        window.app.settings.actor.getSnapshot().matches('idle')
      )
      await page.evaluate(
        ({ setting, value }) => {
          window.app.settings.actor.send({
            type: `set.modeling.${setting}`,
            data: { level: 'project', value },
          })
        },
        { setting, value }
      )
      await expect
        .poll(() =>
          page.evaluate(
            (setting) => window.app.settings.get().modeling[setting].current,
            setting
          )
        )
        .toBe(value)
    }

    await toolbar.openFeatureTreePane()
    const sketchOperation = await toolbar.getFeatureTreeOperation(
      'sketch001',
      0
    )
    await sketchOperation.dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.closeFeatureTreePane()
    await page.evaluate(() => {
      const infra = window.app.singletons.kclManager.sceneInfra
      const controls = infra.camControls
      const camera = controls.camera
      if (!('left' in camera))
        throw new Error('Expected an orthographic camera')
      camera.position.x = controls.target.x = 8.1
      camera.position.y = controls.target.y = 8.1
      camera.zoom *= 25 / infra.getPixelsPerBaseUnit(camera)
      camera.updateProjectionMatrix()
      controls.update(true)
    })
    await toolbar.selectCenterRectangle()

    const screenPoint = (coordinate: number) =>
      page.evaluate((coordinate) => {
        const infra = window.app.singletons.kclManager.sceneInfra
        const camera = infra.camControls.camera
        const projected = camera.position
          .clone()
          .set(coordinate, coordinate, 0)
          .project(camera)
        const bounds = infra.renderer.domElement.getBoundingClientRect()
        return {
          x: bounds.left + ((projected.x + 1) * bounds.width) / 2,
          y: bounds.top + ((1 - projected.y) * bounds.height) / 2,
        }
      }, coordinate)
    const center = await screenPoint(8.1)
    const corner = await screenPoint(10.8)
    await page.mouse.move(center.x, center.y)
    await page.mouse.click(center.x, center.y)

    const expectedCoordinates = [
      [8.1, 8.1],
      [5.4, 5.4, 10.8, 5.4],
      [10.8, 5.4, 10.8, 10.8],
      [10.8, 10.8, 5.4, 10.8],
      [5.4, 10.8, 5.4, 5.4],
      [5.4, 5.4, 10.8, 10.8],
      [10.8, 5.4, 5.4, 10.8],
    ].flat()
    const getCoordinates = async () => {
      const code = (await editor.codeContent.textContent()) ?? ''
      return [...code.matchAll(/var\s+(-?\d+(?:\.\d+)?)mm/g)].map((match) =>
        Number(match[1])
      )
    }

    await expect
      .poll(async () => {
        await page.mouse.move(corner.x, corner.y)
        return getCoordinates()
      })
      .toEqual(expectedCoordinates)
    const checkpoint = await page.evaluate(
      () => window.app.singletons.kclManager.currentSketchCheckpointId
    )
    await page.mouse.click(corner.x, corner.y)
    await expect
      .poll(() =>
        page.evaluate(
          () => window.app.singletons.kclManager.currentSketchCheckpointId
        )
      )
      .not.toBe(checkpoint)
    await page.keyboard.press('Escape')
    await toolbar.exitSketchBtn.click()
    await expect(toolbar.startSketchBtn).toBeEnabled()
    const savedSource = await page.evaluate(() => ({
      path: window.app.singletons.kclManager.path,
      code: window.app.singletons.kclManager.code,
    }))
    await expect
      .poll(() => fs.readFile(savedSource.path, { encoding: 'utf-8' }))
      .toBe(savedSource.code)
    await page.reload()
    await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 30_000 })
    await scene.settled()
    await expect.poll(getCoordinates).toEqual(expectedCoordinates)
  })
})
