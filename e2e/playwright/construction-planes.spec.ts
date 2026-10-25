import { expect, test } from '@e2e/playwright/zoo-test'

for (const kind of [
  'Offset',
  'Midplane',
  'Parallel through point',
  'Perpendicular bisector',
] as const) {
  test(
    `Plane infers ${kind} from viewport references`,
    { tag: '@web' },
    async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
      await homePage.goToModelingScene()
      await editor.openPane()
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode(
          '',
          `@settings(kclVersion = 3.0)
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
      const camera = async (back = false) => {
        await scene.moveCameraTo(
          { x: 80, y: back ? 100 : -100, z: 100 },
          { x: 20, y: 20, z: 10 }
        )
        await page.evaluate(async () => {
          await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'default_camera_get_settings' },
          })
        })
      }
      await scene.settled()
      await camera()
      await page.getByTestId('plane').click()
      await expect
        .poll(async () => {
          const state = await cmdBar.getState()
          return state.stage === 'arguments' ? state.currentArgKey : undefined
        })
        .toBe('references')
      const pick = async (point: number[], count: number) => {
        const projected = await page.evaluate((point) => {
          const camera =
            window.app.singletons.kclManager.sceneInfra.camControls.camera.clone()
          camera.updateMatrixWorld(true)
          const p = camera.position
            .clone()
            .set(point[0], point[1], point[2])
            .project(camera)
          return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }
        }, point)
        const pixel = await scene.convertPagePositionToStream(
          projected.x,
          projected.y,
          'ratio'
        )
        expect(
          await page.evaluate(
            ({ x, y }) =>
              !document
                .elementFromPoint(x, y)
                ?.closest('[data-testid="command-bar"]'),
            pixel
          ),
          'The Plane dialog must leave the reference point available to click'
        ).toBe(true)
        const [click] = scene.makeMouseHelpers(projected.x, projected.y, {
          format: 'ratio',
          debugLabel: 'reference',
        })
        await click()
        await expect
          .poll(async () => {
            const selection = JSON.parse(
              await cmdBar.currentArgumentInput.inputValue()
            )
            return (
              selection.graphSelections.length +
              selection.otherSelections.length
            )
          })
          .toBe(count)
      }
      await pick(
        kind === 'Midplane'
          ? [20, 0, 10]
          : kind === 'Perpendicular bisector'
            ? [0, 0, 20]
            : [20, 20, 20],
        1
      )
      if (kind !== 'Offset') {
        await page.keyboard.down('Shift')
        if (kind === 'Midplane') await camera(true)
        await pick(
          kind === 'Midplane'
            ? [20, 40, 10]
            : kind === 'Parallel through point'
              ? [40, 0, 0]
              : [40, 0, 20],
          2
        )
        await page.keyboard.up('Shift')
      }
      await cmdBar.progressCmdBar()
      if (kind === 'Offset') {
        await expect
          .poll(async () => {
            const state = await cmdBar.getState()
            return state.stage === 'arguments' ? state.currentArgKey : undefined
          })
          .toBe('offset')
        await cmdBar.argumentInput.locator('[contenteditable]').fill('5mm')
        await expect(page.locator('#arg-form')).toHaveAttribute(
          'data-can-submit',
          'true'
        )
        await cmdBar.progressCmdBar()
      }
      await expect(page.locator('#review-form')).toBeVisible()
      await expect(page.getByTestId('command-bar-submit')).toBeEnabled()
      await cmdBar.submit()
      await scene.settled()
      const result = await page.evaluate(() => {
        const p = window.app.singletons.kclManager.variables.plane001
        return p?.type === 'Plane'
          ? { origin: p.value.origin, normal: p.value.zAxis }
          : undefined
      })
      const origin =
        kind === 'Offset'
          ? [0, 0, 25]
          : kind === 'Midplane'
            ? [0, 20, 0]
            : kind === 'Parallel through point'
              ? [40, 0, 0]
              : [20, 0, 20]
      // Plane origins on faces may differ tangentially; check the defining equation.
      if (kind === 'Offset') expect(result?.origin.z).toBeCloseTo(25)
      else if (kind === 'Midplane') expect(result?.origin.y).toBeCloseTo(20)
      else
        for (const [i, axis] of (['x', 'y', 'z'] as const).entries())
          expect(result?.origin[axis]).toBeCloseTo(origin[i])
      const normal =
        kind === 'Midplane'
          ? [0, -1, 0]
          : kind === 'Perpendicular bisector'
            ? [1, 0, 0]
            : [0, 0, 1]
      for (const [i, axis] of (['x', 'y', 'z'] as const).entries())
        expect(
          kind === 'Midplane'
            ? Math.abs(result?.normal[axis] ?? NaN)
            : result?.normal[axis]
        ).toBeCloseTo(Math.abs(normal[i]))
      await toolbar.startSketchBtn.click()
      await (await toolbar.getFeatureTreeOperation('plane001', 0)).click()
      await expect(toolbar.exitSketchBtn).toBeVisible()
      await editor.expectEditor.toContain('sketch(on = plane001)')
    }
  )
}

test(
  'Plane infers three points from actual corners on a solid',
  { tag: '@web' },
  async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
    await homePage.goToModelingScene()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `@settings(kclVersion = 3.0)
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
          window.app.singletons.kclManager.sceneInfra.camControls.camera.clone()
        camera.updateMatrixWorld(true)
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

    await page.getByTestId('plane').click()
    await expect
      .poll(async () => {
        const state = await cmdBar.getState()
        return state.stage === 'arguments' ? state.currentArgKey : undefined
      })
      .toBe('references')
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
      'plane001 = plane(origin = [0mm, 0mm, 20mm], normal = [0, 0, 1], xAxis = [1, 0, 0])',
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
