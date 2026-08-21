import { TEST_COLORS, circleMove, getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Test network related behaviors', { tag: '@desktop' }, () => {
  test(
    'simulate network down and network little widget',
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
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0.0, 0.0])
  |> line(end = [10.0, 0])
  |> line(end = [0, 10.0])
  |> close()`
      )

      const dimensions = { width: 1200, height: 500 }
      const modelProbe = {
        x: dimensions.width / 2 + dimensions.width / 100,
        y: dimensions.height / 2,
      }
      await page.setBodyDimensions(dimensions)

      await homePage.goToModelingScene()
      await scene.settled()
      await scene.expectPixelColor(TEST_COLORS.GREY, modelProbe, 15)

      const networkToggle = page.getByTestId(/network-toggle/)

      // This is how we wait until the stream is online
      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 15000,
      })

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
      await page.mouse.click(modelProbe.x, modelProbe.y, { button: 'right' })
      await expect(viewControlsMenu).toBeVisible()

      // Exercise Chromium's actual offline path so the WebSocket and WebRTC
      // transports close in the same order they do for a real network loss.
      await context.setOffline(true)
      try {
        await expect
          .poll(() => page.evaluate(() => navigator.onLine))
          .toBe(false)
        await expect(networkToggle).toContainText('Network health (Offline)')
        await expect(scene.engineConnectionsSpinner).not.toBeVisible()
        await expect(scene.streamWrapper).toHaveAttribute('inert')
        await expect(
          page.getByTestId('engine-scene-view-extension-overlay')
        ).toHaveAttribute('inert')
        await expect(viewControlsMenu).not.toBeVisible()
        await expect(toolbar.startSketchBtn).toBeDisabled()
        await page.keyboard.press('s')
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            )
        )
        await expect(toolbar.exitSketchBtn).not.toBeVisible()
        await scene.expectPixelColor(TEST_COLORS.GREY, modelProbe, 15)

        // The Network Health popover remains the one available interaction.
        await networkToggle.click()
        await expect(networkPopover).toBeVisible()
        await networkToggle.click()
        await expect(networkPopover).not.toBeVisible()
      } finally {
        await context.setOffline(false)
      }

      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 10_000,
      })
      await expect(scene.streamWrapper).not.toHaveAttribute('inert')
      await expect(
        page.getByTestId('engine-scene-view-extension-overlay')
      ).not.toHaveAttribute('inert')

      // (Second check) expect the network to be up
      await expect(networkToggle).toContainText(
        /Network health \((Strong|Ok)\)/
      )

      // A terminal websocket failure still needs an explicit escape hatch.
      await page.evaluate(() => {
        window.engineCommandManager.tearDown({
          websocketClosed: true,
          code: '1006',
        })
      })
      await expect(scene.engineConnectionsSpinner).toBeVisible()
      await expect(scene.streamWrapper).not.toHaveAttribute('inert')
      await expect(scene.engineConnectionsSpinner).toHaveAttribute(
        'role',
        'alert'
      )
      await expect(scene.engineConnectionsSpinner).toContainText(
        'Failed to connect.'
      )
      await expect(
        scene.engineConnectionsSpinner.getByRole('button', {
          name: /reconnect/i,
        })
      ).toBeVisible()
      await scene.engineConnectionsSpinner
        .getByRole('button', { name: /reconnect/i })
        .click()
      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 15_000,
      })
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

      if (!tronApp) throw new Error('tronApp is missing.')

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
