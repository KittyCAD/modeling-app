import { test, expect } from '@playwright/test'
import { makeTemplate, getUtils } from './test-utils'
import waitOn from 'wait-on'
import { roundOff } from 'lib/utils'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { secrets } from './secrets'
import {
  TEST_SETTINGS,
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_CORRUPTED,
  TEST_SETTINGS_ONBOARDING_EXPORT,
  TEST_SETTINGS_ONBOARDING_START,
} from './storageStates'
import * as TOML from '@iarna/toml'
import { Coords2d } from 'lang/std/sketch'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'

/*
debug helper: unfortunately we do rely on exact coord mouse clicks in a few places
just from the nature of the stream, running the test with debugger and pasting the below
into the console can be useful to get coords

document.addEventListener('mousemove', (e) =>
  console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
)
*/

const commonPoints = {
  startAt: '[9.06, -12.22]',
  num1: 9.14,
  num2: 18.2,
  // num1: 9.64,
  // num2: 19.19,
}

test.beforeEach(async ({ context, page }) => {
  // wait for Vite preview server to be up
  await waitOn({
    resources: ['tcp:3000'],
    timeout: 5000,
  })

  await context.addInitScript(
    async ({ token, settingsKey, settings }) => {
      localStorage.setItem('TOKEN_PERSIST_KEY', token)
      localStorage.setItem('persistCode', ``)
      localStorage.setItem(settingsKey, settings)
    },
    {
      token: secrets.token,
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({ settings: TEST_SETTINGS }),
    }
  )
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

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(100)

  // select a plane
  await page.mouse.click(700, 200)

  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('-XZ')`
  )
  await u.closeDebugPanel()

  await page.waitForTimeout(300) // TODO detect animation ending, or disable animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)`)
  await page.waitForTimeout(100)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)`)
  await page.waitForTimeout(100)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)
  |> line([-${commonPoints.num2}, 0], %)`)

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

  await page.getByRole('button', { name: 'Constrain' }).click()
  await page.getByRole('button', { name: 'Equal Length' }).click()

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %, 'seg01')
  |> line([0, ${commonPoints.num1}], %)
  |> angledLine([180, segLen('seg01', %)], %)`)
})

test('Can moving camera', async ({ page, context }) => {
  test.skip(process.platform === 'darwin', 'Can moving camera')
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openAndClearDebugPanel()
  await u.closeKclCodePanel()

  const camPos: [number, number, number] = [0, 85, 85]
  const bakeInRetries = async (
    mouseActions: any,
    xyz: [number, number, number],
    cnt = 0
  ) => {
    // hack that we're implemented our own retry instead of using retries built into playwright.
    // however each of these camera drags can be flaky, because of udp
    // and so putting them together means only one needs to fail to make this test extra flaky.
    // this way we can retry within the test
    // We could break them out into separate tests, but the longest past of the test is waiting
    // for the stream to start, so it can be good to bundle related things together.

    await u.updateCamPosition(camPos)
    await page.waitForTimeout(100)

    // rotate
    await u.closeDebugPanel()
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.waitForTimeout(100)
    // const yo = page.getByTestId('cam-x-position').inputValue()

    await u.doAndWaitForImageDiff(async () => {
      await mouseActions()

      await u.openAndClearDebugPanel()

      await u.closeDebugPanel()
      await page.waitForTimeout(100)
    }, 300)

    await u.openAndClearDebugPanel()
    await page.getByTestId('cam-x-position').isVisible()

    const vals = await Promise.all([
      page.getByTestId('cam-x-position').inputValue(),
      page.getByTestId('cam-y-position').inputValue(),
      page.getByTestId('cam-z-position').inputValue(),
    ])
    const xError = Math.abs(Number(vals[0]) + xyz[0])
    const yError = Math.abs(Number(vals[1]) + xyz[1])
    const zError = Math.abs(Number(vals[2]) + xyz[2])

    let shouldRetry = false

    if (xError > 5 || yError > 5 || zError > 5) {
      if (cnt > 2) {
        console.log('xVal', vals[0], 'xError', xError)
        console.log('yVal', vals[1], 'yError', yError)
        console.log('zVal', vals[2], 'zError', zError)

        throw new Error('Camera position not as expected')
      }
      shouldRetry = true
    }
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await page.waitForTimeout(100)
    if (shouldRetry) await bakeInRetries(mouseActions, xyz, cnt + 1)
  }
  await bakeInRetries(async () => {
    await page.mouse.move(700, 200)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(600, 303)
    await page.mouse.up({ button: 'right' })
  }, [4, -10.5, -120])

  await bakeInRetries(async () => {
    await page.keyboard.down('Shift')
    await page.mouse.move(600, 200)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(700, 200, { steps: 2 })
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Shift')
  }, [-10, -85, -85])

  await u.updateCamPosition(camPos)

  await u.clearCommandLogs()
  await u.closeDebugPanel()

  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(200)

  // zoom
  await u.doAndWaitForImageDiff(async () => {
    await page.keyboard.down('Control')
    await page.mouse.move(700, 400)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(700, 300)
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Control')

    await u.openDebugPanel()
    await page.waitForTimeout(300)
    await u.clearCommandLogs()

    await u.closeDebugPanel()
  }, 300)

  // zoom with scroll
  await u.openAndClearDebugPanel()
  // TODO, it appears we don't get the cam setting back from the engine when the interaction is zoom into `backInRetries` once the information is sent back on zoom
  // await expect(Math.abs(Number(await page.getByTestId('cam-x-position').inputValue()) + 12)).toBeLessThan(1.5)
  // await expect(Math.abs(Number(await page.getByTestId('cam-y-position').inputValue()) - 85)).toBeLessThan(1.5)
  // await expect(Math.abs(Number(await page.getByTestId('cam-z-position').inputValue()) - 85)).toBeLessThan(1.5)

  await page.getByRole('button', { name: 'Exit Sketch' }).click()

  await bakeInRetries(async () => {
    await page.mouse.move(700, 400)
    await page.mouse.wheel(0, -100)
  }, [1, -94, -94])
})

test('if you click the format button it formats your code', async ({
  page,
}) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')

  await u.waitForAuthSkipAppStart()

  // check no error to begin with
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

  await page.click('.cm-content')
  await page.keyboard.type(`const part001 = startSketchOn('XY')
|> startProfileAt([-10, -10], %)
|> line([20, 0], %)
|> line([0, 20], %)
|> line([-20, 0], %)
|> close(%)`)
  await page.click('#code-pane button:first-child')
  await page.click('button:has-text("Format code")')

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`)
})

test('if you use the format keyboard binding it formats your code', async ({
  page,
}) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('XY')
|> startProfileAt([-10, -10], %)
|> line([20, 0], %)
|> line([0, 20], %)
|> line([-20, 0], %)
|> close(%)`
    )
  })
  await page.setViewportSize({ width: 1000, height: 500 })
  const lspStartPromise = page.waitForEvent('console', async (message) => {
    // it would be better to wait for a message that the kcl lsp has started by looking for the message  message.text().includes('[lsp] [window/logMessage]')
    // but that doesn't seem to make it to the console for macos/safari :(
    if (message.text().includes('start kcl lsp')) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return true
    }
    return false
  })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await lspStartPromise

  // check no error to begin with
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // focus the editor
  await page.click('.cm-line')

  // Hit alt+shift+f to format the code
  await page.keyboard.press('Alt+Shift+KeyF')

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)`)
})

test('ensure the Zoo logo is not a link in browser app', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')

  const zooLogo = page.locator('[data-testid="app-logo"]')
  // Make sure it's not a link
  await expect(zooLogo).not.toHaveAttribute('href')
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
  await expect(page.getByText("found unknown token '$'")).toBeVisible()

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

test('if your kcl gets an error from the engine it is inlined', async ({
  page,
}) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const box = startSketchOn('XY')
|> startProfileAt([0, 0], %)
|> line([0, 10], %)
|> line([10, 0], %)
|> line([0, -10], %, 'revolveAxis')
|> close(%)
|> extrude(10, %)

const sketch001 = startSketchOn(box, "revolveAxis")
|> startProfileAt([5, 10], %)
|> line([0, -10], %)
|> line([2, 0], %)
|> line([0, -10], %)
|> close(%)
|> revolve({
axis: getEdge('revolveAxis', box),
angle: 90
}, %)
    `
    )
  })

  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')

  await u.waitForAuthSkipAppStart()

  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // error in guter
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

  // error text on hover
  await page.hover('.cm-lint-marker-error')
  await expect(
    page.getByText(
      'sketch profile must lie entirely on one side of the revolution axis'
    )
  ).toBeVisible()
})

test('executes on load', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
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
  const variablesTabButton = page.getByRole('tab', {
    name: 'Variables',
    exact: false,
  })
  await variablesTabButton.click()

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

test('re-executes', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  const variablesTabButton = page.getByRole('tab', {
    name: 'Variables',
    exact: false,
  })
  await variablesTabButton.click()
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

const sketchOnPlaneAndBackSideTest = async (
  page: any,
  plane: string,
  clickCoords: { x: number; y: number }
) => {
  const u = getUtils(page)
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  const camCmdBackSide: [number, number, number] = [-100, -100, -100]
  let camPos: [number, number, number] = [100, 100, 100]
  if (plane === '-XY' || plane === '-YZ' || plane === '-XZ') {
    camPos = camCmdBackSide
  }

  const code = `const part001 = startSketchOn('${plane}')
  |> startProfileAt([1.14, -1.54], %)`

  await u.openDebugPanel()

  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await u.updateCamPosition(camPos)

  await u.closeDebugPanel()
  await page.mouse.click(clickCoords.x, clickCoords.y)
  await page.waitForTimeout(300) // wait for animation

  await expect(page.getByRole('button', { name: 'Line' })).toBeVisible()

  // draw a line
  const startXPx = 600

  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)

  await expect(page.locator('.cm-content')).toHaveText(code)

  await page.getByRole('button', { name: 'Line' }).click()
  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.clearCommandLogs()
  await u.removeCurrentCode()
}

test.describe('Can create sketches on all planes and their back sides', () => {
  test('XY', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(
      page,
      'XY',
      { x: 600, y: 388 } // red plane
      // { x: 600, y: 400 }, // red plane // clicks grid helper and that causes problems, should fix so that these coords work too.
    )
  })

  test('YZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, 'YZ', { x: 700, y: 250 }) // green plane
  })

  test('XZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, 'XZ', { x: 700, y: 80 }) // blue plane
  })

  test('-XY', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, '-XY', { x: 600, y: 118 }) // back of red plane
  })

  test('-YZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, '-YZ', { x: 700, y: 219 }) // back of green plane
  })

  test('-XZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, '-XZ', { x: 700, y: 427 }) // back of blue plane
  })
})

test('Auto complete works', async ({ page }) => {
  const u = getUtils(page)
  // const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  const lspStartPromise = page.waitForEvent('console', async (message) => {
    // it would be better to wait for a message that the kcl lsp has started by looking for the message  message.text().includes('[lsp] [window/logMessage]')
    // but that doesn't seem to make it to the console for macos/safari :(
    if (message.text().includes('start kcl lsp')) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return true
    }
    return false
  })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await lspStartPromise

  // this test might be brittle as we add and remove functions
  // but should also be easy to update.
  // tests clicking on an option, selection the first option
  // and arrowing down to an option

  await page.click('.cm-content')
  await page.keyboard.type('const part001 = start')

  // expect there to be six auto complete options
  await expect(page.locator('.cm-completionLabel')).toHaveCount(6)
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
  await page.keyboard.type('12')
  await page.waitForTimeout(100)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('  |> lin')

  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.waitForTimeout(100)
  // press arrow down twice then enter to accept xLine
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  // finish line with comment
  await page.keyboard.type('5')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type(' // lin')
  await page.waitForTimeout(100)
  // there shouldn't be any auto complete options for 'lin' in the comment
  await expect(page.locator('.cm-completionLabel')).not.toBeVisible()

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('XZ')
  |> startProfileAt([3.14, 12], %)
  |> xLine(5, %) // lin`)
})

test('Stored settings are validated and fall back to defaults', async ({
  page,
}) => {
  const u = getUtils(page)

  // Override beforeEach test setup
  // with corrupted settings
  await page.addInitScript(
    async ({ settingsKey, settings }) => {
      localStorage.setItem(settingsKey, settings)
    },
    {
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({ settings: TEST_SETTINGS_CORRUPTED }),
    }
  )

  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // Check the settings were reset
  const storedSettings = TOML.parse(
    await page.evaluate(
      ({ settingsKey }) => localStorage.getItem(settingsKey) || '',
      { settingsKey: TEST_SETTINGS_KEY }
    )
  ) as { settings: SaveSettingsPayload }

  expect(storedSettings.settings?.app?.theme).toBe(undefined)

  // Check that the invalid settings were removed
  expect(storedSettings.settings?.modeling?.defaultUnit).toBe(undefined)
  expect(storedSettings.settings?.modeling?.mouseControls).toBe(undefined)
  expect(storedSettings.settings?.app?.projectDirectory).toBe(undefined)
  expect(storedSettings.settings?.projects?.defaultProjectName).toBe(undefined)
})

test('Project settings can be set and override user settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('button', { name: 'Start Sketch' })
    .waitFor({ state: 'visible' })

  // Open the settings modal with the browser keyboard shortcut
  await page.keyboard.press('Meta+Shift+,')

  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true })
  ).toBeVisible()
  await page
    .locator('select[name="app-theme"]')
    .selectOption({ value: 'light' })

  // Verify the toast appeared
  await expect(
    page.getByText(`Set theme to "light" for this project`)
  ).toBeVisible()
  // Check that the theme changed
  await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)

  // Check that the user setting was not changed
  await page.getByRole('radio', { name: 'User' }).click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('dark')

  // Roll back to default "system" theme
  await page
    .getByText(
      'themeRoll back themeRoll back to match defaultThe overall appearance of the appl'
    )
    .hover()
  await page
    .getByRole('button', {
      name: 'Roll back theme ; Has tooltip: Roll back to match default',
    })
    .click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

  // Check that the project setting did not change
  await page.getByRole('radio', { name: 'Project' }).click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')
})

test('Project settings can be opened with keybinding from the editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('button', { name: 'Start Sketch' })
    .waitFor({ state: 'visible' })

  // Put the cursor in the editor
  await page.click('.cm-content')

  // Open the settings modal with the browser keyboard shortcut
  await page.keyboard.press('Meta+Shift+,')

  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true })
  ).toBeVisible()
  await page
    .locator('select[name="app-theme"]')
    .selectOption({ value: 'light' })

  // Verify the toast appeared
  await expect(
    page.getByText(`Set theme to "light" for this project`)
  ).toBeVisible()
  // Check that the theme changed
  await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)

  // Check that the user setting was not changed
  await page.getByRole('radio', { name: 'User' }).click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('dark')

  // Roll back to default "system" theme
  await page
    .getByText(
      'themeRoll back themeRoll back to match defaultThe overall appearance of the appl'
    )
    .hover()
  await page
    .getByRole('button', {
      name: 'Roll back theme ; Has tooltip: Roll back to match default',
    })
    .click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

  // Check that the project setting did not change
  await page.getByRole('radio', { name: 'Project' }).click()
  await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')
})

test('Click through each onboarding step', async ({ page }) => {
  const u = getUtils(page)

  // Override beforeEach test setup
  await page.addInitScript(
    async ({ settingsKey, settings }) => {
      // Give no initial code, so that the onboarding start is shown immediately
      localStorage.setItem('persistCode', '')
      localStorage.setItem(settingsKey, settings)
    },
    {
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({ settings: TEST_SETTINGS_ONBOARDING_START }),
    }
  )

  await page.setViewportSize({ width: 1200, height: 1080 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // Test that the onboarding pane loaded
  await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

  const nextButton = page.getByTestId('onboarding-next')

  while ((await nextButton.innerText()) !== 'Finish') {
    await expect(nextButton).toBeVisible()
    await nextButton.click()
  }

  // Finish the onboarding
  await expect(nextButton).toBeVisible()
  await nextButton.click()

  // Test that the onboarding pane is gone
  await expect(page.getByTestId('onboarding-content')).not.toBeVisible()
  await expect(page.url()).not.toContain('onboarding')
})

test('Onboarding redirects and code updating', async ({ page }) => {
  const u = getUtils(page)

  // Override beforeEach test setup
  await page.addInitScript(
    async ({ settingsKey, settings }) => {
      // Give some initial code, so we can test that it's cleared
      localStorage.setItem('persistCode', 'const sigmaAllow = 15000')
      localStorage.setItem(settingsKey, settings)
    },
    {
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({ settings: TEST_SETTINGS_ONBOARDING_EXPORT }),
    }
  )

  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // Test that the redirect happened
  await expect(page.url().split(':3000').slice(-1)[0]).toBe(
    `/file/%2Fbrowser%2Fmain.kcl/onboarding/export`
  )

  // Test that you come back to this page when you refresh
  await page.reload()
  await expect(page.url().split(':3000').slice(-1)[0]).toBe(
    `/file/%2Fbrowser%2Fmain.kcl/onboarding/export`
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
    page.mouse.click(700, 253).then(() => page.waitForTimeout(100))
  const emptySpaceClick = () =>
    page.mouse.click(728, 343).then(() => page.waitForTimeout(100))
  const topHorzSegmentClick = () =>
    page.mouse.click(709, 290).then(() => page.waitForTimeout(100))
  const bottomHorzSegmentClick = () =>
    page.mouse.click(767, 396).then(() => page.waitForTimeout(100))

  await u.clearCommandLogs()
  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
  await page.getByRole('button', { name: 'Start Sketch' }).click()

  // select a plane
  await page.mouse.click(700, 200)
  await page.waitForTimeout(700) // wait for animation

  const startXPx = 600
  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)`)

  await page.waitForTimeout(100)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)`)

  await page.waitForTimeout(100)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)`)
  await page.waitForTimeout(100)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)
  |> line([-${commonPoints.num2}, 0], %)`)

  // deselect line tool
  await page.getByRole('button', { name: 'Line' }).click()

  await u.closeDebugPanel()
  const selectionSequence = async (isSecondTime = false) => {
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

    await page.waitForTimeout(100)
    await page.mouse.move(
      startXPx + PUR * 15,
      isSecondTime ? 430 : 500 - PUR * 10
    )

    await expect(page.getByTestId('hover-highlight')).toBeVisible()
    // bg-yellow-200 is more brittle than hover-highlight, but is closer to the user experience
    // and will be an easy fix if it breaks because we change the colour
    await expect(page.locator('.bg-yellow-200')).toBeVisible()

    // check mousing off, than mousing onto another line
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 15) // mouse off
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
    await page.mouse.move(
      startXPx + PUR * 10,
      isSecondTime ? 295 : 500 - PUR * 20
    ) // mouse onto another line
    await expect(page.getByTestId('hover-highlight')).toBeVisible()

    // now check clicking works including axis

    // click a segment hold shift and click an axis, see that a relevant constraint is enabled
    await topHorzSegmentClick()
    await page.keyboard.down('Shift')
    const constrainButton = page.getByRole('button', { name: 'Constrain' })
    const absYButton = page.getByRole('button', { name: 'ABS Y' })
    await constrainButton.click()
    await expect(absYButton).toBeDisabled()
    await page.waitForTimeout(100)
    await xAxisClick()
    await page.keyboard.up('Shift')
    await constrainButton.click()
    await absYButton.and(page.locator(':not([disabled])')).waitFor()
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    await page.waitForTimeout(100)
    // same selection but click the axis first
    await xAxisClick()
    await constrainButton.click()
    await expect(absYButton).toBeDisabled()
    await page.keyboard.down('Shift')
    await page.waitForTimeout(100)
    await topHorzSegmentClick()

    await page.keyboard.up('Shift')
    await constrainButton.click()
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    // check the same selection again by putting cursor in code first then selecting axis
    await page.getByText(`  |> line([-${commonPoints.num2}, 0], %)`).click()
    await page.keyboard.down('Shift')
    await constrainButton.click()
    await expect(absYButton).toBeDisabled()
    await page.waitForTimeout(100)
    await xAxisClick()
    await page.keyboard.up('Shift')
    await constrainButton.click()
    await expect(absYButton).not.toBeDisabled()

    // clear selection by clicking on nothing
    await emptySpaceClick()

    // select segment in editor than another segment in scene and check there are two cursors
    // TODO change this back to shift click in the scene, not cmd click in the editor
    await bottomHorzSegmentClick()

    await expect(page.locator('.cm-cursor')).toHaveCount(1)

    await page.keyboard.down(process.platform === 'linux' ? 'Control' : 'Meta')
    await page.waitForTimeout(100)
    await page.getByText(`  |> line([-${commonPoints.num2}, 0], %)`).click()

    await expect(page.locator('.cm-cursor')).toHaveCount(2)
    await page.waitForTimeout(500)
    await page.keyboard.up(process.platform === 'linux' ? 'Control' : 'Meta')

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
  await u.updateCamPosition([0, -1378.01, 0.06])
  await u.closeDebugPanel()

  // select a line
  // await topHorzSegmentClick()
  await page.getByText(commonPoints.startAt).click() // TODO remove this and reinstate // await topHorzSegmentClick()
  await page.waitForTimeout(100)

  // enter sketch again
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
    'default_camera_get_settings'
  )
  await page.waitForTimeout(150)

  await page.waitForTimeout(300) // wait for animation

  // hover again and check it works
  await selectionSequence(true)
})

test.describe('Command bar tests', () => {
  test('Command bar works and can change a setting', async ({ page }) => {
    // Brief boilerplate
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    let cmdSearchBar = page.getByPlaceholder('Search commands')

    // First try opening the command bar and closing it
    await page
      .getByRole('button', { name: 'Commands', exact: false })
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
    const themeOption = page.getByRole('option', {
      name: 'Settings · app · theme',
    })
    await expect(themeOption).toBeVisible()
    await themeOption.click()
    const themeInput = page.getByPlaceholder('Select an option')
    await expect(themeInput).toBeVisible()
    await expect(themeInput).toBeFocused()
    // Select dark theme
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'system' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set theme to "system" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
  })

  test('Command bar keybinding works from code editor and can change a setting', async ({
    page,
  }) => {
    // Brief boilerplate
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    let cmdSearchBar = page.getByPlaceholder('Search commands')

    // Put the cursor in the code editor
    await page.click('.cm-content')

    // Now try the same, but with the keyboard shortcut, check focus
    await page.keyboard.press('Meta+K')
    await expect(cmdSearchBar).toBeVisible()
    await expect(cmdSearchBar).toBeFocused()

    // Try typing in the command bar
    await page.keyboard.type('theme')
    const themeOption = page.getByRole('option', {
      name: 'Settings · app · theme',
    })
    await expect(themeOption).toBeVisible()
    await themeOption.click()
    const themeInput = page.getByPlaceholder('Select an option')
    await expect(themeInput).toBeVisible()
    await expect(themeInput).toBeFocused()
    // Select dark theme
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'system' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set theme to "system" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
  })

  test('Can extrude from the command bar', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const distance = sqrt(20)
      const part001 = startSketchOn('-XZ')
      |> startProfileAt([-6.95, 10.98], %)
      |> line([25.1, 0.41], %)
      |> line([0.73, -20.93], %)
      |> line([-23.44, 0.52], %)
      |> close(%)
          `
      )
    })

    const u = getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    // Make sure the stream is up
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Extrude' }).isEnabled()

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await page.keyboard.press('Meta+K')
    await expect(cmdSearchBar).toBeVisible()

    // Search for extrude command and choose it
    await page.getByRole('option', { name: 'Extrude' }).click()

    // Assert that we're on the selection step
    await expect(page.getByRole('button', { name: 'selection' })).toBeDisabled()
    // Select a face
    await page.mouse.move(700, 200)
    await page.mouse.click(700, 200)

    // Assert that we're on the distance step
    await expect(page.getByRole('button', { name: 'distance' })).toBeDisabled()

    // Assert that the an alternative variable name is chosen,
    // since the default variable name is already in use (distance)
    await page.getByRole('button', { name: 'Create new variable' }).click()
    await expect(page.getByPlaceholder('Variable name')).toHaveValue(
      'distance001'
    )

    const continueButton = page.getByRole('button', { name: 'Continue' })
    const submitButton = page.getByRole('button', { name: 'Submit command' })
    await continueButton.click()

    // Review step and argument hotkeys
    await expect(submitButton).toBeEnabled()
    await page.keyboard.press('Backspace')

    // Assert we're back on the distance step
    await expect(
      page.getByRole('button', { name: 'Distance 5', exact: false })
    ).toBeDisabled()

    await continueButton.click()
    await submitButton.click()

    // Check that the code was updated
    await u.waitForCmdReceive('extrude')
    // Unfortunately this indentation seems to matter for the test
    await expect(page.locator('.cm-content')).toHaveText(
      `const distance = sqrt(20)
const distance001 = ${KCL_DEFAULT_LENGTH}
const part001 = startSketchOn('-XZ')
    |> startProfileAt([-6.95, 10.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -20.93], %)
    |> line([-23.44, 0.52], %)
    |> close(%)
    |> extrude(distance001, %)`.replace(/(\r\n|\n|\r)/gm, '') // remove newlines
    )
  })
})

test('Can add multiple sketches', async ({ page }) => {
  test.skip(process.platform === 'darwin', 'Can add multiple sketches')
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
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
  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)`)
  await page.waitForTimeout(100)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)`)
  await page.waitForTimeout(100)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  const finalCodeFirstSketch = `const part001 = startSketchOn('-XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1}], %)
  |> line([-${commonPoints.num2}, 0], %)`
  await expect(page.locator('.cm-content')).toHaveText(finalCodeFirstSketch)

  // exit the sketch

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()

  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.updateCamPosition([100, 100, 100])
  await page.waitForTimeout(250)

  // start a new sketch
  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(400)
  await u.updateCamPosition([583, 2000, 370])
  await page.mouse.click(650, 450)

  await page.waitForTimeout(500) // TODO detect animation ending, or disable animation
  await u.clearAndCloseDebugPanel()

  // on mock os there are issues with getting the camera to update
  // it should not be selecting the 'XZ' plane here if the camera updated
  // properly, but if we just role with it we can still verify everything
  // in the rest of the test
  const plane = process.platform === 'darwin' ? 'XZ' : 'XY'

  await page.waitForTimeout(100)
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  const startAt2 = '[22.65, -30.57]'
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('${plane}')
  |> startProfileAt(${startAt2}, %)`.replace(/\s/g, '')
  )
  await page.waitForTimeout(100)

  await u.closeDebugPanel()
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(100)

  const num2 = 22.87
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('${plane}')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)`.replace(/\s/g, '')
  )

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('${plane}')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)
  |> line([0, ${roundOff(num2)}], %)`.replace(/\s/g, '')
  )
  await page.waitForTimeout(100)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(
    (await page.locator('.cm-content').innerText()).replace(/\s/g, '')
  ).toBe(
    `${finalCodeFirstSketch}
const part002 = startSketchOn('${plane}')
  |> startProfileAt(${startAt2}, %)
  |> line([${num2}, 0], %)
  |> line([0, ${roundOff(num2)}], %)
  |> line([-45.52, 0], %)`.replace(/\s/g, '')
  )
})

test('ProgramMemory can be serialised', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 1], %)
  |> line([1, 0], %)
  |> line([0, -1], %)
  |> close(%)
  |> extrude(1, %)
  |> patternLinear3d({
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

test('Hovering over 3d features highlights code', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async (KCL_DEFAULT_LENGTH) => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
  |> startProfileAt([20, 0], %)
  |> line([7.13, 4 + 0], %)
  |> angledLine({ angle: 3 + 0, length: 3.14 + 0 }, %)
  |> lineTo([20.14 + 0, -0.14 + 0], %)
  |> xLineTo(29 + 0, %)
  |> yLine(-3.14 + 0, %, 'a')
  |> xLine(1.63, %)
  |> angledLineOfXLength({ angle: 3 + 0, length: 3.14 }, %)
  |> angledLineOfYLength({ angle: 30, length: 3 + 0 }, %)
  |> angledLineToX({ angle: 22.14 + 0, to: 12 }, %)
  |> angledLineToY({ angle: 30, to: 11.14 }, %)
  |> angledLineThatIntersects({
        angle: 3.14,
        intersectTag: 'a',
        offset: 0
      }, %)
  |> tangentialArcTo([13.14 + 0, 13.14], %)
  |> close(%)
  |> extrude(5 + 7, %)    
`
    )
  }, KCL_DEFAULT_LENGTH)
  await page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  const extrusionTop: Coords2d = [800, 240]
  const flatExtrusionFace: Coords2d = [960, 160]
  const arc: Coords2d = [840, 160]
  const close: Coords2d = [720, 200]
  const nothing: Coords2d = [600, 200]

  await page.mouse.move(nothing[0], nothing[1])
  await page.mouse.click(nothing[0], nothing[1])

  await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
  await page.waitForTimeout(200)

  await page.mouse.move(extrusionTop[0], extrusionTop[1])
  await expect(page.getByTestId('hover-highlight')).toBeVisible()
  await page.mouse.move(nothing[0], nothing[1])
  await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

  await page.mouse.move(arc[0], arc[1])
  await expect(page.getByTestId('hover-highlight')).toBeVisible()
  await page.mouse.move(nothing[0], nothing[1])
  await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

  await page.mouse.move(close[0], close[1])
  await expect(page.getByTestId('hover-highlight')).toBeVisible()
  await page.mouse.move(nothing[0], nothing[1])
  await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

  await page.mouse.move(flatExtrusionFace[0], flatExtrusionFace[1])
  await expect(page.getByTestId('hover-highlight')).toHaveCount(5) // multiple lines
  await page.mouse.move(nothing[0], nothing[1])
  await page.waitForTimeout(100)
  await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
})

test("Various pipe expressions should and shouldn't allow edit and or extrude", async ({
  page,
}) => {
  const u = getUtils(page)
  const selectionsSnippets = {
    extrudeAndEditBlocked: '|> startProfileAt([10.81, 32.99], %)',
    extrudeAndEditBlockedInFunction: '|> startProfileAt(pos, %)',
    extrudeAndEditAllowed: '|> startProfileAt([15.72, 4.7], %)',
    editOnly: '|> startProfileAt([15.79, -14.6], %)',
  }
  await page.addInitScript(
    async ({
      extrudeAndEditBlocked,
      extrudeAndEditBlockedInFunction,
      extrudeAndEditAllowed,
      editOnly,
    }: any) => {
      localStorage.setItem(
        'persistCode',
        `const part001 = startSketchOn('-XZ')
  ${extrudeAndEditBlocked}
  |> line([25.96, 2.93], %)
  |> line([5.25, -5.72], %)
  |> line([-2.01, -10.35], %)
  |> line([-27.65, -2.78], %)
  |> close(%)
  |> extrude(5, %)
const part002 = startSketchOn('-XZ')
  ${extrudeAndEditAllowed}
  |> line([10.32, 6.47], %)
  |> line([9.71, -6.16], %)
  |> line([-3.08, -9.86], %)
  |> line([-12.02, -1.54], %)
  |> close(%)
const part003 = startSketchOn('-XZ')
  ${editOnly}
  |> line([27.55, -1.65], %)
  |> line([4.95, -8], %)
  |> line([-20.38, -10.12], %)
  |> line([-15.79, 17.08], %)

fn yohey = (pos) => {
  const part004 = startSketchOn('-XZ')
  ${extrudeAndEditBlockedInFunction}
  |> line([27.55, -1.65], %)
  |> line([4.95, -10.53], %)
  |> line([-20.38, -8], %)
  |> line([-15.79, 17.08], %)
  return ''
}

    yohey([15.79, -34.6])
`
      )
    },
    selectionsSnippets
  )
  await page.setViewportSize({ width: 1200, height: 1000 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()

  // wait for execution done
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // wait for start sketch as a proxy for the stream being ready
  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()

  await page.getByText(selectionsSnippets.extrudeAndEditBlocked).click()
  await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Edit Sketch' })
  ).not.toBeVisible()

  await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
  await expect(page.getByRole('button', { name: 'Extrude' })).not.toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Edit Sketch' })
  ).not.toBeDisabled()

  await page.getByText(selectionsSnippets.editOnly).click()
  await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Edit Sketch' })
  ).not.toBeDisabled()

  await page
    .getByText(selectionsSnippets.extrudeAndEditBlockedInFunction)
    .click()
  await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Edit Sketch' })
  ).not.toBeVisible()

  // selecting an editable sketch but clicking "start sktech" should start a new sketch and not edit the existing one
  await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.mouse.click(700, 200)
  // expect main content to contain `part005` i.e. started a new sketch
  await expect(page.locator('.cm-content')).toHaveText(
    /part005 = startSketchOn\('-XZ'\)/
  )
})

test('Deselecting line tool should mean nothing happens on click', async ({
  page,
}) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await u.doAndWaitForImageDiff(
    () => page.getByRole('button', { name: 'Start Sketch' }).click(),
    200
  )

  await page.mouse.click(700, 200)

  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('-XZ')`
  )

  await page.waitForTimeout(600)

  let previousCodeContent = await page.locator('.cm-content').innerText()

  // deselect the line tool by clicking it
  await page.getByRole('button', { name: 'Line' }).click()

  await page.mouse.click(700, 200)
  await page.waitForTimeout(100)
  await page.mouse.click(700, 250)
  await page.waitForTimeout(100)
  await page.mouse.click(750, 200)
  await page.waitForTimeout(100)

  // expect no change
  await expect(page.locator('.cm-content')).toHaveText(previousCodeContent)

  // select line tool again
  await page.getByRole('button', { name: 'Line' }).click()

  await u.closeDebugPanel()

  // line tool should work as expected again
  await page.mouse.click(700, 200)
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await page.waitForTimeout(100)
  await page.mouse.click(700, 300)
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()

  await page.waitForTimeout(100)
  await page.mouse.click(750, 300)
  await expect(page.locator('.cm-content')).not.toHaveText(previousCodeContent)
  previousCodeContent = await page.locator('.cm-content').innerText()
})

test('Can edit segments by dragging their handles', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([12.73, -0.09], %)
  |> tangentialArcTo([24.95, -5.38], %)`
    )
  })

  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()

  const startPX = [665, 458]
  const lineEndPX = [842, 458]
  const arcEndPX = [971, 342]

  const dragPX = 30

  await page.getByText('startProfileAt([4.61, -14.01], %)').click()
  await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Sketch' }).click()
  await page.waitForTimeout(400)
  let prevContent = await page.locator('.cm-content').innerText()

  const step5 = { steps: 5 }

  // drag startProfieAt handle
  await page.mouse.move(startPX[0], startPX[1])
  await page.mouse.down()
  await page.mouse.move(startPX[0] + dragPX, startPX[1] - dragPX, step5)
  await page.mouse.up()

  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  // drag line handle
  await page.mouse.move(lineEndPX[0] + dragPX, lineEndPX[1] - dragPX)
  await page.mouse.down()
  await page.mouse.move(
    lineEndPX[0] + dragPX * 2,
    lineEndPX[1] - dragPX * 2,
    step5
  )
  await page.mouse.up()
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  // drag tangentialArcTo handle
  await page.mouse.move(arcEndPX[0], arcEndPX[1])
  await page.mouse.down()
  await page.mouse.move(arcEndPX[0] + dragPX, arcEndPX[1] - dragPX, step5)
  await page.mouse.up()
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

  // expect the code to have changed
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt([6.44, -12.07], %)
  |> line([14.04, 2.03], %)
  |> tangentialArcTo([27.19, -4.2], %)`)
})

const doSnapAtDifferentScales = async (
  page: any,
  camPos: [number, number, number],
  scale = 1,
  fudge = 0
) => {
  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  const code = `const part001 = startSketchOn('XZ')
|> startProfileAt([${roundOff(scale * 87.68)}, ${roundOff(scale * 43.84)}], %)
|> line([${roundOff(scale * 175.36)}, 0], %)
|> line([0, -${roundOff(scale * 175.36) + fudge}], %)
|> close(%)`

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(100)

  await u.openAndClearDebugPanel()
  await u.updateCamPosition(camPos)
  await u.closeDebugPanel()

  // select a plane
  await page.mouse.click(700, 200)
  await expect(page.locator('.cm-content')).toHaveText(
    `const part001 = startSketchOn('XZ')`
  )

  let prevContent = await page.locator('.cm-content').innerText()

  const pointA = [700, 200]
  const pointB = [900, 200]
  const pointC = [900, 400]

  // draw three lines
  await page.mouse.click(pointA[0], pointA[1])
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  await page.mouse.click(pointB[0], pointB[1])
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  await page.mouse.click(pointC[0], pointC[1])
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  await page.mouse.move(pointA[0] - 12, pointA[1] + 12)
  const pointNotQuiteA = [pointA[0] - 7, pointA[1] + 7]
  await page.mouse.move(pointNotQuiteA[0], pointNotQuiteA[1], { steps: 10 })

  await page.mouse.click(pointNotQuiteA[0], pointNotQuiteA[1])
  await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
  prevContent = await page.locator('.cm-content').innerText()

  await expect(page.locator('.cm-content')).toHaveText(code)

  // exit sketch
  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.removeCurrentCode()
}

test.describe('Snap to close works (at any scale)', () => {
  test('[0, 100, 100]', async ({ page }) => {
    await doSnapAtDifferentScales(page, [0, 100, 100], 0.01, 0.01)
  })

  test('[0, 10000, 10000]', async ({ page }) => {
    await doSnapAtDifferentScales(page, [0, 10000, 10000])
  })
})

test('Sketch on face', async ({ page }) => {
  const u = getUtils(page)
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
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
  |> extrude(5 + 7, %)`
    )
  })

  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()

  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(300)

  let previousCodeContent = await page.locator('.cm-content').innerText()

  await u.openAndClearDebugPanel()
  await u.doAndWaitForCmd(
    () => page.mouse.click(793, 133),
    'default_camera_get_settings',
    true
  )
  await page.waitForTimeout(150)

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

  await expect(page.locator('.cm-content'))
    .toContainText(`const part002 = startSketchOn(part001, 'seg01')
  |> startProfileAt([-12.83, 6.7], %)
  |> line([2.87, -0.23], %)
  |> line([-3.05, -1.47], %)
  |> close(%)`)

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.updateCamPosition([1049, 239, 686])
  await u.closeDebugPanel()

  await page.getByText('startProfileAt([-12.83, 6.7], %)').click()
  await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeVisible()
  await u.doAndWaitForCmd(
    () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
    'default_camera_get_settings',
    true
  )
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

  const result = makeTemplate`const part002 = startSketchOn(part001, 'seg01')
  |> startProfileAt([-12.83, 6.7], %)
  |> line([${[2.28, 2.35]}, -${0.07}], %)
  |> line([-3.05, -1.47], %)
  |> close(%)`

  await expect(page.locator('.cm-content')).toHaveText(result.regExp)

  // exit sketch
  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await page.getByText('startProfileAt([-12.83, 6.7], %)').click()

  await expect(page.getByRole('button', { name: 'Extrude' })).not.toBeDisabled()
  await page.getByRole('button', { name: 'Extrude' }).click()

  await expect(page.getByTestId('command-bar')).toBeVisible()
  await page.waitForTimeout(100)

  await page.keyboard.press('Enter')
  await expect(page.getByText('Confirm Extrude')).toBeVisible()
  await page.keyboard.press('Enter')

  const result2 = result.genNext`
  |> extrude(${[5, 5]} + 7, %)`
  await expect(page.locator('.cm-content')).toHaveText(result2.regExp)
})

test('Can code mod a line length', async ({ page }) => {
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> xLine(-20, %)
`
    )
  })

  const u = getUtils(page)
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // Click the line of code for xLine.
  await page.getByText(`xLine(-20, %)`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
  await page.waitForTimeout(100)

  // enter sketch again
  await page.getByRole('button', { name: 'Edit Sketch' }).click()
  await page.waitForTimeout(350) // wait for animation

  const startXPx = 500
  await page.mouse.move(startXPx + PUR * 15, 250 - PUR * 10)
  await page.mouse.click(615, 102)
  await page.getByRole('button', { name: 'Constrain', exact: true }).click()
  await page.getByRole('button', { name: 'length', exact: true }).click()
  await page.getByText('Add constraining value').click()

  await expect(page.locator('.cm-content')).toHaveText(
    `const length001 = 20const part001 = startSketchOn('XY')  |> startProfileAt([-10, -10], %)  |> line([20, 0], %)  |> line([0, 20], %)  |> xLine(-length001, %)`
  )
})

test('Extrude from command bar selects extrude line after', async ({
  page,
}) => {
  await page.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> xLine(-20, %)
  |> close(%)
    `
    )
  })

  const u = getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('/')
  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  // Click the line of code for xLine.
  await page.getByText(`close(%)`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
  await page.waitForTimeout(100)

  await page.getByRole('button', { name: 'Extrude' }).click()
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await expect(page.locator('.cm-activeLine')).toHaveText(
    `  |> extrude(${KCL_DEFAULT_LENGTH}, %)`
  )
})
