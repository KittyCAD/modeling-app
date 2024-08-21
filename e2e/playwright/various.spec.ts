import { test, expect } from '@playwright/test'

import {
  doExport,
  getUtils,
  makeTemplate,
  metaModifier,
  setup,
  tearDown,
} from './test-utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

const CtrlKey = process.platform === 'darwin' ? 'Meta' : 'Control'

test('Units menu', async ({ page }) => {
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })

  await u.waitForAuthSkipAppStart()

  const unitsMenuButton = page.getByRole('button', {
    name: 'Current Units',
    exact: false,
  })
  await expect(unitsMenuButton).toBeVisible()
  await expect(unitsMenuButton).toContainText('in')

  await unitsMenuButton.click()
  const millimetersButton = page.getByRole('button', { name: 'Millimeters' })

  await expect(millimetersButton).toBeVisible()
  await millimetersButton.click()

  // Look out for the toast message
  const toastMessage = page.getByText(
    `Set default unit to "mm" for this project`
  )
  await expect(toastMessage).toBeVisible()

  // Verify that the popover has closed
  await expect(millimetersButton).not.toBeAttached()

  // Verify that the button label has updated
  await expect(unitsMenuButton).toContainText('mm')
})

test('Successful export shows a success toast', async ({ page }) => {
  // FYI this test doesn't work with only engine running locally
  // And you will need to have the KittyCAD CLI installed
  const u = await getUtils(page)
  await page.addInitScript(async () => {
    ;(window as any).playwrightSkipFilePicker = true
    localStorage.setItem(
      'persistCode',
      `const topAng = 25
const bottomAng = 35
const baseLen = 3.5
const baseHeight = 1
const totalHeightHalf = 2
const armThick = 0.5
const totalLen = 9.5
const part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> yLine(baseHeight, %)
  |> xLine(baseLen, %)
  |> angledLineToY({
        angle: topAng,
        to: totalHeightHalf,
      }, %, $seg04)
  |> xLineTo(totalLen, %, $seg03)
  |> yLine(-armThick, %, $seg01)
  |> angledLineThatIntersects({
        angle: HALF_TURN,
        offset: -armThick,
        intersectTag: seg04
      }, %)
  |> angledLineToY([segAng(seg04) + 180, ZERO], %)
  |> angledLineToY({
        angle: -bottomAng,
        to: -totalHeightHalf - armThick,
      }, %, $seg02)
  |> xLineTo(segEndX(seg03) + 0, %)
  |> yLine(-segLen(seg01), %)
  |> angledLineThatIntersects({
        angle: HALF_TURN,
        offset: -armThick,
        intersectTag: seg02
      }, %)
  |> angledLineToY([segAng(seg02) + 180, -baseHeight], %)
  |> xLineTo(ZERO, %)
  |> close(%)
  |> extrude(4, %)`
    )
  })
  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.waitForCmdReceive('extrude')
  await page.waitForTimeout(1000)
  await u.clearAndCloseDebugPanel()

  await doExport(
    {
      type: 'gltf',
      storage: 'embedded',
      presentation: 'pretty',
    },
    page
  )

  // This is the main thing we're testing,
  // We test the export functionality across all
  // file types in snapshot-tests.spec.ts
  await expect(page.getByText('Exported successfully')).toBeVisible()
})

test('Paste should not work unless an input is focused', async ({
  page,
  browserName,
}) => {
  // To run this test locally, uncomment Firefox in playwright.config.ts
  test.skip(
    browserName !== 'firefox',
    "This bug is really Firefox-only, which we don't run in CI."
  )
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await u.waitForAuthSkipAppStart()
  await page
    .getByRole('button', { name: 'Start Sketch' })
    .waitFor({ state: 'visible' })

  const codeEditorText = page.locator('.cm-content')
  const pasteContent = `// was this pasted?`
  const typeContent = `// this should be typed`

  // Load text into the clipboard
  await page.evaluate((t) => navigator.clipboard.writeText(t), pasteContent)

  // Focus the text editor
  await codeEditorText.focus()

  // Show that we can type into it
  await page.keyboard.type(typeContent)
  await page.keyboard.press('Enter')

  // Paste without the code pane focused
  await codeEditorText.blur()
  await page.keyboard.press(`${metaModifier}+KeyV`)

  // Show that the paste didn't work but typing did
  await expect(codeEditorText).not.toContainText(pasteContent)
  await expect(codeEditorText).toContainText(typeContent)

  // Paste with the code editor focused
  // Following this guidance: https://github.com/microsoft/playwright/issues/8114
  await codeEditorText.focus()
  await page.keyboard.press(`${metaModifier}+KeyV`)
  await expect(
    await page.evaluate(
      () => document.querySelector('.cm-content')?.textContent
    )
  ).toContain(pasteContent)
})

test('Keyboard shortcuts can be viewed through the help menu', async ({
  page,
}) => {
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await u.waitForAuthSkipAppStart()

  await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('button', { name: 'Start Sketch' })
    .waitFor({ state: 'visible' })

  // Open the help menu
  await page.getByRole('button', { name: 'Help and resources' }).click()

  // Open the keyboard shortcuts
  await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click()

  // Verify the URL and that you can see a list of shortcuts
  await expect(page.url()).toContain('?tab=keybindings')
  await expect(
    page.getByRole('heading', { name: 'Enter Sketch Mode' })
  ).toBeAttached()
})

test('First escape in tool pops you out of tool, second exits sketch mode', async ({
  page,
}) => {
  // Wait for the app to be ready for use
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  const lineButton = page.getByRole('button', {
    name: 'line Line',
    exact: true,
  })
  const arcButton = page.getByRole('button', {
    name: 'arc Tangential Arc',
    exact: true,
  })

  // Test these hotkeys perform actions when
  // focus is on the canvas
  await page.mouse.move(600, 250)
  await page.mouse.click(600, 250)

  // Start a sketch
  await page.keyboard.press('s')
  await page.mouse.move(800, 300)
  await page.mouse.click(800, 300)
  await page.waitForTimeout(1000)
  await expect(lineButton).toBeVisible()
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true')

  // Draw a line
  await page.mouse.move(700, 200, { steps: 5 })
  await page.mouse.click(700, 200)
  await page.mouse.move(800, 250, { steps: 5 })
  await page.mouse.click(800, 250)
  // Unequip line tool
  await page.keyboard.press('Escape')
  // Make sure we didn't pop out of sketch mode.
  await expect(page.getByRole('button', { name: 'Exit Sketch' })).toBeVisible()
  await expect(lineButton).not.toHaveAttribute('aria-pressed', 'true')
  // Equip arc tool
  await page.keyboard.press('a')
  await expect(arcButton).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(1000, 100, { steps: 5 })
  await page.mouse.click(1000, 100)
  await page.keyboard.press('Escape')
  await page.keyboard.press('l')
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true')

  // Do not close the sketch.
  // On close it will exit sketch mode.

  // Unequip line tool
  await page.keyboard.press('Escape')
  await expect(lineButton).toHaveAttribute('aria-pressed', 'false')
  await expect(arcButton).toHaveAttribute('aria-pressed', 'false')
  // Make sure we didn't pop out of sketch mode.
  await expect(page.getByRole('button', { name: 'Exit Sketch' })).toBeVisible()
  // Exit sketch
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Exit Sketch' })
  ).not.toBeVisible()
})

test('Basic default modeling and sketch hotkeys work', async ({ page }) => {
  const u = await getUtils(page)

  // This test can run long if it takes a little too long to load
  // the engine.
  test.setTimeout(90000)
  // This test has a weird bug on ubuntu
  test.skip(
    process.platform === 'linux',
    'weird playwright bug on ubuntu https://github.com/KittyCAD/modeling-app/issues/2444'
  )
  // Load the app with the code pane open

  await test.step(`Set up test`, async () => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'store',
        JSON.stringify({
          state: {
            openPanes: ['code'],
          },
          version: 0,
        })
      )
    })
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()
  })

  const codePane = page.locator('.cm-content')
  const lineButton = page.getByRole('button', {
    name: 'line Line',
    exact: true,
  })
  const arcButton = page.getByRole('button', {
    name: 'arc Tangential Arc',
    exact: true,
  })
  const extrudeButton = page.getByRole('button', { name: 'Extrude' })
  const commandBarComboBox = page.getByPlaceholder('Search commands')
  const exitSketchButton = page.getByRole('button', { name: 'Exit Sketch' })

  await test.step(`Type code with modeling hotkeys, shouldn't fire`, async () => {
    await codePane.click()
    await page.keyboard.type('//')
    await page.keyboard.press('s')
    await expect(commandBarComboBox).not.toBeVisible()
    await page.keyboard.press('e')
    await expect(commandBarComboBox).not.toBeVisible()
    await expect(codePane).toHaveText('//se')
  })

  // Blur focus from the code editor, use the s command to sketch
  await test.step(`Blur editor focus, enter sketch`, async () => {
    /**
     * TODO: There is a bug somewhere that causes this test to fail
     * if you toggle the codePane closed before your trigger the
     * start of the sketch.
     * and a separate Safari-only bug that causes the test to fail
     * if the pane is open the entire test. The maintainer of CodeMirror
     * has pinpointed this to the unusual browser behavior:
     * https://discuss.codemirror.net/t/how-to-force-unfocus-of-the-codemirror-element-in-safari/8095/3
     */
    await blurCodeEditor()
    await page.waitForTimeout(1000)
    await page.keyboard.press('s')
    await page.waitForTimeout(1000)
    await page.mouse.move(800, 300, { steps: 5 })
    await page.mouse.click(800, 300)
    await page.waitForTimeout(1000)
    await expect(lineButton).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15_000,
    })
  })

  // Use some sketch hotkeys to create a sketch (l and a for now)
  await test.step(`Incomplete sketch with hotkeys`, async () => {
    await test.step(`Draw a line`, async () => {
      await page.mouse.move(700, 200, { steps: 5 })
      await page.mouse.click(700, 200)
      await page.mouse.move(800, 250, { steps: 5 })
      await page.mouse.click(800, 250)
    })

    await test.step(`Unequip line tool`, async () => {
      await page.keyboard.press('l')
      await expect(lineButton).not.toHaveAttribute('aria-pressed', 'true')
    })

    await test.step(`Draw a tangential arc`, async () => {
      await page.keyboard.press('a')
      await expect(arcButton).toHaveAttribute('aria-pressed', 'true', {
        timeout: 10_000,
      })
      await page.mouse.move(1000, 100, { steps: 5 })
      await page.mouse.click(1000, 100)
    })

    await test.step(`Unequip with escape, equip line tool`, async () => {
      await page.keyboard.press('Escape')
      await page.keyboard.press('l')
      await page.waitForTimeout(50)
      await expect(lineButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  await test.step(`Type code with sketch hotkeys, shouldn't fire`, async () => {
    // Since there's code now, we have to get to the end of the line
    await page.locator('.cm-line').last().click()
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up(CtrlKey)

    await page.keyboard.press('Enter')
    await page.keyboard.type('//')
    await page.keyboard.press('l')
    await expect(lineButton).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('a')
    await expect(lineButton).toHaveAttribute('aria-pressed', 'true')
    await expect(codePane).toContainText('//la')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
  })

  await test.step(`Close profile and exit sketch`, async () => {
    await blurCodeEditor()
    await page.mouse.move(700, 200, { steps: 5 })
    await page.mouse.click(700, 200)
    // On  close it will unequip the line tool.
    await expect(lineButton).toHaveAttribute('aria-pressed', 'false')
    await expect(exitSketchButton).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
  })

  // Extrude with e
  await test.step(`Extrude the sketch`, async () => {
    await page.mouse.click(750, 150)
    await blurCodeEditor()
    await expect(extrudeButton).toBeEnabled()
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
    await page.mouse.move(800, 200, { steps: 5 })
    await page.mouse.click(800, 200)
    await page.waitForTimeout(500)
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(
      page.getByRole('button', { name: 'Submit command' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Submit command' }).click()
    await expect(page.locator('.cm-content')).toContainText('extrude(')
  })

  // await codePaneButton.click()
  // await expect(u.codeLocator).not.toBeVisible()

  /**
   * work-around: to stop `keyboard.press()` from typing in the editor even when it should be blurred
   */
  async function blurCodeEditor() {
    await page.getByRole('button', { name: 'Commands' }).click()
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
  }
})

test('Delete key does not navigate back', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })

  const settingsButton = page.getByRole('link', {
    name: 'Settings',
    exact: false,
  })
  const settingsCloseButton = page.getByTestId('settings-close-button')

  await settingsButton.click()
  await expect(page.url()).toContain('/settings')

  // Make sure that delete doesn't go back from settings
  await page.keyboard.press('Delete')
  await expect(page.url()).toContain('/settings')

  // Now close the settings and try delete again,
  // make sure it doesn't go back to settings
  await settingsCloseButton.click()
  await page.keyboard.press('Delete')
  await expect(page.url()).not.toContain('/settings')
})

test('Sketch on face', async ({ page }) => {
  test.setTimeout(90_000)
  const u = await getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> line([3.75, 0.46], %)
  |> line([4.99, -0.46], %)
  |> line([3.3, -2.12], %)
  |> line([2.16, -3.33], %)
  |> line([0.85, -3.08], %)
  |> line([-0.18, -3.36], %)
  |> line([-3.86, -2.73], %)
  |> line([-17.67, 0.85], %)
  |> close(%)
  const extrude001 = extrude(5 + 7, sketch001)`
    )
  })

  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()

  // wait for execution done
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()

  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(300)

  let previousCodeContent = await page.locator('.cm-content').innerText()

  await u.openAndClearDebugPanel()
  await u.doAndWaitForCmd(
    () => page.mouse.click(625, 165),
    'default_camera_get_settings',
    true
  )
  await page.waitForTimeout(150)
  await u.closeDebugPanel()

  const firstClickPosition = [612, 238]
  const secondClickPosition = [661, 242]
  const thirdClickPosition = [609, 267]

  await page.mouse.click(firstClickPosition[0], firstClickPosition[1])
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await page.waitForTimeout(100)
  await page.mouse.click(secondClickPosition[0], secondClickPosition[1])
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await page.waitForTimeout(100)
  await page.mouse.click(thirdClickPosition[0], thirdClickPosition[1])
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await page.waitForTimeout(100)
  await page.mouse.click(firstClickPosition[0], firstClickPosition[1])
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await expect.poll(u.normalisedEditorCode).toContain(
    u.normalisedCode(`const sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.94, 6.6], %)
  |> line([2.45, -0.2], %)
  |> line([-2.6, -1.25], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`)
  )

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.updateCamPosition([1049, 239, 686])
  await u.closeDebugPanel()

  await page.getByText('startProfileAt([-12').click()
  await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Sketch' }).click()
  await page.waitForTimeout(400)
  await page.waitForTimeout(150)
  await page.setViewportSize({ width: 1200, height: 1200 })
  await u.openAndClearDebugPanel()
  await u.updateCamPosition([452, -152, 1166])
  await u.closeDebugPanel()
  await page.waitForTimeout(200)

  const pointToDragFirst = [787, 565]
  await page.mouse.move(pointToDragFirst[0], pointToDragFirst[1])
  await page.mouse.down()
  await page.mouse.move(pointToDragFirst[0] - 20, pointToDragFirst[1], {
    steps: 5,
  })
  await page.mouse.up()
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  const result = makeTemplate`const sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.83, 6.7], %)
  |> line([${[2.28, 2.35]}, -${0.07}], %)
  |> line([-3.05, -1.47], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`

  await expect(page.locator('.cm-content')).toHaveText(result.regExp)

  // exit sketch
  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await page.getByText('startProfileAt([-12').click()

  await expect(page.getByRole('button', { name: 'Extrude' })).not.toBeDisabled()
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Extrude' }).click()

  await expect(page.getByTestId('command-bar')).toBeVisible()
  await page.waitForTimeout(100)

  await page.getByRole('button', { name: 'arrow right Continue' }).click()
  await page.waitForTimeout(100)
  await expect(page.getByText('Confirm Extrude')).toBeVisible()
  await page.getByRole('button', { name: 'checkmark Submit command' }).click()

  const result2 = result.genNext`
const sketch002 = extrude(${[5, 5]} + 7, sketch002)`
  await expect(page.locator('.cm-content')).toHaveText(result2.regExp)
})
