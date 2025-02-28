import { test, expect, Page } from './zoo-test'
import { HomePageFixture } from './fixtures/homePageFixture'
import { getUtils } from './test-utils'
import { EngineCommand } from 'lang/std/artifactGraph'
import { uuidv4 } from 'lib/utils'
import { SceneFixture } from './fixtures/sceneFixture'

test.describe(
  'Can create sketches on all planes and their back sides',
  { tag: ['@skipWin'] },
  () => {
    const sketchOnPlaneAndBackSideTest = async (
      page: Page,
      homePage: HomePageFixture,
      scene: SceneFixture,
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

      const code = `sketch001 = startSketchOn('${plane}')profile001 = startProfileAt([0.91, -1.22], sketch001)`

      await u.openDebugPanel()

      await u.clearCommandLogs()
      await page.getByRole('button', { name: 'Start Sketch' }).click()

      await u.sendCustomCmd(camCommand)
      await page.waitForTimeout(100)
      await u.sendCustomCmd(updateCamCommand)

      await u.closeDebugPanel()
      await page.mouse.click(clickCoords.x, clickCoords.y)
      await page.waitForTimeout(600) // wait for animation

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
        name: 'XY',
        plane: 'XY',
        coords: { x: 600, y: 388 },
        description: 'red plane',
      },
      {
        name: 'YZ',
        plane: 'YZ',
        coords: { x: 700, y: 250 },
        description: 'green plane',
      },
      {
        name: 'XZ',
        plane: 'XZ',
        coords: { x: 684, y: 427 },
        description: 'blue plane',
      },
      {
        name: '-XY',
        plane: '-XY',
        coords: { x: 600, y: 118 },
        description: 'back of red plane',
      },
      {
        name: '-YZ',
        plane: '-YZ',
        coords: { x: 700, y: 219 },
        description: 'back of green plane',
      },
      {
        name: '-XZ',
        plane: '-XZ',
        coords: { x: 700, y: 80 },
        description: 'back of blue plane',
      },
    ]

    for (const config of planeConfigs) {
      test(config.name, async ({ page, homePage, scene }) => {
        await sketchOnPlaneAndBackSideTest(
          page,
          homePage,
          scene,
          config.plane,
          config.coords
        )
      })
    }
  }
)
