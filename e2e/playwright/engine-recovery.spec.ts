import { expect, test } from '@e2e/playwright/zoo-test'
import type { JSHandle, Locator, Page } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

const model = `@settings(kclVersion = 2.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2.5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 5mm)`

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
    .poll(() =>
      image.evaluate((element: HTMLVideoElement | HTMLCanvasElement) => {
        if (element instanceof HTMLVideoElement && element.readyState < 2)
          return false
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 18
        const context = canvas.getContext('2d')!
        context.drawImage(element, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, 32, 18).data
        const background = (pixels[0] + pixels[1] + pixels[2]) / 3
        let foreground = 0
        let total = 0
        for (let index = 0; index < pixels.length; index += 4) {
          const brightness =
            (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3
          total += brightness
          if (Math.abs(brightness - background) > 40) foreground++
        }
        const mean = total / (32 * 18)
        return mean > 10 && mean < 248 && foreground >= 32
      })
    )
    .toBe(true)
}

async function expectRecovered(
  page: Page,
  previousPeer: JSHandle<RTCPeerConnection>
) {
  await expect
    .poll(
      () =>
        previousPeer.evaluate((previousPeer) => {
          const connection = window.engineCommandManager.connection
          const video =
            document.querySelector<HTMLVideoElement>('video#video-stream')
          return Boolean(
            connection?.peerConnection !== previousPeer &&
              connection?.peerConnection?.connectionState === 'connected' &&
              video?.srcObject === connection.mediaStream
          )
        }),
      { timeout: 40_000 }
    )
    .toBe(true)
  await expect(page.locator('canvas#freeze-frame')).not.toBeVisible()
  await expectModelFrame(page.locator('video#video-stream'))
}

test.describe('Engine recovery', { tag: ['@web', '@skipLocalEngine'] }, () => {
  test.use({
    userFeatures: [
      EXPERIMENTAL_POINT_AND_CLICK_FLAG,
      SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
    ],
  })
  test.describe.configure({ timeout: 120_000 })

  test.beforeEach(async ({ page, scene, editor }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await setIdleTimeout(page, 0)
    await editor.replaceCode('', model)
    await scene.connectionEstablished()
    await scene.settled()
    await expectModelFrame(page.locator('video#video-stream'))
  })

  test.afterEach(async ({ page }) => {
    await page.context().setOffline(false)
    await setIdleTimeout(page, 0)
  })

  test('keeps the last frame visible while waking from idle', async ({
    page,
    scene,
  }) => {
    const freeze = page.locator('canvas#freeze-frame')
    const peer = await page.evaluateHandle(
      () => window.engineCommandManager.connection!.peerConnection!
    )

    try {
      await setIdleTimeout(page, 5000)
      await expect(freeze).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(() => peer.evaluate((peer) => peer.connectionState))
        .toBe('closed')
      await expectModelFrame(freeze)

      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await expect(
        page.getByRole('status').filter({ hasText: 'Reconnecting' })
      ).toBeVisible()
      await expect(freeze).toBeVisible()
      await setIdleTimeout(page, 0)
      await expectRecovered(page, peer)
    } finally {
      await peer.dispose()
    }
  })

  test('keeps the last frame visible while recovering from offline', async ({
    page,
  }) => {
    const freeze = page.locator('canvas#freeze-frame')
    const peer = await page.evaluateHandle(
      () => window.engineCommandManager.connection!.peerConnection!
    )

    try {
      await page.context().setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await expect(
        page.getByRole('alert').filter({ hasText: 'Failed to connect.' })
      ).toBeVisible()
      await expect
        .poll(() => peer.evaluate((peer) => peer.connectionState))
        .toBe('closed')
      await expectModelFrame(freeze)

      await page.context().setOffline(false)
      await expectRecovered(page, peer)
    } finally {
      await peer.dispose()
    }
  })
})
