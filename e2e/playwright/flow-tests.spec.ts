import { test, expect } from '@playwright/test'
import { secrets } from './secrets'
import { EngineCommand } from '../../src/lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { getUtils } from './test-utils'

/*
debug helper: unfortunately we do rely on exact coord mouse clicks in a few places
just from the nature of the stream, running the test with debugger and pasting the below
into the console can be useful to get coords

document.addEventListener('mousemove', (e) =>
  console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
)
*/

test.beforeEach(async ({ context, page }) => {
  context.addInitScript(async (token) => {
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
  page.emulateMedia({ reducedMotion: 'reduce' })
})

test.setTimeout(60000)

test('Basic sketch', async ({ page }) => {
  const u = getUtils(page)
  page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('localhost:3000')
  await u.waitForPageLoad()
  await u.openDebugPanel()
  await u.waitForDefaultPlanesToBeVisible()

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await u.waitForDefaultPlanesToBeVisible()

  await u.closeDebugPanel()
  // select a plane
  await page.mouse.click(700, 200)
  await u.openDebugPanel()

  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Line' }).click()

  await u.waitForCmdReceive
  await u.clearCommandLogs()
  await u.closeDebugPanel()

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  await u.openDebugPanel()
  await u.waitForCmdReceive('mouse_click')
  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  const startAt = '[9.94, -13.41]'
  const tenish = '10.03'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)
  |> line([0, ${tenish}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)
  |> line([0, ${tenish}], %)
  |> line([-19.97, 0], %)`)

  // deselect line tool

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Line' }).click()
  await u.waitForCmdReceive('set_tool')
  await u.clearCommandLogs()
  await u.closeDebugPanel()

  // click between first two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10)
  await u.openDebugPanel()
  await u.waitForCmdReceive('select_with_point')
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
  |> line({ to: [10.03, 0], tag: 'seg01' }, %)
  |> line([0, ${tenish}], %)
  |> angledLine([180, segLen('seg01', %)], %)`)
})

test('if you write invalid kcl you get inlined errors', async ({ page }) => {
  const u = getUtils(page)
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')

  await u.waitForPageLoad()

  // check no error to begin with
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

  /* add the following code to the editor (# error is not a valid line)
    # error
    const topAng = 30
    const bottomAng = 25
   */
  await page.click('.cm-content')
  await page.keyboard.type('# error')
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
})

test('executes on load', async ({ page, context }) => {
  const u = getUtils(page)
  context.addInitScript(async (token) => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
  |> startProfileAt([-6.95, 4.98], %)
  |> line([25.1, 0.41], %)
  |> line([0.73, -14.93], %)
  |> line([-23.44, 0.52], %)`
    )
  })
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForPageLoad()

  // expand variables section
  await page.getByText('Variables').click()

  // can find part001 in the variables summary (pretty-json-container, makes sure we're not looking in the code editor)
  // part001 only shows up in the variables summary if it's been executed
  await expect(
    page.locator('.pretty-json-container >> text=part001')
  ).toBeVisible()
})

test('re-executes', async ({ page, context }) => {
  const u = getUtils(page)
  context.addInitScript(async (token) => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForPageLoad()

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
  page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForPageLoad()
  await u.openDebugPanel()
  await u.waitForDefaultPlanesToBeVisible()

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

  const drawLine = async () => {
    const startXPx = 600
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Line' }).click()

    await page.waitForFunction(() =>
      document.querySelector('[data-receive-command-type="set_tool"]')
    )
    await u.clearCommandLogs()

    await u.closeDebugPanel()

    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    await u.openDebugPanel()
    await page.waitForFunction(() =>
      document.querySelector('[data-receive-command-type="mouse_click"]')
    )
    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
    await u.openDebugPanel()
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
    await u.sendCustomCmd(viewCmd)
    await u.clearCommandLogs()
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await u.waitForDefaultPlanesToBeVisible()

    await u.closeDebugPanel()
    await page.mouse.click(clickCoords.x, clickCoords.y)
    await u.openDebugPanel()

    await expect(page.getByRole('button', { name: 'Line' })).toBeVisible()

    await drawLine()

    await expect(page.locator('.cm-content')).toHaveText(expectedCode)

    await page.getByRole('button', { name: 'Line' }).click()
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await u.clearCommandLogs()
    await u.removeCurrentCode()
    // await u.waitForCmdReceive('execution_done')
  }
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: `const part001 = startSketchOn('XY')
  |> startProfileAt([3.97, -5.36], %)
  |> line([4.01, 0], %)`,
    clickCoords: { x: 700, y: 350 }, // red plane
  })
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: `const part001 = startSketchOn('YZ')
  |> startProfileAt([3.97, -5.36], %)
  |> line([4.01, 0], %)`,
    clickCoords: { x: 1000, y: 200 }, // green plane
  })
  await TestSinglePlane({
    viewCmd: camCmd,
    expectedCode: `const part001 = startSketchOn('XZ')
  |> startProfileAt([-3.97, -5.36], %)
  |> line([-4.01, 0], %)`,
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
    expectedCode: `const part001 = startSketchOn('-XY')
  |> startProfileAt([-3.97, -5.36], %)
  |> line([-4.01, 0], %)`,
    clickCoords: { x: 705, y: 136 }, // back of red plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: `const part001 = startSketchOn('-YZ')
  |> startProfileAt([-3.97, -5.36], %)
  |> line([-4.01, 0], %)`,
    clickCoords: { x: 1000, y: 350 }, // back of green plane
  })
  await TestSinglePlane({
    viewCmd: camCmdBackSide,
    expectedCode: `const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.97, -5.36], %)
  |> line([4.01, 0], %)`,
    clickCoords: { x: 600, y: 400 }, // back of blue plane
  })
})

test('Auto complete works', async ({ page }) => {
  const u = getUtils(page)
  // const PUR = 400 / 37.5 //pixeltoUnitRatio
  page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForPageLoad()
  await u.waitForDefaultPlanesToBeVisible()

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
