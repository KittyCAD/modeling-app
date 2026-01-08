import { doExport, getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test('Units menu', { tag: '@desktop' }, async ({ page, homePage }) => {
  await page.setBodyDimensions({ width: 1200, height: 500 })
  await homePage.goToModelingScene()

  const unitsMenuButton = page.getByTestId('units-menu')
  await expect(unitsMenuButton).toBeVisible()
  await expect(unitsMenuButton).toContainText('in')

  await unitsMenuButton.click()
  const millimetersButton = page.getByRole('button', { name: 'Millimeters' })

  await expect(millimetersButton).toBeVisible()
  await millimetersButton.click()

  // Look out for the toast message
  const toastMessage = page.getByText('Updated per-file units to mm')
  await expect(toastMessage).toBeVisible()

  // Verify that the popover has closed
  await expect(millimetersButton).not.toBeAttached()

  // Verify that the button label has updated
  await expect(unitsMenuButton).toContainText('mm')
})

test(
  'Successful export shows a success toast',
  { tag: ['@desktop', '@skipLocalEngine'] },
  async ({ page, homePage, cmdBar, tronApp }) => {
    // FYI this test doesn't work with only engine running locally
    // And you will need to have the KittyCAD CLI installed
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `topAng = 25
bottomAng = 35
baseLen = 3.5
baseHeight = 1
totalHeightHalf = 2
armThick = 0.5
totalLen = 9.5
part001 = startSketchOn(-XZ)
|> startProfile(at = [0, 0])
|> yLine(length = baseHeight)
|> xLine(length = baseLen)
|> angledLine(
      angle = topAng,
      endAbsoluteY = totalHeightHalf,
      tag = $seg04,
   )
|> xLine(endAbsolute = totalLen, tag = $seg03)
|> yLine(length = -armThick, tag = $seg01)
|> angledLineThatIntersects(angle = turns::HALF_TURN, offset = -armThick, intersectTag = seg04)
|> angledLine(angle = segAng(seg04) + 180, endAbsoluteY = turns::ZERO)
|> angledLine(
      angle = -bottomAng,
      endAbsoluteY = -totalHeightHalf - armThick,
      tag = $seg02,
   )
|> xLine(endAbsolute = segEndX(seg03) + 0)
|> yLine(length = -segLen(seg01))
|> angledLineThatIntersects(angle = turns::HALF_TURN, offset = -armThick, intersectTag = seg02)
|> angledLine(angle = segAng(seg02) + 180, endAbsoluteY = -baseHeight)
|> xLine(endAbsolute = turns::ZERO)
|> close()
|> extrude(length = 4)`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.waitForCmdReceive('extrude')
    await page.waitForTimeout(1000)
    await u.clearAndCloseDebugPanel()

    if (!tronApp) throw new Error('tronApp is missing.')

    await doExport(
      {
        type: 'gltf',
        storage: 'embedded',
        presentation: 'pretty',
      },
      tronApp?.projectDirName,
      page,
      cmdBar
    )
  }
)

test(
  'Paste should not work unless an input is focused',
  { tag: '@desktop' },
  async ({ page, homePage }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
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
    await page.keyboard.press('ControlOrMeta+KeyV')

    // Show that the paste didn't work but typing did
    await expect(codeEditorText).not.toContainText(pasteContent)
    await expect(codeEditorText).toContainText(typeContent)

    // Paste with the code editor focused
    // Following this guidance: https://github.com/microsoft/playwright/issues/8114
    await codeEditorText.focus()
    await page.keyboard.press('ControlOrMeta+KeyV')
    await expect(
      await page.evaluate(
        () => document.querySelector('.cm-content')?.textContent
      )
    ).toContain(pasteContent)
  }
)

test(
  'Keyboard shortcuts can be viewed through the help menu',
  { tag: '@desktop' },
  async ({ page, homePage }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    await page.waitForURL('file:///**', { waitUntil: 'domcontentloaded' })
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Open the help menu
    await page.getByRole('button', { name: 'Help and resources' }).click()

    // Open the keyboard shortcuts
    await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click()

    // Verify the URL and that you can see a list of shortcuts
    await expect.poll(() => page.url()).toContain('?tab=keybindings')
    await expect(
      page.getByRole('heading', { name: 'Enter Sketch Mode' })
    ).toBeAttached()
  }
)

test(
  'First escape in tool pops you out of tool, second exits sketch mode',
  { tag: '@desktop' },
  async ({ page, homePage, toolbar }) => {
    // Wait for the app to be ready for use
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Test these hotkeys perform actions when
    // focus is on the canvas
    await page.mouse.move(600, 250)
    await page.mouse.click(600, 250)

    // Start a sketch
    await page.keyboard.press('s')
    await page.mouse.move(800, 300)
    await page.mouse.click(800, 300)
    await page.waitForTimeout(1000)
    await expect(toolbar.lineBtn).toBeVisible()
    await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')

    // Draw a line
    await page.mouse.move(700, 200, { steps: 5 })
    await page.mouse.click(700, 200)

    const secondMousePosition = { x: 800, y: 250 }

    await page.mouse.move(secondMousePosition.x, secondMousePosition.y, {
      steps: 5,
    })
    await page.mouse.click(secondMousePosition.x, secondMousePosition.y)
    // Unequip line tool
    await page.keyboard.press('Escape')
    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()
    await expect(toolbar.lineBtn).not.toHaveAttribute('aria-pressed', 'true')
    // Equip arc tool
    await toolbar.selectTangentialArc()

    // click in the same position again to continue the profile
    await page.mouse.move(secondMousePosition.x, secondMousePosition.y, {
      steps: 5,
    })
    await page.mouse.click(secondMousePosition.x, secondMousePosition.y)

    await page.mouse.move(1000, 100, { steps: 5 })
    await page.mouse.click(1000, 100)
    await page.keyboard.press('Escape')
    await expect(toolbar.tangentialArcBtn).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await expect
      .poll(async () => {
        await page.keyboard.press('l')
        return toolbar.lineBtn.getAttribute('aria-pressed')
      })
      .toBe('true')

    // Do not close the sketch.
    // On close it will exit sketch mode.

    // Unequip line tool
    await page.keyboard.press('Escape')
    await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(toolbar.tangentialArcBtn).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()
    // Exit sketch
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
  }
)

test(
  'Delete key does not navigate back',
  { tag: '@desktop' },
  async ({ page, homePage }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    await page.waitForURL('file:///**', { waitUntil: 'domcontentloaded' })

    const settingsButton = page.getByRole('link', {
      name: 'Settings',
      exact: false,
    })
    const settingsCloseButton = page.getByTestId('settings-close-button')

    await settingsButton.click()
    await expect.poll(() => page.url()).toContain('/settings')

    // Make sure that delete doesn't go back from settings
    await page.keyboard.press('Delete')
    await expect.poll(() => page.url()).toContain('/settings')

    // Now close the settings and try delete again,
    // make sure it doesn't go back to settings
    await settingsCloseButton.click()
    await page.keyboard.press('Delete')
    await expect.poll(() => page.url()).not.toContain('/settings')
  }
)
