import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test(
  'orientation gizmos follow their editor rather than their React view',
  { tag: ['@web', '@desktop'] },
  async ({ page, homePage, toolbar, scene }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await homePage.createAndGoToProject('gizmo-lifetime')
    await scene.settled()
    const gizmo = page.getByLabel('View orientation gizmo', { exact: true })
    const setStyle = async (style: 'cube' | 'axis') => {
      await page.evaluate((value) => {
        window.app.settings.actor.send({
          type: 'set.modeling.gizmoType',
          data: { level: 'user', value },
        })
      }, style)
      await expect
        .poll(() =>
          page.evaluate((value) => {
            const sceneInfra = window.app.singletons.kclManager.sceneInfra
            const renderer =
              value === 'cube'
                ? sceneInfra.getCubeGizmo('light')
                : sceneInfra.getAxisGizmo()
            return (
              document.querySelector(
                '[aria-label="View orientation gizmo"] canvas'
              ) === renderer?.canvas
            )
          }, style)
        )
        .toBe(true)
      await expect(gizmo.locator('canvas')).toBeVisible()
    }
    await setStyle('cube')
    const cube = await gizmo.locator('canvas').elementHandle()
    if (!cube) throw new Error('Cube canvas did not mount')
    await setStyle('axis')
    await expect
      .poll(() => cube.evaluate((canvas) => canvas.isConnected))
      .toBe(false)
    const axis = await gizmo.locator('canvas').elementHandle()
    if (!axis) throw new Error('Axis canvas did not mount')
    await setStyle('cube')
    await expect
      .poll(() => cube.evaluate((canvas) => canvas.isConnected))
      .toBe(true)
    await setStyle('axis')
    await expect
      .poll(() => axis.evaluate((canvas) => canvas.isConnected))
      .toBe(true)

    await toolbar.openPane(DefaultLayoutPaneID.Files)
    await toolbar.createFile({
      fileName: 'other.kcl',
      waitForToastToDisappear: false,
    })
    await toolbar.openFile('other.kcl')
    await scene.settled()
    await expect(gizmo.locator('canvas')).toBeVisible()
    await expect
      .poll(() => axis.evaluate((canvas) => canvas.isConnected))
      .toBe(false)
    await expect
      .poll(() => cube.evaluate((canvas) => canvas.isConnected))
      .toBe(false)
    await setStyle('cube')
    await expect(gizmo.locator('canvas')).toBeVisible()
    expect(errors).toEqual([])
  }
)
