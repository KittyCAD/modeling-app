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
  // reducedMotion kills animations, which speeds up tests and reduces flakiness
  page.emulateMedia({ reducedMotion: 'reduce' })
})

test.setTimeout(60000)

test('change camera, show planes', async ({ page, context }) => {
  const u = getUtils(page)
  page.setViewportSize({ width: 1200, height: 500 })
  await page.goto('localhost:3000')
  await u.waitForAuthSkipAppStart()
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

  await u.waitForDefaultPlanesVisibilityChange()
  await u.closeDebugPanel()

  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 100,
  })

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.waitForDefaultPlanesVisibilityChange()

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
  await u.waitForDefaultPlanesVisibilityChange()
  await u.closeDebugPanel()

  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 150,
  })

  await u.openAndClearDebugPanel()
  await page.getByRole('button', { name: 'Exit Sketch' }).click()
  await u.waitForDefaultPlanesVisibilityChange()

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
  await u.waitForDefaultPlanesVisibilityChange()
  await u.closeDebugPanel()

  // take snapshot
  await page.waitForTimeout(100) // best to be safe for screenshots
  await expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 100,
  })
})
