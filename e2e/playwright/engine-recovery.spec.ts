import { expect, test } from '@e2e/playwright/zoo-test'
import type { Locator, Page } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'

const model = `@settings(kclVersion = 2.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2.5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 5mm)`
const freeze = (page: Page) => page.locator('canvas#freeze-frame')
const reconnecting = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Reconnecting' })
const recovery = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Failed to connect.' })

async function setIdleTimeout(page: Page, value: number) {
  await page.evaluate((value) => {
    window.app.settings.send({
      type: 'set.app.streamIdleMode',
      data: { level: 'user', value },
    })
  }, value)
}

async function expectModelFrame(image: Locator) {
  await expect(image).toBeVisible()
  await expect
    .poll(
      () =>
        image.evaluate((element: HTMLVideoElement | HTMLCanvasElement) => {
          if (element instanceof HTMLVideoElement && element.readyState < 2)
            return false
          const canvas = document.createElement('canvas')
          canvas.width = 32
          canvas.height = 18
          const context = canvas.getContext('2d')!
          context.drawImage(element, 0, 0, 32, 18)
          const pixels = context.getImageData(0, 0, 32, 18).data
          // These centered models leave the top-left pixel as background.
          const background = (pixels[0] + pixels[1] + pixels[2]) / 3
          let total = 0
          let foreground = 0
          for (let i = 0; i < pixels.length; i += 4) {
            const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
            total += brightness
            if (Math.abs(brightness - background) > 40) foreground++
          }
          const mean = total / (32 * 18)
          // Require a model-sized foreground, not just a non-black background.
          return mean > 10 && mean < 248 && foreground >= 32
        }),
      {
        message:
          'Video contains the model, not black or the blank startup background',
      }
    )
    .toBe(true)
}

async function expectRecovered(page: Page, reconnect: () => Promise<unknown>) {
  // Retained body rows and a visible video can both belong to the old session.
  const before = await page.evaluateHandle(() => ({
    video: document.querySelector<HTMLVideoElement>('video#video-stream')!,
    source:
      document.querySelector<HTMLVideoElement>('video#video-stream')!.srcObject,
    connection: window.engineCommandManager.connection,
    logStart: window.engineDebugger.logs.length,
    code: window.app.singletons.kclManager.code,
  }))
  try {
    await reconnect()
    await expect
      .poll(
        () =>
          before.evaluate((before) => {
            const connection = window.engineCommandManager.connection
            const logs = window.engineDebugger.logs.slice(before.logStart)
            const loaded = logs.findLastIndex(
              (log) => log.message === 'setIsSceneReady(true)'
            )
            const ready = logs.findLastIndex(
              (log) =>
                log.label === 'tryConnecting' &&
                log.message === 'setAppState({ isStreamAcceptingInput: true })'
            )
            return Boolean(
              connection &&
                connection !== before.connection &&
                connection.peerConnection?.connectionState === 'connected' &&
                before.video.srcObject &&
                before.video.srcObject !== before.source &&
                before.video.srcObject === connection.mediaStream &&
                loaded >= 0 &&
                ready > loaded
            )
          }),
        {
          timeout: 40_000,
          message: 'Replacement stream, scene and camera are ready',
        }
      )
      .toBe(true)
    await expect(freeze(page)).not.toBeVisible()
    await expect(recovery(page)).not.toBeVisible()
    await expect(reconnecting(page)).not.toBeVisible()
    const video = page.locator('video#video-stream')
    await expect(video).toBeVisible()
    await video.evaluate(
      (video: HTMLVideoElement) =>
        new Promise<void>((resolve, reject) => {
          const source = video.srcObject
          const connection = window.engineCommandManager.connection
          let first: VideoFrameCallbackMetadata | undefined
          let frame = 0
          const finish = (error?: string) => {
            clearTimeout(timeout)
            video.cancelVideoFrameCallback(frame)
            if (error) reject(new Error(error))
            else resolve()
          }
          const timeout = setTimeout(
            () => finish('Recovered video stopped presenting frames'),
            5000
          )
          const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (
              video.srcObject !== source ||
              window.engineCommandManager.connection !== connection ||
              source !== connection?.mediaStream ||
              connection.peerConnection?.connectionState !== 'connected'
            ) {
              finish('Recovered connection changed during playback')
              return
            }
            first ??= metadata
            // WebKit can keep mediaTime at zero for live WebRTC streams.
            // Presentation timestamps still advance with the rendered frames.
            if (
              metadata.presentedFrames > first.presentedFrames + 3 &&
              metadata.presentationTime > first.presentationTime
            ) {
              finish()
              return
            }
            frame = video.requestVideoFrameCallback(onFrame)
          }
          frame = video.requestVideoFrameCallback(onFrame)
        })
    )
    await expectModelFrame(video)
    await expect(
      page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: 'Body 1', exact: true })
    ).toHaveCount(1)
    expect(
      await before.evaluate(
        ({ code }) => window.app.singletons.kclManager.code === code
      )
    ).toBe(true)
  } finally {
    await before.dispose()
  }
}

test.describe('Engine recovery', { tag: ['@web', '@skipLocalEngine'] }, () => {
  test.use({
    userFeatures: [
      EXPERIMENTAL_POINT_AND_CLICK_FLAG,
      SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
    ],
  })
  test.describe.configure({ timeout: 120_000 })

  test.beforeEach(async ({ page, scene, editor, toolbar }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await setIdleTimeout(page, 0)
    await editor.replaceCode('', model)
    await scene.connectionEstablished()
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await expect(
      page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: 'Body 1', exact: true })
    ).toBeVisible()
    await expectModelFrame(page.locator('video#video-stream'))
  })

  test.afterEach(async ({ page }) => {
    await setIdleTimeout(page, 0)
    await page.context().setOffline(false)
  })

  test('a point-and-click body survives three idle wakes', async ({
    page,
    scene,
    toolbar,
    editor,
    cmdBar,
  }) => {
    test.setTimeout(180_000)
    await editor.replaceCode('', '@settings(kclVersion = 2.0)')
    await expect(
      page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: 'Body 1', exact: true })
    ).toHaveCount(0)
    await scene.settled()
    await toolbar.startSketchOnDefaultPlane('Top plane')
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.rectangleBtn.click()
    await scene.makeMouseHelpers(0.35, 0.35, { format: 'ratio' })[0]()
    await scene.makeMouseHelpers(0.65, 0.65, { format: 'ratio' })[0]()
    await toolbar.exitSketch()
    await scene.settled()
    await toolbar.extrudeButton.click()
    await scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })[0]()
    await cmdBar.progressCmdBar()
    await cmdBar.argumentInput.locator('[contenteditable]').fill('5mm')
    await cmdBar.progressCmdBar()
    await cmdBar.submit()
    await scene.settled()

    for (let cycle = 0; cycle < 3; cycle++) {
      const peer = await page.evaluateHandle(
        () => window.engineCommandManager.connection!.peerConnection!
      )
      try {
        await setIdleTimeout(page, 5000)
        await expect(freeze(page)).toBeVisible({ timeout: 15_000 })
        await expect
          .poll(() => peer.evaluate((peer) => peer.connectionState))
          .toBe('closed')
        await expectModelFrame(freeze(page))
        await expectRecovered(page, async () => {
          await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
          await expect(reconnecting(page)).toBeVisible()
          await expect(freeze(page)).toBeVisible()
          await setIdleTimeout(page, 0)
        })
      } finally {
        await peer.dispose()
      }
    }
  })

  test('three browser offline/online cycles preserve the active scene', async ({
    page,
  }) => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const peer = await page.evaluateHandle(
        () => window.engineCommandManager.connection!.peerConnection!
      )
      try {
        await page.context().setOffline(true)
        await expect
          .poll(() => page.evaluate(() => navigator.onLine))
          .toBe(false)
        await expect(recovery(page)).toBeVisible()
        await expect
          .poll(() => peer.evaluate((peer) => peer.connectionState))
          .toBe('closed')
        await expectModelFrame(freeze(page))
        await expectRecovered(page, () => page.context().setOffline(false))
      } finally {
        await peer.dispose()
      }
    }
  })

  for (const failure of ['websocket', 'data-channel']) {
    test(`${failure} closure preserves the scene through recovery`, async ({
      page,
    }) => {
      const state = await page.evaluateHandle(() => {
        const manager = window.engineCommandManager
        const connection = manager.connection!
        const start = manager.start.bind(manager)
        let held = false
        let resume = () => {}
        let removeCloseListener = () => {}
        const pending = new Promise<void>((resolve) => {
          resume = resolve
        })
        // Keep the replacement from hiding a black gap before we can inspect it.
        manager.start = async (...args) => {
          held = true
          await pending
          return start(...args)
        }
        return {
          close: async (failure: string, eventName: string) => {
            if (failure === 'data-channel') {
              connection.unreliableDataChannel!.close()
              return undefined
            }
            let code: string | undefined
            const onClose = (event: Event) => {
              code = (event as CustomEvent<{ code?: string }>).detail?.code
            }
            // The data channel may close first. Follow the notification the app handled,
            // rather than assuming close(1000) causes automatic recovery.
            manager.addEventListener(eventName, onClose)
            removeCloseListener = () =>
              manager.removeEventListener(eventName, onClose)
            const websocket = connection.websocket!
            const closed = new Promise<void>((resolve) => {
              websocket.addEventListener('close', () => resolve(), {
                once: true,
              })
            })
            websocket.close(1000)
            await closed
            return code
          },
          held: () => held,
          peerState: () => connection.peerConnection?.connectionState,
          resume: () => {
            removeCloseListener()
            manager.start = start
            resume()
          },
        }
      })
      try {
        const code = await state.evaluate(
          (state, { failure, eventName }) => state.close(failure, eventName),
          { failure, eventName: EngineConnectionManagerEvents.WebsocketClosed }
        )
        await expect
          .poll(() => state.evaluate((state) => state.peerState()))
          .toBe('closed')
        expect(await page.evaluate(() => navigator.onLine)).toBe(true)
        await expectModelFrame(freeze(page))
        if (code === '1006') {
          await expect(recovery(page)).toBeVisible()
          expect(await state.evaluate((state) => state.held())).toBe(false)
          await recovery(page)
            .getByRole('button', { name: /Reconnect/ })
            .click()
        }
        await expect
          .poll(() => state.evaluate((state) => state.held()))
          .toBe(true)
        await expect(recovery(page)).not.toBeVisible()
        await expectModelFrame(freeze(page))
        await expectRecovered(page, () =>
          state.evaluate((state) => state.resume())
        )
      } finally {
        await state.evaluate((state) => state.resume())
        await state.dispose()
      }
    })
  }

  test('an exhausted idle wake recovers through the Reconnect button', async ({
    page,
    scene,
  }) => {
    await setIdleTimeout(page, 5000)
    await expect(freeze(page)).toBeVisible({ timeout: 15_000 })
    const starts = await page.evaluateHandle(() => {
      const manager = window.engineCommandManager
      const originalStart = manager.start.bind(manager)
      let attempts = 0
      let rejectFirst = () => {}
      manager.start = async () => {
        attempts++
        if (attempts === 1)
          await new Promise<void>((_resolve, reject) => {
            rejectFirst = () =>
              reject(new Error('Injected Engine-start failure'))
          })
        throw new Error('Injected Engine-start failure')
      }
      return {
        attempts: () => attempts,
        reject: () => rejectFirst(),
        restore: () => {
          manager.start = originalStart
        },
      }
    })
    try {
      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await expect(reconnecting(page)).toBeVisible()
      await setIdleTimeout(page, 0)
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(1)
      await starts.evaluate((state) => state.reject())
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(5)
      await expect(recovery(page)).toBeVisible()
      await expect(reconnecting(page)).not.toBeVisible()
      await expectModelFrame(freeze(page))
    } finally {
      await starts.evaluate((state) => state.restore())
      await starts.dispose()
    }
    await expectRecovered(page, () =>
      recovery(page)
        .getByRole('button', { name: /Reconnect/ })
        .click()
    )
  })
})
