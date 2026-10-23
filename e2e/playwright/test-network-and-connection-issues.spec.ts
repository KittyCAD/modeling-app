import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { circleMove, getUtils, TEST_COLORS } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Test network related behaviors', { tag: '@desktop' }, () => {
  test(
    'simulate network down and network little widget',
    { tag: '@skipLocalEngine' },
    async ({ page, homePage, toolbar, scene, cmdBar }) => {
      const networkToggleConnectedText = page.getByText(
        'Network health (Strong)'
      )
      const networkToggleWeakText = page.getByText('Network health (Ok)')

      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.waitForAuthentication()
      await homePage.goToModelingScene()
      await scene.settled()

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

      // Turn off the network
      await u.emulateNetworkConditions({
        offline: true,
        // values of 0 remove any active throttling. crbug.com/456324#c9
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })

      // Expect the network to be down
      await expect(networkToggle).toContainText('Network health (Offline)')
      await expect(scene.networkToggleConnected).toHaveCount(0)

      // Click the network toggle
      await networkToggle.click()

      // Check the modal opened.
      await expect(networkPopover).toBeVisible()

      // Click off the modal.
      await page.mouse.click(0, 0)
      await expect(networkPopover).not.toBeVisible()

      // Turn back on the network
      await u.emulateNetworkConditions({
        offline: false,
        // values of 0 remove any active throttling. crbug.com/456324#c9
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })

      await expect(toolbar.startSketchBtn).not.toBeDisabled({
        timeout: 15000,
      })

      // (Second check) expect the network to be up
      await expect(
        networkToggleConnectedText.or(networkToggleWeakText)
      ).toBeVisible()
      await expect(scene.networkToggleConnected).toBeVisible()
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
