import { expect, test } from '@e2e/playwright/zoo-test'

const profileCode = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@desktop' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test.beforeEach(async ({ context, page, homePage, scene }) => {
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, profileCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
  })

  test('Toolbar activates, dismisses, and switches modeling dialogs', async ({
    page,
    toolbar,
    editor,
    cmdBar,
  }) => {
    const dialog = page.getByTestId('modeling-dialog')
    await toolbar.extrudeButton.click()
    await expect(dialog.getByText('Extrude', { exact: true })).toBeVisible()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'true')

    await toolbar.extrudeButton.click()
    await expect(dialog).not.toBeAttached()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')

    await toolbar.extrudeButton.click()
    await toolbar.revolveButton.click()
    await expect(dialog.getByText('Revolve', { exact: true })).toBeVisible()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')
    await expect(toolbar.revolveButton).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeAttached()
    await expect(toolbar.revolveButton).toHaveAttribute('aria-pressed', 'false')

    await cmdBar.cmdBarOpenBtn.click()
    await cmdBar.cmdOptions.getByText('Extrude', { exact: true }).click()
    await expect(dialog.getByText('Extrude', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(profileCode, { shouldNormalise: true })
    await editor.expectEditor.not.toContain('extrude(')
  })

  test('Keeps expanded dialog controls inside the modeling viewport', async ({
    page,
    toolbar,
  }) => {
    await toolbar.extrudeButton.click()
    const dialog = page.getByTestId('modeling-dialog')
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })

    await expect
      .poll(async () => {
        const dialogBounds = await dialog.boundingBox()
        const toolbarBounds = await page.getByTestId('toolbar').boundingBox()
        return dialogBounds && toolbarBounds
          ? Math.round(dialogBounds.y - toolbarBounds.y - toolbarBounds.height)
          : 0
      })
      .toBe(8)

    await dialog.getByText('More options', { exact: true }).click()
    for (const height of [800, 600]) {
      await page.setBodyDimensions({ width: 1200, height })
      await expect
        .poll(async () => {
          const submitBounds = await submit.boundingBox()
          const sceneBounds = await page
            .locator('#modeling-area-container')
            .boundingBox()
          return submitBounds && sceneBounds
            ? submitBounds.y +
                submitBounds.height -
                (sceneBounds.y + sceneBounds.height)
            : 1
        })
        .toBeLessThanOrEqual(0)
      await expect(submit).toBeInViewport()
    }

    const initialBounds = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { height: bounds.height, centerX: bounds.x + bounds.width / 2 }
    })
    const sceneBottom = await page
      .locator('#modeling-area-container')
      .evaluate((element) => element.getBoundingClientRect().bottom)
    await dialog.getByText('Extrude', { exact: true }).hover()
    await page.mouse.down()
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.mouse.move(initialBounds.centerX, sceneBottom - 1 - attempt)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      await expect
        .poll(async () => {
          const height = await dialog.evaluate(
            (element) => element.getBoundingClientRect().height
          )
          return Math.abs(height - initialBounds.height)
        })
        .toBeLessThanOrEqual(1)
    }
    await page.mouse.up()
    await expect
      .poll(() =>
        submit.evaluate((element) => element.getBoundingClientRect().bottom)
      )
      .toBeLessThanOrEqual(sceneBottom)
    await expect(submit).toBeInViewport()
  })

  test('Keeps a dragged dialog inside the modeling area after resizing', async ({
    page,
    toolbar,
  }) => {
    await toolbar.extrudeButton.click()
    const dialog = page.getByTestId('modeling-dialog')
    await expect(
      dialog.getByRole('textbox', { name: 'Distance', exact: false })
    ).toBeVisible()
    const bounds = await dialog.boundingBox()
    if (!bounds) throw new Error('Expected dialog bounds')
    await dialog.getByText('Extrude', { exact: true }).hover()
    await page.mouse.down()
    await page.mouse.move(bounds.x + 60, bounds.y + 45, { steps: 3 })
    await page.mouse.up()

    for (const size of [
      { width: 1000, height: 700 },
      { width: 1100, height: 600 },
    ]) {
      await page.setBodyDimensions(size)
      await expect
        .poll(async () => {
          const dialogBounds = await dialog.boundingBox()
          const container = await page
            .locator('#modeling-area-container')
            .boundingBox()
          return Boolean(
            dialogBounds &&
              container &&
              dialogBounds.x >= container.x &&
              dialogBounds.y >= container.y &&
              dialogBounds.x + dialogBounds.width <=
                container.x + container.width + 1 &&
              dialogBounds.y + dialogBounds.height <=
                container.y + container.height + 1
          )
        })
        .toBe(true)
      await expect(
        dialog.getByRole('button', { name: 'Submit', exact: true })
      ).toBeInViewport()
    }
  })

  test('Creates and edits an extrude with selection removal and extent changes', async ({
    page,
    toolbar,
    editor,
    scene,
  }) => {
    const dialog = page.getByTestId('modeling-dialog')
    const distance = dialog.getByRole('textbox', {
      name: 'Distance',
      exact: false,
    })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })

    await editor.selectText('region(')
    await toolbar.extrudeButton.click()
    await expect(
      dialog.getByRole('button', { name: 'Remove selection 1' })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove selection 1' }).click()
    await expect(submit).toBeDisabled()
    // Code-to-scene selection suppresses duplicate events for 500ms.
    await expect(async () => {
      await editor.scrollToText('sketch001 =')
      await editor.selectText('region(')
      await expect(
        dialog.getByRole('button', { name: 'Remove selection 1' })
      ).toBeVisible({ timeout: 200 })
    }).toPass()

    await distance.fill('missingDistance')
    await expect(submit).toBeDisabled()
    await distance.fill('12')
    await dialog.getByRole('button', { name: 'Two sides', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Second distance' }).fill('4')
    await dialog.getByRole('button', { name: 'Symmetric', exact: true }).click()
    await expect(
      dialog.getByRole('textbox', { name: 'Second distance' })
    ).not.toBeAttached()
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude(region001, length = 12, symmetric = true)'
    )
    await editor.expectEditor.not.toContain('bidirectionalLength')
    await scene.settled()

    await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
    await expect(
      dialog.getByRole('button', { name: 'Symmetric', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(distance).toHaveText('12')
    await distance.fill('8')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude(region001, length = 8, symmetric = true)'
    )
    await editor.expectEditor.not.toContain('bidirectionalLength')
    await scene.settled()
  })
})
