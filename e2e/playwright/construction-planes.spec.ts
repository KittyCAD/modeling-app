import { expect, test } from '@e2e/playwright/zoo-test'

test(
  '3-Point Plane picks actual corners on a solid',
  { tag: '@web' },
  async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
    await homePage.goToModelingScene()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `@settings(kclVersion = 2.0)
outline = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [40mm, 0mm])
  right = line(start = [40mm, 0mm], end = [40mm, 40mm])
  top = line(start = [40mm, 40mm], end = [0mm, 40mm])
  left = line(start = [0mm, 40mm], end = [0mm, 0mm])
}
face = region(point = [10mm, 10mm], sketch = outline)
body = extrude(face, length = 20mm)`
      )
    )
    await scene.settled()
    await scene.moveCameraTo(
      { x: 80, y: -100, z: 100 },
      { x: 20, y: 20, z: 10 }
    )
    // Refresh the client camera after setting the engine camera directly.
    await page.evaluate(async () => {
      await window.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: crypto.randomUUID(),
        cmd: { type: 'default_camera_get_settings' },
      })
    })
    const clickCorner = async (point: number[]) => {
      const projected = await page.evaluate((point) => {
        const camera =
          window.app.singletons.kclManager.sceneInfra.camControls.camera
        const p = camera.position
          .clone()
          .set(point[0], point[1], point[2])
          .project(camera)
        return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }
      }, point)
      const [click] = scene.makeMouseHelpers(projected.x, projected.y, {
        format: 'ratio',
        debugLabel: 'corner',
      })
      await click()
    }
    // The public filter allows a corner to be selected before entering the tool.
    await page.getByTestId('selection-filter-status').click()
    await page.getByRole('button', { name: 'Points', exact: true }).click()
    await clickCorner([0, 0, 20])
    await expect(page.getByText('1 point', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.app.singletons.kclManager.selectionFilter.value
        )
      )
      .toEqual(['vertex'])

    await page
      .getByRole('button', { name: 'planes: open menu', exact: true })
      .click()
    await page.getByTestId('dropdown-plane-points').click()
    await expect
      .poll(async () => {
        const state = await cmdBar.getState()
        return state.stage === 'arguments' ? state.currentArgKey : undefined
      })
      .toBe('pickedPoints')
    // First click replaces selection; Shift adds the remaining corners.
    await clickCorner([0, 0, 20])
    await expect
      .poll(
        async () =>
          JSON.parse(await page.getByTestId('cmd-bar-arg-value').inputValue())
            .graphSelections.length
      )
      .toBe(1)
    await page.keyboard.down('Shift')
    await clickCorner([40, 0, 20])
    await expect
      .poll(
        async () =>
          JSON.parse(await page.getByTestId('cmd-bar-arg-value').inputValue())
            .graphSelections.length
      )
      .toBe(2)
    await clickCorner([40, 40, 20])
    await expect
      .poll(
        async () =>
          JSON.parse(await page.getByTestId('cmd-bar-arg-value').inputValue())
            .graphSelections.length
      )
      .toBe(3)
    await page.keyboard.up('Shift')
    await cmdBar.progressCmdBar()
    await expect
      .poll(async () => (await cmdBar.getState()).stage)
      .toBe('review')
    await cmdBar.submit()
    await editor.expectEditor.toContain(
      'plane001 = plane(points = [[0mm, 0mm, 20mm], [40mm, 0mm, 20mm], [40mm, 40mm, 20mm]])',
      { shouldNormalise: true }
    )
    await scene.settled()
    await toolbar.startSketchBtn.click()
    await (await toolbar.getFeatureTreeOperation('plane001', 0)).click()
    await expect(toolbar.exitSketchBtn).toBeVisible()
    await editor.expectEditor.toContain('sketch(on = plane001)')
  }
)

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
      if (method === 'Three points') {
        await cmdBar
          .selectOption({ name: 'Enter coordinates', exact: true })
          .click()
      }
      for (const arg of args) {
        await expect
          .poll(async () => {
            const state = await cmdBar.getState()
            return state.stage === 'arguments' ? state.currentArgKey : undefined
          })
          .toBe(arg)
        await expect(page.locator('#arg-form')).toHaveAttribute(
          'data-can-submit',
          'true'
        )
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
      await expect(toolbar.exitSketchBtn).toBeVisible()
      await editor.expectEditor.toContain('sketch(on = plane001)')
      await expect(page.getByTestId('sketch-exit')).toBeVisible()
    }
  )
}
