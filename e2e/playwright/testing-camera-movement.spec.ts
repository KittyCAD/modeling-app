import { test, expect } from '@playwright/test'
import { EngineCommand } from 'lang/std/artifactGraph'
import { uuidv4 } from 'lib/utils'
import { getUtils, setup, tearDown } from './test-utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing Camera Movement', () => {
  test('Can moving camera', async ({ page, context }) => {
    test.skip(process.platform === 'darwin', 'Can moving camera')
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
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
      await page.mouse.move(600, 303)
      await page.mouse.up({ button: 'right' })
    }, [4, -10.5, -120])

    await bakeInRetries(async () => {
      await page.keyboard.down('Shift')
      await page.mouse.move(600, 200)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(700, 200, { steps: 2 })
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

  test('Zoom should be consistent when exiting or entering sketches', async ({
    page,
  }) => {
    // start new sketch pan and zoom before exiting, when exiting the sketch should stay in the same place
    // than zoom and pan outside of sketch mode and enter again and it should not change from where it is
    // than again for sketching

    test.skip(process.platform !== 'darwin', 'Zoom should be consistent')
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
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

    let code = `const sketch001 = startSketchOn('XY')`
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
    code += `\n  |> line([11.18, 0], %)`
    // await expect(u.codeLocator).toHaveText(code)
    await u.canvasLocator.click({ position: { x, y: 275 } })
    code += `\n  |> line([0, 6.99], %)`
    // await expect(u.codeLocator).toHaveText(code)

    // click the line button
    await page.getByRole('button', { name: 'Line', exact: true }).click()

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
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    await page.waitForTimeout(400)

    await hoverOverNothing()
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
})
