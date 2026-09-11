import { expect, test } from '@e2e/playwright/zoo-test'
import type { Locator, Page } from '@playwright/test'
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

async function expectRenderedFrame(image: Locator) {
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate((element: HTMLVideoElement | HTMLCanvasElement) => {
        if (element instanceof HTMLVideoElement && element.readyState < 2)
          return false
        const canvas = document.createElement('canvas')
        canvas.width = 16
        canvas.height = 9
        const context = canvas.getContext('2d')!
        context.drawImage(element, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        return pixels.data.some((value, index) => index % 4 !== 3 && value > 10)
      })
    )
    .toBe(true)
}

test.describe('Engine recovery', { tag: ['@web', '@skipLocalEngine'] }, () => {
  test.use({
    userFeatures: [
      EXPERIMENTAL_POINT_AND_CLICK_FLAG,
      SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
    ],
  })
  test.describe.configure({ timeout: 120_000 })

  test('keeps the last frame visible while waking from idle', async ({
    page,
    scene,
    editor,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await setIdleTimeout(page, 0)
    await editor.replaceCode('', model)
    await scene.connectionEstablished()
    await scene.settled()
    const video = page.locator('video#video-stream')
    const freeze = page.locator('canvas#freeze-frame')
    const peer = await page.evaluateHandle(
      () => window.engineCommandManager.connection!.peerConnection!
    )

    try {
      await expectRenderedFrame(video)
      await setIdleTimeout(page, 5000)
      await expect(freeze).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(() => peer.evaluate((peer) => peer.connectionState))
        .toBe('closed')
      await expectRenderedFrame(freeze)

      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await expect(
        page.getByRole('status').filter({ hasText: 'Reconnecting' })
      ).toBeVisible()
      await expect(freeze).toBeVisible()
      await setIdleTimeout(page, 0)

      await expect
        .poll(
          () =>
            peer.evaluate(
              (oldPeer) =>
                window.engineCommandManager.connection?.peerConnection !==
                  oldPeer &&
                window.engineCommandManager.connection?.peerConnection
                  ?.connectionState === 'connected'
            ),
          { timeout: 40_000 }
        )
        .toBe(true)
      await expect(freeze).not.toBeVisible()
      await expectRenderedFrame(video)
    } finally {
      await setIdleTimeout(page, 0)
      await peer.dispose()
    }
  })
})
