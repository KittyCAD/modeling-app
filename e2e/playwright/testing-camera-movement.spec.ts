import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'

import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'

test.describe('Testing Camera Movement', () => {
  /**
   * hack that we're implemented our own retry instead of using retries built into playwright.
   * however each of these camera drags can be flaky, because of udp
   * and so putting them together means only one needs to fail to make this test extra flaky.
   * this way we can retry within the test
   * We could break them out into separate tests, but the longest past of the test is waiting
   * for the stream to start, so it can be good to bundle related things together.
   */
  const bakeInRetries = async ({
    mouseActions,
    afterPosition,
    beforePosition,
    retryCount = 0,
    page,
    scene,
  }: {
    mouseActions: () => Promise<void>
    beforePosition: [number, number, number]
    afterPosition: [number, number, number]
    retryCount?: number
    page: Page
    scene: SceneFixture
  }) => {
    const acceptableCamError = 5
    const u = await getUtils(page)

    await test.step('Set up initial camera position', async () =>
      await scene.moveCameraTo({
        x: beforePosition[0],
        y: beforePosition[1],
        z: beforePosition[2],
      }))

    await test.step('Do actions and watch for changes', async () =>
      u.doAndWaitForImageDiff(async () => {
        await mouseActions()

        await u.openAndClearDebugPanel()
        await u.closeDebugPanel()
        await page.waitForTimeout(100)
      }, 300))

    await u.openAndClearDebugPanel()
    await expect(page.getByTestId('cam-x-position')).toBeAttached()

    const vals = await Promise.all([
      page.getByTestId('cam-x-position').inputValue(),
      page.getByTestId('cam-y-position').inputValue(),
      page.getByTestId('cam-z-position').inputValue(),
    ])
    const errors = vals.map((v, i) => Math.abs(Number(v) - afterPosition[i]))
    let shouldRetry = false

    if (errors.some((e) => e > acceptableCamError)) {
      if (retryCount > 2) {
        console.log('xVal', vals[0], 'xError', errors[0])
        console.log('yVal', vals[1], 'yError', errors[1])
        console.log('zVal', vals[2], 'zError', errors[2])

        throw new Error('Camera position not as expected', {
          cause: {
            vals,
            errors,
          },
        })
      }
      shouldRetry = true
    }
    if (shouldRetry) {
      await bakeInRetries({
        mouseActions,
        afterPosition: afterPosition,
        beforePosition: beforePosition,
        retryCount: retryCount + 1,
        page,
        scene,
      })
    }
  }

  test(
    'Can pan and zoom camera reliably',
    {
      tag: '@web',
    },
    async ({ page, homePage, scene, cmdBar }) => {
      const u = await getUtils(page)
      const camInitialPosition: [number, number, number] = [0, 85, 85]

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await u.openAndClearDebugPanel()
      await u.closeKclCodePanel()

      await test.step('Pan', async () => {
        await bakeInRetries({
          mouseActions: async () => {
            await page.keyboard.down('Shift')
            await page.mouse.move(600, 200)
            await page.mouse.down({ button: 'right' })
            // Gotcha: remove steps:2 from this 700,200 mouse move. This bricked the test on local host engine.
            await page.mouse.move(700, 200)
            await page.mouse.up({ button: 'right' })
            await page.keyboard.up('Shift')
            await page.waitForTimeout(200)
          },
          afterPosition: [19, 85, 85],
          beforePosition: camInitialPosition,
          page,
          scene,
        })
      })

      await test.step('Zoom with click and drag', async () => {
        await bakeInRetries({
          mouseActions: async () => {
            await page.keyboard.down('Control')
            await page.mouse.move(700, 400)
            await page.mouse.down({ button: 'right' })
            await page.mouse.move(700, 300)
            await page.mouse.up({ button: 'right' })
            await page.keyboard.up('Control')
          },
          afterPosition: [0, 118, 118],
          beforePosition: camInitialPosition,
          page,
          scene,
        })
      })

      await test.step('Zoom with scrollwheel', async () => {
        const refreshCamValuesCmd: EngineCommand = {
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_get_settings',
          },
        }
        await bakeInRetries({
          mouseActions: async () => {
            await page.mouse.move(700, 400)
            await page.mouse.wheel(0, -150)

            // Scroll zooming doesn't update the debug pane's cam position values,
            // so we have to force a refresh.
            await u.clearCommandLogs()
            await u.sendCustomCmd(refreshCamValuesCmd)
            await u.waitForCmdReceive('default_camera_get_settings')
          },
          afterPosition: [0, 42.5, 42.5],
          beforePosition: camInitialPosition,
          page,
          scene,
        })
      })
    }
  )

  test(
    'Can orbit camera reliably',
    {
      tag: '@web',
    },
    async ({ page, homePage, scene, cmdBar }) => {
      const u = await getUtils(page)
      const initialCamPosition: [number, number, number] = [0, 85, 85]

      await homePage.goToModelingScene()
      // this turns on the debug pane setting as well
      await scene.settled(cmdBar)

      await u.openAndClearDebugPanel()
      await u.closeKclCodePanel()

      await test.step('Test orbit with spherical mode', async () => {
        await bakeInRetries({
          mouseActions: async () => {
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
          },
          afterPosition: [-4, 10.5, 120],
          beforePosition: initialCamPosition,
          page,
          scene,
        })
      })

      await test.step('Test orbit with trackball mode', async () => {
        await test.step('Set orbitMode to trackball', async () => {
          await cmdBar.openCmdBar()
          await cmdBar.selectOption({ name: 'camera orbit' }).click()
          await cmdBar.selectOption({ name: 'trackball' }).click()
          await expect(
            page.getByText(`camera orbit to "trackball"`)
          ).toBeVisible()
        })

        await bakeInRetries({
          mouseActions: async () => {
            await page.mouse.move(700, 200)
            await page.mouse.down({ button: 'right' })
            await page.waitForTimeout(100)

            const appLogoBBox = await page.getByTestId('app-logo').boundingBox()
            expect(appLogoBBox).not.toBeNull()
            if (!appLogoBBox) {
              throw new Error('app logo not found')
            }
            await page.mouse.move(
              appLogoBBox.x + appLogoBBox.width / 2,
              appLogoBBox.y + appLogoBBox.height / 2
            )
            await page.waitForTimeout(100)
            await page.mouse.move(600, 303)
            await page.waitForTimeout(100)
            await page.mouse.up({ button: 'right' })
          },
          afterPosition: [18.06, -42.79, 110.87],
          beforePosition: initialCamPosition,
          page,
          scene,
        })
      })
    }
  )

  // TODO: fix after electron migration is merged
  test('Zoom should be consistent when exiting or entering sketches', async ({
    page,
    homePage,
  }) => {
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

    let code = `sketch001 = startSketchOn(XY)`
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
    code += `\n  |> startProfile(at = [8.12, -12.98])`
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
  })

  test(`Zoom by scroll should not fire
  while orbiting`, async ({ homePage, page }) => {
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
    const mouseControlSuccessToast = page.getByText(
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

    await test.step(`Test
  setup`, async () => {
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
      await u.closeKclCodePanel()
      // This test requires the mouse controls to be set to Solidworks
      await u.openDebugPanel()
      await test.step(`
  Set
  mouse
  controls
  setting
  to
  Solidworks`, async () => {
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
        await expect(mouseControlSuccessToast).toBeVisible()
        await settingsCloseButton.click()
      })
    })

    await test.step(`
  Test
  scrolling
  zoom
  works`, async () => {
      await resetCamera()
      await page.mouse.move(orbitMouseStart.x, orbitMouseStart.y)
      await page.mouse.wheel(0, -100)
      await test.step(`
  Force
  a
  refresh
  of
  the
  camera
  position`, async () => {
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

    await test.step(`
  Test
  orbiting
  works`, async () => {
      await doOrbitWith()
    })

    await test.step(`
  Test
  scrolling
  while orbiting doesn
  't zoom`, async () => {
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

    async function doOrbitWith(callback = async () => { }) {
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
