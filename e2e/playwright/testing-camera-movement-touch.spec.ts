import {
  getUtils,
  panFromCenter,
  panTwoFingerFromCenter,
  pinchFromCenter,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { type Page, devices } from '@playwright/test'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'

test.use({
  hasTouch: true,
})
test.describe('Testing Camera Movement (Touch Only)', () => {
  /**
   * DUPLICATED FROM `testing-camera-movement.spec.ts`, might need to become a util.
   *
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
  // test(
  //   'Touch camera controls',
  //   {
  //     tag: '@web',
  //   },
  //   async ({ page, homePage, scene, cmdBar }) => {
  //     const u = await getUtils(page)
  //     const camInitialPosition: [number, number, number] = [0, 85, 85]
  //
  //     await homePage.goToModelingScene()
  //     await scene.settled(cmdBar)
  //     const stream = page.getByTestId('stream')
  //
  //     await u.openAndClearDebugPanel()
  //     await u.closeKclCodePanel()
  //
  //     await test.step('Orbit', async () => {
  //       await bakeInRetries({
  //         mouseActions: async () => {
  //           await panFromCenter(stream, 200, 200)
  //           await page.waitForTimeout(200)
  //         },
  //         afterPosition: [19, 85, 85],
  //         beforePosition: camInitialPosition,
  //         page,
  //         scene,
  //       })
  //     })
  //
  //     await test.step('Pan', async () => {
  //       await bakeInRetries({
  //         mouseActions: async () => {
  //           await panTwoFingerFromCenter(stream, 200, 200)
  //           await page.waitForTimeout(200)
  //         },
  //         afterPosition: [19, 85, 85],
  //         beforePosition: camInitialPosition,
  //         page,
  //         scene,
  //       })
  //     })
  //
  //     await test.step('Zoom', async () => {
  //       await bakeInRetries({
  //         mouseActions: async () => {
  //           await pinchFromCenter(stream, 300, -100, 5)
  //         },
  //         afterPosition: [0, 118, 118],
  //         beforePosition: camInitialPosition,
  //         page,
  //         scene,
  //       })
  //     })
  //   }
  //  )
})
