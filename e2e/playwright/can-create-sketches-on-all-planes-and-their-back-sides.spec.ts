import { test, expect } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import { EngineCommand } from 'lang/std/artifactGraph'
import { uuidv4 } from 'lib/utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
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

    await expect(
      page.getByRole('button', { name: 'Line', exact: true })
    ).toBeVisible()

    // draw a line
    const startXPx = 600

    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)

    await expect(page.locator('.cm-content')).toHaveText(code)

    await page.getByRole('button', { name: 'Line', exact: true }).click()
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
