import { test, expect } from '@playwright/test'
import { uuidv4 } from 'lib/utils'
import { getUtils, setup, tearDown } from './test-utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Editor tests', () => {
  test('can comment out code with ctrl+/', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()
    const CtrlKey = process.platform === 'darwin' ? 'Meta' : 'Control'

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`)

    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('/')
    await page.keyboard.up(CtrlKey)

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> line([-20, 0], %)
    // |> close(%)`)

    // uncomment the code
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('/')
    await page.keyboard.up(CtrlKey)

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> line([-20, 0], %)
    |> close(%)`)
  })

  test('if you click the format button it formats your code', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`)
    await page.locator('#code-pane button:first-child').click()
    await page.locator('button:has-text("Format code")').click()

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> line([-20, 0], %)
    |> close(%)`)
  })

  test('fold gutters work', async ({ page }) => {
    const u = await getUtils(page)

    const fullCode = `const sketch001 = startSketchOn('XY')
     |> startProfileAt([-10, -10], %)
     |> line([20, 0], %)
     |> line([0, 20], %)
     |> line([-20, 0], %)
     |> close(%)`
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
     |> startProfileAt([-10, -10], %)
     |> line([20, 0], %)
     |> line([0, 20], %)
     |> line([-20, 0], %)
     |> close(%)`
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // TODO: Jess needs to fix this but you have to mod the code to get them to show
    // up, its an annoying codemirror thing.
    await page.locator('.cm-content').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    const foldGutterFoldLine = page.locator('[title="Fold line"]')
    const foldGutterUnfoldLine = page.locator('[title="Unfold line"]')

    await expect(page.locator('.cm-content')).toHaveText(fullCode)

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Make sure we have a fold gutter
    await expect(foldGutterFoldLine).toBeVisible()
    await expect(foldGutterUnfoldLine).not.toBeVisible()

    // Collapse the code
    await foldGutterFoldLine.click()

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XY')…   `
    )
    await expect(page.locator('.cm-content')).not.toHaveText(fullCode)
    await expect(foldGutterFoldLine).not.toBeVisible()
    await expect(foldGutterUnfoldLine.nth(1)).toBeVisible()

    // Expand the code
    await foldGutterUnfoldLine.nth(1).click()
    await expect(page.locator('.cm-content')).toHaveText(fullCode)

    // Delete all the code.
    await page.locator('.cm-content').click()
    // Select all
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Backspace')

    await expect(page.locator('.cm-content')).toHaveText(``)
    await expect(page.locator('.cm-content')).not.toHaveText(fullCode)

    await expect(foldGutterUnfoldLine).not.toBeVisible()
    await expect(foldGutterFoldLine).not.toBeVisible()
  })

  test('hover over functions shows function description', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // focus the editor
    await u.codeLocator.click()

    // Hover over  the startSketchOn function
    await page.getByText('startSketchOn').hover()
    await expect(page.locator('.hover-tooltip')).toBeVisible()
    await expect(
      page.getByText(
        'Start a new 2-dimensional sketch on a specific plane or face'
      )
    ).toBeVisible()

    // Hover over the line function
    await page.getByText('line').first().hover()
    await expect(page.locator('.hover-tooltip')).toBeVisible()
    await expect(page.getByText('Draw a line')).toBeVisible()
  })

  test('if you use the format keyboard binding it formats your code', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`
      )
      localStorage.setItem('disableAxis', 'true')
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // focus the editor
    await u.codeLocator.click()

    // Hit alt+shift+f to format the code
    await page.keyboard.press('Alt+Shift+KeyF')

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> line([-20, 0], %)
    |> close(%)`)
  })

  test('if you write kcl with lint errors you get lints', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-info')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type('const my_snake_case_var = 5')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const myCamelCaseVar = 5')
    await page.keyboard.press('Enter')

    // press arrows to clear autocomplete
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()

    // select the line that's causing the error and delete it
    await page.getByText('const my_snake_case_var = 5').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')

    // wait for .cm-lint-marker-info not to be visible
    await expect(page.locator('.cm-lint-marker-info')).not.toBeVisible()
  })

  test('if you fixup kcl errors you clear lints', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> close(%)
  `
      )
    })

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()

    await page.getByText(' |> line([2.48, 2.44], %)').click()

    await expect(
      page.locator('.cm-lint-marker-error').first()
    ).not.toBeVisible()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')

    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()
    await page.keyboard.type(')')
    await expect(
      page.locator('.cm-lint-marker-error').first()
    ).not.toBeVisible()
  })

  test('if you write invalid kcl you get inlined errors', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    /* add the following code to the editor ($ error is not a valid line)
      $ error
      const topAng = 30
      const bottomAng = 25
     */
    await u.codeLocator.click()
    await page.keyboard.type('$ error')

    // press arrows to clear autocomplete
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')

    await page.keyboard.press('Enter')
    await page.keyboard.type('const topAng = 30')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const bottomAng = 25')
    await page.keyboard.press('Enter')

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.getByText('Unexpected token').first()).toBeVisible()

    // select the line that's causing the error and delete it
    await page.getByText('$ error').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')

    // wait for .cm-lint-marker-error not to be visible
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // let's check we get an error when defining the same variable twice
    await page.getByText('const bottomAng = 25').click()
    await page.keyboard.press('Enter')
    await page.keyboard.type("// Let's define the same thing twice")
    await page.keyboard.press('Enter')
    await page.keyboard.type('const topAng = 42')
    await page.keyboard.press('ArrowLeft')

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
    await expect(
      page.locator('.cm-lint-marker.cm-lint-marker-error')
    ).toBeVisible()

    await page.locator('.cm-lint-marker.cm-lint-marker-error').hover()
    await expect(page.locator('.cm-diagnosticText').first()).toBeVisible()
    await expect(
      page.getByText('Cannot redefine `topAng`').first()
    ).toBeVisible()

    const secondTopAng = page.getByText('topAng').first()
    await secondTopAng?.dblclick()
    await page.keyboard.type('otherAng')

    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
  })

  test('error with 2 source ranges gets 2 diagnostics', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const length = .750
  const width = 0.500
  const height = 0.500
  const dia = 4
  
  fn squareHole = (l, w) => {
    const squareHoleSketch = startSketchOn('XY')
    |> startProfileAt([-width / 2, -length / 2], %)
    |> lineTo([width / 2, -length / 2], %)
    |> lineTo([width / 2, length / 2], %)
    |> lineTo([-width / 2, length / 2], %)
    |> close(%)
    return squareHoleSketch
  }
  `
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Click on the bottom of the code editor to add a new line
    await u.codeLocator.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type(`const extrusion = startSketchOn('XY')
    |> circle([0, 0], dia/2, %)
  |> hole(squareHole(length, width, height), %)
  |> extrude(height, %)`)

    // error in gutter
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()
    await page.hover('.cm-lint-marker-error:first-child')
    await expect(
      page.getByText('Expected 2 arguments, got 3').first()
    ).toBeVisible()

    // Make sure there are two diagnostics
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(2)
  })
  test('if your kcl gets an error from the engine it is inlined', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, $revolveAxis)
  |> close(%)
  |> extrude(10, %)

  const sketch001 = startSketchOn(box, revolveAxis)
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> revolve({
  axis: revolveAxis,
  angle: 90
  }, %)
      `
      )
    })

    await page.setViewportSize({ width: 1000, height: 500 })

    await page.goto('/')
    await u.waitForPageLoad()

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const searchText =
      'sketch profile must lie entirely on one side of the revolution axis'
    await expect(page.getByText(searchText)).toBeVisible()
  })
  test.describe('Autocomplete works', () => {
    test('with enter/click to accept the completion', async ({ page }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // this test might be brittle as we add and remove functions
      // but should also be easy to update.
      // tests clicking on an option, selection the first option
      // and arrowing down to an option

      await u.codeLocator.click()
      await page.keyboard.type('const sketch001 = start')

      // expect there to be six auto complete options
      await expect(page.locator('.cm-completionLabel')).toHaveCount(8)
      // this makes sure we can accept a completion with click
      await page.getByText('startSketchOn').click()
      await page.keyboard.type("'XZ'")
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.keyboard.type('  |> startProfi')
      // expect there be a single auto complete option that we can just hit enter on
      await expect(page.locator('.cm-completionLabel')).toBeVisible()
      await page.waitForTimeout(100)
      await page.keyboard.press('Enter') // accepting the auto complete, not a new line

      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.type('12')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.type('  |> lin')

      await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
      await page.waitForTimeout(100)
      // press arrow down twice then enter to accept xLine
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      // finish line with comment
      await page.keyboard.type('5')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')

      await page.keyboard.type(' // ')
      // Since we need to parse the ast to know we are in a comment we gotta hang tight.
      await page.waitForTimeout(700)
      await page.keyboard.type('lin ')
      await page.waitForTimeout(200)
      // there shouldn't be any auto complete options for 'lin' in the comment
      await expect(page.locator('.cm-completionLabel')).not.toBeVisible()

      await expect(page.locator('.cm-content'))
        .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([3.14, 12], %)
    |> xLine(5, %) // lin`)
    })

    test('with tab to accept the completion', async ({ page }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // this test might be brittle as we add and remove functions
      // but should also be easy to update.
      // tests clicking on an option, selection the first option
      // and arrowing down to an option

      await u.codeLocator.click()
      await page.keyboard.type('const sketch001 = startSketchO')
      await page.waitForTimeout(100)

      // Make sure just hitting tab will take the only one left
      await expect(page.locator('.cm-completionLabel')).toHaveCount(1)
      await page.waitForTimeout(500)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Tab')
      await page.waitForTimeout(500)
      await page.keyboard.type("'XZ'")
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.keyboard.type('  |> startProfi')
      // expect there be a single auto complete option that we can just hit enter on
      await expect(page.locator('.cm-completionLabel')).toBeVisible()
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab') // accepting the auto complete, not a new line

      await page.keyboard.press('Tab')
      await page.keyboard.type('12')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.type('  |> lin')

      await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
      await page.waitForTimeout(100)
      // press arrow down twice then tab to accept xLine
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Tab')
      // finish line with comment
      await page.keyboard.type('5')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')

      await page.keyboard.type(' // ')
      // Since we need to parse the ast to know we are in a comment we gotta hang tight.
      await page.waitForTimeout(700)
      await page.keyboard.type('lin ')
      await page.waitForTimeout(200)
      // there shouldn't be any auto complete options for 'lin' in the comment
      await expect(page.locator('.cm-completionLabel')).not.toBeVisible()

      await expect(page.locator('.cm-content'))
        .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([3.14, 12], %)
    |> xLine(5, %) // lin`)
    })
  })
  test('Can undo a click and point extrude with ctrl+z', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.waitForTimeout(100)
    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 0, y: -1250, z: 580 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await page.waitForTimeout(100)
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await page.waitForTimeout(100)

    const startPX = [665, 458]

    const dragPX = 40

    await page.getByText('startProfileAt([4.61, -14.01], %)').click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeVisible()
    await page.getByRole('button', { name: 'Extrude' }).click()

    await expect(page.getByTestId('command-bar')).toBeVisible()
    await page.waitForTimeout(100)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await expect(page.getByText('Confirm Extrude')).toBeVisible()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)

    // expect the code to have changed
    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')  |> startProfileAt([4.61, -14.01], %)  |> line([12.73, -0.09], %)  |> tangentialArcTo([24.95, -5.38], false, %)  |> close(%)const extrude001 = extrude(5, sketch001)`
    )

    // Now hit undo
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)`)
  })

  // failing for the same reason as "Can edit a sketch that has been extruded in the same pipe"
  // please fix together
  test.fixme('Can undo a sketch modification with ctrl+z', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> extrude(5, %)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.waitForTimeout(100)
    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 0, y: -1250, z: 580 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await page.waitForTimeout(100)
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await page.waitForTimeout(100)

    const startPX = [665, 458]

    const dragPX = 40

    await page.getByText('startProfileAt([4.61, -14.01], %)').click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(400)
    let prevContent = await page.locator('.cm-content').innerText()

    await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

    // drag startProfieAt handle
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: { x: startPX[0], y: startPX[1] },
      targetPosition: { x: startPX[0] + dragPX, y: startPX[1] + dragPX },
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag line handle
    // we wait so it saves the code
    await page.waitForTimeout(800)

    const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
    await page.waitForTimeout(100)
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: { x: lineEnd.x - 5, y: lineEnd.y },
      targetPosition: { x: lineEnd.x + dragPX, y: lineEnd.y + dragPX },
    })
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // we wait so it saves the code
    await page.waitForTimeout(800)

    // drag tangentialArcTo handle
    const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: { x: tangentEnd.x, y: tangentEnd.y - 5 },
      targetPosition: {
        x: tangentEnd.x + dragPX,
        y: tangentEnd.y + dragPX,
      },
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([7.12, -16.82], %)
    |> line([15.4, -2.74], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> line([2.65, -2.69], %)
    |> close(%)
    |> extrude(5, %)`)

    // Hit undo
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([7.12, -16.82], %)
    |> line([15.4, -2.74], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> extrude(5, %)`)

    // Hit undo again.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([7.12, -16.82], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> extrude(5, %)`)

    // Hit undo again.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> extrude(5, %)`)
  })
})
