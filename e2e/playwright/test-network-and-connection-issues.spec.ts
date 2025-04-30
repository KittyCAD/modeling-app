import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'

import {
  commonPoints,
  getUtils,
  TEST_COLORS,
  circleMove,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe(
  'Test network related behaviors',
  {
    tag: ['@macos', '@windows'],
  },
  () => {
    test(
      'simulate network down and network little w1dget',
      { tag: '@skipLocalEngine' },
      async ({ page, homePage }) => {
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()

        const networkToggle = page.getByTestId('network-toggle')

        // This is how we wait until the stream is online
        await expect(
          page.getByRole('button', { name: 'Start Sketch' })
        ).not.toBeDisabled({ timeout: 15000 })

        const networkWidget = page.locator('[data-testid="network-toggle"]')
        await expect(networkWidget).toBeVisible()
        await networkWidget.hover()

        const networkPopover = page.locator('[data-testid="network-popover"]')
        await expect(networkPopover).not.toBeVisible()

        // (First check) Expect the network to be up
        await expect(networkToggle).toContainText('Connected')

        // Click the network widget
        await networkWidget.click()

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
        await expect(networkToggle).toContainText('Problem')

        // Click the network widget
        await networkWidget.click()

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

        await expect(
          page.getByRole('button', { name: 'Start Sketch' })
        ).not.toBeDisabled({ timeout: 15000 })

        // (Second check) expect the network to be up
        await expect(networkToggle).toContainText('Connected')
      }
    )

    test(
      'Engine disconnect & reconnect in sketch mode',
      { tag: '@skipLocalEngine' },
      async ({ page, homePage, toolbar, scene, cmdBar }) => {
        const networkToggle = page.getByTestId('network-toggle')

        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })
        const PUR = 400 / 37.5 //pixeltoUnitRatio

        await homePage.goToModelingScene()
        await u.waitForPageLoad()

        await u.openDebugPanel()
        // click on "Start Sketch" button
        await u.clearCommandLogs()
        await page.getByRole('button', { name: 'Start Sketch' }).click()
        await page.waitForTimeout(100)

        // select a plane
        await page.mouse.click(700, 200)

        await expect(page.locator('.cm-content')).toHaveText(
          `sketch001 = startSketchOn(XZ)`
        )
        await u.closeDebugPanel()

        await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

        const startXPx = 600
        await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
        await expect(page.locator('.cm-content')).toHaveText(
          `sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${commonPoints.startAt})`
        )
        await page.waitForTimeout(100)

        await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
        await page.waitForTimeout(100)

        await expect(
          page.locator('.cm-content')
        ).toHaveText(`sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${commonPoints.startAt})
      |> xLine(length = ${commonPoints.num1})`)

        // Expect the network to be up
        await expect(networkToggle).toContainText('Connected')

        // simulate network down
        await u.emulateNetworkConditions({
          offline: true,
          // values of 0 remove any active throttling. crbug.com/456324#c9
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })

        // Expect the network to be down
        await expect(networkToggle).toContainText('Problem')

        // Ensure we are not in sketch mode
        await expect(
          page.getByRole('button', { name: 'Exit Sketch' })
        ).not.toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Start Sketch' })
        ).toBeVisible()

        // simulate network up
        await u.emulateNetworkConditions({
          offline: false,
          // values of 0 remove any active throttling. crbug.com/456324#c9
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })

        // Wait for the app to be ready for use
        await expect(
          page.getByRole('button', { name: 'Start Sketch' })
        ).not.toBeDisabled({ timeout: 15000 })

        // Expect the network to be up
        await expect(networkToggle).toContainText('Connected')
        await scene.settled(cmdBar)

        // Click off the code pane.
        await page.mouse.click(100, 100)

        // select a line
        await page
          .getByText(`startProfile(sketch001, at = ${commonPoints.startAt})`)
          .click()

        // enter sketch again
        await toolbar.editSketch()

        // Click the line tool
        await page
          .getByRole('button', { name: 'line Line', exact: true })
          .click()

        await page.waitForTimeout(150)

        const camCommand: EngineCommand = {
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_look_at',
            center: { x: 109, y: 0, z: -152 },
            vantage: { x: 115, y: -505, z: -152 },
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
        await toolbar.openPane('debug')
        await u.sendCustomCmd(camCommand)
        await page.waitForTimeout(100)
        await u.sendCustomCmd(updateCamCommand)
        await page.waitForTimeout(100)

        // click to continue profile
        await page.mouse.click(1007, 400)
        await page.waitForTimeout(100)
        // Ensure we can continue sketching
        await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
        await expect
          .poll(u.normalisedEditorCode)
          .toBe(`sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [12.34, -12.34])
  |> xLine(length = 12.34)
  |> line(end = [-12.34, 12.34])

`)
        await page.waitForTimeout(100)
        await page.mouse.click(startXPx, 500 - PUR * 20)

        await expect
          .poll(u.normalisedEditorCode)
          .toBe(`sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [12.34, -12.34])
  |> xLine(length = 12.34)
  |> line(end = [-12.34, 12.34])
  |> xLine(length = -12.34)

`)

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
        await page.keyboard.press('Escape')
        await expect(
          page.getByRole('button', { name: 'Exit Sketch' })
        ).not.toBeVisible()
      }
    )

    test(
      'Paused stream freezes view frame, unpause reconnect is seamless to user',
      { tag: '@skipLocalEngine' },
      async ({ page, homePage, scene, cmdBar, toolbar }) => {
        const networkToggle = page.getByTestId('network-toggle')
        const networkToggleConnectedText = page.getByText('Connected')
        const networkToggleWeakText = page.getByText('Network health (Weak)')
        const userSettingsTab = page.getByRole('radio', { name: 'User' })
        const appStreamIdleModeSetting = page.getByTestId('app-streamIdleMode')
        const settingsCloseButton = page.getByTestId('settings-close-button')

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
          await scene.settled(cmdBar)
        })

        await test.step('Set stream idle pause time to 5s', async () => {
          await page.getByRole('link', { name: 'Settings' }).last().click()
          await expect(
            page.getByRole('heading', { name: 'Settings', exact: true })
          ).toBeVisible()
          await userSettingsTab.click()
          await appStreamIdleModeSetting.click()
          await appStreamIdleModeSetting.selectOption('5000')
          await settingsCloseButton.click()
          await expect(
            page.getByText('Set stream idle mode to "5000" as a user default')
          ).toBeVisible()
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
  }
)
