import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'

import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'

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
        const keys = ['x', 'y', 'z']
        keys.forEach((key, i) =>
          console.log(key, {
            expected: afterPosition[i],
            received: vals[i],
            error: errors[i],
          })
        )

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

  test('Can pan and zoom camera reliably', async ({
    page,
    homePage,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    const camInitialPosition: [number, number, number] = [0, 85, 85]

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await u.openAndClearDebugPanel()
    await u.closeKclCodePanel()

    await test.step('Pan', async () => {
      await bakeInRetries({
        mouseActions: async () => {
          const dragStart = await scene.convertPagePositionToStream(600, 200)
          const dragEnd = await scene.convertPagePositionToStream(700, 200)
          await page.keyboard.down('Shift')
          await page.mouse.move(dragStart.x, dragStart.y)
          await page.mouse.down({ button: 'right' })
          // Gotcha: remove steps:2 from this 700,200 mouse move. This bricked the test on local host engine.
          await page.mouse.move(dragEnd.x, dragEnd.y)
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
          const dragStart = await scene.convertPagePositionToStream(700, 400)
          const dragEnd = await scene.convertPagePositionToStream(700, 300)
          await page.keyboard.down('Control')
          await page.mouse.move(dragStart.x, dragStart.y)
          await page.mouse.down({ button: 'right' })
          await page.mouse.move(dragEnd.x, dragEnd.y)
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
          const scrollPos = await scene.convertPagePositionToStream(700, 400)
          await page.mouse.move(scrollPos.x, scrollPos.y)
          await page.mouse.wheel(0, -150)

          // Scroll zooming doesn't update the debug pane's cam position values,
          // so we have to force a refresh.
          await u.openAndClearDebugPanel()
          await u.sendCustomCmd(refreshCamValuesCmd)
          await u.waitForCmdReceive('default_camera_get_settings')
          await u.closeDebugPanel()
        },
        afterPosition: [0, 42.5, 42.5],
        beforePosition: camInitialPosition,
        page,
        scene,
      })
    })
  })

  test('Can orbit camera reliably', async ({
    page,
    homePage,
    scene,
    cmdBar,
  }) => {
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
          const moveOne = await scene.convertPagePositionToStream(700, 200)
          await page.mouse.move(moveOne.x, moveOne.y)
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
          const moveTwo = await scene.convertPagePositionToStream(600, 303)
          await page.mouse.move(moveTwo.x, moveTwo.y)
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
          const moveOne = await scene.convertPagePositionToStream(700, 200)
          await page.mouse.move(moveOne.x, moveOne.y)
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
          const moveTwo = await scene.convertPagePositionToStream(600, 303)
          await page.mouse.move(moveTwo.x, moveTwo.y)
          await page.waitForTimeout(100)
          await page.mouse.up({ button: 'right' })
        },
        afterPosition: [47.27, -15.48, 109.43],
        beforePosition: initialCamPosition,
        page,
        scene,
      })
    })
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
