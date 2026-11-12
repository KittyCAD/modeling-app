import { TEST_CODE_GIZMO } from '@e2e/playwright/storageStates'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Locator } from '@playwright/test'
import { uuidv4 } from '@src/lib/utils'
import { PNG } from 'pngjs'

// Local camera changes can leave the gizmo between orientations. Locate its
// visible coloured axis head, reflecting through the origin for negative axes,
// so the click follows the control while the expected camera pose stays fixed.
// TODO: After https://github.com/KittyCAD/modeling-app/pull/14856 lands,
// verify fixed-position clicks and remove this helper and the PNG import.
async function localAxisPosition(
  gizmo: Locator,
  axis: 'x' | 'y' | 'z',
  negative: boolean
) {
  const image = PNG.sync.read(await gizmo.screenshot({ scale: 'css' }))
  const center = { x: image.width / 2, y: image.height / 2 }
  const pixels: { x: number; y: number }[] = []
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const [r, g, b] = image.data.subarray(i, i + 3)
      // Axis heads are filled; exclude their thin stems near the origin.
      const isHead =
        axis === 'x'
          ? r > 220 && g < 150 && b < 150
          : axis === 'y'
            ? g > 200 && r < 150 && b < 150
            : b > 210 && r < 150 && g < 180
      if (
        isHead &&
        Math.hypot(x - center.x, y - center.y) > image.width * 0.2
      ) {
        pixels.push({ x, y })
      }
    }
  }
  expect(
    pixels.length,
    `the positive ${axis.toUpperCase()} gizmo head must be visible`
  ).toBeGreaterThan(0)
  const positive = {
    x: pixels.reduce((sum, point) => sum + point.x, 0) / pixels.length,
    y: pixels.reduce((sum, point) => sum + point.y, 0) / pixels.length,
  }
  return negative
    ? { x: center.x * 2 - positive.x, y: center.y * 2 - positive.y }
    : positive
}

test.describe('Testing Gizmo', { tag: '@desktop' }, () => {
  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    const cases = [
      {
        testDescription: 'top view',
        axis: 'z',
        negative: false,
        gizmoClickPosition: { x: 40, y: 18 },
        expectedCameraPosition: { x: 800, y: -152, z: 4886.02 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
      {
        testDescription: 'bottom view',
        axis: 'z',
        negative: true,
        gizmoClickPosition: { x: 40, y: 65 },
        expectedCameraPosition: { x: 800, y: -152, z: -4834.02 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
      {
        testDescription: 'right view',
        axis: 'x',
        negative: false,
        gizmoClickPosition: { x: 18, y: 51 },
        expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
      {
        testDescription: 'left view',
        axis: 'x',
        negative: true,
        gizmoClickPosition: { x: 63, y: 33 },
        expectedCameraPosition: { x: -4060.02, y: -152, z: 26 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
      {
        testDescription: 'back view',
        axis: 'y',
        negative: false,
        gizmoClickPosition: { x: 56, y: 57 },
        expectedCameraPosition: { x: 800, y: 4708.02, z: 26 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
      {
        testDescription: 'front view',
        axis: 'y',
        negative: true,
        gizmoClickPosition: { x: 20, y: 27 },
        expectedCameraPosition: { x: 800, y: -5012.02, z: 26 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      },
    ] as const
    for (const {
      gizmoClickPosition,
      expectedCameraPosition,
      expectedCameraTarget,
      testDescription,
      axis,
      negative,
    } of cases) {
      test(`check ${testDescription} ${rendererTag}`, async ({
        page,
        homePage,
        scene,
      }) => {
        const u = await getUtils(page)
        await page.addInitScript((TEST_CODE_GIZMO) => {
          localStorage.setItem('persistCode', TEST_CODE_GIZMO)
        }, TEST_CODE_GIZMO)

        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await u.waitForPageLoad()

        await page.waitForTimeout(100)
        // wait for execution done
        if (rendererTag === '@streamRenderer') {
          await u.openDebugPanel()
          await u.expectCmdLog('[data-message-type="execution-done"]')
        }
        if (rendererTag === '@localRenderer') {
          await scene.settled()
          await scene.moveCameraTo(
            { x: 3000, y: 3000, z: 3000 },
            { x: 800, y: -152, z: 26 }
          )
        } else {
          await u.sendCustomCmd({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'default_camera_look_at',
              vantage: {
                x: 3000,
                y: 3000,
                z: 3000,
              },
              center: {
                x: 800,
                y: -152,
                z: 26,
              },
              up: { x: 0, y: 0, z: 1 },
            },
          })
          await page.waitForTimeout(100)
          await u.clearCommandLogs()
          await u.sendCustomCmd({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'default_camera_get_settings',
            },
          })
          await u.waitForCmdReceive('default_camera_get_settings')
        }

        if (rendererTag === '@streamRenderer') await u.clearCommandLogs()
        const gizmo = page.locator('[aria-label*=gizmo]')
        await expect(gizmo).toBeVisible()
        const clickPosition =
          rendererTag === '@localRenderer'
            ? await localAxisPosition(gizmo, axis, negative)
            : gizmoClickPosition
        await gizmo.hover({ position: clickPosition })
        await page.waitForTimeout(100)
        await gizmo.click({ position: clickPosition })
        await page.mouse.move(0, 0)

        if (rendererTag === '@streamRenderer') {
          // We use different camera commands for top/bottom cf. all others.
          if (['top view', 'bottom view'].includes(testDescription)) {
            await u.waitForCmdReceive('default_camera_set_view')
          } else {
            await u.waitForCmdReceive('default_camera_look_at')
          }
          await u.clearCommandLogs()

          await u.sendCustomCmd({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'default_camera_get_settings',
            },
          })
          await u.waitForCmdReceive('default_camera_get_settings')
        }
        if (rendererTag === '@localRenderer') {
          await expect
            .poll(() => scene.getCameraInfo())
            .toEqual({
              position: Object.values(expectedCameraPosition),
              target: Object.values(expectedCameraTarget),
            })
        } else {
          await Promise.all([
            // position
            expect(page.getByTestId('cam-x-position')).toHaveValue(
              expectedCameraPosition.x.toString()
            ),
            expect(page.getByTestId('cam-y-position')).toHaveValue(
              expectedCameraPosition.y.toString()
            ),
            expect(page.getByTestId('cam-z-position')).toHaveValue(
              expectedCameraPosition.z.toString()
            ),
            // target
            expect(page.getByTestId('cam-x-target')).toHaveValue(
              expectedCameraTarget.x.toString()
            ),
            expect(page.getByTestId('cam-y-target')).toHaveValue(
              expectedCameraTarget.y.toString()
            ),
            expect(page.getByTestId('cam-z-target')).toHaveValue(
              expectedCameraTarget.z.toString()
            ),
          ])
        }
      })
    }

    test(`Context menu and popover menu ${rendererTag}`, async ({
      page,
      homePage,
      scene,
    }) => {
      const testCase = {
        testDescription: 'Right view',
        expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
        expectedCameraTarget: { x: 800, y: -152, z: 26 },
      }

      // Test prelude taken from the above test
      const u = await getUtils(page)
      await page.addInitScript((TEST_CODE_GIZMO) => {
        localStorage.setItem('persistCode', TEST_CODE_GIZMO)
      }, TEST_CODE_GIZMO)
      await page.setBodyDimensions({ width: 1000, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled()
      await page.waitForTimeout(100)
      // wait for execution done
      if (rendererTag === '@streamRenderer') {
        await u.openDebugPanel()
        await u.expectCmdLog('[data-message-type="execution-done"]')
      }
      if (rendererTag === '@localRenderer') {
        await scene.moveCameraTo(
          { x: 3000, y: 3000, z: 3000 },
          { x: 800, y: -152, z: 26 }
        )
      } else {
        await u.sendCustomCmd({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_look_at',
            vantage: {
              x: 3000,
              y: 3000,
              z: 3000,
            },
            center: {
              x: 800,
              y: -152,
              z: 26,
            },
            up: { x: 0, y: 0, z: 1 },
          },
        })
        await page.waitForTimeout(100)
        await u.clearCommandLogs()
        await u.sendCustomCmd({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_get_settings',
          },
        })
        await u.waitForCmdReceive('default_camera_get_settings')
      }

      // Now find and select the correct
      // view from the context menu
      if (rendererTag === '@streamRenderer') await u.clearCommandLogs()
      const gizmo = page.locator('[aria-label*=gizmo]')
      await gizmo.click({ button: 'right' })
      const buttonToTest = page.getByRole('button', {
        name: testCase.testDescription,
      })
      await expect(buttonToTest).toBeVisible()
      await buttonToTest.click()

      if (rendererTag === '@streamRenderer') {
        // Now assert we've moved to the correct view
        // Taken from the above test
        await u.waitForCmdReceive('default_camera_look_at')

        await u.sendCustomCmd({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_get_settings',
          },
        })
        await u.waitForCmdReceive('default_camera_get_settings')
        await page.waitForTimeout(400)
      }
      if (rendererTag === '@localRenderer') {
        await expect
          .poll(() => scene.getCameraInfo())
          .toEqual({
            position: Object.values(testCase.expectedCameraPosition),
            target: Object.values(testCase.expectedCameraTarget),
          })
      } else {
        await Promise.all([
          // position
          expect(page.getByTestId('cam-x-position')).toHaveValue(
            testCase.expectedCameraPosition.x.toString()
          ),
          expect(page.getByTestId('cam-y-position')).toHaveValue(
            testCase.expectedCameraPosition.y.toString()
          ),
          expect(page.getByTestId('cam-z-position')).toHaveValue(
            testCase.expectedCameraPosition.z.toString()
          ),
          // target
          expect(page.getByTestId('cam-x-target')).toHaveValue(
            testCase.expectedCameraTarget.x.toString()
          ),
          expect(page.getByTestId('cam-y-target')).toHaveValue(
            testCase.expectedCameraTarget.y.toString()
          ),
          expect(page.getByTestId('cam-z-target')).toHaveValue(
            testCase.expectedCameraTarget.z.toString()
          ),
        ])
      }
      // Now test the popover menu.
      // It has the same click handlers, so we can just
      // test that it opens and contains the same content.
      const gizmoPopoverButton = page.getByRole('button', {
        name: 'view settings',
      })
      await expect(gizmoPopoverButton).toBeVisible()
      await gizmoPopoverButton.click()
      await expect(buttonToTest).toBeVisible()
    })
  }
})
