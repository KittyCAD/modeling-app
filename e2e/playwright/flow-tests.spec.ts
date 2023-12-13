import { test, expect } from '@playwright/test'
import { secrets } from './secrets'
import { EngineCommand } from '../../src/lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
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
  await u.waitForDefaultPlanesVisibilityChange()

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await Promise.all([
    u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    ),
    u.waitForDefaultPlanesVisibilityChange(),
  ])

  // select a plane
  await u.doAndWaitForCmd(() => page.mouse.click(700, 200), 'edit_mode_enter')
  await u.waitForCmdReceive('set_tool')

  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Line' }).click(),
    'set_tool'
  )

  const startXPx = 600
  await u.doAndWaitForCmd(
    () => page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10),
    'mouse_click',
    false
  )

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  const startAt = '[18.26, -24.63]'
  const num = '18.43'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num}], %)
  |> line([-36.69, 0], %)`)

  // deselect line tool
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Line' }).click(),
    'set_tool'
  )

  // click between first two clicks to get center of the line
  await u.doAndWaitForCmd(
    () => page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10),
    'select_with_point'
  )
  await u.closeDebugPanel()

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
  |> line([0, ${num}], %)
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
  await u.waitForDefaultPlanesVisibilityChange()

  const camCmd: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_look_at',
      center: { x: 15, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      vantage: { x: 30, y: 30, z: 30 },
    },
  }

  const TestSinglePlane = async ({
    viewCmd,
    expectedCode,
    clickCoords,
  }: {
    viewCmd: EngineCommand
    expectedCode: string
    clickCoords: { x: number; y: number }
  }) => {
    await u.openDebugPanel()
    await u.sendCustomCmd(viewCmd)
    await u.clearCommandLogs()
    // await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await u.waitForDefaultPlanesVisibilityChange()

    await u.closeDebugPanel()
    await page.mouse.click(clickCoords.x, clickCoords.y)
    await u.openDebugPanel()

    await expect(page.getByRole('button', { name: 'Line' })).toBeVisible()

    // draw a line
    const startXPx = 600
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Line' }).click()
    await u.waitForCmdReceive('set_tool')
    await u.clearCommandLogs()
    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    await u.openDebugPanel()
    await u.waitForCmdReceive('mouse_click')
    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
    await u.openDebugPanel()

    await expect(page.locator('.cm-content')).toHaveText(expectedCode)

    await page.getByRole('button', { name: 'Line' }).click()
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await u.clearCommandLogs()
    await u.removeCurrentCode()
  }

  const codeTemplate = (
    plane = 'XY',
    sign = ''
  ) => `const part001 = startSketchOn('${plane}')
  |> startProfileAt([${sign}6.88, -9.29], %)
  |> line([${sign}6.95, 0], %)`
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: codeTemplate('XY'),
    clickCoords: { x: 700, y: 350 }, // red plane
  })
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: codeTemplate('YZ'),
    clickCoords: { x: 1000, y: 200 }, // green plane
  })
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: codeTemplate('XZ', '-'),
    clickCoords: { x: 630, y: 130 }, // blue plane
  })

  // new camera angle to click the back side of all three planes
  const camCmdBackSide: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_look_at',
      center: { x: -15, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      vantage: { x: -30, y: -30, z: -30 },
    },
  }
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-XY', '-'),
    clickCoords: { x: 705, y: 136 }, // back of red plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-YZ', '-'),
    clickCoords: { x: 1000, y: 350 }, // back of green plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: codeTemplate('-XZ'),
    clickCoords: { x: 600, y: 400 }, // back of blue plane
  })
})

test('Auto complete works', async ({ page }) => {
  const u = getUtils(page)
  // const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.waitForDefaultPlanesVisibilityChange()

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
  await u.waitForDefaultPlanesVisibilityChange()

  const xAxisClick = () => page.mouse.click(700, 250)
  const emptySpaceClick = () => page.mouse.click(700, 300)
  const topHorzSegmentClick = () => page.mouse.click(700, 285)
  const bottomHorzSegmentClick = () => page.mouse.click(750, 393)

  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await u.waitForDefaultPlanesVisibilityChange()

  // select a plane
  await u.doAndWaitForCmd(() => page.mouse.click(700, 200), 'edit_mode_enter')
  await u.waitForCmdReceive('set_tool')

  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Line' }).click(),
    'set_tool'
  )

  const startXPx = 600
  await u.doAndWaitForCmd(
    () => page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10),
    'mouse_click',
    false
  )

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  const startAt = '[18.26, -24.63]'
  const num = '18.43'
  const num2 = '36.69'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${num}, 0], %)
  |> line([0, ${num}], %)
  |> line([-${num2}, 0], %)`)

  // deselect line tool
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Line' }).click(),
    'set_tool'
  )

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
    await u.doAndWaitForCmd(topHorzSegmentClick, 'select_with_point', false)
    await page.keyboard.down('Shift')
    const absYButton = page.getByRole('button', { name: 'ABS Y' })
    await expect(absYButton).toBeDisabled()
    await u.doAndWaitForCmd(xAxisClick, 'select_with_point', false)
    await page.keyboard.up('Shift')
    await absYButton.and(page.locator(':not([disabled])')).waitFor()
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await u.doAndWaitForCmd(emptySpaceClick, 'select_clear', false)

    // same selection but click the axis first
    await u.doAndWaitForCmd(xAxisClick, 'select_with_point', false)
    await expect(absYButton).toBeDisabled()
    await page.keyboard.down('Shift')
    await u.doAndWaitForCmd(topHorzSegmentClick, 'select_with_point', false)
    await page.keyboard.up('Shift')
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await u.doAndWaitForCmd(emptySpaceClick, 'select_clear', false)

    // check the same selection again by putting cursor in code first then selecting axis
    await u.doAndWaitForCmd(
      () => page.getByText(`  |> line([-${num2}, 0], %)`).click(),
      'select_clear',
      false
    )
    await page.keyboard.down('Shift')
    await expect(absYButton).toBeDisabled()
    await u.doAndWaitForCmd(xAxisClick, 'select_with_point', false)
    await page.keyboard.up('Shift')
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await u.doAndWaitForCmd(emptySpaceClick, 'select_clear', false)

    // select segment in editor than another segment in scene and check there are two cursors
    await u.doAndWaitForCmd(
      () => page.getByText(`  |> line([-${num2}, 0], %)`).click(),
      'select_clear',
      false
    )
    await page.keyboard.down('Shift')
    await expect(page.locator('.cm-cursor')).toHaveCount(1)
    await u.doAndWaitForCmd(bottomHorzSegmentClick, 'select_with_point', false) // another segment, bottom one
    await page.keyboard.up('Shift')
    await expect(page.locator('.cm-cursor')).toHaveCount(2)

    // clear selection by clicking on nothing
    await u.doAndWaitForCmd(emptySpaceClick, 'select_clear', false)
  }

  await selectionSequence()

  // hovering in fresh sketch worked, lets try exiting and re-entering
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Exit Sketch' }).click(),
    'edit_mode_exit'
  )
  // wait for execution done
  await u.expectCmdLog('[data-message-type="execution-done"]')

  // select a line
  await u.doAndWaitForCmd(topHorzSegmentClick, 'select_clear', false)

  // enter sketch again
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Start Sketch' }).click(),
    'edit_mode_enter',
    false
  )

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
  // It has a different label on mac and windows/linux, "Meta+K" and "Ctrl+/" respectively,
  // But both should work on Linux which CI runs on
  await page.getByRole('button', { name: 'Ctrl+/' }).click()
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
  await page.getByText('|> line([25.1, 0.41], %)').click()
  await page.keyboard.press('Enter')
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
