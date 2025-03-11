import { test, expect } from './zoo-test'
import { commonPoints, getUtils } from './test-utils'
import { EngineCommand } from 'lang/std/artifactGraph'
import { uuidv4 } from 'lib/utils'

test.describe('Test network and connection issues', () => {
  test(
    'simulate network down and network little widget',
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
    async ({ page, homePage }) => {
      // TODO: Don't skip Mac for these. After `window.engineCommandManager.tearDown` is working in Safari, these should work on webkit
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
        `sketch001 = startSketchOn('XZ')`
      )
      await u.closeDebugPanel()

      await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

      const startXPx = 600
      await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
      await expect(page.locator('.cm-content')).toHaveText(
        `sketch001 = startSketchOn('XZ')profile001 = startProfileAt(${commonPoints.startAt}, sketch001)`
      )
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
      await page.waitForTimeout(100)

      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn('XZ')profile001 = startProfileAt(${commonPoints.startAt}, sketch001)
      |> xLine(${commonPoints.num1}, %)`)

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
      await expect(page.getByTestId('loading-stream')).not.toBeAttached()

      // Click off the code pane.
      await page.mouse.click(100, 100)

      // select a line
      await page
        .getByText(`startProfileAt(${commonPoints.startAt}, sketch001)`)
        .click()

      // enter sketch again
      await u.doAndWaitForCmd(
        () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
        'default_camera_get_settings'
      )
      await page.waitForTimeout(150)

      // Click the line tool
      await page.getByRole('button', { name: 'line Line', exact: true }).click()

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
      await u.sendCustomCmd(camCommand)
      await page.waitForTimeout(100)
      await u.sendCustomCmd(updateCamCommand)
      await page.waitForTimeout(100)

      // click to continue profile
      await page.mouse.click(1007, 400)
      await page.waitForTimeout(100)
      // Ensure we can continue sketching
      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
      await expect.poll(u.normalisedEditorCode)
        .toBe(`sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([12.34, -12.34], sketch001)
  |> xLine(12.34, %)
  |> line(end = [-12.34, 12.34])

`)
      await page.waitForTimeout(100)
      await page.mouse.click(startXPx, 500 - PUR * 20)

      await expect.poll(u.normalisedEditorCode)
        .toBe(`sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([12.34, -12.34], sketch001)
  |> xLine(12.34, %)
  |> line(end = [-12.34, 12.34])
  |> xLine(-12.34, %)

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
})
