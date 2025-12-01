import type { Page } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'

import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
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
    editor: EditorFixture,
    plane: string,
    clickCoords: { x: number; y: number }
  ) => {
    const u = await getUtils(page)
    // await page.addInitScript(() => {
    //   localStorage.setItem('persistCode', '@settings(defaultLengthUnit = in)')
    // })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    // await scene.settled(cmdBar)
    const XYPlaneRed: [number, number, number] = [46, 36, 34]
    await scene.expectPixelColor(XYPlaneRed, { x: 700, y: 300 }, 15)

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

    const code = `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(${plane})profile001 = startProfile(sketch001, at = [`

    await test.step(`Sketch on the ${plane} plane using custom camera commands to orient`, async () => {
      await u.openDebugPanel()
      await u.clearCommandLogs()
      await toolbar.startSketchBtn.click()

      await u.sendCustomCmd(camCommand)
      await page.waitForTimeout(100)
      await u.sendCustomCmd(updateCamCommand)

      await u.closeDebugPanel()

      const resolvedCoords = await scene.convertPagePositionToStream(
        clickCoords.x,
        clickCoords.y
      )
      await page.mouse.click(resolvedCoords.x, resolvedCoords.y)
      await page.waitForTimeout(600) // wait for animation

      await toolbar.waitUntilSketchingReady()

      await u.closeDebugPanel()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
    })

    const lineCoords = await scene.convertPagePositionToStream(707, 393)
    await page.mouse.click(lineCoords.x, lineCoords.y)

    await editor.expectEditor.toContain(code)
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
      coords: { x: 560, y: 150 },
      description: 'back of blue plane',
    },
  ]

  for (const config of planeConfigs) {
    test(config.plane, async ({ page, homePage, scene, toolbar, editor }) => {
      await sketchOnPlaneAndBackSideTest(
        page,
        homePage,
        scene,
        toolbar,
        editor,
        config.plane,
        config.coords
      )
    })
  }
})
test.describe('Can create sketches on offset planes and their back sides', () => {
  const sketchOnPlaneAndBackSideTest = async (
    page: Page,
    homePage: HomePageFixture,
    scene: SceneFixture,
    toolbar: ToolbarFixture,
    editor: EditorFixture,
    plane: string,
    clickCoords: { x: number; y: number }
  ) => {
    const u = await getUtils(page)
    await page.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
xyPlane = offsetPlane(XY, offset = 0.05)
xzPlane = offsetPlane(XZ, offset = 0.05)
yzPlane = offsetPlane(YZ, offset = 0.05)
`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
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

    const prefix = plane.length === 3 ? '-' : ''
    const planeName = plane
      .slice(plane.length === 3 ? 1 : 0)
      .toLocaleLowerCase()

    const codeLine1 = `sketch001 = startSketchOn(${prefix}${planeName}Plane)`
    const codeLine2 = 'profile001 = startProfile(sketch001, at = ['

    await test.step(`Sketch on the ${plane} plane using custom camera commands to orient`, async () => {
      await u.openDebugPanel()

      await u.clearCommandLogs()
      await toolbar.startSketchBtn.click()

      await u.sendCustomCmd(camCommand)
      await page.waitForTimeout(100)
      await u.sendCustomCmd(updateCamCommand)

      await u.closeDebugPanel()

      // TODO: can we remove these feature tree checks? They seem out of place.
      await toolbar.openFeatureTreePane()
      await toolbar.getDefaultPlaneVisibilityButton('XY').click()
      await toolbar.getDefaultPlaneVisibilityButton('XZ').click()
      await toolbar.getDefaultPlaneVisibilityButton('YZ').click()
      await expect(
        toolbar
          .getDefaultPlaneVisibilityButton('YZ')
          .locator('[aria-label="eye crossed out"]')
      ).toBeVisible()

      const resolvedCoords = await scene.convertPagePositionToStream(
        clickCoords.x,
        clickCoords.y
      )
      await page.mouse.click(resolvedCoords.x, resolvedCoords.y)
      await page.waitForTimeout(600) // wait for animation

      await toolbar.waitUntilSketchingReady()

      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
    })

    const lineCoords = await scene.convertPagePositionToStream(707, 393)
    await page.mouse.click(lineCoords.x, lineCoords.y)

    await editor.expectEditor.toContain(codeLine1)
    await editor.expectEditor.toContain(codeLine2)
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
      coords: { x: 560, y: 150 },
      description: 'back of blue plane',
    },
  ]

  for (const config of planeConfigs) {
    test(config.plane, async ({ page, homePage, scene, toolbar, editor }) => {
      await sketchOnPlaneAndBackSideTest(
        page,
        homePage,
        scene,
        toolbar,
        editor,
        config.plane,
        config.coords
      )
    })
  }
})
