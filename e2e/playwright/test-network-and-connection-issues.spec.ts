import type { Page } from '@playwright/test'
import {
  TEST_COLORS,
  circleMove,
  getUtils,
  openPane,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

const IDLE_DISCONNECT_REPRO_KCL = `@settings(experimentalFeatures = allow)

plane001 = offsetPlane(XZ, offset = 5)

sketch001 = sketch(on = plane001) {
  circle1 = circle(start = [var -2.24mm, var 0mm], center = [var -2.98mm, var 1.13mm])
}
sketch002 = sketch(on = XZ) {
  circle1 = circle(start = [var 0.24mm, var -1.85mm], center = [var 1.28mm, var -2.73mm])
}
sketch003 = sketch(on = XZ) {
  circle1 = circle(start = [var 2.55mm, var 2.23mm], center = [var 1.63mm, var 3.67mm])
}
sketch004 = sketch(on = XZ) {
}
sketch005 = sketch(on = XZ) {
  circle1 = circle(start = [var -4.99mm, var 4.55mm], center = [var -6.39mm, var 5.71mm])
}
`

type BrowserConsoleEntry = {
  args: unknown[]
  text: string
  type: string
}

async function collectIdleDisconnectDebugState(page: Page) {
  return page.evaluate(() => {
    const w = window as any

    return {
      isExecuting: w.kclManager?.isExecuting ?? null,
      code: w.kclManager?.code ?? '',
      debugSnapshot: w.engineCommandManager?.getDebugSnapshot?.() ?? null,
      recentCommandLogs: (w.engineCommandManager?.commandLogs ?? []).slice(-50),
      recentEngineLogs: (w.engineDebugger?.logs ?? []).slice(-300),
    }
  })
}

async function dragSceneWhileDisconnected(page: Page, scene: any) {
  const dragSequences: Array<{
    from: [number, number]
    to: [number, number]
    modifier?: 'Shift' | 'Control'
  }> = [
    { from: [780, 240], to: [930, 210] },
    { from: [760, 300], to: [860, 360], modifier: 'Shift' },
    { from: [900, 360], to: [900, 250], modifier: 'Control' },
  ]

  for (const drag of dragSequences) {
    const start = await scene.convertPagePositionToStream(
      drag.from[0],
      drag.from[1]
    )
    const end = await scene.convertPagePositionToStream(drag.to[0], drag.to[1])

    if (drag.modifier) {
      await page.keyboard.down(drag.modifier)
    }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up({ button: 'right' })

    if (drag.modifier) {
      await page.keyboard.up(drag.modifier)
    }

    await page.waitForTimeout(150)
  }
}

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

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

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
    }
  )

  test(
    'Engine disconnect & reconnect in sketch mode',
    { tag: '@skipLocalEngine' },
    async ({ page, homePage, toolbar, scene, cmdBar, editor }) => {
      const networkToggle = page.getByTestId(/network-toggle/)
      const networkToggleConnectedText = page.getByText(
        'Network health (Strong)'
      )
      const networkToggleWeakText = page.getByText('Network health (Ok)')

      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await u.waitForPageLoad()

      await u.openDebugPanel()
      // click on "Start Sketch" button
      await toolbar.startSketchOnDefaultPlane('Front plane')

      await expect(page.locator('.cm-content')).toHaveText(
        `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)`
      )
      await u.closeDebugPanel()

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

      await scene.settled(cmdBar)

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
      await page.keyboard.press('Escape')
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
        await scene.settled(cmdBar)
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

  test(
    'Feature tree settles within 10s after simulated idle reconnect',
    { tag: '@skipLocalEngine' },
    async ({ page, homePage, scene, cmdBar, editor, tronApp }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      const u = await getUtils(page)
      const browserConsoleEntries: BrowserConsoleEntry[] = []

      page.on('console', (message) => {
        if (
          !message.text().includes('[engine-debug][500ms]') &&
          !message.text().includes('tearing down connection through idle path.')
        ) {
          return
        }

        void Promise.all(
          message.args().map((arg) => arg.jsonValue().catch(() => null))
        ).then((args) => {
          browserConsoleEntries.push({
            type: message.type(),
            text: message.text(),
            args,
          })
        })
      })

      await tronApp.cleanProjectDir({
        app: {
          show_debug_panel: true,
          stream_idle_mode: 120_000,
        },
      })

      await page.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, IDLE_DISCONNECT_REPRO_KCL)

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await test.step('Go to modeling scene with repro code loaded', async () => {
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain(IDLE_DISCONNECT_REPRO_KCL, {
          shouldNormalise: true,
          timeout: 20_000,
        })
        await openPane(page, 'feature-tree-pane-button')
        await u.openDebugPanel()
        await u.clearCommandLogs()
        await page.evaluate(() => {
          ;(window as any).engineDebugger.logs = []
        })
      })

      const featureTreeSpinner = page.getByText('Building feature tree...')
      await expect(featureTreeSpinner).not.toBeVisible()

      await test.step('Simulate idle disconnect and trigger reconnect', async () => {
        await expect(page.getByTestId('simulate-idle-disconnect')).toBeVisible()
        await page.getByTestId('simulate-idle-disconnect').click()

        await page.waitForFunction(() => {
          const w = window as any
          return (
            !w.engineCommandManager?.started &&
            !w.engineCommandManager?.connection
          )
        })

        await dragSceneWhileDisconnected(page, scene)
        await scene.moveNoWhere(20)

        await page.waitForFunction(() => {
          const w = window as any
          const connection = w.engineCommandManager?.connection

          return Boolean(
            w.engineCommandManager?.started &&
              connection &&
              connection.websocket?.readyState === WebSocket.OPEN &&
              connection.mediaStream
          )
        })

        await page.waitForFunction(() => {
          const w = window as any
          return (w.engineDebugger?.logs ?? []).some(
            (log: any) =>
              log.label === 'onEngineConnectionReadyForRequests' &&
              log.message === 'kclManager.executeCode()'
          )
        })
      })

      await test.step('Feature tree should stop building promptly after reconnect', async () => {
        try {
          await expect
            .poll(
              async () => ({
                isExecuting: await page.evaluate(
                  () => (window as any).kclManager?.isExecuting ?? null
                ),
                spinnerVisible: await featureTreeSpinner.isVisible(),
              }),
              {
                timeout: 10_000,
                message:
                  'Feature tree stayed in the building state for more than 10 seconds after reconnect.',
              }
            )
            .toEqual({
              isExecuting: false,
              spinnerVisible: false,
            })
        } catch (error) {
          const debugState = await collectIdleDisconnectDebugState(page)

          await test.info().attach('idle-disconnect-debug-state', {
            body: JSON.stringify(debugState, null, 2),
            contentType: 'application/json',
          })

          await test.info().attach('idle-disconnect-pending-command-events', {
            body: JSON.stringify(
              debugState.debugSnapshot?.recentPendingCommandEvents ?? [],
              null,
              2
            ),
            contentType: 'application/json',
          })

          await test.info().attach('idle-disconnect-console', {
            body: JSON.stringify(browserConsoleEntries.slice(-100), null, 2),
            contentType: 'application/json',
          })

          throw error
        }
      })
    }
  )
})
