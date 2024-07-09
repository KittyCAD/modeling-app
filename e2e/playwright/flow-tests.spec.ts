import { test, expect, Page } from '@playwright/test'
import {
  makeTemplate,
  getUtils,
  getMovementUtils,
  wiggleMove,
  doExport,
  metaModifier,
  TEST_COLORS,
} from './test-utils'
import waitOn from 'wait-on'
import { XOR, roundOff, uuidv4 } from 'lib/utils'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { secrets } from './secrets'
import {
  TEST_SETTINGS,
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_CORRUPTED,
  TEST_SETTINGS_ONBOARDING_EXPORT,
  TEST_SETTINGS_ONBOARDING_START,
  TEST_CODE_GIZMO,
  TEST_SETTINGS_ONBOARDING_USER_MENU,
  TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING,
} from './storageStates'
import * as TOML from '@iarna/toml'
import { LineInputsType } from 'lang/std/sketchcombos'
import { Coords2d } from 'lang/std/sketch'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'
import { EngineCommand } from 'lang/std/engineConnection'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { bracket } from 'lib/exampleKcl'

const PERSIST_MODELING_CONTEXT = 'persistModelingContext'

/*
debug helper: unfortunately we do rely on exact coord mouse clicks in a few places
just from the nature of the stream, running the test with debugger and pasting the below
into the console can be useful to get coords

document.addEventListener('mousemove', (e) =>
  console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
)
*/

const deg = (Math.PI * 2) / 360

const commonPoints = {
  startAt: '[7.19, -9.7]',
  num1: 7.25,
  num2: 14.44,
  // num1: 9.64,
  // num2: 19.19,
}

test.afterEach(async ({ context, page }, testInfo) => {
  if (testInfo.status === 'skipped') return
  if (testInfo.status === 'failed') return

  const u = await getUtils(page)
  // Kill the network so shutdown happens properly
  await u.emulateNetworkConditions({
    offline: true,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  // It seems it's best to give the browser about 3s to close things
  // It's not super reliable but we have no real other choice for now
  await page.waitForTimeout(3000)
})

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
      localStorage.setItem('playwright', 'true')
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

test.setTimeout(120000)

async function doBasicSketch(page: Page, openPanes: string[]) {
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio

  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  // If we have the code pane open, we should see the code.
  if (openPanes.includes('code')) {
    await expect(u.codeLocator).toHaveText(``)
  } else {
    // Ensure we don't see the code.
    await expect(u.codeLocator).not.toBeVisible()
  }

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

  if (openPanes.includes('code')) {
    await expect(u.codeLocator).toHaveText(
      `const sketch001 = startSketchOn('XZ')`
    )
  }
  await u.closeDebugPanel()

  await page.waitForTimeout(1000) // TODO detect animation ending, or disable animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)`)
  }
  await page.waitForTimeout(500)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(500)

  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)`)
  }
  await page.waitForTimeout(500)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1 + 0.01}], %)`)
  }
  await page.waitForTimeout(500)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1 + 0.01}], %)
  |> line([-${commonPoints.num2}, 0], %)`)
  }

  // deselect line tool
  await page.getByRole('button', { name: 'Line' }).click()
  await page.waitForTimeout(500)

  const line1 = await u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`, 0)
  if (openPanes.includes('code')) {
    expect(await u.getGreatestPixDiff(line1, TEST_COLORS.WHITE)).toBeLessThan(3)
    await expect(
      await u.getGreatestPixDiff(line1, [249, 249, 249])
    ).toBeLessThan(3)
  }
  // click between first two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10)
  await page.waitForTimeout(100)
  if (openPanes.includes('code')) {
    expect(await u.getGreatestPixDiff(line1, TEST_COLORS.BLUE)).toBeLessThan(3)
    await expect(await u.getGreatestPixDiff(line1, [0, 0, 255])).toBeLessThan(3)
  }

  // hold down shift
  await page.keyboard.down('Shift')
  // click between the latest two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 20)

  // selected two lines therefore there should be two cursors
  if (openPanes.includes('code')) {
    await expect(page.locator('.cm-cursor')).toHaveCount(2)
  }

  await page.getByRole('button', { name: 'Constraints' }).click()
  await page.getByRole('button', { name: 'Equal Length' }).click()

  // Open the code pane.
  await u.openKclCodePanel()
  await expect(u.codeLocator).toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %, $seg01)
  |> line([0, ${commonPoints.num1 + 0.01}], %)
  |> angledLine([180, segLen(seg01, %)], %)`)
}

test.describe('Basic sketch', () => {
  test('code pane open at start', async ({ page }) => {
    await doBasicSketch(page, ['code'])
  })

  test('code pane closed at start', async ({ page }) => {
    // Load the app with the code panes
    await page.addInitScript(async (persistModelingContext) => {
      localStorage.setItem(
        persistModelingContext,
        JSON.stringify({ openPanes: [] })
      )
    }, PERSIST_MODELING_CONTEXT)
    await doBasicSketch(page, [])
  })
})

test.describe('Testing Camera Movement', () => {
  test('Can moving camera', async ({ page, context }) => {
    test.skip(process.platform === 'darwin', 'Can moving camera')
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

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

      const camCommand: EngineCommand = {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          center: { x: 0, y: 0, z: 0 },
          vantage: { x: camPos[0], y: camPos[1], z: camPos[2] },
          up: { x: 0, y: 0, z: 1 },
        },
      }
      const updateCamCommand: EngineCommand = {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      }
      await u.sendCustomCmd(camCommand)
      await page.waitForTimeout(100)
      await u.sendCustomCmd(updateCamCommand)
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
    }, [-19, -85, -85])

    const camCommand: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: camPos[0], y: camPos[1], z: camPos[2] },
        up: { x: 0, y: 0, z: 1 },
      },
    }
    const updateCamCommand: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    }
    await u.sendCustomCmd(camCommand)
    await page.waitForTimeout(100)
    await u.sendCustomCmd(updateCamCommand)
    await page.waitForTimeout(100)

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
    }, [0, -85, -85])
  })

  test('Zoom should be consistent when exiting or entering sketches', async ({
    page,
  }) => {
    // start new sketch pan and zoom before exiting, when exiting the sketch should stay in the same place
    // than zoom and pan outside of sketch mode and enter again and it should not change from where it is
    // than again for sketching

    test.skip(process.platform !== 'darwin', 'Zoom should be consistent')
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.waitForTimeout(100)

    // select a plane
    await page.mouse.click(700, 325)

    let code = `const sketch001 = startSketchOn('XY')`
    await expect(u.codeLocator).toHaveText(code)
    await u.closeDebugPanel()

    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

    // move the camera slightly
    await page.keyboard.down('Shift')
    await page.mouse.move(700, 300)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(800, 200)
    await page.mouse.up({ button: 'right' })
    await page.keyboard.up('Shift')

    let y = 350,
      x = 948

    await u.canvasLocator.click({ position: { x: 783, y } })
    code += `\n  |> startProfileAt([8.12, -12.98], %)`
    // await expect(u.codeLocator).toHaveText(code)
    await u.canvasLocator.click({ position: { x, y } })
    code += `\n  |> line([11.18, 0], %)`
    // await expect(u.codeLocator).toHaveText(code)
    await u.canvasLocator.click({ position: { x, y: 275 } })
    code += `\n  |> line([0, 6.99], %)`
    // await expect(u.codeLocator).toHaveText(code)

    // click the line button
    await page.getByRole('button', { name: 'Line' }).click()

    const hoverOverNothing = async () => {
      // await u.canvasLocator.hover({position: {x: 700, y: 325}})
      await page.mouse.move(700, 325)
      await page.waitForTimeout(100)
      await expect(page.getByTestId('hover-highlight')).not.toBeVisible({
        timeout: 10_000,
      })
    }

    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

    await page.waitForTimeout(100)
    // hover over horizontal line
    await u.canvasLocator.hover({ position: { x: 800, y } })
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })
    await page.waitForTimeout(200)

    await hoverOverNothing()
    await page.waitForTimeout(200)
    // hover over vertical line
    await u.canvasLocator.hover({ position: { x, y: 325 } })
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    // click exit sketch
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await page.waitForTimeout(400)

    await hoverOverNothing()
    await page.waitForTimeout(200)
    // hover over horizontal line
    await page.mouse.move(858, y, { steps: 5 })
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    // hover over vertical line
    await page.mouse.move(x, 325)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    // hover over vertical line
    await page.mouse.move(857, y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })
    // now click it
    await page.mouse.click(857, y)

    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    await page.waitForTimeout(400)

    await hoverOverNothing()
    x = 975
    y = 468

    await page.waitForTimeout(100)
    await page.mouse.move(x, 419, { steps: 5 })
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    await page.mouse.move(855, y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await page.waitForTimeout(200)

    await hoverOverNothing()
    await page.waitForTimeout(200)

    await page.mouse.move(x, 419)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })

    await hoverOverNothing()

    await page.mouse.move(855, y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible({
      timeout: 10_000,
    })
  })
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
      page.getByText('Start a sketch on a specific plane or face')
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
      page.locator('.cm-lintRange.cm-lintRange-error').first()
    ).toBeVisible()

    await page.locator('.cm-lintRange.cm-lintRange-error').hover()
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
    await u.waitForPageLoad()

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const searchText =
      'sketch profile must lie entirely on one side of the revolution axis'
    await expect(page.getByText(searchText).first()).toBeVisible()
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
      await expect(page.locator('.cm-completionLabel')).toHaveCount(6)
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
    |> tangentialArcTo([24.95, -5.38], %)
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
      `const sketch001 = startSketchOn('XZ')  |> startProfileAt([4.61, -14.01], %)  |> line([12.73, -0.09], %)  |> tangentialArcTo([24.95, -5.38], %)  |> close(%)const extrude001 = extrude(5, sketch001)`
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
    |> tangentialArcTo([24.95, -5.38], %)
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
    |> tangentialArcTo([24.95, -5.38], %)
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
    |> tangentialArcTo([24.95, -5.38], %)
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
    |> tangentialArcTo([24.95, -5.38], %)
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
    |> tangentialArcTo([24.95, -5.38], %)
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
    |> tangentialArcTo([24.95, -5.38], %)
    |> close(%)
    |> extrude(5, %)`)
  })
})

test.describe('Can create sketches on all planes and their back sides', () => {
  const sketchOnPlaneAndBackSideTest = async (
    page: any,
    plane: string,
    clickCoords: { x: number; y: number }
  ) => {
    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    const coord =
      plane === '-XY' || plane === '-YZ' || plane === 'XZ' ? -100 : 100
    const camCommand: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: coord, y: coord, z: coord },
        up: { x: 0, y: 0, z: 1 },
      },
    }
    const updateCamCommand: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    }

    const code = `const sketch001 = startSketchOn('${plane}')
    |> startProfileAt([0.9, -1.22], %)`

    await u.openDebugPanel()

    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await u.sendCustomCmd(camCommand)
    await page.waitForTimeout(100)
    await u.sendCustomCmd(updateCamCommand)

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
    await sketchOnPlaneAndBackSideTest(page, '-XZ', { x: 700, y: 80 }) // blue plane
  })

  test('-XY', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, '-XY', { x: 600, y: 118 }) // back of red plane
  })

  test('-YZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, '-YZ', { x: 700, y: 219 }) // back of green plane
  })

  test('-XZ', async ({ page }) => {
    await sketchOnPlaneAndBackSideTest(page, 'XZ', { x: 700, y: 427 }) // back of blue plane
  })
})

test.describe('Copilot ghost text', () => {
  test('completes code in empty file', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )

    // Hit enter a few times.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)    `
    )

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
  })

  test('copilot disabled in sketch mode no select plane', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

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
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toContainText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
  })

  test('copilot disabled in sketch mode after selecting plane', async ({
    page,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

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
      `const sketch001 = startSketchOn('XZ')`
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
      `const sketch001 = startSketchOn('XZ')`
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
      `const sketch001 = startSketchOn('XZ')fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // We should be able to hit Tab to accept the completion.
    await page.keyboard.press('Tab')
    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )

    // Hit enter a few times.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)    `
    )

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
  })

  test('ArrowUp in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowDown in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowLeft in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('ArrowRight in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('Enter in code scoots it down', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
  })

  test('Ctrl+shift+z in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    const CtrlKey = process.platform === 'darwin' ? 'Meta' : 'Control'

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up(CtrlKey)
    await page.keyboard.up('Shift')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('Ctrl+z in code rejects the suggestion and undos the last code', async ({
    page,
  }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    const CtrlKey = process.platform === 'darwin' ? 'Meta' : 'Control'

    await page.waitForTimeout(800)
    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await page.keyboard.type('{thing: "blah"}', { delay: 0 })

    await expect(page.locator('.cm-content')).toHaveText(`{thing: "blah"}`)

    // We wanna make sure the code saves.
    await page.waitForTimeout(800)

    // Ctrl+z
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyZ')
    await page.keyboard.up(CtrlKey)

    await expect(page.locator('.cm-content')).toHaveText(``)

    // Ctrl+shift+z
    await page.keyboard.down(CtrlKey)
    await page.keyboard.down('Shift')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up(CtrlKey)
    await page.keyboard.up('Shift')

    await expect(page.locator('.cm-content')).toHaveText(`{thing: "blah"}`)

    // We wanna make sure the code saves.
    await page.waitForTimeout(800)

    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `{thing: "blah"}fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Once for the enter.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyZ')
    await page.keyboard.up(CtrlKey)

    // Once for the text.
    await page.keyboard.down(CtrlKey)
    await page.keyboard.press('KeyZ')
    await page.keyboard.up(CtrlKey)

    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    // TODO when we make codemirror a widget, we can test this.
    //await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('delete in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('Delete')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('backspace in code rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
    )
    await expect(page.locator('.cm-ghostText').first()).toHaveText(
      `fn cube = (pos, scale) => {`
    )

    // Going elsewhere in the code should hide the ghost text.
    await page.keyboard.press('Backspace')
    await expect(page.locator('.cm-ghostText').first()).not.toBeVisible()

    await expect(page.locator('.cm-content')).toHaveText(``)
  })

  test('focus outside code pane rejects the suggestion', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.codeLocator.click()
    await expect(page.locator('.cm-content')).toHaveText(``)

    await expect(page.locator('.cm-ghostText')).not.toBeVisible()
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-ghostText').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      `fn cube = (pos, scale) => {  const sg = startSketchOn('XY')    |> startProfileAt(pos, %)    |> line([0, scale], %)    |> line([scale, 0], %)    |> line([0, -scale], %)  return sg}const part001 = cube([0,0], 20)    |> close(%)    |> extrude(20, %)`
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

test.describe('Testing settings', () => {
  test('Stored settings are validated and fall back to defaults', async ({
    page,
  }) => {
    const u = await getUtils(page)

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
    expect(storedSettings.settings?.projects?.defaultProjectName).toBe(
      undefined
    )
  })

  test('Project settings can be set and override user settings', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
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
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Put the cursor in the editor
    await page.locator('.cm-content').click()

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

  test('Project and user settings can be reset', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Put the cursor in the editor
    await page.locator('.cm-content').click()

    // Open the settings modal with the browser keyboard shortcut
    await page.keyboard.press('Meta+Shift+,')

    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    // Check that the user setting was not changed
    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Set the user theme to light.
    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" as a user default`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    await page.getByRole('radio', { name: 'Project' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()
    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')
  })
})

test.describe('Onboarding tests', () => {
  test('Onboarding code is shown in the editor', async ({ page }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey }) => {
        // Give no initial code, so that the onboarding start is shown immediately
        localStorage.removeItem('persistCode')
        localStorage.removeItem(settingsKey)
      },
      { settingsKey: TEST_SETTINGS_KEY }
    )

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    // *and* that the code is shown in the editor
    await expect(page.locator('.cm-content')).toContainText('// Shelf Bracket')
  })

  test('Click through each onboarding step', async ({ page }) => {
    const u = await getUtils(page)

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
    const u = await getUtils(page)

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

  test('Onboarding code gets reset to demo on Interactive Numbers step', async ({
    page,
  }) => {
    test.skip(
      process.platform === 'darwin',
      "Skip on macOS, because Playwright isn't behaving the same as the actual browser"
    )
    const u = await getUtils(page)
    const badCode = `// This is bad code we shouldn't see`
    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings, badCode }) => {
        localStorage.setItem('persistCode', badCode)
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING,
        }),
        badCode,
      }
    )

    await page.setViewportSize({ width: 1200, height: 1080 })
    await u.waitForAuthSkipAppStart()

    await page.waitForURL('**' + onboardingPaths.PARAMETRIC_MODELING, {
      waitUntil: 'domcontentloaded',
    })

    const bracketNoNewLines = bracket.replace(/\n/g, '')

    // Check the code got reset on load
    await expect(page.locator('#code-pane')).toBeVisible()
    await expect(u.codeLocator).toHaveText(bracketNoNewLines, {
      timeout: 10_000,
    })

    // Mess with the code again
    await u.codeLocator.selectText()
    await u.codeLocator.fill(badCode)
    await expect(u.codeLocator).toHaveText(badCode)

    // Click to the next step
    await page.locator('[data-testid="onboarding-next"]').click()
    await page.waitForURL('**' + onboardingPaths.INTERACTIVE_NUMBERS, {
      waitUntil: 'domcontentloaded',
    })

    // Check that the code has been reset
    await expect(u.codeLocator).toHaveText(bracketNoNewLines)
  })

  test('Avatar text updates depending on image load success', async ({
    page,
  }) => {
    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: TEST_SETTINGS_ONBOARDING_USER_MENU,
        }),
      }
    )

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })

    // Test that the text in this step is correct
    const avatarLocator = await page
      .getByTestId('user-sidebar-toggle')
      .locator('img')
    const onboardingOverlayLocator = await page
      .getByTestId('onboarding-content')
      .locator('div')
      .nth(1)

    // Expect the avatar to be visible and for the text to reference it
    await expect(avatarLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toContainText('your avatar')

    // This is to force the avatar to 404.
    // For our test image (only triggers locally. on CI, it's Kurt's /
    // gravatar image )
    await page.route('/cat.jpg', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found!',
      })
    })

    // 404 the CI avatar image
    await page.route('https://lh3.googleusercontent.com/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found!',
      })
    })

    await page.reload({ waitUntil: 'domcontentloaded' })

    // Now expect the text to be different
    await expect(avatarLocator).not.toBeVisible()
    await expect(onboardingOverlayLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toContainText('the menu button')
  })
})

test.describe('Testing selections', () => {
  test.setTimeout(90_000)
  test('Selections work on fresh and edited sketch', async ({ page }) => {
    // tests mapping works on fresh sketch and edited sketch
    // tests using hovers which is the same as selections, because if
    // source ranges are wrong, hovers won't work
    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    const xAxisClick = () =>
      page.mouse.click(700, 253).then(() => page.waitForTimeout(100))
    const emptySpaceClick = () =>
      page.mouse.click(700, 343).then(() => page.waitForTimeout(100))
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
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)`)

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)`)

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([0, ${commonPoints.num1 + 0.01}], %)`)
    await page.waitForTimeout(100)
    await page.mouse.click(startXPx, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([0, ${commonPoints.num1 + 0.01}], %)
    |> line([-${commonPoints.num2}, 0], %)`)

    // deselect line tool
    await page.getByRole('button', { name: 'Line' }).click()

    await u.closeDebugPanel()
    const selectionSequence = async () => {
      await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

      await page.waitForTimeout(100)
      await page.mouse.move(startXPx + PUR * 15, 500 - PUR * 10)

      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
      // bg-yellow-200 is more brittle than hover-highlight, but is closer to the user experience
      // and will be an easy fix if it breaks because we change the colour
      await expect(page.locator('.bg-yellow-200').first()).toBeVisible()

      // check mousing off, than mousing onto another line
      await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 15) // mouse off
      await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
      await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 20) // mouse onto another line
      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()

      // now check clicking works including axis

      // click a segment hold shift and click an axis, see that a relevant constraint is enabled
      await topHorzSegmentClick()
      await page.keyboard.down('Shift')
      const constrainButton = page.getByRole('button', { name: 'Constraints' })
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
      await page.waitForTimeout(100)

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

      await page.keyboard.down(
        process.platform === 'linux' ? 'Control' : 'Meta'
      )
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
    await u.closeDebugPanel()

    // select a line, this verifies that sketches in the scene can be selected outside of sketch mode
    await topHorzSegmentClick()
    await page.waitForTimeout(100)

    // enter sketch again
    await u.doAndWaitForCmd(
      () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
      'default_camera_get_settings'
    )
    await page.waitForTimeout(150)

    await page.waitForTimeout(300) // wait for animation

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: 0, y: -1378.01, z: 0 },
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

    await emptySpaceClick()

    await u.closeDebugPanel()

    // hover again and check it works
    await selectionSequence()
  })

  test('Solids should be select and deletable', async ({ page }) => {
    test.setTimeout(90_000)
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
        |> startProfileAt([-79.26, 95.04], %)
        |> line([112.54, 127.64], %, $seg02)
        |> line([170.36, -121.61], %, $seg01)
        |> lineTo([profileStartX(%), profileStartY(%)], %)
        |> close(%)
const extrude001 = extrude(50, sketch001)
const sketch005 = startSketchOn(extrude001, 'END')
  |> startProfileAt([23.24, 136.52], %)
  |> line([-8.44, 36.61], %)
  |> line([49.4, 2.05], %)
  |> line([29.69, -46.95], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch003 = startSketchOn(extrude001, seg01)
  |> startProfileAt([21.23, 17.81], %)
  |> line([51.97, 21.32], %)
  |> line([4.07, -22.75], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn(extrude001, seg02)
  |> startProfileAt([-100.54, 16.99], %)
  |> line([0, 20.03], %)
  |> line([62.61, 0], %, $seg03)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude002 = extrude(50, sketch002)
const sketch004 = startSketchOn(extrude002, seg03)
  |> startProfileAt([57.07, 134.77], %)
  |> line([-4.72, 22.84], %)
  |> line([28.8, 6.71], %)
  |> line([9.19, -25.33], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude003 = extrude(20, sketch004)
const pipeLength = 40
const pipeSmallDia = 10
const pipeLargeDia = 20
const thickness = 0.5
const part009 = startSketchOn('XY')
  |> startProfileAt([pipeLargeDia - (thickness / 2), 38], %)
  |> line([thickness, 0], %)
  |> line([0, -1], %)
  |> angledLineToX({
       angle: 60,
       to: pipeSmallDia + thickness
     }, %)
  |> line([0, -pipeLength], %)
  |> angledLineToX({
       angle: -60,
       to: pipeLargeDia + thickness
     }, %)
  |> line([0, -1], %)
  |> line([-thickness, 0], %)
  |> line([0, 1], %)
  |> angledLineToX({ angle: 120, to: pipeSmallDia }, %)
  |> line([0, pipeLength], %)
  |> angledLineToX({ angle: 60, to: pipeLargeDia }, %)
  |> close(%)
const rev = revolve({ axis: 'y' }, part009)
`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 1139.49, y: -7053, z: 8597.31 },
        center: { x: -2206.68, y: -1298.36, z: 60 },
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

    const revolve = { x: 646, y: 248 }
    const parentExtrude = { x: 915, y: 133 }
    const solid2d = { x: 770, y: 167 }

    // DELETE REVOLVE
    await page.mouse.click(revolve.x, revolve.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([0, -pipeLength], %)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)

    await expect(u.codeLocator).not.toContainText(
      `const rev = revolve({ axis: 'y' }, part009)`
    )

    // DELETE PARENT EXTRUDE
    await page.mouse.click(parentExtrude.x, parentExtrude.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([170.36, -121.61], %, $seg01)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(
      `const extrude001 = extrude(50, sketch001)`
    )
    await expect(u.codeLocator).toContainText(`const sketch005 = startSketchOn({
       plane: {
         origin: { x: 0, y: -50, z: 0 },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 0, z: 1 },
         z_axis: { x: 0, y: -1, z: 0 }
       }
     })`)
    await expect(u.codeLocator).toContainText(`const sketch003 = startSketchOn({
       plane: {
         origin: { x: 116.53, y: 0, z: 163.25 },
         x_axis: { x: -0.81, y: 0, z: 0.58 },
         y_axis: { x: 0, y: -1, z: 0 },
         z_axis: { x: 0.58, y: 0, z: 0.81 }
       }
     })`)
    await expect(u.codeLocator).toContainText(`const sketch002 = startSketchOn({
       plane: {
         origin: { x: -91.74, y: 0, z: 80.89 },
         x_axis: { x: -0.66, y: 0, z: -0.75 },
         y_axis: { x: 0, y: -1, z: 0 },
         z_axis: { x: -0.75, y: 0, z: 0.66 }
       }
     })`)

    // DELETE SOLID 2D
    await page.mouse.click(solid2d.x, solid2d.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> startProfileAt([23.24, 136.52], %)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(
      `const sketch005 = startSketchOn({`
    )
  })
  test("Deleting solid that the AST mod can't handle results in a toast message", async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-79.26, 95.04], %)
  |> line([112.54, 127.64], %, $seg02)
  |> line([170.36, -121.61], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
const launderExtrudeThroughVar = extrude001
const sketch002 = startSketchOn(launderExtrudeThroughVar, seg02)
  |> startProfileAt([-100.54, 16.99], %)
  |> line([0, 20.03], %)
  |> line([62.61, 0], %, $seg03)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)      
`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await u.closeDebugPanel()

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 1139.49, y: -7053, z: 8597.31 },
        center: { x: -2206.68, y: -1298.36, z: 60 },
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

    // attempt delete
    await page.mouse.click(930, 139)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([170.36, -121.61], %, $seg01)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')

    await expect(page.getByText('Unable to delete part')).toBeVisible()
  })
  test('Hovering over 3d features highlights code', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async (KCL_DEFAULT_LENGTH) => {
      localStorage.setItem(
        'persistCode',
        `const part001 = startSketchOn('XZ')
    |> startProfileAt([20, 0], %)
    |> line([7.13, 4 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 3.14 + 0 }, %)
    |> lineTo([20.14 + 0, -0.14 + 0], %)
    |> xLineTo(29 + 0, %)
    |> yLine(-3.14 + 0, %, $a)
    |> xLine(1.63, %)
    |> angledLineOfXLength({ angle: 3 + 0, length: 3.14 }, %)
    |> angledLineOfYLength({ angle: 30, length: 3 + 0 }, %)
    |> angledLineToX({ angle: 22.14 + 0, to: 12 }, %)
    |> angledLineToY({ angle: 30, to: 11.14 }, %)
    |> angledLineThatIntersects({
          angle: 3.14,
          intersectTag: a,
          offset: 0
        }, %)
    |> tangentialArcTo([13.14 + 0, 13.14], %)
    |> close(%)
    |> extrude(5 + 7, %)
  `
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

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
    await u.closeDebugPanel()

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
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await page.mouse.move(nothing[0], nothing[1])
    await expect(page.getByTestId('hover-highlight').first()).not.toBeVisible()

    await page.mouse.move(arc[0], arc[1])
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await page.mouse.move(nothing[0], nothing[1])
    await expect(page.getByTestId('hover-highlight').first()).not.toBeVisible()

    await page.mouse.move(close[0], close[1])
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await page.mouse.move(nothing[0], nothing[1])
    await expect(page.getByTestId('hover-highlight').first()).not.toBeVisible()

    await page.mouse.move(flatExtrusionFace[0], flatExtrusionFace[1])
    await expect(page.getByTestId('hover-highlight')).toHaveCount(5) // multiple lines
    await page.mouse.move(nothing[0], nothing[1])
    await page.waitForTimeout(100)
    await expect(page.getByTestId('hover-highlight').first()).not.toBeVisible()
  })
  test("Extrude button should be disabled if there's no extrudable geometry when nothing is selected", async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> line([3.75, 0.46], %)
  |> line([4.99, -0.46], %, $seg01)
  |> line([3.3, -2.12], %)
  |> line([2.16, -3.33], %)
  |> line([0.85, -3.08], %)
  |> line([-0.18, -3.36], %)
  |> line([-3.86, -2.73], %)
  |> line([-17.67, 0.85], %)
  |> close(%)
const extrude001 = extrude(10, sketch001)
  `
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectUnExtrudable = () =>
      page.getByText(`line([4.99, -0.46], %, $seg01)`).click()
    const clickEmpty = () => page.mouse.click(700, 460)
    await selectUnExtrudable()
    // expect extrude button to be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    await clickEmpty()

    // expect active line to contain nothing
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // and extrude to still be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    const codeToAdd = `${await u.codeLocator.allInnerTexts()}
const sketch002 = startSketchOn(extrude001, $seg01)
  |> startProfileAt([-12.94, 6.6], %)
  |> line([2.45, -0.2], %)
  |> line([-2, -1.25], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`
    await u.codeLocator.fill(codeToAdd)

    await selectUnExtrudable()
    // expect extrude button to be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    await clickEmpty()
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // there's not extrudable geometry, so button should be enabled
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
  })

  const removeAfterFirstParenthesis = (inputString: string) => {
    const index = inputString.indexOf('(')
    if (index !== -1) {
      return inputString.substring(0, index)
    }
    return inputString // return the original string if '(' is not found
  }

  test('Testing selections (and hovers) work on sketches when NOT in sketch mode', async ({
    page,
  }) => {
    const cases = [
      {
        pos: [694, 185],
        expectedCode: 'line([74.36, 130.4], %, $seg01)',
      },
      {
        pos: [816, 244],
        expectedCode: 'angledLine([segAng(seg01, %), yo], %)',
      },
      {
        pos: [1107, 161],
        expectedCode: 'tangentialArcTo([167.95, -28.85], %)',
      },
    ] as const
    await page.addInitScript(
      async ({ cases }) => {
        localStorage.setItem(
          'persistCode',
          `const yo = 79
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> ${cases[0].expectedCode}
  |> line([-3.19, -138.43], %)
  |> ${cases[1].expectedCode}
  |> line([41.19, 28.97 + 5], %)
  |> ${cases[2].expectedCode}`
        )
      },
      { cases }
    )
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openAndClearDebugPanel()

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: -449, y: -7503, z: 99 },
        center: { x: -449, y: 0, z: 99 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await u.waitForCmdReceive('default_camera_look_at')
    await u.clearAndCloseDebugPanel()

    // end setup, now test hover and selects
    for (const { pos, expectedCode } of cases) {
      // hover over segment, check it's content
      await page.mouse.move(pos[0], pos[1], { steps: 5 })
      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
      await expect(page.getByTestId('hover-highlight').first()).toHaveText(
        expectedCode
      )
      // hover over segment, click it and check the cursor has move to the right place
      await page.mouse.click(pos[0], pos[1])
      await expect(page.locator('.cm-activeLine')).toHaveText(
        '|> ' + expectedCode
      )
    }
  })
  test("Hovering and selection of extruded faces works, and is not overridden shortly after user's click", async ({
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-79.26, 95.04], %)
  |> line([112.54, 127.64], %)
  |> line([170.36, -121.61], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
        `
      )
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openAndClearDebugPanel()

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 6615, y: -9505, z: 10344 },
        center: { x: 1579, y: -635, z: 4035 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await u.waitForCmdReceive('default_camera_look_at')
    await u.clearAndCloseDebugPanel()

    await page.waitForTimeout(1000)

    let noHoverColor: [number, number, number] = [82, 82, 82]
    let hoverColor: [number, number, number] = [116, 116, 116]
    let selectColor: [number, number, number] = [144, 148, 97]

    const extrudeWall = { x: 670, y: 275 }
    const extrudeText = `line([170.36, -121.61], %, $seg01)`

    const cap = { x: 594, y: 283 }
    const capText = `startProfileAt([-79.26, 95.04], %)`

    const nothing = { x: 946, y: 229 }

    expect(await u.getGreatestPixDiff(extrudeWall, noHoverColor)).toBeLessThan(
      5
    )
    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(100)
    await page.mouse.move(extrudeWall.x, extrudeWall.y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await expect(page.getByTestId('hover-highlight').first()).toContainText(
      removeAfterFirstParenthesis(extrudeText)
    )
    await page.waitForTimeout(200)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, hoverColor)
    ).toBeLessThan(5)
    await page.mouse.click(extrudeWall.x, extrudeWall.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${extrudeText}`)
    await page.waitForTimeout(200)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(5)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(5)

    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(300)
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

    // because of shading, color is not exact everywhere on the face
    noHoverColor = [104, 104, 104]
    hoverColor = [134, 134, 134]
    selectColor = [158, 162, 110]

    await expect(await u.getGreatestPixDiff(cap, noHoverColor)).toBeLessThan(5)
    await page.mouse.move(cap.x, cap.y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await expect(page.getByTestId('hover-highlight').first()).toContainText(
      removeAfterFirstParenthesis(capText)
    )
    await page.waitForTimeout(200)
    await expect(await u.getGreatestPixDiff(cap, hoverColor)).toBeLessThan(5)
    await page.mouse.click(cap.x, cap.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${capText}`)
    await page.waitForTimeout(200)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(5)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(5)
  })
  test("Various pipe expressions should and shouldn't allow edit and or extrude", async ({
    page,
  }) => {
    const u = await getUtils(page)
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
          `const part001 = startSketchOn('XZ')
    ${extrudeAndEditBlocked}
    |> line([25.96, 2.93], %)
    |> line([5.25, -5.72], %)
    |> line([-2.01, -10.35], %)
    |> line([-27.65, -2.78], %)
    |> close(%)
    |> extrude(5, %)
  const sketch002 = startSketchOn('XZ')
    ${extrudeAndEditAllowed}
    |> line([10.32, 6.47], %)
    |> line([9.71, -6.16], %)
    |> line([-3.08, -9.86], %)
    |> line([-12.02, -1.54], %)
    |> close(%)
  const sketch003 = startSketchOn('XZ')
    ${editOnly}
    |> line([27.55, -1.65], %)
    |> line([4.95, -8], %)
    |> line([-20.38, -10.12], %)
    |> line([-15.79, 17.08], %)
  
  fn yohey = (pos) => {
    const sketch004 = startSketchOn('XZ')
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

    await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
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

    // selecting an editable sketch but clicking "start sketch" should start a new sketch and not edit the existing one
    await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.waitForTimeout(200)
    await page.getByTestId('KCL Code').click()
    await page.waitForTimeout(200)
    await page.mouse.click(734, 134)
    await page.waitForTimeout(100)
    await page.getByTestId('KCL Code').click()
    // expect main content to contain `sketch005` i.e. started a new sketch
    await page.waitForTimeout(300)
    await expect(page.locator('.cm-content')).toHaveText(
      /sketch001 = startSketchOn\('XZ'\)/
    )
  })

  test('Deselecting line tool should mean nothing happens on click', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')`
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
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(700, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(750, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()
  })
})

test.describe('Command bar tests', () => {
  test('Extrude from command bar selects extrude line after', async ({
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> xLine(-20, %)
    |> close(%)
      `
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

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
      `const extrude001 = extrude(${KCL_DEFAULT_LENGTH}, sketch001)`
    )
  })
  test('Command bar works and can change a setting', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // First try opening the command bar and closing it
    await page
      .getByRole('button', { name: 'Commands', exact: false })
      .or(page.getByRole('button', { name: '⌘K' }))
      .click()

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()
    await page.keyboard.press('Escape')
    cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).not.toBeVisible()

    // Now try the same, but with the keyboard shortcut, check focus
    await page.keyboard.press('Meta+K')
    cmdSearchBar = page.getByPlaceholder('Search commands')
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
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // Put the cursor in the code editor
    await page.locator('.cm-content').click()

    // Now try the same, but with the keyboard shortcut, check focus
    await page.keyboard.press('Meta+K')

    let cmdSearchBar = page.getByPlaceholder('Search commands')
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
      const sketch001 = startSketchOn('XZ')
      |> startProfileAt([-6.95, 10.98], %)
      |> line([25.1, 0.41], %)
      |> line([0.73, -20.93], %)
      |> line([-23.44, 0.52], %)
      |> close(%)
          `
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

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
const sketch001 = startSketchOn('XZ')
    |> startProfileAt([-6.95, 10.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -20.93], %)
    |> line([-23.44, 0.52], %)
    |> close(%)
const extrude001 = extrude(distance001, sketch001)`.replace(
        /(\r\n|\n|\r)/gm,
        ''
      ) // remove newlines
    )
  })
})

test.describe('Regression tests', () => {
  // bugs we found that don't fit neatly into other categories
  test('executes on load', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('-XZ')
    |> startProfileAt([-6.95, 4.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -14.93], %)
    |> line([-23.44, 0.52], %)`
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // expand variables section
    const variablesTabButton = page.getByRole('tab', {
      name: 'Variables',
      exact: false,
    })
    await variablesTabButton.click()

    // can find sketch001 in the variables summary (pretty-json-container, makes sure we're not looking in the code editor)
    // sketch001 only shows up in the variables summary if it's been executed
    await page.waitForFunction(() => {
      const variablesElement = document.querySelector(
        '.pretty-json-container'
      ) as HTMLDivElement
      return variablesElement.innerHTML.includes('sketch001')
    })
    await expect(
      page.locator('.pretty-json-container >> text=sketch001')
    ).toBeVisible()
  })

  test('re-executes', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', `const myVar = 5`)
    })
    await page.setViewportSize({ width: 1000, height: 500 })

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
  test('ProgramMemory can be serialised', async ({ page }) => {
    const u = await getUtils(page)
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
  test('ensure the Zoo logo is not a link in browser app', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })
    await u.waitForAuthSkipAppStart()

    const zooLogo = page.locator('[data-testid="app-logo"]')
    // Make sure it's not a link
    await expect(zooLogo).not.toHaveAttribute('href')
  })
  test('Position _ Is Out Of Range... regression test', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const exampleSketch = startSketchOn("XZ")
    |> startProfileAt([0, 0], %)
    |> angledLine({ angle: 50, length: 45 }, %)
    |> yLineTo(0, %)
    |> close(%)
    |>
  
  const example = extrude(5, exampleSketch)
  shell({ faces: ['end'], thickness: 0.25 }, exampleSketch)`
      )
    })

    await page.goto('/')
    await u.waitForPageLoad()

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
    await page.waitForTimeout(200)
    // expect it still to be there (sometimes it just clears for a bit?)
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible({
      timeout: 10_000,
    })

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.getByText('Unexpected token').first()).toBeVisible()

    // Okay execution finished, let's start editing text below the error.
    await u.codeLocator.click()
    // Go to the end of the editor
    // This bug happens when there is a diagnostic in the editor and you try to
    // edit text below it.
    // Or delete a huge chunk of text and then try to edit below it.
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('thing: "blah"', { delay: 100 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowLeft')

    await expect(page.locator('.cm-content'))
      .toContainText(`const exampleSketch = startSketchOn("XZ")
    |> startProfileAt([0, 0], %)
    |> angledLine({ angle: 50, length: 45 }, %)
    |> yLineTo(0, %)
    |> close(%)

    thing: "blah"`)

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
  })
})

test.describe('Sketch tests', () => {
  test('multi-sketch file shows multiple Edit Sketch buttons', async ({
    page,
    context,
  }) => {
    const u = await getUtils(page)
    const selectionsSnippets = {
      startProfileAt1:
        '|> startProfileAt([-width / 4 + screwRadius, height / 2], %)',
      startProfileAt2: '|> startProfileAt([-width / 2, 0], %)',
      startProfileAt3: '|> startProfileAt([0, thickness], %)',
    }
    await context.addInitScript(
      async ({ startProfileAt1, startProfileAt2, startProfileAt3 }: any) => {
        localStorage.setItem(
          'persistCode',
          `
  const width = 20
  const height = 10
  const thickness = 5
  const screwRadius = 3
  const wireRadius = 2
  const wireOffset = 0.5
  
  const screwHole = startSketchOn('XY')
    ${startProfileAt1}
    |> arc({
          radius: screwRadius,
          angle_start: 0,
          angle_end: 360
        }, %)
  
  const part001 = startSketchOn('XY')
    ${startProfileAt2}
    |> xLine(width * .5, %)
    |> yLine(height, %)
    |> xLine(-width * .5, %)
    |> close(%)
    |> hole(screwHole, %)
    |> extrude(thickness, %)
  
  const part002 = startSketchOn('-XZ')
    ${startProfileAt3}
    |> xLine(width / 4, %)
    |> tangentialArcTo([width / 2, 0], %)
    |> xLine(-width / 4 + wireRadius, %)
    |> yLine(wireOffset, %)
    |> arc({
          radius: wireRadius,
          angle_start: 0,
          angle_end: 180
        }, %)
    |> yLine(-wireOffset, %)
    |> xLine(-width / 4, %)
    |> close(%)
    |> extrude(-height, %)
  `
        )
      },
      selectionsSnippets
    )
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await page.getByText(selectionsSnippets.startProfileAt1).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt2).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt3).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
  })
  test('Can delete most of a sketch and the line tool will still work', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([12.73, -0.09], %)
  |> tangentialArcTo([24.95, -5.38], %)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await page.getByText('tangentialArcTo([24.95, -5.38], %)').click()

    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    await page.waitForTimeout(600) // wait for animation

    await page.getByText('tangentialArcTo([24.95, -5.38], %)').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await u.openAndClearDebugPanel()

    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'Line' }).click()
    await page.waitForTimeout(100)

    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([0.31, 16.47], %)`
    )
  })
  test('Can exit selection of face', async ({ page }) => {
    // Load the app with the code panes
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', ``)
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()

    await expect(
      page.getByText('click plane or face to sketch on')
    ).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()
  })
  test.describe('Can edit segments by dragging their handles', () => {
    const doEditSegmentsByDraggingHandle = async (
      page: Page,
      openPanes: string[]
    ) => {
      // Load the app with the code panes
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], %)
      |> close(%)`
        )
      })

      const u = await getUtils(page)
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
      await u.closeDebugPanel()

      // If we have the code pane open, we should see the code.
      if (openPanes.includes('code')) {
        await expect(u.codeLocator)
          .toHaveText(`const sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], %)
      |> close(%)`)
      } else {
        // Ensure we don't see the code.
        await expect(u.codeLocator).not.toBeVisible()
      }

      const startPX = [665, 458]

      const dragPX = 30
      let prevContent = ''

      if (openPanes.includes('code')) {
        await page.getByText('startProfileAt([4.61, -14.01], %)').click()
      } else {
        // Wait for the render.
        await page.waitForTimeout(1000)
        // Select the sketch
        await page.mouse.click(700, 370)
      }
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(400)
      if (openPanes.includes('code')) {
        prevContent = await page.locator('.cm-content').innerText()
      }

      const step5 = { steps: 5 }

      await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

      // drag startProfieAt handle
      await page.mouse.move(startPX[0], startPX[1])
      await page.mouse.down()
      await page.mouse.move(startPX[0] + dragPX, startPX[1] - dragPX, step5)
      await page.mouse.up()

      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag line handle
      await page.waitForTimeout(100)

      const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
      await page.mouse.move(lineEnd.x - 5, lineEnd.y)
      await page.mouse.down()
      await page.mouse.move(lineEnd.x + dragPX, lineEnd.y - dragPX, step5)
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag tangentialArcTo handle
      const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
      await page.mouse.move(tangentEnd.x, tangentEnd.y - 5)
      await page.mouse.down()
      await page.mouse.move(tangentEnd.x + dragPX, tangentEnd.y - dragPX, step5)
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      }

      // Open the code pane
      await u.openKclCodePanel()

      // expect the code to have changed
      await expect(page.locator('.cm-content'))
        .toHaveText(`const sketch001 = startSketchOn('XZ')
      |> startProfileAt([6.44, -12.07], %)
      |> line([14.72, 1.97], %)
      |> tangentialArcTo([24.95, -5.38], %)
      |> line([1.97, 2.06], %)
      |> close(%)`)
    }
    test('code pane open at start-handles', async ({ page }) => {
      // Load the app with the code panes
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
      await doEditSegmentsByDraggingHandle(page, ['code'])
    })

    test('code pane closed at start-handles', async ({ page }) => {
      // Load the app with the code panes
      await page.addInitScript(async (persistModelingContext) => {
        localStorage.setItem(
          persistModelingContext,
          JSON.stringify({ openPanes: [] })
        )
      }, PERSIST_MODELING_CONTEXT)
      await doEditSegmentsByDraggingHandle(page, [])
    })
  })

  // failing for the same reason as "Can undo a sketch modification with ctrl+z"
  // please fix together
  test.fixme(
    'Can edit a sketch that has been extruded in the same pipe',
    async ({ page }) => {
      const u = await getUtils(page)
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], %)
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
      await page.waitForTimeout(100)

      const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
      await page.waitForTimeout(100)
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: lineEnd.x - 5, y: lineEnd.y },
        targetPosition: { x: lineEnd.x + dragPX, y: lineEnd.y + dragPX },
      })
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

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
    |> tangentialArcTo([24.95, -5.38], %)
    |> line([2.65, -2.69], %)
    |> close(%)
    |> extrude(5, %)`)
    }
  )

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], %)
    |> close(%)
    |> revolve({ axis: "X",}, %)`
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

    const dragPX = 30

    await page.getByText('startProfileAt([4.61, -14.01], %)').click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(400)
    let prevContent = await page.locator('.cm-content').innerText()

    const step5 = { steps: 5 }

    await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

    // drag startProfieAt handle
    await page.mouse.move(startPX[0], startPX[1])
    await page.mouse.down()
    await page.mouse.move(startPX[0] + dragPX, startPX[1] - dragPX, step5)
    await page.mouse.up()

    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag line handle
    await page.waitForTimeout(100)

    const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
    await page.mouse.move(lineEnd.x - 5, lineEnd.y)
    await page.mouse.down()
    await page.mouse.move(lineEnd.x + dragPX, lineEnd.y - dragPX, step5)
    await page.mouse.up()
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag tangentialArcTo handle
    const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
    await page.mouse.move(tangentEnd.x, tangentEnd.y - 5)
    await page.mouse.down()
    await page.mouse.move(tangentEnd.x + dragPX, tangentEnd.y - dragPX, step5)
    await page.mouse.up()
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([6.44, -12.07], %)
    |> line([14.72, 1.97], %)
    |> tangentialArcTo([24.95, -5.38], %)
    |> line([1.97, 2.06], %)
    |> close(%)
    |> revolve({ axis: "X" }, %)`)
  })
  test('Can add multiple sketches', async ({ page }) => {
    test.skip(process.platform === 'darwin', 'Can add multiple sketches')
    const u = await getUtils(page)
    const viewportSize = { width: 1200, height: 500 }
    await page.setViewportSize(viewportSize)

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    const { toSU, click00r } = getMovementUtils({ center, page })

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    let codeStr = "const sketch001 = startSketchOn('XY')"

    await page.mouse.click(center.x, viewportSize.height * 0.55)
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()
    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

    await click00r(0, 0)
    codeStr += `  |> startProfileAt(${toSU([0, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(50, 0)
    await page.waitForTimeout(100)
    codeStr += `  |> line(${toSU([50, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 50)
    codeStr += `  |> line(${toSU([0, 50])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-50, 0)
    codeStr += `  |> line(${toSU([-50, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    // exit the sketch, reset relative clicker
    click00r(undefined, undefined)
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await page.waitForTimeout(250)
    await u.clearCommandLogs()

    // start a new sketch
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // when exiting the sketch above the camera is still looking down at XY,
    // so selecting the plane again is a bit easier.
    await page.mouse.click(center.x + 200, center.y + 100)
    await page.waitForTimeout(600) // TODO detect animation ending, or disable animation
    codeStr += "const sketch002 = startSketchOn('XY')"
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()

    await click00r(30, 0)
    codeStr += `  |> startProfileAt([1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(30, 0)
    codeStr += `  |> line([1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 30)
    codeStr += `  |> line([0, -1.53], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-30, 0)
    codeStr += `  |> line([-1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(undefined, undefined)
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.updateCamPosition([100, 100, 100])
    await u.clearCommandLogs()
  })
  test.describe('Snap to close works (at any scale)', () => {
    const doSnapAtDifferentScales = async (
      page: any,
      camPos: [number, number, number],
      scale = 1
    ) => {
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()
      await u.openDebugPanel()

      const code = `const sketch001 = startSketchOn('-XZ')
    |> startProfileAt([${roundOff(scale * 69.6)}, ${roundOff(scale * 34.8)}], %)
    |> line([${roundOff(scale * 139.19)}, 0], %)
    |> line([0, -${roundOff(scale * 139.2)}], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeVisible()

      await u.clearCommandLogs()
      await page.getByRole('button', { name: 'Start Sketch' }).click()
      await page.waitForTimeout(100)

      await u.openAndClearDebugPanel()
      await u.updateCamPosition(camPos)
      await u.closeDebugPanel()

      await page.mouse.move(0, 0)

      // select a plane
      await page.mouse.move(700, 200, { steps: 10 })
      await page.mouse.click(700, 200, { delay: 200 })
      await expect(page.locator('.cm-content')).toHaveText(
        `const sketch001 = startSketchOn('-XZ')`
      )

      let prevContent = await page.locator('.cm-content').innerText()

      const pointA = [700, 200]
      const pointB = [900, 200]
      const pointC = [900, 400]

      // draw three lines
      await page.waitForTimeout(500)
      await page.mouse.move(pointA[0], pointA[1], { steps: 10 })
      await page.mouse.click(pointA[0], pointA[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointB[0], pointB[1], { steps: 10 })
      await page.mouse.click(pointB[0], pointB[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointC[0], pointC[1], { steps: 10 })
      await page.mouse.click(pointC[0], pointC[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointA[0] - 12, pointA[1] + 12, { steps: 10 })
      const pointNotQuiteA = [pointA[0] - 7, pointA[1] + 7]
      await page.mouse.move(pointNotQuiteA[0], pointNotQuiteA[1], { steps: 10 })

      await page.mouse.click(pointNotQuiteA[0], pointNotQuiteA[1], {
        delay: 200,
      })
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await expect(page.locator('.cm-content')).toHaveText(code)
      // Assert the tool was unequipped
      await expect(
        page.getByRole('button', { name: 'Line' })
      ).not.toHaveAttribute('aria-pressed', 'true')

      // exit sketch
      await u.openAndClearDebugPanel()
      await page.getByRole('button', { name: 'Exit Sketch' }).click()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.removeCurrentCode()
    }
    test('[0, 100, 100]', async ({ page }) => {
      await doSnapAtDifferentScales(page, [0, 100, 100], 0.01)
    })

    test('[0, 10000, 10000]', async ({ page }) => {
      await doSnapAtDifferentScales(page, [0, 10000, 10000])
    })
  })
  test("Existing sketch with bad code delete user's code", async ({ page }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
`
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await page.mouse.click(622, 355)

    await page.waitForTimeout(800)
    await page.getByText(`END')`).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  |>', { delay: 100 })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    await expect((await u.codeLocator.innerText()).replace(/\s/g, '')).toBe(
      `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
const sketch002 = startSketchOn(extrude001, 'END')
  |>
`.replace(/\s/g, '')
    )
  })
})

test.describe('Testing constraints', () => {
  test('Can constrain line length', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> xLine(-20, %)
  `
      )
    })

    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Click the line of code for line.
    await page.getByText(`line([0, 20], %)`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
    await page.waitForTimeout(100)

    // enter sketch again
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(500) // wait for animation

    const startXPx = 500
    await page.mouse.move(startXPx + PUR * 15, 250 - PUR * 10)
    await page.keyboard.down('Shift')
    await page.mouse.click(834, 244)
    await page.keyboard.up('Shift')

    await page.getByRole('button', { name: 'Constraints', exact: true }).click()
    await page.getByRole('button', { name: 'length', exact: true }).click()
    await page.getByText('Add constraining value').click()

    await expect(page.locator('.cm-content')).toHaveText(
      `const length001 = 20const sketch001 = startSketchOn('XY')  |> startProfileAt([-10, -10], %)  |> line([20, 0], %)  |> angledLine([90, length001], %)  |> xLine(-20, %)`
    )

    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()

    await page.waitForTimeout(500) // wait for animation

    // Exit sketch
    await page.mouse.move(startXPx + PUR * 15, 250 - PUR * 10)
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
  })
  test(`Test remove constraints`, async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const yo = 79
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %, $seg01)
  |> line([78.92, -120.11], %)
  |> angledLine([segAng(seg01, %), yo], %)
  |> line([41.19, 28.97 + 5], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
      )
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await page.getByText('line([74.36, 130.4], %, $seg01)').click()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    const line3 = await u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`)

    await page.mouse.click(line3.x, line3.y)
    await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
    await page
      .getByRole('button', {
        name: 'Constraints',
      })
      .click()
    await page
      .getByRole('button', { name: 'remove constraints', exact: true })
      .click()

    await page.getByText('line([39.13, 68.63], %)').click()
    const activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent).toHaveLength(1)
    await expect(activeLinesContent[0]).toHaveText('|> line([39.13, 68.63], %)')

    // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
    await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
  })
  test.describe('Test perpendicular distance constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        offset: '-offset001',
      },
      {
        testName: 'No variable',
        offset: '-128.05',
      },
    ] as const
    for (const { testName, offset } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %, $seg01)
  |> line([78.92, -120.11], %)
  |> angledLine([segAng(seg01, %), 78.33], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %, $seg01)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Constraints',
          })
          .click()
        await page
          .getByRole('button', { name: 'perpendicular distance', exact: true })
          .click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        const addVariable = testName === 'Add variable'
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // Wait for the codemod to take effect
        await expect(page.locator('.cm-content')).toContainText(`angle: -57,`)
        await expect(page.locator('.cm-content')).toContainText(
          `offset: ${offset},`
        )

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent[0]).toHaveText(
          `|> line([74.36, 130.4], %, $seg01)`
        )
        await expect(activeLinesContent[1]).toHaveText(`}, %)`)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test distance between constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        constraint: 'horizontal distance',
        value: 'segEndX(seg01, %) + xDis001, 61.34',
      },
      {
        testName: 'No variable',
        constraint: 'horizontal distance',
        value: 'segEndX(seg01, %) + 88.08, 61.34',
      },
      {
        testName: 'Add variable',
        constraint: 'vertical distance',
        value: '154.9, segEndY(seg01, %) - yDis001',
      },
      {
        testName: 'No variable',
        constraint: 'vertical distance',
        value: '154.9, segEndY(seg01, %) - 42.32',
      },
    ] as const
    for (const { testName, value, constraint } of cases) {
      test(`${constraint} - ${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Constraints',
          })
          .click()
        await page
          .getByRole('button', { name: constraint, exact: true })
          .click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        const addVariable = testName === 'Add variable'
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [
          `|> line([74.36, 130.4], %, $seg01)`,
          `|> lineTo([${value}], %)`,
        ]

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test ABS distance constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'ABS X',
        value: 'xDis001, 61.34',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'ABS X',
        value: '154.9, 61.34',
      },
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'ABS Y',
        value: '154.9, yDis001',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'ABS Y',
        value: '154.9, 61.34',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${constraint} - ${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        if (constraint === 'ABS X') {
          await page.mouse.click(600, 130)
        } else {
          await page.mouse.click(900, 250)
        }
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Constraints',
          })
          .click()
        await page
          .getByRole('button', { name: constraint, exact: true })
          .click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [`|> lineTo([${value}], %)`]

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test Angle constraint double segment selection', () => {
    const cases = [
      {
        testName: 'Add variable',
        addVariable: true,
        axisSelect: false,
        value: 'segAng(seg01, %) + angle001',
      },
      {
        testName: 'No variable',
        addVariable: false,
        axisSelect: false,
        value: 'segAng(seg01, %) + 22.69',
      },
      {
        testName: 'Add variable, selecting axis',
        addVariable: true,
        axisSelect: true,
        value: 'QUARTER_TURN - angle001',
      },
      {
        testName: 'No variable, selecting axis',
        addVariable: false,
        axisSelect: true,
        value: 'QUARTER_TURN - 7',
      },
    ] as const
    for (const { testName, addVariable, value, axisSelect } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        if (axisSelect) {
          await page.mouse.click(600, 130)
        } else {
          await page.mouse.click(line1.x, line1.y)
        }
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Constraints',
          })
          .click()
        await page.getByTestId('angle').click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [
          '|> line([74.36, 130.4], %, $seg01)',
          `|> angledLine([${value}, 78.33], %)`,
        ]
        if (axisSelect) codeAfter.shift()

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test Angle/Length constraint single selection', () => {
    const cases = [
      {
        testName: 'Angle - Add variable',
        addVariable: true,
        constraint: 'angle',
        value: 'angle001, 78.33',
      },
      {
        testName: 'Angle - No variable',
        addVariable: false,
        constraint: 'angle',
        value: '83, 78.33',
      },
      {
        testName: 'Length - Add variable',
        addVariable: true,
        constraint: 'length',
        value: '83, length001',
      },
      {
        testName: 'Length - No variable',
        addVariable: false,
        constraint: 'length',
        value: '83, 78.33',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${2}"]`
        )

        await page.mouse.click(line3.x, line3.y)
        await page
          .getByRole('button', {
            name: 'Constraints',
          })
          .click()
        await page.getByTestId(constraint).click()

        if (!addVariable) {
          await page.getByTestId('create-new-variable-checkbox').click()
        }
        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        const changedCode = `|> angledLine([${value}], %)`
        await expect(page.locator('.cm-content')).toContainText(changedCode)
        // checking active assures the cursor is where it should be
        await expect(page.locator('.cm-activeLine')).toHaveText(changedCode)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Many segments - no modal constraints', () => {
    const cases = [
      {
        constraintName: 'Vertical',
        codeAfter: [
          `|> yLine(130.4, %)`,
          `|> yLine(77.79, %)`,
          `|> yLine(28.97, %)`,
        ],
      },
      {
        codeAfter: [
          `|> xLine(74.36, %)`,
          `|> xLine(9.16, %)`,
          `|> xLine(41.19, %)`,
        ],
        constraintName: 'Horizontal',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async (customCode) => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([41.19, 28.97], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line1 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${0}"]`
        )
        const line3 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${2}"]`
        )
        const line4 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${3}"]`
        )

        // select two segments by holding down shift
        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.mouse.click(line4.x, line4.y)
        await page.keyboard.up('Shift')

        // check actives lines
        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent).toHaveLength(codeAfter.length)

        const constraintMenuButton = page.getByRole('button', {
          name: 'Constraints',
        })
        const constraintButton = page
          .getByRole('button', {
            name: constraintName,
          })
          .first()

        // apply the constraint
        await constraintMenuButton.click()
        await constraintButton.click({ delay: 200 })

        // check there are still 3 cursors (they should stay on the same lines as before constraint was applied)
        await expect(page.locator('.cm-cursor')).toHaveCount(codeAfter.length)

        // check both cursors are where they should be after constraint is applied and the code is correct
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )
      })
    }
  })
  test.describe('Two segment - no modal constraints', () => {
    const cases = [
      {
        codeAfter: `|> angledLine([83, segLen(seg01, %)], %)`,
        constraintName: 'Equal Length',
      },
      {
        codeAfter: `|> angledLine([segAng(seg01, %), 78.33], %)`,
        constraintName: 'Parallel',
      },
      {
        codeAfter: `|> lineTo([segEndX(seg01, %), 61.34], %)`,
        constraintName: 'Vertically Align',
      },
      {
        codeAfter: `|> lineTo([154.9, segEndY(seg01, %)], %)`,
        constraintName: 'Horizontally Align',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line1 = await u.getBoundingBox(`[data-overlay-index="${0}"]`)
        const line3 = await u.getBoundingBox(`[data-overlay-index="${2}"]`)

        // select two segments by holding down shift
        await page.mouse.click(line1.x - 20, line1.y + 20)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x - 3, line3.y + 20)
        await page.keyboard.up('Shift')
        const constraintMenuButton = page.getByRole('button', {
          name: 'Constraints',
        })
        const constraintButton = page.getByRole('button', {
          name: constraintName,
        })

        // apply the constraint
        await constraintMenuButton.click()
        await constraintButton.click()

        await expect(page.locator('.cm-content')).toContainText(codeAfter)
        // expect the string 'seg01' to appear twice in '.cm-content' the tag segment and referencing the tag
        const content = await page.locator('.cm-content').innerText()
        await expect(content.match(/seg01/g)).toHaveLength(2)
        // check there are still 2 cursors (they should stay on the same lines as before constraint was applied)
        await expect(page.locator('.cm-cursor')).toHaveCount(2)
        // check actives lines
        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent).toHaveLength(2)

        // check both cursors are where they should be after constraint is applied
        await expect(activeLinesContent[0]).toHaveText(
          '|> line([74.36, 130.4], %, $seg01)'
        )
        await expect(activeLinesContent[1]).toHaveText(codeAfter)
      })
    }
  })
  test.describe('Axis & segment - no modal constraints', () => {
    const cases = [
      {
        codeAfter: `|> lineTo([154.9, ZERO], %)`,
        axisClick: { x: 950, y: 250 },
        constraintName: 'Snap To X',
      },
      {
        codeAfter: `|> lineTo([ZERO, 61.34], %)`,
        axisClick: { x: 600, y: 150 },
        constraintName: 'Snap To Y',
      },
    ] as const
    for (const { codeAfter, constraintName, axisClick } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `const yo = 5
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
const part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what, %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getBoundingBox(`[data-overlay-index="${2}"]`)

        // select segment and axis by holding down shift
        await page.mouse.click(line3.x - 3, line3.y + 20)
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await page.mouse.click(axisClick.x, axisClick.y)
        await page.keyboard.up('Shift')
        const constraintMenuButton = page.getByRole('button', {
          name: 'Constraints',
        })
        const constraintButton = page.getByRole('button', {
          name: constraintName,
        })

        // apply the constraint
        await constraintMenuButton.click()
        await expect(constraintButton).toBeVisible()
        await constraintButton.click()

        // check the cursor is where is should be after constraint is applied
        await expect(page.locator('.cm-content')).toContainText(codeAfter)
        await expect(page.locator('.cm-activeLine')).toHaveText(codeAfter)
      })
    }
  })

  test('Horizontally constrained line remains selected after applying constraint', async ({
    page,
  }) => {
    test.setTimeout(70_000)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-1.05, -1.07], %)
  |> line([3.79, 2.68], %, $seg01)
  |> line([3.13, -2.4], %)`
      )
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await page.getByText('line([3.79, 2.68], %, $seg01)').click()
    await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeEnabled(
      { timeout: 10_000 }
    )
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    await page.waitForTimeout(100)
    const lineBefore = await u.getSegmentBodyCoords(
      `[data-overlay-index="1"]`,
      0
    )
    expect(
      await u.getGreatestPixDiff(lineBefore, TEST_COLORS.WHITE)
    ).toBeLessThan(3)
    await page.mouse.move(lineBefore.x, lineBefore.y)
    await page.waitForTimeout(50)
    await page.mouse.click(lineBefore.x, lineBefore.y)
    expect(
      await u.getGreatestPixDiff(lineBefore, TEST_COLORS.BLUE)
    ).toBeLessThan(3)

    await page
      .getByRole('button', {
        name: 'Constraints',
      })
      .click()
    await page.getByRole('button', { name: 'horizontal', exact: true }).click()

    let activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent[0]).toHaveText(`|> xLine(3.13, %)`)

    // If the overlay-angle is updated the THREE.js scene is in a good state
    await expect(
      await page.locator('[data-overlay-index="1"]')
    ).toHaveAttribute('data-overlay-angle', '0')

    const lineAfter = await u.getSegmentBodyCoords(
      `[data-overlay-index="1"]`,
      0
    )
    expect(
      await u.getGreatestPixDiff(lineAfter, TEST_COLORS.BLUE)
    ).toBeLessThan(3)

    await page.waitForTimeout(300)
    await page
      .getByRole('button', {
        name: 'Constraints',
      })
      .click()
    // await expect(page.getByRole('button', { name: 'length', exact: true })).toBeVisible()
    await page.waitForTimeout(200)
    // await page.getByRole('button', { name: 'length', exact: true }).click()
    await page.locator('[data-testid="length"]').click()

    await page.getByLabel('length Value').fill('10')
    await page.getByRole('button', { name: 'Add constraining value' }).click()

    activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent[0]).toHaveText(`|> xLine(length001, %)`)

    // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
    await expect(page.getByTestId('segment-overlay')).toHaveCount(2)
  })
})

test.describe('Testing segment overlays', () => {
  test.describe('Hover over a segment should show its overlay, hovering over the input overlays should show its popover, clicking the input overlay should constrain/unconstrain it:\nfor the following segments', () => {
    /**
     * Clicks on an constrained element
     * @param {Page} page - The page to perform the action on
     * @param {Object} options - The options for the action
     * @param {Object} options.hoverPos - The position to hover over
     * @param {Object} options.constraintType - The type of constraint
     * @param {number} options.ang - The angle
     * @param {number} options.steps - The number of steps to perform
     */
    const _clickConstrained =
      (page: Page) =>
      async ({
        hoverPos,
        constraintType,
        expectBeforeUnconstrained,
        expectAfterUnconstrained,
        expectFinal,
        ang = 45,
        steps = 10,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        constraintType:
          | 'horizontal'
          | 'vertical'
          | 'tangentialWithPrevious'
          | LineInputsType
        expectBeforeUnconstrained: string
        expectAfterUnconstrained: string
        expectFinal: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        await expect(page.locator('.cm-content')).toContainText(
          expectBeforeUnconstrained
        )
        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await expect(page.locator('.cm-content')).toContainText(
          expectAfterUnconstrained
        )

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await expect(unconstrainedLocator).toBeVisible()
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await page.getByText('Add variable').click()
        await expect(page.locator('.cm-content')).toContainText(expectFinal)
      }

    /**
     * Clicks on an unconstrained element
     * @param {Page} page - The page to perform the action on
     * @param {Object} options - The options for the action
     * @param {Object} options.hoverPos - The position to hover over
     * @param {Object} options.constraintType - The type of constraint
     * @param {number} options.ang - The angle
     * @param {number} options.steps - The number of steps to perform
     */
    const _clickUnconstrained =
      (page: Page) =>
      async ({
        hoverPos,
        constraintType,
        expectBeforeUnconstrained,
        expectAfterUnconstrained,
        expectFinal,
        ang = 45,
        steps = 5,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        constraintType:
          | 'horizontal'
          | 'vertical'
          | 'tangentialWithPrevious'
          | LineInputsType
        expectBeforeUnconstrained: string
        expectAfterUnconstrained: string
        expectFinal: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        await expect(page.getByText('Added variable')).not.toBeVisible()
        await expect(page.locator('.cm-content')).toContainText(
          expectBeforeUnconstrained
        )
        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await expect(unconstrainedLocator).toBeVisible()
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await page.getByText('Add variable').click()
        await expect(page.locator('.cm-content')).toContainText(
          expectAfterUnconstrained
        )
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await expect(page.locator('.cm-content')).toContainText(expectFinal)
      }
    test.setTimeout(120000)
    test('for segments [line, angledLine, lineTo, xLineTo]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([5 + 0, 20 + 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([5 + 33, 20 + 11.5 + 0], %)
    |> xLineTo(5 + 9 - 5, %)
    |> yLineTo(20 + -10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 5 + 26 }, %)
    |> angledLineToY({ angle: 89, to: 20 + 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([5 + 3.14 + 13, 20 + 3.14], %)
        `
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(5 + 9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      await u.openAndClearDebugPanel()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: { x: 80, y: -1350, z: 510 },
          center: { x: 80, y: 0, z: 510 },
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
      await u.closeDebugPanel()

      let ang = 0

      const line = await u.getBoundingBox(`[data-overlay-index="${0}"]`)
      ang = await u.getAngle(`[data-overlay-index="${0}"]`)
      console.log('line1', line, ang)
      await clickConstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: '|> line([0.5, -14 + 0], %)',
        expectAfterUnconstrained: '|> line([0.5, -14], %)',
        expectFinal: '|> line([0.5, yRel001], %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('line2')
      await clickUnconstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: '|> line([0.5, yRel001], %)',
        expectAfterUnconstrained: 'line([xRel001, yRel001], %)',
        expectFinal: '|> line([0.5, yRel001], %)',
        ang: ang + 180,
        locator: '[data-overlay-index="0"]',
      })

      const angledLine = await u.getBoundingBox(`[data-overlay-index="1"]`)
      ang = await u.getAngle(`[data-overlay-index="1"]`)
      console.log('angledLine1')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLine({ angle: 3 + 0, length: 32 + 0 }, %)',
        expectAfterUnconstrained: 'angledLine({ angle: 3, length: 32 + 0 }, %)',
        expectFinal: 'angledLine({ angle: angle001, length: 32 + 0 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })
      console.log('angledLine2')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'length',
        expectBeforeUnconstrained:
          'angledLine({ angle: angle001, length: 32 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLine({ angle: angle001, length: 32 }, %)',
        expectFinal: 'angledLine({ angle: angle001, length: len001 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let lineTo = await u.getBoundingBox(`[data-overlay-index="2"]`)
      ang = await u.getAngle(`[data-overlay-index="2"]`)
      console.log('lineTo1')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'lineTo([5 + 33, 20 + 11.5 + 0], %)',
        expectAfterUnconstrained: 'lineTo([5 + 33, 31.5], %)',
        expectFinal: 'lineTo([5 + 33, yAbs001], %)',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })
      console.log('lineTo2')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'lineTo([5 + 33, yAbs001], %)',
        expectAfterUnconstrained: 'lineTo([38, yAbs001], %)',
        expectFinal: 'lineTo([xAbs001, yAbs001], %)',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })

      const xLineTo = await u.getBoundingBox(`[data-overlay-index="3"]`)
      ang = await u.getAngle(`[data-overlay-index="3"]`)
      console.log('xlineTo1')
      await clickConstrained({
        hoverPos: { x: xLineTo.x, y: xLineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'xLineTo(5 + 9 - 5, %)',
        expectAfterUnconstrained: 'xLineTo(9, %)',
        expectFinal: 'xLineTo(xAbs002, %)',
        ang: ang + 180,
        steps: 8,
        locator: '[data-overlay-toolbar-index="3"]',
      })
    })
    test('for segments [yLineTo, xLine]', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const yRel001 = -14
const xRel001 = 0.5
const angle001 = 3
const len001 = 32
const yAbs001 = 11.5
const xAbs001 = 33
const xAbs002 = 4
const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0.5, yRel001], %)
  |> angledLine({ angle: angle001, length: len001 }, %)
  |> lineTo([33, yAbs001], %)
  |> xLineTo(xAbs002, %)
  |> yLineTo(-10.77, %, $a)
  |> xLine(26.04, %)
  |> yLine(21.14 + 0, %)
  |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
        `
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLine(26.04, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(8)

      const clickUnconstrained = _clickUnconstrained(page)

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let ang = 0

      const yLineTo = await u.getBoundingBox(`[data-overlay-index="4"]`)
      ang = await u.getAngle(`[data-overlay-index="4"]`)
      console.log('ylineTo1')
      await clickUnconstrained({
        hoverPos: { x: yLineTo.x, y: yLineTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'yLineTo(-10.77, %, $a)',
        expectAfterUnconstrained: 'yLineTo(yAbs002, %, $a)',
        expectFinal: 'yLineTo(-10.77, %, $a)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="4"]',
      })

      const xLine = await u.getBoundingBox(`[data-overlay-index="5"]`)
      ang = await u.getAngle(`[data-overlay-index="5"]`)
      console.log('xline')
      await clickUnconstrained({
        hoverPos: { x: xLine.x, y: xLine.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: 'xLine(26.04, %)',
        expectAfterUnconstrained: 'xLine(xRel002, %)',
        expectFinal: 'xLine(26.04, %)',
        steps: 10,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="5"]',
      })
    })
    test('for segments [yLine, angledLineOfXLength, angledLineOfYLength]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, 3.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()
      await page.waitForTimeout(500)

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      let ang = 0

      const yLine = await u.getBoundingBox(`[data-overlay-index="6"]`)
      ang = await u.getAngle(`[data-overlay-index="6"]`)
      console.log('yline1')
      await clickConstrained({
        hoverPos: { x: yLine.x, y: yLine.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: 'yLine(21.14 + 0, %)',
        expectAfterUnconstrained: 'yLine(21.14, %)',
        expectFinal: 'yLine(yRel001, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="6"]',
      })

      const angledLineOfXLength = await u.getBoundingBox(
        `[data-overlay-index="7"]`
      )
      ang = await u.getAngle(`[data-overlay-index="7"]`)
      console.log('angledLineOfXLength1')
      await clickConstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)',
        expectAfterUnconstrained:
          'angledLineOfXLength({ angle: -179, length: 23.14 }, %)',
        expectFinal:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })
      console.log('angledLineOfXLength2')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        expectAfterUnconstrained:
          'angledLineOfXLength({ angle: angle001, length: xRel001 }, %)',
        expectFinal:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        steps: 7,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })

      const angledLineOfYLength = await u.getBoundingBox(
        `[data-overlay-index="8"]`
      )
      ang = await u.getAngle(`[data-overlay-index="8"]`)
      console.log('angledLineOfYLength1')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineOfYLength({ angle: angle002, length: 19 + 0 }, %)',
        expectFinal: 'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="8"]',
      })
      console.log('angledLineOfYLength2')
      await clickConstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 }, %)',
        expectFinal: 'angledLineOfYLength({ angle: -91, length: yRel002 }, %)',
        ang: ang + 180,
        steps: 7,
        locator: '[data-overlay-toolbar-index="8"]',
      })
    })
    test('for segments [angledLineToX, angledLineToY, angledLineThatIntersects]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, 1.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      let ang = 0

      const angledLineToX = await u.getBoundingBox(`[data-overlay-index="9"]`)
      ang = await u.getAngle(`[data-overlay-index="9"]`)
      console.log('angledLineToX')
      await clickConstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'angle',
        expectBeforeUnconstrained: 'angledLineToX({ angle: 3 + 0, to: 26 }, %)',
        expectAfterUnconstrained: 'angledLineToX({ angle: 3, to: 26 }, %)',
        expectFinal: 'angledLineToX({ angle: angle001, to: 26 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })
      console.log('angledLineToX2')
      await clickUnconstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained:
          'angledLineToX({ angle: angle001, to: 26 }, %)',
        expectAfterUnconstrained:
          'angledLineToX({ angle: angle001, to: xAbs001 }, %)',
        expectFinal: 'angledLineToX({ angle: angle001, to: 26 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })

      const angledLineToY = await u.getBoundingBox(`[data-overlay-index="10"]`)
      ang = await u.getAngle(`[data-overlay-index="10"]`)
      console.log('angledLineToY')
      await clickUnconstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineToY({ angle: angle002, to: 9.14 + 0 }, %)',
        expectFinal: 'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        steps: process.platform === 'darwin' ? 8 : 9,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })
      console.log('angledLineToY2')
      await clickConstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        expectAfterUnconstrained: 'angledLineToY({ angle: 89, to: 9.14 }, %)',
        expectFinal: 'angledLineToY({ angle: 89, to: yAbs001 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })

      const angledLineThatIntersects = await u.getBoundingBox(
        `[data-overlay-index="11"]`
      )
      ang = await u.getAngle(`[data-overlay-index="11"]`)
      console.log('angledLineThatIntersects')
      await clickUnconstrained({
        hoverPos: {
          x: angledLineThatIntersects.x,
          y: angledLineThatIntersects.y,
        },
        constraintType: 'angle',
        expectBeforeUnconstrained: `angledLineThatIntersects({
      angle: 4.14,
      intersectTag: a,
      offset: 9
    }, %)`,
        expectAfterUnconstrained: `angledLineThatIntersects({
      angle: angle003,
      intersectTag: a,
      offset: 9
    }, %)`,
        expectFinal: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="11"]',
      })
      console.log('angledLineThatIntersects2')
      await clickUnconstrained({
        hoverPos: {
          x: angledLineThatIntersects.x,
          y: angledLineThatIntersects.y,
        },
        constraintType: 'intersectionOffset',
        expectBeforeUnconstrained: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
        expectAfterUnconstrained: `angledLineThatIntersects({
      angle: -176,
      offset: perpDist001,
      intersectTag: a
    }, %)`,
        expectFinal: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="11"]',
      })
    })
    test('for segment [tangentialArcTo]', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, -3.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      const tangentialArcTo = await u.getBoundingBox(
        '[data-overlay-index="12"]'
      )
      let ang = await u.getAngle('[data-overlay-index="12"]')
      console.log('tangentialArcTo')
      await clickConstrained({
        hoverPos: { x: tangentialArcTo.x, y: tangentialArcTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'tangentialArcTo([3.14 + 13, -3.14], %)',
        expectAfterUnconstrained: 'tangentialArcTo([16.14, -3.14], %)',
        expectFinal: 'tangentialArcTo([xAbs001, -3.14], %)',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="12"]',
      })
      console.log('tangentialArcTo2')
      await clickUnconstrained({
        hoverPos: { x: tangentialArcTo.x, y: tangentialArcTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'tangentialArcTo([xAbs001, -3.14], %)',
        expectAfterUnconstrained: 'tangentialArcTo([xAbs001, yAbs001], %)',
        expectFinal: 'tangentialArcTo([xAbs001, -3.14], %)',
        ang: ang + 180,
        steps: 10,
        locator: '[data-overlay-toolbar-index="12"]',
      })
    })
  })
  test.describe('Testing deleting a segment', () => {
    const _deleteSegmentSequence =
      (page: Page) =>
      async ({
        hoverPos,
        codeToBeDeleted,
        stdLibFnName,
        ang = 45,
        steps = 6,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        codeToBeDeleted: string
        stdLibFnName: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        await expect(page.locator('.cm-content')).toContainText(codeToBeDeleted)

        await page.locator(`[data-stdlib-fn-name="${stdLibFnName}"]`).click()
        await page.getByText('Delete Segment').click()

        await expect(page.locator('.cm-content')).not.toContainText(
          codeToBeDeleted
        )
      }
    test('all segment types', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0.5, -14 + 0], %)
  |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
  |> lineTo([33, 11.5 + 0], %)
  |> xLineTo(9 - 5, %)
  |> yLineTo(-10.77, %, $a)
  |> xLine(26.04, %)
  |> yLine(21.14 + 0, %)
  |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
  |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
  |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
  |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
  |> angledLineThatIntersects({
       angle: 4.14,
       intersectTag: a,
       offset: 9
     }, %)
  |> tangentialArcTo([3.14 + 13, 1.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)
      const deleteSegmentSequence = _deleteSegmentSequence(page)

      let segmentToDelete

      const getOverlayByIndex = (index: number) =>
        u.getBoundingBox(`[data-overlay-index="${index}"]`)
      segmentToDelete = await getOverlayByIndex(12)
      let ang = await u.getAngle(`[data-overlay-index="${12}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'tangentialArcTo([3.14 + 13, 1.14], %)',
        stdLibFnName: 'tangentialArcTo',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="12"]',
      })

      segmentToDelete = await getOverlayByIndex(11)
      ang = await u.getAngle(`[data-overlay-index="${11}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: `angledLineThatIntersects({
      angle: 4.14,
      intersectTag: a,
      offset: 9
    }, %)`,
        stdLibFnName: 'angledLineThatIntersects',
        ang: ang + 180,
        steps: 7,
        locator: '[data-overlay-toolbar-index="11"]',
      })

      segmentToDelete = await getOverlayByIndex(10)
      ang = await u.getAngle(`[data-overlay-index="${10}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        stdLibFnName: 'angledLineToY',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })

      segmentToDelete = await getOverlayByIndex(9)
      ang = await u.getAngle(`[data-overlay-index="${9}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLineToX({ angle: 3 + 0, to: 26 }, %)',
        stdLibFnName: 'angledLineToX',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })

      segmentToDelete = await getOverlayByIndex(8)
      ang = await u.getAngle(`[data-overlay-index="${8}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        stdLibFnName: 'angledLineOfYLength',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="8"]',
      })

      segmentToDelete = await getOverlayByIndex(7)
      ang = await u.getAngle(`[data-overlay-index="${7}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted:
          'angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)',
        stdLibFnName: 'angledLineOfXLength',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })

      segmentToDelete = await getOverlayByIndex(6)
      ang = await u.getAngle(`[data-overlay-index="${6}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLine(21.14 + 0, %)',
        stdLibFnName: 'yLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="6"]',
      })

      segmentToDelete = await getOverlayByIndex(5)
      ang = await u.getAngle(`[data-overlay-index="${5}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLine(26.04, %)',
        stdLibFnName: 'xLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="5"]',
      })

      segmentToDelete = await getOverlayByIndex(4)
      ang = await u.getAngle(`[data-overlay-index="${4}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLineTo(-10.77, %, $a)',
        stdLibFnName: 'yLineTo',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="4"]',
      })

      segmentToDelete = await getOverlayByIndex(3)
      ang = await u.getAngle(`[data-overlay-index="${3}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLineTo(9 - 5, %)',
        stdLibFnName: 'xLineTo',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="3"]',
      })

      segmentToDelete = await getOverlayByIndex(2)
      ang = await u.getAngle(`[data-overlay-index="${2}"]`)
      await expect(page.getByText('Added variable')).not.toBeVisible()

      const hoverPos = { x: segmentToDelete.x, y: segmentToDelete.y }
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
      let x = 0,
        y = 0
      x = hoverPos.x + Math.cos(ang * deg) * 32
      y = hoverPos.y - Math.sin(ang * deg) * 32
      await page.mouse.move(hoverPos.x, hoverPos.y)
      await wiggleMove(
        page,
        hoverPos.x,
        hoverPos.y,
        20,
        30,
        ang,
        10,
        5,
        '[data-overlay-toolbar-index="2"]'
      )

      const codeToBeDeleted = 'lineTo([33, 11.5 + 0], %)'
      await expect(page.locator('.cm-content')).toContainText(codeToBeDeleted)

      await page.getByTestId('overlay-menu').click()
      await page.getByText('Delete Segment').click()

      await expect(page.locator('.cm-content')).not.toContainText(
        codeToBeDeleted
      )

      segmentToDelete = await getOverlayByIndex(1)
      ang = await u.getAngle(`[data-overlay-index="${1}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine({ angle: 3 + 0, length: 32 + 0 }, %)',
        stdLibFnName: 'angledLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      segmentToDelete = await getOverlayByIndex(0)
      ang = await u.getAngle(`[data-overlay-index="${0}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'line([0.5, -14 + 0], %)',
        stdLibFnName: 'line',
        ang: ang + 180,
      })

      await page.waitForTimeout(200)
    })
  })
  test.describe('Testing delete with dependent segments', () => {
    const cases = [
      'line([22, 2], %, $seg01)',
      'angledLine([5, 23.03], %, $seg01)',
      'xLine(23, %, $seg01)',
      'yLine(-8, %, $seg01)',
      'xLineTo(30, %, $seg01)',
      'yLineTo(-4, %, $seg01)',
      'angledLineOfXLength([3, 30], %, $seg01)',
      'angledLineOfXLength({ angle: 3, length: 30 }, %, $seg01)',
      'angledLineOfYLength([3, 1.5], %, $seg01)',
      'angledLineOfYLength({ angle: 3, length: 1.5 }, %, $seg01)',
      'angledLineToX([3, 30], %, $seg01)',
      'angledLineToX({ angle: 3, to: 30 }, %, $seg01)',
      'angledLineToY([3, 7], %, $seg01)',
      'angledLineToY({ angle: 3, to: 7 }, %, $seg01)',
    ]
    for (const doesHaveTagOutsideSketch of [true, false]) {
      for (const lineOfInterest of cases) {
        const isObj = lineOfInterest.includes('{ angle: 3,')
        test(`${lineOfInterest.split('(')[0]}${isObj ? '-[obj-input]' : ''}${
          doesHaveTagOutsideSketch ? '-[tagOutsideSketch]' : ''
        }`, async ({ page }) => {
          await page.addInitScript(
            async ({ lineToBeDeleted, extraLine }) => {
              localStorage.setItem(
                'persistCode',
                `const part001 = startSketchOn('XZ')
  |> startProfileAt([5, 6], %)
  |> ${lineToBeDeleted}
  |> line([-10, -15], %)
  |> angledLine([-176, segLen(seg01, %)], %)        
${extraLine ? 'const myVar = segLen(seg01, part001)' : ''}`
              )
            },
            {
              lineToBeDeleted: lineOfInterest,
              extraLine: doesHaveTagOutsideSketch,
            }
          )
          const u = await getUtils(page)
          await page.setViewportSize({ width: 1200, height: 500 })

          await u.waitForAuthSkipAppStart()
          await page.waitForTimeout(300)

          await page.getByText(lineOfInterest).click()
          await page.waitForTimeout(100)
          await page.getByRole('button', { name: 'Edit Sketch' }).click()
          await page.waitForTimeout(500)

          await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
          const segmentToDelete = await u.getBoundingBox(
            `[data-overlay-index="0"]`
          )

          const isYLine = lineOfInterest.toLowerCase().includes('yline')
          const hoverPos = {
            x: segmentToDelete.x + (isYLine ? 0 : -20),
            y: segmentToDelete.y + (isYLine ? -20 : 0),
          }
          await expect(page.getByText('Added variable')).not.toBeVisible()
          const ang = isYLine ? 45 : -45
          const [x, y] = [
            Math.cos((ang * Math.PI) / 180) * 45,
            Math.sin((ang * Math.PI) / 180) * 45,
          ]

          await page.mouse.move(hoverPos.x + x, hoverPos.y + y)
          await page.mouse.move(hoverPos.x, hoverPos.y, { steps: 5 })

          await expect(page.locator('.cm-content')).toContainText(
            lineOfInterest
          )

          await page.getByTestId('overlay-menu').click()
          await page.waitForTimeout(100)
          await page.getByText('Delete Segment').click()

          await page.getByText('Cancel').click()

          await page.mouse.move(hoverPos.x + x, hoverPos.y + y)
          await page.mouse.move(hoverPos.x, hoverPos.y, { steps: 5 })

          await expect(page.locator('.cm-content')).toContainText(
            lineOfInterest
          )

          await page.getByTestId('overlay-menu').click()
          await page.waitForTimeout(100)
          await page.getByText('Delete Segment').click()

          await page.getByText('Continue and unconstrain').last().click()

          if (doesHaveTagOutsideSketch) {
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(
              page.getByText(
                'Segment tag used outside of current Sketch. Could not delete.'
              )
            ).toBeTruthy()
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(page.locator('.cm-content')).toContainText(
              lineOfInterest
            )
          } else {
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(page.locator('.cm-content')).not.toContainText(
              lineOfInterest
            )
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(page.locator('.cm-content')).not.toContainText('seg01')
          }
        })
      }
    }
  })
  test.describe('Testing remove constraints segments', () => {
    const cases = [
      {
        before: `line([22 + 0, 2 + 0], %, $seg01)`,
        after: `line([22, 2], %, $seg01)`,
      },

      {
        before: `angledLine([5 + 0, 23.03 + 0], %, $seg01)`,
        after: `line([22.94, 2.01], %, $seg01)`,
      },
      {
        before: `xLine(23 + 0, %, $seg01)`,
        after: `line([23, 0], %, $seg01)`,
      },
      {
        before: `yLine(-8 + 0, %, $seg01)`,
        after: `line([0, -8], %, $seg01)`,
      },
      {
        before: `xLineTo(30 + 0, %, $seg01)`,
        after: `line([25, 0], %, $seg01)`,
      },
      {
        before: `yLineTo(-4 + 0, %, $seg01)`,
        after: `line([0, -10], %, $seg01)`,
      },
      {
        before: `angledLineOfXLength([3 + 0, 30 + 0], %, $seg01)`,
        after: `line([30, 1.57], %, $seg01)`,
      },
      {
        before: `angledLineOfYLength([3 + 0, 1.5 + 0], %, $seg01)`,
        after: `line([28.62, 1.5], %, $seg01)`,
      },
      {
        before: `angledLineToX([3 + 0, 30 + 0], %, $seg01)`,
        after: `line([25, 1.31], %, $seg01)`,
      },
      {
        before: `angledLineToY([3 + 0, 7 + 0], %, $seg01)`,
        after: `line([19.08, 1], %, $seg01)`,
      },
      {
        before: `angledLineOfXLength({ angle: 3 + 0, length: 30 + 0 }, %, $seg01)`,
        after: `line([30, 1.57], %, $seg01)`,
      },
      {
        before: `angledLineOfYLength({ angle: 3 + 0, length: 1.5 + 0 }, %, $seg01)`,
        after: `line([28.62, 1.5], %, $seg01)`,
      },
      {
        before: `angledLineToX({ angle: 3 + 0, to: 30 + 0 }, %, $seg01)`,
        after: `line([25, 1.31], %, $seg01)`,
      },
      {
        before: `angledLineToY({ angle: 3 + 0, to: 7 + 0 }, %, $seg01)`,
        after: `line([19.08, 1], %, $seg01)`,
      },
    ]

    for (const { before, after } of cases) {
      const isObj = before.includes('{ angle: 3')
      test(`${before.split('(')[0]}${isObj ? '-[obj-input]' : ''}`, async ({
        page,
      }) => {
        await page.addInitScript(
          async ({ lineToBeDeleted }) => {
            localStorage.setItem(
              'persistCode',
              `const part001 = startSketchOn('XZ')
  |> startProfileAt([5, 6], %)
  |> ${lineToBeDeleted}
  |> line([-10, -15], %)
  |> angledLine([-176, segLen(seg01, %)], %)`
            )
          },
          {
            lineToBeDeleted: before,
          }
        )
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()
        await page.waitForTimeout(300)

        await page.getByText(before).click()
        await page.waitForTimeout(100)
        await page.getByRole('button', { name: 'Edit Sketch' }).click()
        await page.waitForTimeout(500)

        await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
        await expect(page.getByText('Added variable')).not.toBeVisible()

        const hoverPos = await u.getBoundingBox(`[data-overlay-index="0"]`)
        let ang = await u.getAngle(`[data-overlay-index="${0}"]`)
        ang += 180

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(
          page,
          x,
          y,
          20,
          30,
          ang,
          10,
          5,
          '[data-overlay-toolbar-index="0"]'
        )

        await expect(page.locator('.cm-content')).toContainText(before)

        await page.getByTestId('overlay-menu').click()
        await page.waitForTimeout(100)
        await page.getByText('Remove constraints').click()

        await expect(page.locator('.cm-content')).toContainText(after)
        // check the cursor was left in the correct place after transform
        await expect(page.locator('.cm-activeLine')).toHaveText('|> ' + after)
        await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
      })
    }
  })
})

test.describe('Test network and connection issues', () => {
  test('simulate network down and network little widget', async ({
    page,
    browserName,
  }) => {
    // TODO: Don't skip Mac for these. After `window.tearDown` is working in Safari, these should work on webkit
    test.skip(
      browserName === 'webkit',
      'Skip on Safari until `window.tearDown` is working there'
    )
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // This is how we wait until the stream is online
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled({ timeout: 15000 })

    const networkWidget = page.locator('[data-testid="network-toggle"]')
    await expect(networkWidget).toBeVisible()
    await networkWidget.hover()

    const networkPopover = page.locator('[data-testid="network-popover"]')
    await expect(networkPopover).not.toBeVisible()

    // (First check) Expect the network to be up
    await expect(page.getByText('Network Health (Connected)')).toBeVisible()

    // Click the network widget
    await networkWidget.click()

    // Check the modal opened.
    await expect(networkPopover).toBeVisible()

    // Click off the modal.
    await page.mouse.click(100, 100)
    await expect(networkPopover).not.toBeVisible()

    // Turn off the network
    await u.emulateNetworkConditions({
      offline: true,
      // values of 0 remove any active throttling. crbug.com/456324#c9
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    // Expect the network to be down
    await expect(page.getByText('Network Health (Offline)')).toBeVisible()

    // Click the network widget
    await networkWidget.click()

    // Check the modal opened.
    await expect(networkPopover).toBeVisible()

    // Click off the modal.
    await page.mouse.click(0, 0)
    await expect(networkPopover).not.toBeVisible()

    // Turn back on the network
    await u.emulateNetworkConditions({
      offline: false,
      // values of 0 remove any active throttling. crbug.com/456324#c9
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled({ timeout: 15000 })

    // (Second check) expect the network to be up
    await expect(page.getByText('Network Health (Connected)')).toBeVisible()
  })

  test('Engine disconnect & reconnect in sketch mode', async ({
    page,
    browserName,
  }) => {
    // TODO: Don't skip Mac for these. After `window.tearDown` is working in Safari, these should work on webkit
    test.skip(
      browserName === 'webkit',
      'Skip on Safari until `window.tearDown` is working there'
    )
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled({ timeout: 15000 })

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.waitForTimeout(100)

    // select a plane
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')`
    )
    await u.closeDebugPanel()

    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

    const startXPx = 600
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)`)
    await page.waitForTimeout(100)

    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
    await page.waitForTimeout(100)

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)`)

    // Expect the network to be up
    await expect(page.getByText('Network Health (Connected)')).toBeVisible()

    // simulate network down
    await u.emulateNetworkConditions({
      offline: true,
      // values of 0 remove any active throttling. crbug.com/456324#c9
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    // Expect the network to be down
    await expect(page.getByText('Network Health (Offline)')).toBeVisible()

    // Ensure we are not in sketch mode
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // simulate network up
    await u.emulateNetworkConditions({
      offline: false,
      // values of 0 remove any active throttling. crbug.com/456324#c9
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    // Wait for the app to be ready for use
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled({ timeout: 15000 })

    // Expect the network to be up
    await expect(page.getByText('Network Health (Connected)')).toBeVisible()

    // Click off the code pane.
    await page.mouse.click(100, 100)

    // select a line
    await page.getByText(`startProfileAt(${commonPoints.startAt}, %)`).click()

    // enter sketch again
    await u.doAndWaitForCmd(
      () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
      'default_camera_get_settings'
    )
    await page.waitForTimeout(150)

    // Click the line tool
    await page.getByRole('button', { name: 'Line' }).click()

    await page.waitForTimeout(150)

    // Ensure we can continue sketching
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([-9.16, 8.81], %)`)
    await page.waitForTimeout(100)
    await page.mouse.click(startXPx, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([-9.16, 8.81], %)
    |> line([-5.28, 0], %)`)

    // Unequip line tool
    await page.keyboard.press('Escape')
    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Line' })
    ).not.toHaveAttribute('aria-pressed', 'true')

    // Exit sketch
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
  })
})

test.describe('Testing Gizmo', () => {
  const cases = [
    {
      testDescription: 'top view',
      clickPosition: { x: 951, y: 385 },
      expectedCameraPosition: { x: 800, y: -152, z: 4886.02 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'bottom view',
      clickPosition: { x: 951, y: 429 },
      expectedCameraPosition: { x: 800, y: -152, z: -4834.02 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'right view',
      clickPosition: { x: 929, y: 417 },
      expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'left view',
      clickPosition: { x: 974, y: 397 },
      expectedCameraPosition: { x: -4060.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'back view',
      clickPosition: { x: 967, y: 421 },
      expectedCameraPosition: { x: 800, y: 4708.02, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'front view',
      clickPosition: { x: 935, y: 393 },
      expectedCameraPosition: { x: 800, y: -5012.02, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
  ] as const
  for (const {
    clickPosition,
    expectedCameraPosition,
    expectedCameraTarget,
    testDescription,
  } of cases) {
    test(`check ${testDescription}`, async ({ page, browserName }) => {
      const u = await getUtils(page)
      await page.addInitScript((TEST_CODE_GIZMO) => {
        localStorage.setItem('persistCode', TEST_CODE_GIZMO)
      }, TEST_CODE_GIZMO)
      await page.setViewportSize({ width: 1000, height: 500 })

      await u.waitForAuthSkipAppStart()
      await page.waitForTimeout(100)
      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: {
            x: 3000,
            y: 3000,
            z: 3000,
          },
          center: {
            x: 800,
            y: -152,
            z: 26,
          },
          up: { x: 0, y: 0, z: 1 },
        },
      })
      await page.waitForTimeout(100)
      await u.clearCommandLogs()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await u.waitForCmdReceive('default_camera_get_settings')

      await u.clearCommandLogs()
      await page.mouse.move(clickPosition.x, clickPosition.y)
      await page.waitForTimeout(100)
      await page.mouse.click(clickPosition.x, clickPosition.y)
      await page.mouse.move(0, 0)
      await u.waitForCmdReceive('default_camera_look_at')
      await u.clearCommandLogs()

      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await u.waitForCmdReceive('default_camera_get_settings')

      await Promise.all([
        // position
        expect(page.getByTestId('cam-x-position')).toHaveValue(
          expectedCameraPosition.x.toString()
        ),
        expect(page.getByTestId('cam-y-position')).toHaveValue(
          expectedCameraPosition.y.toString()
        ),
        expect(page.getByTestId('cam-z-position')).toHaveValue(
          expectedCameraPosition.z.toString()
        ),
        // target
        expect(page.getByTestId('cam-x-target')).toHaveValue(
          expectedCameraTarget.x.toString()
        ),
        expect(page.getByTestId('cam-y-target')).toHaveValue(
          expectedCameraTarget.y.toString()
        ),
        expect(page.getByTestId('cam-z-target')).toHaveValue(
          expectedCameraTarget.z.toString()
        ),
      ])
    })
  }

  test('Context menu', async ({ page }) => {
    const testCase = {
      testDescription: 'Right view',
      expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    }

    // Test prelude taken from the above test
    const u = await getUtils(page)
    await page.addInitScript((TEST_CODE_GIZMO) => {
      localStorage.setItem('persistCode', TEST_CODE_GIZMO)
    }, TEST_CODE_GIZMO)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()
    await page.waitForTimeout(100)
    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: {
          x: 3000,
          y: 3000,
          z: 3000,
        },
        center: {
          x: 800,
          y: -152,
          z: 26,
        },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await page.waitForTimeout(100)
    await u.clearCommandLogs()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await u.waitForCmdReceive('default_camera_get_settings')

    // Now find and select the correct
    // view from the context menu
    await u.clearCommandLogs()
    const gizmo = page.locator('[aria-label*=gizmo]')
    await gizmo.click({ button: 'right' })
    const buttonToTest = page.getByRole('button', {
      name: testCase.testDescription,
    })
    await expect(buttonToTest).toBeVisible()
    await buttonToTest.click()

    // Now assert we've moved to the correct view
    // Taken from the above test
    await u.waitForCmdReceive('default_camera_look_at')

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await u.waitForCmdReceive('default_camera_get_settings')
    await page.waitForTimeout(400)

    await Promise.all([
      // position
      expect(page.getByTestId('cam-x-position')).toHaveValue(
        testCase.expectedCameraPosition.x.toString()
      ),
      expect(page.getByTestId('cam-y-position')).toHaveValue(
        testCase.expectedCameraPosition.y.toString()
      ),
      expect(page.getByTestId('cam-z-position')).toHaveValue(
        testCase.expectedCameraPosition.z.toString()
      ),
      // target
      expect(page.getByTestId('cam-x-target')).toHaveValue(
        testCase.expectedCameraTarget.x.toString()
      ),
      expect(page.getByTestId('cam-y-target')).toHaveValue(
        testCase.expectedCameraTarget.y.toString()
      ),
      expect(page.getByTestId('cam-z-target')).toHaveValue(
        testCase.expectedCameraTarget.z.toString()
      ),
    ])
  })
})

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
  |> angledLineToY([segAng(seg04, %) + 180, ZERO], %)
  |> angledLineToY({
        angle: -bottomAng,
        to: -totalHeightHalf - armThick,
      }, %, $seg02)
  |> xLineTo(segEndX(seg03, %) + 0, %)
  |> yLine(-segLen(seg01, %), %)
  |> angledLineThatIntersects({
        angle: HALF_TURN,
        offset: -armThick,
        intersectTag: seg02
      }, %)
  |> angledLineToY([segAng(seg02, %) + 180, -baseHeight], %)
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
  await page.getByRole('button', { name: 'Help', exact: false }).click()

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

  const lineButton = page.getByRole('button', { name: 'Line' })
  const arcButton = page.getByRole('button', { name: 'Tangential Arc' })

  // Test these hotkeys perform actions when
  // focus is on the canvas
  await page.mouse.move(600, 250)
  await page.mouse.click(600, 250)

  // Start a sketch
  await page.keyboard.press('s')
  await page.mouse.move(800, 300)
  await page.mouse.click(800, 300)
  await page.waitForTimeout(1000)
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
  // This test can run long if it takes a little too long to load
  // the engine.
  test.setTimeout(90000)
  // This test has a weird bug on ubuntu
  test.skip(
    process.platform === 'linux',
    'weird playwright bug on ubuntu https://github.com/KittyCAD/modeling-app/issues/2444'
  )
  // Load the app with the code pane open
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

  // Wait for the app to be ready for use
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.closeDebugPanel()

  const codePane = page.getByRole('textbox').locator('div')
  const codePaneButton = page.getByRole('tab', { name: 'KCL Code' })
  const lineButton = page.getByRole('button', { name: 'Line' })
  const arcButton = page.getByRole('button', { name: 'Tangential Arc' })
  const extrudeButton = page.getByRole('button', { name: 'Extrude' })

  // Test that the hotkeys do nothing when
  // focus is on the code pane
  await codePane.click()
  await page.keyboard.press('/')
  await page.keyboard.press('/')
  await page.keyboard.press('s')
  await page.keyboard.press('l')
  await page.keyboard.press('a')
  await page.keyboard.press('e')
  await expect(page.locator('.cm-content')).toHaveText('//slae')
  await page.keyboard.press('Meta+/')
  await page.waitForTimeout(2000)
  // Test these hotkeys perform actions when
  // focus is on the canvas
  await page.mouse.move(600, 250)
  await page.mouse.click(600, 250)
  // Start a sketch
  await page.keyboard.press('s')
  await page.waitForTimeout(2000)
  await page.mouse.move(800, 300, { steps: 5 })
  await page.mouse.click(800, 300)
  await page.waitForTimeout(2000)
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  })
  /**
   * TODO: There is a bug somewhere that causes this test to fail
   * if you toggle the codePane closed before your trigger the
   * start of the sketch.
   * and a separate Safari-only bug that causes the test to fail
   * if the pane is open the entire test. The maintainer of CodeMirror
   * has pinpointed this to the unusual browser behavior:
   * https://discuss.codemirror.net/t/how-to-force-unfocus-of-the-codemirror-element-in-safari/8095/3
   */
  await codePaneButton.click()
  await expect(u.codeLocator).not.toBeVisible()
  await page.waitForTimeout(300)

  // Draw a line
  await page.mouse.move(700, 200, { steps: 5 })
  await page.mouse.click(700, 200)
  await page.waitForTimeout(300)
  await page.mouse.move(800, 250, { steps: 5 })
  await page.mouse.click(800, 250)
  // Unequip line tool
  await page.keyboard.press('l')
  await expect(lineButton).not.toHaveAttribute('aria-pressed', 'true')
  // Equip arc tool
  await page.keyboard.press('a')
  await expect(arcButton).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  })
  await page.mouse.move(1000, 100, { steps: 5 })
  await page.mouse.click(1000, 100)
  await page.keyboard.press('Escape')
  await page.keyboard.press('l')
  await expect(lineButton).toHaveAttribute('aria-pressed', 'true')
  // Close profile
  await page.mouse.move(700, 200, { steps: 5 })
  await page.mouse.click(700, 200)
  // On  close it will unequip the line tool.
  await expect(lineButton).toHaveAttribute('aria-pressed', 'false')
  // Exit sketch
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Exit Sketch' })
  ).not.toBeVisible()
  await page.waitForTimeout(400)

  // Extrude
  await page.mouse.click(750, 150)
  await expect(extrudeButton).not.toBeDisabled()
  await page.keyboard.press('e')
  await page.waitForTimeout(100)
  await page.mouse.move(800, 200, { steps: 5 })
  await page.mouse.click(800, 200)
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForTimeout(300)
  await expect(
    page.getByRole('button', { name: 'Submit command' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Submit command' }).click()

  await codePaneButton.click()
  await expect(page.locator('.cm-content')).toContainText('extrude(')
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
    () => page.mouse.click(625, 133),
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

  await expect(page.locator('.cm-content'))
    .toContainText(`const sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.94, 6.6], %)
  |> line([2.45, -0.2], %)
  |> line([-2.6, -1.25], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`)

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.expectCmdLog('[data-message-type="execution-done"]')

  await u.updateCamPosition([1049, 239, 686])
  await u.closeDebugPanel()

  await page.getByText('startProfileAt([-12.94, 6.6], %)').click()
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

  await page.getByText('startProfileAt([-12.94, 6.6], %)').click()

  await expect(page.getByRole('button', { name: 'Extrude' })).not.toBeDisabled()
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Extrude' }).click()

  await expect(page.getByTestId('command-bar')).toBeVisible()
  await page.waitForTimeout(100)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await expect(page.getByText('Confirm Extrude')).toBeVisible()
  await page.keyboard.press('Enter')

  const result2 = result.genNext`
const sketch002 = extrude(${[5, 5]} + 7, sketch002)`
  await expect(page.locator('.cm-content')).toHaveText(result2.regExp)
})
