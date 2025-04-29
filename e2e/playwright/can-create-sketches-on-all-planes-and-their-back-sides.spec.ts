import type { Page } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'

import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Can create sketches on all planes and their back sides', () => {
  const sketchOnPlaneAndBackSideTest = async (
    page: Page,
    homePage: HomePageFixture,
    scene: SceneFixture,
    toolbar: ToolbarFixture,
    plane: string,
    clickCoords: { x: number; y: number }
  ) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    const XYPlanRed: [number, number, number] = [98, 50, 51]
    await scene.expectPixelColor(XYPlanRed, { x: 700, y: 300 }, 15)

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

    const code = `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(${plane})profile001 = startProfile(sketch001, at = [0.91, -1.22])`

    await u.openDebugPanel()

    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await u.sendCustomCmd(camCommand)
    await page.waitForTimeout(100)
    await u.sendCustomCmd(updateCamCommand)

    await u.closeDebugPanel()

    await page.mouse.click(clickCoords.x, clickCoords.y)
    await page.waitForTimeout(600) // wait for animation

    await toolbar.waitUntilSketchingReady()

    await expect(
      page.getByRole('button', { name: 'line Line', exact: true })
    ).toBeVisible()

    await u.closeDebugPanel()
    await page.mouse.click(707, 393)

    await expect(page.locator('.cm-content')).toHaveText(code)

    await page
      .getByRole('button', { name: 'line Line', exact: true })
      .first()
      .click()
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await u.clearCommandLogs()
    await u.removeCurrentCode()
  }

  const planeConfigs = [
    {
      plane: 'XY',
      coords: { x: 600, y: 388 },
      description: 'red plane',
    },
    {
      plane: 'YZ',
      coords: { x: 700, y: 250 },
      description: 'green plane',
    },
    {
      plane: 'XZ',
      coords: { x: 684, y: 427 },
      description: 'blue plane',
    },
    {
      plane: '-XY',
      coords: { x: 600, y: 118 },
      description: 'back of red plane',
    },
    {
      plane: '-YZ',
      coords: { x: 700, y: 219 },
      description: 'back of green plane',
    },
    {
      plane: '-XZ',
      coords: { x: 700, y: 80 },
      description: 'back of blue plane',
    },
  ]

  for (const config of planeConfigs) {
    test(config.plane, async ({ page, homePage, scene, toolbar }) => {
      await sketchOnPlaneAndBackSideTest(
        page,
        homePage,
        scene,
        toolbar,
        config.plane,
        config.coords
      )
    })
  }
})
