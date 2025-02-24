import { test, expect } from './zoo-test'
import { EngineCommand } from 'lang/std/artifactGraph'
import { uuidv4 } from 'lib/utils'
import { getUtils } from './test-utils'

test.describe('Testing Camera Movement', { tag: ['@skipWin'] }, () => {
  test('Can move camera reliably', async ({ page, context, homePage }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()
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
      await page.waitForTimeout(100)

      const appLogoBBox = await page.getByTestId('app-logo').boundingBox()
      expect(appLogoBBox).not.toBeNull()
      if (!appLogoBBox) throw new Error('app logo not found')
      await page.mouse.move(
        appLogoBBox.x + appLogoBBox.width / 2,
        appLogoBBox.y + appLogoBBox.height / 2
      )
      await page.waitForTimeout(100)
      await page.mouse.move(600, 303)
      await page.waitForTimeout(100)
      await page.mouse.up({ button: 'right' })
    }, [4, -10.5, -120])

    await bakeInRetries(async () => {
      await page.keyboard.down('Shift')
      await page.mouse.move(600, 200)
      await page.mouse.down({ button: 'right' })
      // Gotcha: remove steps:2 from this 700,200 mouse move. This bricked the test on local host engine.
      await page.mouse.move(700, 200)
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

  // TODO: fix after electron migration is merged
  test.fixme(
    'Zoom should be consistent when exiting or entering sketches',
    async ({ page, homePage }) => {
      // start new sketch pan and zoom before exiting, when exiting the sketch should stay in the same place
      // than zoom and pan outside of sketch mode and enter again and it should not change from where it is
      // than again for sketching

      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await u.waitForPageLoad()
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

      let code = `sketch001 = startSketchOn('XY')`
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
      code += `\n  |> line(end = [11.18, 0])`
      // await expect(u.codeLocator).toHaveText(code)
      await u.canvasLocator.click({ position: { x, y: 275 } })
      code += `\n  |> line(end = [0, 6.99])`
      // await expect(u.codeLocator).toHaveText(code)

      // click the line button
      await page.getByRole('button', { name: 'line Line', exact: true }).click()

      const hoverOverNothing = async () => {
        // await u.canvasLocator.hover({position: {x: 700, y: 325}})
        await page.mouse.move(700, 325)
        await page.waitForTimeout(100)
        await expect(page.getByTestId('hover-highlight')).not.toBeVisible({
          timeout: 10_000,
        })
      }

      await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

      await page.waitForTimeout(200)
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
      await hoverOverNothing()
      await page.getByRole('button', { name: 'Edit Sketch' }).click()

      await page.waitForTimeout(400)

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
    }
  )

  test(`Zoom by scroll should not fire while orbiting`, async ({
    homePage,
    page,
  }) => {
    /**
     * Currently we only allow zooming by scroll when no other camera movement is happening,
     * set within cameraMouseDragGuards in cameraControls.ts,
     * until the engine supports unifying multiple camera movements.
     * This verifies that scrollCallback's guard is working as expected.
     */
    const u = await getUtils(page)

    // Constants and locators
    const settingsLink = page.getByTestId('settings-link')
    const settingsDialogHeading = page.getByRole('heading', {
      name: 'Settings',
      exact: true,
    })
    const userSettingsTab = page.getByRole('radio', { name: 'User' })
    const mouseControlsSetting = () => page.locator('#camera-controls').first()
    const mouseControlSuccesToast = page.getByText(
      'Set mouse controls to "Solidworks"'
    )
    const settingsCloseButton = page.getByTestId('settings-close-button')
    const gizmo = page.locator('[aria-label*=gizmo]')
    const resetCameraButton = page.getByRole('button', { name: 'Reset view' })
    const orbitMouseStart = { x: 800, y: 130 }
    const orbitMouseEnd = { x: 0, y: 130 }
    const mid = (v1: number, v2: number) => v1 + (v2 - v1) / 2
    type Point = { x: number; y: number }
    const midPoint = (p1: Point, p2: Point) => ({
      x: mid(p1.x, p2.x),
      y: mid(p1.y, p2.y),
    })
    const orbitMouseStepOne = midPoint(orbitMouseStart, orbitMouseEnd)
    const expectedStartCamZPosition = 64.0
    const expectedZoomCamZPosition = 32.0
    const expectedOrbitCamZPosition = 64.0

    await test.step(`Test setup`, async () => {
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
      await u.closeKclCodePanel()
      // This test requires the mouse controls to be set to Solidworks
      await u.openDebugPanel()
      await test.step(`Set mouse controls setting to Solidworks`, async () => {
        await settingsLink.click()
        await expect(settingsDialogHeading).toBeVisible()
        await userSettingsTab.click()
        const setting = mouseControlsSetting()
        await expect(setting).toBeAttached()
        await setting.scrollIntoViewIfNeeded()
        await setting.selectOption({ label: 'Solidworks' })
        await expect(setting, 'Setting value did not change').toHaveValue(
          'Solidworks',
          { timeout: 120_000 }
        )
        await expect(mouseControlSuccesToast).toBeVisible()
        await settingsCloseButton.click()
      })
    })

    await test.step(`Test scrolling zoom works`, async () => {
      await resetCamera()
      await page.mouse.move(orbitMouseStart.x, orbitMouseStart.y)
      await page.mouse.wheel(0, -100)
      await test.step(`Force a refresh of the camera position`, async () => {
        await u.openAndClearDebugPanel()
        await u.sendCustomCmd({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_get_settings',
          },
        })
        await u.waitForCmdReceive('default_camera_get_settings')
      })

      await expect
        .poll(getCameraZValue, {
          message: 'Camera should be at expected position after zooming',
        })
        .toEqual(expectedZoomCamZPosition)
    })

    await test.step(`Test orbiting works`, async () => {
      await doOrbitWith()
    })

    await test.step(`Test scrolling while orbiting doesn't zoom`, async () => {
      await doOrbitWith(async () => {
        await page.mouse.wheel(0, -100)
      })
    })

    // Helper functions
    async function resetCamera() {
      await test.step(`Reset camera`, async () => {
        await u.openDebugPanel()
        await u.clearCommandLogs()
        await u.doAndWaitForCmd(async () => {
          await gizmo.click({ button: 'right' })
          await resetCameraButton.click()
        }, 'zoom_to_fit')
        await expect
          .poll(getCameraZValue, {
            message: 'Camera Z should be at expected position after reset',
          })
          .toEqual(expectedStartCamZPosition)
      })
    }

    async function getCameraZValue() {
      return page
        .getByTestId('cam-z-position')
        .inputValue()
        .then((value) => parseFloat(value))
    }

    async function doOrbitWith(callback = async () => {}) {
      await resetCamera()

      await test.step(`Perform orbit`, async () => {
        await page.mouse.move(orbitMouseStart.x, orbitMouseStart.y)
        await page.mouse.down({ button: 'middle' })
        await page.mouse.move(orbitMouseStepOne.x, orbitMouseStepOne.y, {
          steps: 3,
        })
        await callback()
        await page.mouse.move(orbitMouseEnd.x, orbitMouseEnd.y, {
          steps: 3,
        })
      })

      await test.step(`Verify orbit`, async () => {
        await expect
          .poll(getCameraZValue, {
            message: 'Camera should be at expected position after orbiting',
          })
          .toEqual(expectedOrbitCamZPosition)
        await page.mouse.up({ button: 'middle' })
      })
    }
  })

  test('Right-click opens context menu when not dragged', async ({
    homePage,
    page,
  }) => {
    const u = await getUtils(page)

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await test.step(`The menu should not show if we drag the mouse`, async () => {
      await page.mouse.move(900, 200)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(900, 300)
      await page.mouse.up({ button: 'right' })

      await expect(page.getByTestId('view-controls-menu')).not.toBeVisible()
    })

    await test.step(`The menu should show if we don't drag the mouse`, async () => {
      await page.mouse.move(900, 200)
      await page.mouse.down({ button: 'right' })
      await page.mouse.up({ button: 'right' })

      await expect(page.getByTestId('view-controls-menu')).toBeVisible()
    })
  })
})
