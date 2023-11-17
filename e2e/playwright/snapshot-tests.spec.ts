import { test, expect } from '@playwright/test'
import { secrets } from './secrets'
import { EngineCommand } from '../../src/lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { getUtils } from './test-utils'

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

test('change camera, show planes', async ({ page, context }) => {
  const u = getUtils(page)
  context.addInitScript(async (token) => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForPageLoad()
  await u.openAndClearDebugPanel()

  const camCmd: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_look_at',
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      vantage: { x: 0, y: 50, z: 50 },
    },
  }

  await u.sendCustomCmd(camCmd)
  await u.waitForCmdReceive('default_camera_look_at')

  // rotate
  await u.closeDebugPanel()
  await page.mouse.move(700, 200)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(600, 300)
  await page.mouse.up({ button: 'right' })

  await u.openDebugPanel()
  await u.waitForCmdReceive('camera_drag_end')
  await page.waitForTimeout(500)
  await u.clearCommandLogs()

  await page.getByRole('button', { name: 'Start Sketch' }).click()

  await u.waitForDefaultPlanesToBeVisible()
  await u.closeDebugPanel()

  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 100,
  })

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.waitForDefaultPlanesToBeVisible()

  await u.sendCustomCmd(camCmd)
  await u.waitForCmdReceive('default_camera_look_at')

  await u.clearCommandLogs()
  await u.closeDebugPanel()
  // pan
  await page.keyboard.down('Shift')
  await page.mouse.move(600, 200)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(700, 200)
  await page.mouse.up({ button: 'right' })
  await page.keyboard.up('Shift')

  await u.openDebugPanel()
  await u.waitForCmdReceive('camera_drag_end')
  await page.waitForTimeout(300)
  await u.clearCommandLogs()

  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await u.waitForDefaultPlanesToBeVisible()
  await u.closeDebugPanel()

  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 150,
  })

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.waitForDefaultPlanesToBeVisible()

  await u.sendCustomCmd(camCmd)
  await u.waitForCmdReceive('default_camera_look_at')

  await u.clearCommandLogs()
  await u.closeDebugPanel()

  // zoom
  await page.keyboard.down('Control')
  await page.mouse.move(700, 400)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(700, 350)
  await page.mouse.up({ button: 'right' })
  await page.keyboard.up('Control')

  await u.openDebugPanel()
  await u.waitForCmdReceive('camera_drag_end')
  await page.waitForTimeout(300)
  await u.clearCommandLogs()

  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await u.waitForDefaultPlanesToBeVisible()
  await u.closeDebugPanel()

  // take snapshot
  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 100,
  })
})

test('Can create sketches on all planes and their back sides snap shot test', async ({
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
    await u.openDebugPanel()
    await u.sendCustomCmd(viewCmd)
    await u.clearCommandLogs()
    // await page.waitForTimeout(2000)
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.waitForTimeout(500)
    await expect(await page.screenshot()).toMatchSnapshot({
      maxDiffPixels: 100,
    })
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