import { expect, test } from '@e2e/playwright/zoo-test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

const profileCode = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 10mm], center = [var 0mm, var 10mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@web' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Uses dialogs for supported commands and the palette for mixed selections', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    const visibility = new Map<string, boolean>()
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).searchParams.has('video_res_width')) return
      socket.on('framesent', ({ payload }) => {
        const request: EngineCommand = JSON.parse(payload.toString())
        const commands =
          request.type === 'modeling_cmd_batch_req'
            ? request.requests.map(({ cmd }) => cmd)
            : request.type === 'modeling_cmd_req'
              ? [request.cmd]
              : []
        for (const command of commands)
          if (command.type === 'object_visible')
            visibility.set(command.object_id, command.hidden)
      })
    })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await editor.selectText('region(')
    await toolbar.revolveButton.click()

    const dialog = page.getByTestId('modeling-dialog')
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })
    const axisMode = dialog.getByRole('combobox', { name: /axis or edge/i })
    await expect(dialog).toBeVisible()
    await axisMode.selectOption({ label: 'Edge' })
    await expect(
      dialog.getByRole('button', { name: 'Select Edge' })
    ).toBeVisible()
    await expect(submit).toBeDisabled()
    await axisMode.selectOption({ label: 'Sketch Axis' })
    await dialog.getByRole('textbox', { name: /^angle$/i }).fill('180deg')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('angle = 180deg')
    await scene.settled()

    await toolbar.openFeatureTreePane()
    await (await toolbar.getFeatureTreeOperation('Revolve', 0)).dblclick()
    await expect(axisMode).not.toBeAttached()
    await dialog.getByRole('textbox', { name: /^angle$/i }).fill('90deg')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('angle = 90deg')
    await scene.settled()

    const planeIds = await page.evaluate(() => {
      const planes = window.app.singletons.kclManager.defaultPlanes
      return planes ? [planes.xy, planes.xz, planes.yz] : []
    })
    expect(planeIds).toHaveLength(3)
    await expect
      .poll(() => planeIds.map((id) => visibility.get(id)))
      .toEqual([true, true, true])
    await toolbar.offsetPlaneButton.click()
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => planeIds.map((id) => visibility.get(id)))
      .toEqual([false, false, false])
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeAttached()
    await expect
      .poll(() => planeIds.map((id) => visibility.get(id)))
      .toEqual([true, true, true])

    await toolbar.translateButton.click()
    await expect(page.getByTestId('command-bar')).toBeVisible()
    await expect(dialog).not.toBeAttached()
    await page.keyboard.press('Escape')
  })

  test('Creates and edits Extrude without losing collapsed fields or selection drafts', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await editor.selectText('region(')
    await toolbar.extrudeButton.click()

    const dialog = page.getByTestId('modeling-dialog')
    const length = dialog.getByRole('textbox', { name: /^length$/i })
    const profiles = dialog.getByRole('button', {
      name: 'Select Profiles',
      exact: true,
    })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })
    const tagStart = dialog.getByRole('textbox', { name: /^tag start$/i })
    await expect(length).toHaveText('5')
    await expect(tagStart).toBeHidden()
    await expect(
      dialog.getByRole('combobox', { name: /^symmetric$/i })
    ).toBeVisible()
    await expect(profiles).toContainText(/1 region/i)

    await dialog.getByRole('button', { name: 'Select To', exact: true }).click()
    await expect(profiles).toContainText(/1 region/i)
    await profiles.click()
    await expect(profiles).toContainText(/1 region/i)

    await length.fill('missingLength')
    await expect(submit).toBeDisabled()
    await length.fill('12mm')
    await expect(submit).toBeEnabled()
    const initialPosition = await dialog.boundingBox()
    if (!initialPosition) throw new Error('Modeling dialog is not visible')
    await page.mouse.move(initialPosition.x + 20, initialPosition.y + 15)
    await page.mouse.down()
    await page.mouse.move(initialPosition.x - 140, initialPosition.y + 15)
    await page.mouse.up()
    await expect(dialog).toHaveCSS('position', 'fixed')
    expect((await dialog.boundingBox())?.x).toBeCloseTo(initialPosition.x - 160)
    const more = dialog.getByText('Show more', { exact: true })
    await more.click()
    await expect(submit).toBeInViewport()
    await expect(
      dialog.getByRole('button', { name: 'Cancel' })
    ).toBeInViewport()
    await tagStart.fill('startFace')
    await more.click()
    await page.setBodyDimensions({ width: 1100, height: 540 })
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const panel = element.getBoundingClientRect()
          const bounds = element.parentElement?.getBoundingClientRect()
          return (
            bounds &&
            panel.top >= bounds.top &&
            panel.left >= bounds.left &&
            panel.bottom <= bounds.bottom &&
            panel.right <= bounds.right
          )
        })
      )
      .toBe(true)
    await expect(submit).toBeInViewport()
    await expect(dialog.locator('header')).toBeInViewport()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('length = 12mm')
    await editor.expectEditor.toContain('tagStart = $startFace')
    await scene.settled()

    await toolbar.openFeatureTreePane()
    const operation = await toolbar.getFeatureTreeOperation('Extrude', 0)
    await operation.dblclick()
    await expect(length).toHaveText('12mm')
    await expect(tagStart).toBeHidden()
    await more.click()
    await expect(tagStart).toHaveValue('startFace')
    await length.fill('99mm')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeAttached()
    await operation.dblclick()
    await expect(length).toHaveText('12mm')
    await expect(tagStart).toBeHidden()
    await length.fill('8mm')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('length = 8mm')
    await editor.expectEditor.toContain('tagStart = $startFace')
    await editor.expectEditor.not.toContain('99mm')
    await scene.settled()
  })
})
