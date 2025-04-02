import { uuidv4 } from '@src/lib/utils'
import fsp from 'fs/promises'
import { join } from 'path'

import {
  TEST_COLORS,
  executorInputPath,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Editor tests', { tag: ['@skipWin'] }, () => {
  test('can comment out code with ctrl+/', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`)

    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('/')
    await page.keyboard.up('ControlOrMeta')

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  // |> close()`.replaceAll('\n', '')
    )

    // uncomment the code
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('/')
    await page.keyboard.up('ControlOrMeta')

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`.replaceAll('\n', '')
    )
  })

  test('ensure we use the cache, and do not re-execute', async ({
    homePage,
    page,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)

    // Ensure we execute the first time.
    await u.openDebugPanel()
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(1)
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(2)

    // Add whitespace to the end of the code.
    await u.codeLocator.click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.type('    ')
    await page.keyboard.press('Enter')
    await page.keyboard.type('    ')

    // Ensure we don't execute the second time.
    await u.openDebugPanel()
    // Make sure we didn't clear the scene.
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(3)
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(1)
  })

  test('ensure we use the cache, and do not clear on append', async ({
    homePage,
    page,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)

    // Ensure we execute the first time.
    await u.openDebugPanel()
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(1)
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(2)

    // Add whitespace to the end of the code.
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
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const x = 1')
    await page.keyboard.press('Enter')

    await u.openDebugPanel()
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(3)
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(1)
  })

  test('if you click the format button it formats your code', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`)
    await page.locator('#code-pane button:first-child').click()
    await page.locator('button:has-text("Format code")').click()

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`.replaceAll('\n', '')
    )
  })

  test('if you click the format button it formats your code and executes so lints are still there', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch_001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`)

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()

    await page.locator('#code-pane button:first-child').click()
    await page.locator('button:has-text("Format code")').click()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)
sketch_001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`.replaceAll('\n', '')
    )

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()
  })

  test('fold gutters work', async ({ page, homePage }) => {
    const fullCode = `sketch001 = startSketchOn(XY)
   |> startProfileAt([-10, -10], %)
   |> line(end = [20, 0])
   |> line(end = [0, 20])
   |> line(end = [-20, 0])
   |> close()`
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
   |> startProfileAt([-10, -10], %)
   |> line(end = [20, 0])
   |> line(end = [0, 20])
   |> line(end = [-20, 0])
   |> close()`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

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
      `sketch001 = startSketchOn(XY)…   `
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
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')

    await expect(page.locator('.cm-content')).toHaveText(``)
    await expect(page.locator('.cm-content')).not.toHaveText(fullCode)

    await expect(foldGutterUnfoldLine).not.toBeVisible()
    await expect(foldGutterFoldLine).not.toBeVisible()
  })

  test('hover over functions shows function description', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

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
    await expect(
      page.getByText('Extend the current sketch with a new straight line.')
    ).toBeVisible()
  })

  test('if you use the format keyboard binding it formats your code', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`
      )
      localStorage.setItem('disableAxis', 'true')
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

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
      .toHaveText(`sketch001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)
  })

  test('if you use the format keyboard binding it formats your code and executes so lints are shown', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch_001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`
      )
      localStorage.setItem('disableAxis', 'true')
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()

    // focus the editor
    await u.codeLocator.click()

    // Hit alt+shift+f to format the code
    await page.keyboard.press('Alt+Shift+KeyF')

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await expect(page.locator('.cm-content'))
      .toHaveText(`sketch_001 = startSketchOn(XY)
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()
  })

  test('if you write kcl with lint errors you get lints', async ({
    page,
    homePage,
    scene,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-info')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type('my_snake_case_var = 5')
    await page.keyboard.press('Enter')
    await page.keyboard.type('myCamelCaseVar = 5')
    await page.keyboard.press('Enter')

    // press arrows to clear autocomplete
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')

    await scene.waitForExecutionDone()

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('Identifiers must be lowerCamelCase').first()
    ).toBeVisible()

    // select the line that's causing the error and delete it
    await page.getByText('my_snake_case_var = 5').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')

    // wait for .cm-lint-marker-info not to be visible
    await expect(page.locator('.cm-lint-marker-info')).not.toBeVisible()
  })

  test('if you fixup kcl errors you clear lints', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfileAt([3.29, 7.86], %)
    |> line(end = [2.48, 2.44])
    |> line(end = [2.66, 1.17])
    |> close()
    `
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()

    await page.getByText(' |> line(end = [2.48, 2.44])').click()

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

  test('if you write invalid kcl you get inlined errors', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    /* add the following code to the editor (~ error is not a valid line)
      * the old check here used $ but this is for tags so it changed meaning.
      * hopefully ~ doesn't change meaning
    ~ error
    const topAng = 30
    const bottomAng = 25
   */
    await u.codeLocator.click()
    await page.keyboard.type('~ error')

    // press arrows to clear autocomplete
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')

    await page.keyboard.press('Enter')
    await page.keyboard.type('topAng = 30')
    await page.keyboard.press('Enter')
    await page.keyboard.type('bottomAng = 25')
    await page.keyboard.press('Enter')

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(
      page.getByText("found unknown token '~'").first()
    ).toBeVisible()

    // select the line that's causing the error and delete it
    await page.getByText('~ error').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')

    // wait for .cm-lint-marker-error not to be visible
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // let's check we get an error when defining the same variable twice
    await page.getByText('bottomAng = 25').click()
    await page.keyboard.press('Enter')
    await page.keyboard.type("// Let's define the same thing twice")
    await page.keyboard.press('Enter')
    await page.keyboard.type('topAng = 42')
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

  test('error with 2 source ranges gets 2 diagnostics', async ({
    page,
    homePage,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `length = .750
    width = 0.500
    height = 0.500
    dia = 4

    fn squareHole = (l, w) => {
  squareHoleSketch = startSketchOn(XY)
  |> startProfileAt([-width / 2, -length / 2], %)
  |> line(endAbsolute = [width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, length / 2])
  |> line(endAbsolute = [-width / 2, length / 2])
  |> close()
  return squareHoleSketch
    }
    `
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()
    await page.waitForTimeout(1000)

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
    await page.keyboard.type(`extrusion = startSketchOn(XY)
  |> circle(center: [0, 0], radius: dia/2)
    |> hole(squareHole(length, width, height), %)
    |> extrude(length = height)`)

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
    context,
    page,
    homePage,
  }) => {
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `box = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0, 10])
    |> line(end = [10, 0])
    |> line(end = [0, -10], tag = $revolveAxis)
    |> close()
    |> extrude(length = 10)

    sketch001 = startSketchOn(box, revolveAxis)
    |> startProfileAt([5, 10], %)
    |> line(end = [0, -10])
    |> line(end = [2, 0])
    |> line(end = [0, -10])
    |> close()
    |> revolve(
    axis = revolveAxis,
    angle = 90
    )
    `
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const searchText =
      'sketch profile must lie entirely on one side of the revolution axis'
    await expect(page.getByText(searchText)).toBeVisible()
  })
  test.describe('Autocomplete works', () => {
    test('with enter/click to accept the completion', async ({
      page,
      homePage,
    }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      // tests clicking on an option, selection the first option
      // and arrowing down to an option

      await u.codeLocator.click()
      await page.keyboard.type('sketch001 = start')

      // expect there to be some auto complete options
      // exact number depends on the KCL stdlib, so let's just check it's > 0 for now.
      await expect(async () => {
        const children = await page.locator('.cm-completionLabel').count()
        expect(children).toBeGreaterThan(0)
      }).toPass()
      // this makes sure we can accept a completion with click
      await page.getByText('startSketchOn').click()
      await page.keyboard.type('XZ')
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
      // press arrow down then enter to accept xLine
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      // finish line with comment
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.type('5')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')

      await page.keyboard.type(' // ')
      // Since we need to parse the ast to know we are in a comment we gotta hang tight.
      await page.waitForTimeout(700)
      await page.keyboard.type('lin ')
      await page.waitForTimeout(200)
      // there shouldn't be any auto complete options for 'lin' in the comment
      await expect(page.locator('.cm-completionLabel')).not.toBeVisible()

      await expect(page.locator('.cm-content')).toHaveText(
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
        |> startProfileAt([3.14, 12], %)
        |> xLine(%, length = 5) // lin`.replaceAll('\n', '')
      )

      // expect there to be no KCL errors
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    })

    test('with tab to accept the completion', async ({ page, homePage }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      // this test might be brittle as we add and remove functions
      // but should also be easy to update.
      // tests clicking on an option, selection the first option
      // and arrowing down to an option

      await u.codeLocator.click()
      await page.keyboard.type('sketch001 = startSketchO')
      await page.waitForTimeout(100)

      // Make sure just hitting tab will take the only one left
      await expect(page.locator('.cm-completionLabel')).toHaveCount(1)
      await page.waitForTimeout(500)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Tab')
      await page.waitForTimeout(500)
      await page.keyboard.type('XZ')
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
      // press arrow down then tab to accept xLine
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Tab')
      // finish line with comment
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.type('5')
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')

      await page.keyboard.type(' // ')
      // Since we need to parse the ast to know we are in a comment we gotta hang tight.
      await page.waitForTimeout(700)
      await page.keyboard.type('lin ')
      await page.waitForTimeout(200)
      // there shouldn't be any auto complete options for 'lin' in the comment
      await expect(page.locator('.cm-completionLabel')).not.toBeVisible()

      await expect(page.locator('.cm-content')).toHaveText(
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
        |> startProfileAt([3.14, 12], %)
        |> xLine(%, length = 5) // lin`.replaceAll('\n', '')
      )
    })
  })
  test('Can undo a click and point extrude with ctrl+z', async ({
    page,
    context,
    homePage,
  }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  |> startProfileAt([4.61, -14.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -5.38], %)
  |> close()`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
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

    await page.getByText('startProfileAt([4.61, -14.01], %)').click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeVisible()
    await page.getByRole('button', { name: 'Extrude' }).click()

    await expect(page.getByTestId('command-bar')).toBeVisible()
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'arrow right Continue' }).click()
    await page.waitForTimeout(100)
    await expect(page.getByText('Confirm Extrude')).toBeVisible()
    await page.getByRole('button', { name: 'checkmark Submit command' }).click()
    await page.waitForTimeout(100)

    // expect the code to have changed
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)  |> startProfileAt([4.61, -14.01], %)  |> line(end = [12.73, -0.09])  |> tangentialArcTo([24.95, -5.38], %)  |> close()extrude001 = extrude(sketch001, length = 5)`
    )

    // Now hit undo
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content'))
      .toHaveText(`sketch001 = startSketchOn(XZ)
  |> startProfileAt([4.61, -14.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -5.38], %)
  |> close()`)
  })

  test(
    'Can undo a sketch modification with ctrl+z',
    { tag: ['@skipWin'] },
    async ({ page, homePage }) => {
      const u = await getUtils(page)
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XZ)
  |> startProfileAt([4.61, -10.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -0.38], %)
  |> close()
  |> extrude(length = 5)`
        )
      })

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
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

      const startPX = [1200 / 2, 500 / 2]

      const dragPX = 40

      await page.getByText('startProfileAt([4.61, -10.01], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(400)
      let prevContent = await page.locator('.cm-content').innerText()

      await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

      // drag startProfileAt handle
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: startPX[0] + 68, y: startPX[1] + 147 },
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
        sourcePosition: { x: tangentEnd.x + 10, y: tangentEnd.y - 5 },
        targetPosition: {
          x: tangentEnd.x + dragPX,
          y: tangentEnd.y + dragPX,
        },
      })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

      // expect the code to have changed
      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn(XZ)
    |> startProfileAt([2.71, -2.71], %)
    |> line(end = [15.4, -2.78])
    |> tangentialArcTo([27.6, -3.05], %)
    |> close()
    |> extrude(length = 5)
  `)

      // Hit undo
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')

      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn(XZ)
    |> startProfileAt([2.71, -2.71], %)
    |> line(end = [15.4, -2.78])
    |> tangentialArcTo([24.95, -0.38], %)
    |> close()
    |> extrude(length = 5)`)

      // Hit undo again.
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')

      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn(XZ)
    |> startProfileAt([2.71, -2.71], %)
    |> line(end = [12.73, -0.09])
    |> tangentialArcTo([24.95, -0.38], %)
    |> close()
    |> extrude(length = 5)
  `)

      // Hit undo again.
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')

      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn(XZ)
  |> startProfileAt([4.61, -10.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -0.38], %)
  |> close()
  |> extrude(length = 5)`)
    }
  )

  test(
    `Can use the import stdlib function on a local OBJ file`,
    { tag: '@electron' },
    async ({ page, context }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      await context.folderSetupFn(async (dir) => {
        const bracketDir = join(dir, 'cube')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cube.obj'),
          join(bracketDir, 'cube.obj')
        )
        await fsp.writeFile(join(bracketDir, 'main.kcl'), '')
      })

      const viewportSize = { width: 1200, height: 500 }
      await page.setBodyDimensions(viewportSize)

      // Locators and constants
      const u = await getUtils(page)
      const projectLink = page.getByRole('link', { name: 'cube' })
      const gizmo = page.locator('[aria-label*=gizmo]')
      const resetCameraButton = page.getByRole('button', { name: 'Reset view' })
      const locationToHavColor = async (
        position: { x: number; y: number },
        color: [number, number, number]
      ) => {
        return u.getGreatestPixDiff(position, color)
      }
      const notTheOrigin = {
        x: viewportSize.width * 0.55,
        y: viewportSize.height * 0.3,
      }
      const origin = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
      const errorIndicators = page.locator('.cm-lint-marker-error')

      await test.step(`Open the empty file, see the default planes`, async () => {
        await projectLink.click()
        await u.waitForPageLoad()
        await expect
          .poll(
            async () =>
              locationToHavColor(notTheOrigin, TEST_COLORS.DARK_MODE_PLANE_XZ),
            {
              timeout: 5000,
              message: 'XZ plane color is visible',
            }
          )
          .toBeLessThan(15)
      })
      await test.step(`Write the import function line`, async () => {
        await u.codeLocator.fill(`import('cube.obj')`)
        await page.waitForTimeout(800)
      })
      await test.step(`Reset the camera before checking`, async () => {
        await u.doAndWaitForCmd(async () => {
          await gizmo.click({ button: 'right' })
          await resetCameraButton.click()
        }, 'zoom_to_fit')
      })
      await test.step(`Verify that we see the imported geometry and no errors`, async () => {
        await expect(errorIndicators).toHaveCount(0)
        await expect
          .poll(
            async () =>
              locationToHavColor(origin, TEST_COLORS.DARK_MODE_PLANE_XZ),
            {
              timeout: 3000,
              message: 'Plane color should not be visible',
            }
          )
          .toBeGreaterThan(15)
        await expect
          .poll(
            async () => locationToHavColor(origin, TEST_COLORS.DARK_MODE_BKGD),
            {
              timeout: 3000,
              message: 'Background color should not be visible',
            }
          )
          .toBeGreaterThan(15)
      })
    }
  )
  test('Rectangle tool panning with middle click', async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
    editor,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 900 })
    await homePage.goToModelingScene()

    // wait until scene is ready to be interacted with
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // select an axis plane
    await page.mouse.click(700, 200)

    // Needed as we don't yet have a way to get a signal from the engine that the camera has animated to the sketch plane
    await page.waitForTimeout(1000)

    const middleMousePan = async (
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ) => {
      const initialCode = await editor.getCurrentCode()

      await page.mouse.click(startX, startY, { button: 'middle' })
      await page.mouse.move(endX, endY, {
        steps: 10,
      })

      // We expect the code to be the same, middle mouse click should not modify the code, only do panning
      await editor.expectEditor.toBe(initialCode)
    }

    await test.step(`Verify corner rectangle panning`, async () => {
      await page.getByTestId('corner-rectangle').click()
      await middleMousePan(800, 500, 900, 600)
    })

    await test.step(`Verify center rectangle panning`, async () => {
      await toolbar.selectCenterRectangle()
      await middleMousePan(800, 200, 900, 300)
    })
  })

  test(`Only show axis planes when there are no errors`, async ({
    page,
    homePage,
  }, testInfo) => {
    await page.addInitScript(async () => {
      // extrude length = 0 causes an error
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    profile001 = circle(sketch001, center = [-100.0, -100.0], radius = 50.0)

    sketch002 = startSketchOn(XZ)
    profile002 = circle(sketch002, center = [-100.0, 100.0], radius = 50.0)
    extrude001 = extrude(profile002, length = 0)` // length = 0 is causing an error
      )
    })

    const viewportSize = { width: 1200, height: 800 }
    await page.setBodyDimensions(viewportSize)

    await homePage.goToModelingScene()

    const u = await getUtils(page)
    const locationToHaveColor = async (
      position: { x: number; y: number },
      color: [number, number, number]
    ) => {
      return u.getGreatestPixDiff(position, color)
    }

    await u.waitForPageLoad()

    // Wait until axis planes are rendered.
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Alternatively just wait a bit
    // await page.waitForTimeout(3000)

    await expect
      .poll(
        async () =>
          locationToHaveColor(
            // This is a position where the blue part of the axis plane is visible if its rendered
            { x: viewportSize.width * 0.75, y: viewportSize.height * 0.2 },
            TEST_COLORS.DARK_MODE_BKGD
          ),
        {
          timeout: 5000,
          message: 'XZ plane color is visible',
        }
      )
      .toBeLessThan(15)
  })
})
