import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { TEST_COLORS, circleMove, getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { LEGACY_SKETCH_MODE_FEATURE_FLAG } from '@src/lib/constants'

// Some of these sketches are KCL 1.0, so editing them needs the legacy sketch flag.
test.use({ userFeatures: [LEGACY_SKETCH_MODE_FEATURE_FLAG] })

test.describe('Test network related behaviors', { tag: '@desktop' }, () => {
  test(
    'preserves the scene while offline',
    { tag: '@skipLocalEngine' },
    async ({ page, context, homePage, toolbar, scene }) => {
      const networkToggleConnectedText = page.getByText(
        'Network health (Strong)'
      )
      const networkToggleWeakText = page.getByText('Network health (Ok)')

      await context.addInitScript(
        (initialCode) => {
          localStorage.setItem('persistCode', initialCode)
        },
        `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 50mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(point = [0mm, 0mm], sketch = sketch001)
extrude001 = extrude(region001, length = 20mm)`
      )

      const dimensions = { width: 1200, height: 500 }
      const modelProbe = {
        x: dimensions.width / 2 + dimensions.width / 100,
        y: dimensions.height / 2,
      }
      await page.setBodyDimensions(dimensions)

      await homePage.waitForAuthentication()
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.moveCameraTo({ x: 80, y: -60, z: 55 })
      const cameraBeforeDisconnect = await scene.getCameraInfo()
      await scene.expectPixelColorNotToBe(
        [TEST_COLORS.DARK_MODE_BKGD, TEST_COLORS.WHITE],
        modelProbe,
        15
      )
      const u = await getUtils(page)
      const streamProbe = await scene.convertPagePositionToStream(
        modelProbe.x,
        modelProbe.y
      )
      const [modelPixel] = await u.getPixelRGBs(streamProbe, 1)

      const networkToggle = page.getByTestId(/network-toggle/)

      await expect(networkToggle).toBeVisible()
      await networkToggle.hover()

      const networkPopover = page.locator('[data-testid="network-popover"]')
      await expect(networkPopover).not.toBeVisible()

      // (First check) Expect the network to be up
      await expect(
        networkToggleConnectedText.or(networkToggleWeakText)
      ).toBeVisible()

      // Click the network widget
      await networkToggle.click()

      // Check the modal opened.
      await expect(networkPopover).toBeVisible()

      // Click off the modal.
      await page.mouse.click(100, 100)
      await expect(networkPopover).not.toBeVisible()

      const viewControlsMenu = page.getByTestId('view-controls-menu')
      await page.getByLabel('View orientation gizmo').click({ button: 'right' })
      await expect(viewControlsMenu).toBeVisible()

      // Exercise Chromium's actual offline path so the WebSocket and WebRTC
      // transports close in the same order they do for a real network loss.
      await context.setOffline(true)
      await expect(networkToggle).toContainText('Network health (Offline)')
      await expect(scene.networkToggleConnected).toHaveCount(0)
      await expect(scene.engineConnectionsSpinner).not.toBeVisible()
      await expect(scene.streamWrapper).toHaveAttribute('inert')
      await expect(
        page.getByTestId('engine-scene-view-extension-overlay')
      ).toHaveAttribute('inert')
      await expect(viewControlsMenu).not.toBeVisible()
      const reconnectingChip = page.getByText('Reconnecting...')
      await expect(reconnectingChip).not.toBeVisible()
      await page.keyboard.press('s')
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await expect(reconnectingChip).toBeVisible()
      await scene.expectPixelColor(modelPixel, modelProbe, 15)

      // Click the network toggle
      await networkToggle.click()

      // Check the modal opened.
      await expect(networkPopover).toBeVisible()

      // Click off the modal.
      await page.mouse.click(0, 0)
      await expect(networkPopover).not.toBeVisible()

      await context.setOffline(false)

      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 15_000,
      })
      await expect(reconnectingChip).not.toBeVisible()
      const cameraAfterReconnect = await scene.getCameraInfo()
      for (const [
        index,
        coordinate,
      ] of cameraBeforeDisconnect.position.entries()) {
        expect(cameraAfterReconnect.position[index]).toBeCloseTo(coordinate, 1)
      }
      for (const [
        index,
        coordinate,
      ] of cameraBeforeDisconnect.target.entries()) {
        expect(cameraAfterReconnect.target[index]).toBeCloseTo(coordinate, 1)
      }

      // (Second check) expect the network to be up
      await networkToggle.hover()
      await expect(
        networkToggleConnectedText.or(networkToggleWeakText)
      ).toBeVisible()
      await expect(scene.networkToggleConnected).toBeVisible()
    }
  )

  test(
    'Engine disconnect & reconnect in sketch mode',
    { tag: '@skipLocalEngine' },
    async ({
      page,
      context,
      homePage,
      toolbar,
      scene,
      cmdBar,
      editor,
      tronApp,
    }) => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: false,
          },
        })
      }

      const networkToggle = page.getByTestId(/network-toggle/)
      const networkToggleConnectedText = page.getByText(
        'Network health (Strong)'
      )
      const networkToggleWeakText = page.getByText('Network health (Ok)')

      const u = await getUtils(page)
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, 'sketch001 = startSketchOn(XZ)')
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled()
      await u.waitForPageLoad()

      const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
      await op.dblclick()
      await toolbar.waitUntilSketchingReady()
      await toolbar.closeFeatureTreePane()

      await expect(page.locator('.cm-content')).toContainText(
        'sketch001 = startSketchOn(XZ)'
      )

      await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

      // Expect the network to be up
      await networkToggle.hover()
      await expect(
        networkToggleConnectedText.or(networkToggleWeakText)
      ).toBeVisible()

      // simulate network down
      await u.emulateNetworkConditions({
        offline: true,
        // values of 0 remove any active throttling. crbug.com/456324#c9
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })

      // Expect the network to be down
      await networkToggle.hover()

      await expect(networkToggle).toContainText('Network health (Offline)')

      // Ensure we are not in sketch mode
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).not.toBeVisible()
      await expect(toolbar.startSketchBtn).toBeVisible()

      // simulate network up
      await u.emulateNetworkConditions({
        offline: false,
        // values of 0 remove any active throttling. crbug.com/456324#c9
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })

      // Wait for the app to be ready for use
      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 15000,
      })

      // Expect the network to be up
      await networkToggle.hover()
      await expect(
        networkToggleConnectedText.or(networkToggleWeakText)
      ).toBeVisible()

      await scene.settled()

      // Click off the code pane.
      await page.mouse.click(100, 100)

      // enter sketch again
      await toolbar.editSketch()

      await page.waitForTimeout(150)

      // click to continue profile
      await page.mouse.click(1000, 400)
      await page.waitForTimeout(100)

      // Ensure we can continue sketching
      await page.mouse.click(800, 300)

      await expect(editor.codeContent).toContainText(
        `profile001 = startProfile(sketch001`
      )
      await page.waitForTimeout(100)

      // Unequip line tool
      await page.keyboard.press('Escape')

      // Make sure we didn't pop out of sketch mode.
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'line Line', exact: true })
      ).not.toHaveAttribute('aria-pressed', 'true')

      // Exit sketch
      await page.keyboard.press('Shift+Escape')
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).not.toBeVisible()
    }
  )

  test(
    'Paused stream freezes view frame, unpause reconnect is seamless to user',
    { tag: '@skipLocalEngine' },
    async ({ page, homePage, scene, cmdBar, toolbar, tronApp }) => {
      const networkToggle = page.getByTestId(/network-toggle/)
      const networkToggleConnectedText = page.getByText(
        'Network health (Strong)'
      )
      const networkToggleWeakText = page.getByText('Network health (Ok)')

      if (!tronApp) throwTronAppMissing()

      await tronApp.cleanProjectDir({
        app: {
          stream_idle_mode: 5000,
        },
      })

      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0.0, 0.0])
  |> line(end = [10.0, 0])
  |> line(end = [0, 10.0])
  |> close()`
        )
      })

      const dim = { width: 1200, height: 500 }
      await page.setBodyDimensions(dim)

      await test.step('Go to modeling scene', async () => {
        await homePage.goToModelingScene()
        await scene.settled()
      })

      await test.step('Verify pausing behavior', async () => {
        // Wait 5s + 1s to pause.
        await page.waitForTimeout(6000)

        // We should now be paused. To the user, it should appear we're still
        // connected.
        await networkToggle.hover()
        await expect(
          networkToggleConnectedText.or(networkToggleWeakText)
        ).toBeVisible()

        const center = {
          x: dim.width / 2,
          y: dim.height / 2,
        }

        let probe = { x: 0, y: 0 }

        // ... and the model's still visibly there
        probe.x = center.x + dim.width / 100
        probe.y = center.y
        await scene.expectPixelColor(TEST_COLORS.GREY, probe, 15)
        probe = { ...center }

        // Now move the mouse around to unpause!
        await circleMove(page, probe.x, probe.y, 20, 10)

        // ONCE AGAIN! Check the view area hasn't changed at all.
        // Check the pixel a couple times as it reconnects.
        // NOTE: Remember, idle behavior is still on at this point -
        // if this test takes longer than 5s shit WILL go south!
        probe.x = center.x + dim.width / 100
        probe.y = center.y
        await scene.expectPixelColor(TEST_COLORS.GREY, probe, 15)
        await page.waitForTimeout(1000)
        await scene.expectPixelColor(TEST_COLORS.GREY, probe, 15)
        probe = { ...center }

        // Ensure we're still connected
        await networkToggle.hover()
        await expect(
          networkToggleConnectedText.or(networkToggleWeakText)
        ).toBeVisible()
      })
    }
  )
})
