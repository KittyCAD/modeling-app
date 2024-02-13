import { test, expect } from '@playwright/test'
import { secrets } from './secrets'
import { getUtils } from './test-utils'
import waitOn from 'wait-on'
import { Themes } from '../../src/lib/theme'

/*
debug helper: unfortunately we do rely on exact coord mouse clicks in a few places
just from the nature of the stream, running the test with debugger and pasting the below
into the console can be useful to get coords

document.addEventListener('mousemove', (e) =>
  console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
)
*/

test.beforeEach(async ({ context, page }) => {
  // wait for Vite preview server to be up
  await waitOn({
    resources: ['tcp:3000'],
    timeout: 5000,
  })
  await context.addInitScript(async (token) => {
    localStorage.setItem('TOKEN_PERSIST_KEY', token)
    localStorage.setItem('persistCode', ``)
    localStorage.setItem(
      'SETTINGS_PERSIST_KEY',
      JSON.stringify({
        baseUnit: 'in',
        cameraControls: 'KittyCAD',
        defaultDirectory: '',
        defaultProjectName: 'project-$nnn',
        onboardingStatus: 'dismissed',
        showDebugPanel: true,
        textWrapping: 'On',
        theme: 'system',
        unitSystem: 'imperial',
      })
    )
  }, secrets.token)
  // kill animations, speeds up tests and reduced flakiness
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test.setTimeout(60000)

test('Basic sketch', async ({ page }) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await u.doAndWaitForImageDiff(
    () => page.getByRole('button', { name: 'Start Sketch' }).click(),
    200
  )

  // select a plane
  await page.mouse.click(700, 200)

  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('-XZ')`
  )

  await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  const startAt = '[23.89, -32.23]'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)`)
  await page.waitForTimeout(100)

  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  const num = 24.11
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)
  |> line([-48, 0], %)`)

  // deselect line tool
  await page.getByRole('button', { name: 'Line' }).click()
  await page.waitForTimeout(100)

  // click between first two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10)
  await page.waitForTimeout(100)

  // hold down shift
  await page.keyboard.down('Shift')
  // click between the latest two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 20)

  // selected two lines therefore there should be two cursors
  await expect(page.locator('.cm-cursor')).toHaveCount(2)

  await page.getByRole('button', { name: 'Equal Length' }).click()

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line({ to: [${num}, 0], tag: 'seg01' }, %)
  |> line([0, ${num + 0.01}], %)
  |> angledLine([180, segLen('seg01', %)], %)`)
})

test('if you write invalid kcl you get inlined errors', async ({ page }) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')

  await u.waitForAuthSkipAppStart()

  // check no error to begin with
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

  /* add the following code to the editor (# error is not a valid line)
    # error
    const topAng = 30
    const bottomAng = 25
   */
  await page.click('.cm-content')
  await page.keyboard.type('# error')

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
  await expect(page.getByText("found unknown token '#'")).toBeVisible()

  // select the line that's causing the error and delete it
  await page.getByText('# error').click()
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

  await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
  await expect(page.locator('.cm-lintRange.cm-lintRange-error')).toBeVisible()

  await page.locator('.cm-lintRange.cm-lintRange-error').hover()
  await expect(page.locator('.cm-diagnosticText')).toBeVisible()
  await expect(page.getByText('Cannot redefine topAng')).toBeVisible()

  const secondTopAng = await page.getByText('topAng').first()
  await secondTopAng?.dblclick()
  await page.keyboard.type('otherAng')

  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
})

test('executes on load', async ({ page, context }) => {
  const u = getUtils(page)
  await context.addInitScript(async (token) => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
  |> startProfileAt([-6.95, 4.98], %)
  |> line([25.1, 0.41], %)
  |> line([0.73, -14.93], %)
  |> line([-23.44, 0.52], %)`
    )
  })
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // expand variables section
  await page.getByText('Variables').click()

  // can find part001 in the variables summary (pretty-json-container, makes sure we're not looking in the code editor)
  // part001 only shows up in the variables summary if it's been executed
  await page.waitForFunction(() => {
    const variablesElement = document.querySelector(
      '.pretty-json-container'
    ) as HTMLDivElement
    return variablesElement.innerHTML.includes('part001')
  })
  await expect(
    page.locator('.pretty-json-container >> text=part001')
  ).toBeVisible()
})

test('re-executes', async ({ page, context }) => {
  const u = getUtils(page)
  await context.addInitScript(async (token) => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  await page.getByText('Variables').click()
  // expect to see "myVar:5"
  await expect(
    page.locator('.pretty-json-container >> text=myVar:5')
  ).toBeVisible()

  // change 5 to 67
  await page.getByText('const myVar').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('67')

  await expect(
    page.locator('.pretty-json-container >> text=myVar:67')
  ).toBeVisible()
})

test('Can create sketches on all planes and their back sides', async ({
  page,
}) => {
  const u = getUtils(page)
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  const camPos: [number, number, number] = [100, 100, 100]

  const TestSinglePlane = async ({
    viewCmd,
    expectedCode,
    clickCoords,
  }: {
    viewCmd: [number, number, number]
    expectedCode: string
    clickCoords: { x: number; y: number }
  }) => {
    await u.openDebugPanel()

    await u.updateCamPosition(viewCmd)

    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await u.closeDebugPanel()
    await page.mouse.click(clickCoords.x, clickCoords.y)
    await page.waitForTimeout(300) // wait for animation

    await expect(page.getByRole('button', { name: 'Line' })).toBeVisible()

    // draw a line
    const startXPx = 600

    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)

    await expect(page.locator('.cm-content')).toHaveText(expectedCode)

    await page.getByRole('button', { name: 'Line' }).click()
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await u.clearCommandLogs()
    await u.removeCurrentCode()
  }

  const codeTemplate = (
    plane = 'XY',
    rounded = false
  ) => `const part001 = startSketchOn('${plane}')
  |> startProfileAt([28.91, -39${rounded ? '' : '.01'}], %)`
  await TestSinglePlane({
    viewCmd: camPos,
    expectedCode: codeTemplate('XY'),
    clickCoords: { x: 600, y: 388 }, // red plane
    // clickCoords: { x: 600, y: 400 }, // red plane // clicks grid helper and that causes problems, should fix so that these coords work too.
  })
  await TestSinglePlane({
    viewCmd: camPos,
    expectedCode: codeTemplate('YZ', true),
    clickCoords: { x: 700, y: 300 }, // green plane
  })
  await TestSinglePlane({
    viewCmd: camPos,
    expectedCode: codeTemplate('XZ'),
    clickCoords: { x: 700, y: 80 }, // blue plane
  })
  const camCmdBackSide: [number, number, number] = [-100, -100, -100]
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-XY', true),
    clickCoords: { x: 601, y: 118 }, // back of red plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-YZ'),
    clickCoords: { x: 730, y: 219 }, // back of green plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-XZ', true),
    clickCoords: { x: 680, y: 427 }, // back of blue plane
  })
})

test('Auto complete works', async ({ page }) => {
  const u = getUtils(page)
  // const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // this test might be brittle as we add and remove functions
  // but should also be easy to update.
  // tests clicking on an option, selection the first option
  // and arrowing down to an option

  await page.click('.cm-content')
  await page.keyboard.type('const part001 = start')

  // expect there to be three auto complete options
  await expect(page.locator('.cm-completionLabel')).toHaveCount(3)
  await page.getByText('startSketchOn').click()
  await page.keyboard.type("('XY')")
  await page.keyboard.press('Enter')
  await page.keyboard.type('  |> startProfi')
  // expect there be a single auto complete option that we can just hit enter on
  await expect(page.locator('.cm-completionLabel')).toBeVisible()
  await page.keyboard.press('Enter') // accepting the auto complete, not a new line

  await page.keyboard.type('([0,0], %)')
  await page.keyboard.press('Enter')
  await page.keyboard.type('  |> lin')

  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  // press arrow down twice then enter to accept xLine
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.keyboard.type('(5, %)')

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> xLine(5, %)`)
})

// Onboarding tests
test('Onboarding redirects and code updating', async ({ page, context }) => {
  const u = getUtils(page)

  // Override beforeEach test setup
  await context.addInitScript(async () => {
    // Give some initial code, so we can test that it's cleared
    localStorage.setItem('persistCode', 'const sigmaAllow = 15000')

    const storedSettings = JSON.parse(
      localStorage.getItem('SETTINGS_PERSIST_KEY') || '{}'
    )
    storedSettings.onboardingStatus = '/export'
    localStorage.setItem('SETTINGS_PERSIST_KEY', JSON.stringify(storedSettings))
  })

  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // Test that the redirect happened
  await expect(page.url().split(':3000').slice(-1)[0]).toBe(
    `/file/new/onboarding/export`
  )

  // Test that you come back to this page when you refresh
  await page.reload()
  await expect(page.url().split(':3000').slice(-1)[0]).toBe(
    `/file/new/onboarding/export`
  )

  // Test that the onboarding pane loaded
  const title = page.locator('[data-testid="onboarding-content"]')
  await expect(title).toBeAttached()

  // Test that the code changes when you advance to the next step
  await page.locator('[data-testid="onboarding-next"]').click()
  await expect(page.locator('.cm-content')).toHaveText('')

  // Test that the code is not empty when you click on the next step
  await page.locator('[data-testid="onboarding-next"]').click()
  await expect(page.locator('.cm-content')).toHaveText(/.+/)
})

test('Selections work on fresh and edited sketch', async ({ page }) => {
  // tests mapping works on fresh sketch and edited sketch
  // tests using hovers which is the same as selections, because if
  // source ranges are wrong, hovers won't work
  const u = getUtils(page)
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  const xAxisClick = () =>
    page.mouse.click(700, 250).then(() => page.waitForTimeout(100))
  const emptySpaceClick = () =>
    page.mouse.click(728, 343).then(() => page.waitForTimeout(100))
  const topHorzSegmentClick = () =>
    page.mouse.click(709, 289).then(() => page.waitForTimeout(100))
  const bottomHorzSegmentClick = () =>
    page.mouse.click(767, 396).then(() => page.waitForTimeout(100))

  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()

  // select a plane
  await page.mouse.click(700, 200)
  await page.waitForTimeout(700) // wait for animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  const startAt = '[23.89, -32.23]'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)`)

  await u.closeDebugPanel()

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  const num = 24.11
  const num2 = '48'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)
  |> line([-${num2}, 0], %)`)

  // deselect line tool
  await page.getByRole('button', { name: 'Line' }).click()

  await u.closeDebugPanel()
  const selectionSequence = async () => {
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

    await page.mouse.move(startXPx + PUR * 15, 500 - PUR * 10)

    await expect(page.getByTestId('hover-highlight')).toBeVisible()
    // bg-yellow-200 is more brittle than hover-highlight, but is closer to the user experience
    // and will be an easy fix if it breaks because we change the colour
    await expect(page.locator('.bg-yellow-200')).toBeVisible()

    // check mousing off, than mousing onto another line
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 15) // mouse off
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 20) // mouse onto another line
    await expect(page.getByTestId('hover-highlight')).toBeVisible()

    // now check clicking works including axis

    // click a segment hold shift and click an axis, see that a relevant constraint is enabled
    await topHorzSegmentClick()
    await page.keyboard.down('Shift')
    const absYButton = page.getByRole('button', { name: 'ABS Y' })
    await expect(absYButton).toBeDisabled()
    await xAxisClick()
    await page.keyboard.up('Shift')
    await absYButton.and(page.locator(':not([disabled])')).waitFor()
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    // same selection but click the axis first
    await xAxisClick()
    await expect(absYButton).toBeDisabled()
    await page.keyboard.down('Shift')
    await topHorzSegmentClick()

    await page.keyboard.up('Shift')
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    // check the same selection again by putting cursor in code first then selecting axis
    await page.getByText(`  |> line([-${num2}, 0], %)`).click()
    await page.keyboard.down('Shift')
    await expect(absYButton).toBeDisabled()
    await xAxisClick()
    await page.keyboard.up('Shift')
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    // select segment in editor than another segment in scene and check there are two cursors
    await page.getByText(`  |> line([-${num2}, 0], %)`).click()
    await page.waitForTimeout(300)
    await page.keyboard.down('Shift')
    await expect(page.locator('.cm-cursor')).toHaveCount(1)
    await bottomHorzSegmentClick()
    await page.keyboard.up('Shift')
    await expect(page.locator('.cm-cursor')).toHaveCount(2)

    // clear selection by clicking on nothing
    await emptySpaceClick()
  }

  await selectionSequence()

  // hovering in fresh sketch worked, lets try exiting and re-entering
  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await page.waitForTimeout(200)
  // wait for execution done

  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // select a line
  await topHorzSegmentClick()
  await page.waitForTimeout(200)

  // enter sketch again
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(700) // wait for animation

  // hover again and check it works
  await selectionSequence()
})

test('Command bar works and can change a setting', async ({ page }) => {
  // Brief boilerplate
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  let cmdSearchBar = page.getByPlaceholder('Search commands')

  // First try opening the command bar and closing it
  // It has a different label on mac and windows/linux, "Meta+K" and "Ctrl+/" respectively
  await page
    .getByRole('button', { name: 'Ctrl+/' })
    .or(page.getByRole('button', { name: '⌘K' }))
    .click()
  await expect(cmdSearchBar).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cmdSearchBar).not.toBeVisible()

  // Now try the same, but with the keyboard shortcut, check focus
  await page.keyboard.press('Meta+K')
  await expect(cmdSearchBar).toBeVisible()
  await expect(cmdSearchBar).toBeFocused()

  // Try typing in the command bar
  await page.keyboard.type('theme')
  const themeOption = page.getByRole('option', { name: 'Set Theme' })
  await expect(themeOption).toBeVisible()
  await themeOption.click()
  const themeInput = page.getByPlaceholder('Select an option')
  await expect(themeInput).toBeVisible()
  await expect(themeInput).toBeFocused()
  // Select dark theme
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: Themes.Dark })).toHaveAttribute(
    'data-headlessui-state',
    'active'
  )
  await page.keyboard.press('Enter')

  // Check the toast appeared
  await expect(page.getByText(`Set Theme to "${Themes.Dark}"`)).toBeVisible()
  // Check that the theme changed
  await expect(page.locator('body')).toHaveClass(`body-bg ${Themes.Dark}`)
})

test('Can extrude from the command bar', async ({ page, context }) => {
  await context.addInitScript(async (token) => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
    |> startProfileAt([-6.95, 4.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -14.93], %)
    |> line([-23.44, 0.52], %)
    |> close(%)`
    )
  })

  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  let cmdSearchBar = page.getByPlaceholder('Search commands')
  await page.keyboard.press('Meta+K')
  await expect(cmdSearchBar).toBeVisible()

  // Search for extrude command and choose it
  await page.getByRole('option', { name: 'Extrude' }).click()
  await expect(page.locator('#arg-form > label')).toContainText(
    'Please select one face'
  )
  await expect(page.getByRole('button', { name: 'selection' })).toBeDisabled()

  // Click to select face and set distance
  await page.getByText('|> startProfileAt([-6.95, 4.98], %)').click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('button', { name: 'distance' })).toBeDisabled()
  await page.keyboard.press('Enter')

  // Review step and argument hotkeys
  await page.keyboard.press('2')
  await expect(page.getByRole('button', { name: '5' })).toBeDisabled()
  await page.keyboard.press('Enter')

  // Check that the code was updated
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('-XZ')
    |> startProfileAt([-6.95, 4.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -14.93], %)
    |> line([-23.44, 0.52], %)
    |> close(%)
    |> extrude(5, %)`
  )
})

test('Can add multiple sketches', async ({ page }) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await u.doAndWaitForImageDiff(
    () => page.getByRole('button', { name: 'Start Sketch' }).click(),
    200
  )

  // select a plane
  await page.mouse.click(700, 200)

  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('-XZ')`
  )

  await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  const startAt = '[23.89, -32.23]'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)`)
  await page.waitForTimeout(100)

  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  const num = 24.11
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  const finalCodeFirstSketch = `const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num + 0.01}], %)
  |> line([-48, 0], %)`
  await expect(page.locator('.cm-content')).toHaveText(finalCodeFirstSketch)

  // exit the sketch

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()

  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.updateCamPosition([0, 100, 100])

  // start a new sketch
  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(100)
  await page.mouse.click(673, 384)

  await page.waitForTimeout(500) // TODO detect animation ending, or disable animation
  await u.clearAndCloseDebugPanel()

  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  const startAt2 = '[23.61, -31.85]'
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('XY')
  |> startProfileAt(${startAt2}, %)`.replace(/\s/g, '')
  )
  await page.waitForTimeout(100)

  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  const num2 = 23.83
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('XY')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)`.replace(/\s/g, '')
  )

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('XY')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)
  |> line([0, ${num2}], %)`.replace(/\s/g, '')
  )
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('XY')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)
  |> line([0, ${num2}], %)
  |> line([-47.44, 0], %)`.replace(/\s/g, '')
  )
})

test('ProgramMemory can be serialised', async ({ page, context }) => {
  const u = getUtils(page)
  await context.addInitScript(async (token) => {
    localStorage.setItem(
      'persistCode',
      `const part = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 1], %)
  |> line([1, 0], %)
  |> line([0, -1], %)
  |> close(%)
  |> extrude(1, %)
  |> patternLinear({
        axis: [1, 0, 1],
        repetitions: 3,
        distance: 6
      }, %)`
    )
  })
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')
  const messages: string[] = []

  // Listen for all console events and push the message text to an array
  page.on('console', (message) => messages.push(message.text()))
  await u.waitForAuthSkipAppStart()

  // wait for execution done
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  const forbiddenMessages = ['cannot serialize tagged newtype variant']
  forbiddenMessages.forEach((forbiddenMessage) => {
    messages.forEach((message) => {
      expect(message).not.toContain(forbiddenMessage)
    })
  })
})
