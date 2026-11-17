import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'recenters a tiny displaced model despite visible reference planes',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [10000, 0], end = [10000.03, 0])
  right = line(start = [10000.03, 0], end = [10000.03, 0.02])
  top = line(start = [10000.03, 0.02], end = [10000, 0.02])
  left = line(start = [10000, 0.02], end = [10000, 0])
}
region001 = region(point = [10000.015, 0.01], sketch = sketch001)
body001 = extrude(region001, length = 0.012)
hide(sketch001)
`
      )
    )
    await scene.settled()
    const recover = page.getByRole('button', {
      name: 'Recenter',
      exact: true,
    })

    // Keep visible origin planes much larger than the displaced model.
    await page.evaluate(() => {
      window.app.singletons.kclManager.sceneInfra.localRenderer?.setDefaultPlaneVisibility(
        { xy: true, xz: true, yz: true }
      )
    })
    await scene.moveCameraTo({ x: 0, y: -100, z: 100 })
    await expect(recover).toBeVisible()
    await recover.click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scene = window.app.singletons.kclManager.sceneInfra
          const bounds = scene.localRenderer?.getModelBounds()
          if (!bounds) return Infinity
          const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
          const size = bounds.max.clone().sub(bounds.min).length()
          return Math.max(
            scene.camControls.target.distanceTo(center) / size,
            scene.camControls.camera.position.distanceTo(
              scene.camControls.target
            ) / size
          )
        })
      )
      .toBeLessThan(10)
    // Check beyond the deliberate 300 ms dismissal during camera movement.
    await page.waitForTimeout(400)
    await expect(recover).not.toBeVisible()
  }
)
