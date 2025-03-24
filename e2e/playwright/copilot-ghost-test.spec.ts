import { test, expect } from './zoo-test'
import { getUtils } from './test-utils'

test.describe('Copilot ghost text', () => {
  // eslint-disable-next-line jest/valid-title
  test.skip(true, 'Needs to get covered again')

  test('completes code in empty file', async ({ page, homePage }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )

    // Hit enter a few times.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)    `
    )

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
  })

  test.skip('copilot disabled in sketch mode no select plane', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    // Click sketch mode.
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await u.codeLocator.click()
    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(``)

    // Exit sketch mode.
    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    await page.waitForTimeout(500)

    await u.codeLocator.click()
    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toContainText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
  })

  test('copilot disabled in sketch mode after selecting plane', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    // Click sketch mode.
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // select a plane
    await page.mouse.click(700, 200)
    await page.waitForTimeout(700) // wait for animation

    await u.codeLocator.click()
    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)`
    )

    // Escape to exit the tool.
    await u.openDebugPanel()
    await u.closeDebugPanel()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await u.codeLocator.click()
    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)`
    )

    // Escape again to exit sketch mode.
    await u.openDebugPanel()
    await u.closeDebugPanel()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await u.codeLocator.click()
    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )

    // Hit enter a few times.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)    `
    )

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
  })

  test('ArrowUp in code rejects the suggestion', async ({ page, homePage }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowDown in code rejects the suggestion', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowLeft in code rejects the suggestion', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowRight in code rejects the suggestion', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('Enter in code scoots it down', async ({ page, homePage }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
  })

  test('Ctrl+shift+z in code rejects the suggestion', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('ControlOrMeta')
    await page.keyboard.up('Shift')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('Ctrl+z in code rejects the suggestion and undos the last code', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await page.waitForTimeout(800)
    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await page.keyboard.type('{thing: "blah"}', { delay: 0 })

    await expect(page.locator('.cm-content')).toHaveText(`{thing: "blah"}`)

    // We wanna make sure the code saves.
    await page.waitForTimeout(800)

    // Ctrl+z
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('ControlOrMeta')

    await expect(page.locator('.cm-content')).toHaveText(``)

    // Ctrl+shift+z
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('ControlOrMeta')
    await page.keyboard.up('Shift')

    await expect(page.locator('.cm-content')).toHaveText(`{thing: "blah"}`)

    // We wanna make sure the code saves.
    await page.waitForTimeout(800)

    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `{thing: "blah"}fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Once for the enter.
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('ControlOrMeta')

    // Once for the text.
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('ControlOrMeta')

    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    // TODO when we make codemirror a widget, we can test this.
    //await expect(page.locator('.cm-content')).toHaveText(``) })

    test('delete in code rejects the suggestion', async ({
      page,
      homePage,
    }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      await u.codeLocator.click()
      await expect(page.locator('.cm-content')).toHaveText(``)

      await expect(page.locator('.cm-ghostText')).not.toBeVisible()
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(page.locator('.cm-ghostText').first()).toBeVisible()
      await expect(page.locator('.cm-content')).toHaveText(
        `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
      )
      await expect(page.locator('.cm-ghostText').first()).toHaveText(
        `fn cube = (pos, scale) => {`
      )

      // Going elsewhere in the code should hide the ghost text.
      await page.keyboard.press('Delete')
      await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

      await expect(page.locator('.cm-content')).toHaveText(``)
    })

    test('backspace in code rejects the suggestion', async ({
      page,
      homePage,
    }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      await u.codeLocator.click()
      await expect(page.locator('.cm-content')).toHaveText(``)

      await expect(page.locator('.cm-ghostText')).not.toBeVisible()
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(page.locator('.cm-ghostText').first()).toBeVisible()
      await expect(page.locator('.cm-content')).toHaveText(
        `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
      )
      await expect(page.locator('.cm-ghostText').first()).toHaveText(
        `fn cube = (pos, scale) => {`
      )

      // Going elsewhere in the code should hide the ghost text.
      await page.keyboard.press('Backspace')
      await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

      await expect(page.locator('.cm-content')).toHaveText(``)
    })

    test('focus outside code pane rejects the suggestion', async ({
      page,
      homePage,
    }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      await u.codeLocator.click()
      await expect(page.locator('.cm-content')).toHaveText(``)

      await expect(page.locator('.cm-ghostText')).not.toBeVisible()
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await expect(page.locator('.cm-ghostText').first()).toBeVisible()
      await expect(page.locator('.cm-content')).toHaveText(
        `fn cube = (pos, scale) => {  sg = startSketchOn(XY)    |> startProfileAt(pos, %)    |> line(end = [0, scale], %)    |> line(end = [scale, 0])    |> line(end = [0, -scale])  return sg}part001 = cube([0,0], 20)    |> close()    |> extrude(length = 20)`
      )
      await expect(page.locator('.cm-ghostText').first()).toHaveText(
        `fn cube = (pos, scale) => {`
      )

      // Going outside the editor should hide the ghost text.
      await page.mouse.move(0, 0)
      await page
        .getByRole('button', { name: 'Start Sketch' })
        .waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Start Sketch' }).click()
      await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

      await expect(page.locator('.cm-content')).toHaveText(``)
    })
  })
})
