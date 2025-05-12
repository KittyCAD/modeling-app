import { join } from 'path'
import { uuidv4 } from '@src/lib/utils'
import fsp from 'fs/promises'

import {
  TEST_COLORS,
  executorInputPath,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Editor tests', () => {
  test('can comment out code with ctrl+/', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
    |> startProfile(at = [-10, -10])
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
  |> startProfile(at = [-10, -10])
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
  |> startProfile(at = [-10, -10])
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
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)

    // Ensure we execute the first time.
    await u.openDebugPanel()
    await expect
      .poll(() =>
        page.locator('[data-receive-command-type="scene_clear_all"]').count()
      )
      .toBe(2)
    await expect
      .poll(() => page.locator('[data-message-type="execution-done"]').count())
      .toBe(2)

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
    ).toHaveCount(2)
  })

  test('ensure we use the cache, and do not clear on append', async ({
    homePage,
    page,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await u.codeLocator.click()
    await page.keyboard.type(`sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`)

    // Ensure we execute the first time.
    await u.openDebugPanel()
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(2)
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
    await page.keyboard.type('x = 1')
    await page.keyboard.press('Enter')

    await u.openDebugPanel()
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(3)
    await expect(
      page.locator('[data-receive-command-type="scene_clear_all"]')
    ).toHaveCount(2)
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
    |> startProfile(at = [-10, -10])
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> line(end = [-20, 0])
    |> close()`)
    await page.locator('#code-pane button:first-child').click()
    await page.locator('button:has-text("Format code")').click()

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()`.replaceAll('\n', '')
    )
  })

  test('F2 can rename a variable', async ({ page, homePage, scene }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `myVARName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVARName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 12)`
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.connectionEstablished()

    // check no error to begin with
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await u.codeLocator.click()

    // Move the cursor to the start of the code
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('ArrowRight')

    await page.waitForTimeout(100)

    // Press F2 to rename the variable
    await page.keyboard.press('F2')

    // Wait for the rename box.
    await expect(page.locator('.cm-rename-popup')).toBeVisible()

    // Make sure we are focused on the rename box
    await expect(page.locator('.cm-rename-popup input')).toBeFocused()

    // Type the new name
    await page.keyboard.type('myNewName')
    // Press Enter to accept the rename
    await page.keyboard.press('Enter')

    // Ensure we have the new name
    await expect(page.locator('.cm-content')).toHaveText(
      `myNewName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myNewName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 12)`.replaceAll('\n', '')
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
    |> startProfile(at = [-10, -10])
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
  |> startProfile(at = [-10, -10])
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
   |> startProfile(at = [-10, -10])
   |> line(end = [20, 0])
   |> line(end = [0, 20])
   |> line(end = [-20, 0])
   |> close()`
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
   |> startProfile(at = [-10, -10])
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
    |> startProfile(at = [-10, -10])
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
    |> startProfile(at = [-10, -10])
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

    await expect(
      page.locator('.cm-content')
    ).toHaveText(`sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
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
    |> startProfile(at = [-10, -10])
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

    await expect(
      page.locator('.cm-content')
    ).toHaveText(`sketch_001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
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

  test('you can accept the suggestion from a lint', async ({
    page,
    homePage,
    scene,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `a1 = startSketchOn({
       origin = { x = 0, y = 0, z = 0 },
       xAxis = { x = 1, y = 0, z = 0 },
       yAxis = { x = 0, y = 12, z = 0 },
     })
  |> startProfile(at = [0, 0])
  |> line(end = [100.0, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    await scene.connectionEstablished()

    await expect(page.locator('.cm-lint-marker-info')).toBeVisible()

    // error in guter
    await expect(page.locator('.cm-lint-marker-info').first()).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-info')
    await expect(
      page.getByText('offsetPlane should be used').first()
    ).toBeVisible()

    // select the line that's causing the error and delete it
    // accept the change
    await page.getByText('use offsetPlane instead').click()

    // Ensure we have the new code
    await expect(page.locator('.cm-content')).toHaveText(
      `a1 = startSketchOn(offsetPlane(XY, offset = 12))
  |> startProfile(at = [0, 0])
  |> line(end = [100.0, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)`.replaceAll('\n', '')
    )
  })

  test('signature help triggered by comma', async ({
    page,
    homePage,
    scene,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `myVARName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVARName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 12`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

    await scene.connectionEstablished()

    // Expect the signature help to NOT be visible
    await expect(page.locator('.cm-signature-tooltip')).not.toBeVisible()

    // Click in the editor
    await page.locator('.cm-content').click()

    // Go to the end of the code
    await page.keyboard.press('ControlOrMeta+End')
    // Type a comma
    await page.keyboard.press(',')

    // Wait for the signature help to show
    await expect(page.locator('.cm-signature-tooltip')).toBeVisible()

    // Make sure the parameters are correct
    await expect(page.locator('.cm-signature-tooltip')).toContainText(
      'sketches:'
    )

    // Make sure the tooltip goes away after a timeout.
    await page.waitForTimeout(12000)

    await expect(page.locator('.cm-signature-tooltip')).not.toBeVisible()
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

    await scene.connectionEstablished()

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
    |> startProfile(at = [3.29, 7.86])
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
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `length = .750
    width = 0.500
    height = 0.500
    dia = 4

    fn squareHole(l, w) {
  squareHoleSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
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
  |> circle(center = [0, 0], radius = dia/2)
    |> subtract2d(tool = squareHole(l = length, w = width, height))
    |> extrude(length = height)`)

    // error in gutter
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()
    await page.hover('.cm-lint-marker-error:first-child')
    await expect(
      page
        .getByText(
          'TODO ADAM: find the right error Expected 2 arguments, got 3'
        )
        .first()
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
    |> startProfile(at = [0, 0])
    |> line(end = [0, 10])
    |> line(end = [10, 0])
    |> line(end = [0, -10], tag = $revolveAxis)
    |> close()
    |> extrude(length = 10)

    sketch001 = startSketchOn(box, face = revolveAxis)
    |> startProfile(at = [5, 10])
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
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
      await page.keyboard.type('12')
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
        |> startProfile(%, at = [3.14, 12])
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
      await page.waitForTimeout(100)
      await page.keyboard.press('Tab')
      await page.keyboard.type('12')
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
        |> startProfile(%, at = [3.14, 12])
        |> xLine(%, length = 5) // lin`.replaceAll('\n', '')
      )
    })
  })
  test('Can undo a click and point extrude with ctrl+z', async ({
    page,
    context,
    homePage,
    toolbar,
    cmdBar,
    scene,
  }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [4.61, -14.01])
  |> line(end = [12.73, -0.09])
  |> tangentialArc(endAbsolute = [24.95, -5.38])
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

    await page.getByText('startProfile(at = [4.61, -14.01])').click()
    await toolbar.extrudeButton.click()
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: {
        Sketches: '1 face',
        Length: '',
      },
      highlightedHeaderArg: 'length',
      commandName: 'Extrude',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      headerArguments: {
        Sketches: '1 face',
        Length: '5',
      },
      commandName: 'Extrude',
    })
    await cmdBar.progressCmdBar()
    await scene.settled(cmdBar)

    // expect the code to have changed
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)  |> startProfile(at = [4.61, -14.01])  |> line(end = [12.73, -0.09])  |> tangentialArc(endAbsolute = [24.95, -5.38])  |> close()extrude001 = extrude(sketch001, length = 5)`
    )

    // Now hit undo
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await page.waitForTimeout(100)
    await expect(
      page.locator('.cm-content')
    ).toHaveText(`sketch001 = startSketchOn(XZ)
  |> startProfile(at = [4.61, -14.01])
  |> line(end = [12.73, -0.09])
  |> tangentialArc(endAbsolute = [24.95, -5.38])
  |> close()`)
  })

  test('Can undo a sketch modification with ctrl+z', async ({
    page,
    homePage,
    editor,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [4.61, -10.01])
  |> line(end = [12.73, -0.09])
  |> tangentialArc(endAbsolute = [24.95, -0.38])
  |> close()
  |> extrude(length = 5)`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

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

    await page.getByText('startProfile(at = [4.61, -10.01])').click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(400)
    let prevContent = await page.locator('.cm-content').innerText()

    await expect(page.getByTestId('segment-overlay')).toHaveCount(3)

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

    // drag tangentialArc handle
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
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [5.36, -5.36])
    |> line(end = [12.73, -0.09])
    |> tangentialArc(endAbsolute = [24.95, -0.38])
    |> close()
    |> extrude(length = 5)`,
      { shouldNormalise: true }
    )

    // Hit undo
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [2.71, -2.71])
    |> line(end = [12.73, -0.09])
    |> tangentialArc(endAbsolute = [24.95, -0.38])
    |> close()
    |> extrude(length = 5)`,
      { shouldNormalise: true }
    )

    // Hit undo again.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [4.61, -10.01])
    |> line(end = [12.73, -0.09])
    |> tangentialArc(endAbsolute = [24.95, -0.38])
    |> close()
    |> extrude(length = 5)`,
      { shouldNormalise: true }
    )

    // Hit undo again.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')

    await page.waitForTimeout(100)
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [4.61, -10.01])
    |> line(end = [12.73, -0.09])
    |> tangentialArc(endAbsolute = [24.95, -0.38])
    |> close()
    |> extrude(length = 5)`,
      { shouldNormalise: true }
    )
  })

  test(
    `Can import a local OBJ file`,
    { tag: '@electron' },
    async ({ page, context }, testInfo) => {
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
      const locationToHaveColor = async (
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
              locationToHaveColor(notTheOrigin, TEST_COLORS.DARK_MODE_PLANE_XZ),
            {
              timeout: 5000,
              message: 'XZ plane color is visible',
            }
          )
          .toBeLessThan(15)
      })
      await test.step(`Write the import function line`, async () => {
        await u.codeLocator.fill(`import 'cube.obj'\ncube`)
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
              locationToHaveColor(origin, TEST_COLORS.DARK_MODE_PLANE_XZ),
            {
              timeout: 3000,
              message: 'Plane color should not be visible',
            }
          )
          .toBeGreaterThan(15)
        await expect
          .poll(
            async () => locationToHaveColor(origin, TEST_COLORS.DARK_MODE_BKGD),
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

  test('Can select lines on the main axis', async ({
    page,
    homePage,
    toolbar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  profile001 = startProfile(sketch001, at = [100.00, 100.0])
    |> yLine(length = -100.0)
    |> xLine(length = 200.0)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`
      )
    })

    const width = 1200
    const height = 800
    const viewportSize = { width, height }
    await page.setBodyDimensions(viewportSize)

    await homePage.goToModelingScene()

    const u = await getUtils(page)
    await u.waitForPageLoad()

    await toolbar.editSketch(0)

    await page.waitForTimeout(1000)

    // Click on the bottom segment that lies on the x axis
    await page.mouse.click(width * 0.85, height / 2)

    await page.waitForTimeout(1000)

    // Verify segment is selected (you can check for visual indicators or state)
    const element = page.locator('[data-overlay-index="2"]')
    await expect(element).toHaveAttribute('data-overlay-visible', 'true')
  })

  test(`Only show axis planes when there are no errors`, async ({
    page,
    homePage,
    scene,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    profile001 = circle(sketch001, center = [-100.0, -100.0], radius = 50.0)

    sketch002 = startSketchOn(XZ)
    profile002 = circle(sketch002, center = [-100.0, 100.0], radius = 50.0)
    extrude001 = extrude(profile002, length = 0)` // length = 0 is causing the error
      )
    })

    const viewportSize = { width: 1200, height: 800 }
    await page.setBodyDimensions(viewportSize)

    await homePage.goToModelingScene()

    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    await scene.expectPixelColor(
      TEST_COLORS.DARK_MODE_BKGD,
      // This is a position where the blue part of the axis plane is visible if its rendered
      { x: viewportSize.width * 0.75, y: viewportSize.height * 0.2 },
      15
    )
  })

  test(`test-toolbar-buttons`, async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
  }) => {
    await test.step('Load an empty file', async () => {
      await page.addInitScript(async () => {
        localStorage.setItem('persistCode', '')
      })
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()

      // wait until scene is ready to be interacted with
      await scene.connectionEstablished()
      await scene.settled(cmdBar)
    })

    await test.step('Test toolbar button correct selection', async () => {
      await toolbar.expectToolbarMode.toBe('modeling')

      await toolbar.startSketchPlaneSelection()

      // Click on a default plane
      await page.mouse.click(700, 200)

      // tools cannot be selected immediately, couldn't find an event to await instead.
      await page.waitForTimeout(1000)

      await toolbar.selectCenterRectangle()

      await expect(page.getByTestId('center-rectangle')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    await test.step('Test Toolbar dropdown remembering last selection', async () => {
      // Select another tool
      await page.getByTestId('circle-center').click()

      // center-rectangle should still be the active option in the rectangle dropdown
      await expect(page.getByTestId('center-rectangle')).toBeVisible()
    })
  })
})
