import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.use({
  userFeatures: [
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
  ],
})

test(
  'idle closes the peer and resumes fresh video on three successive wakes',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, toolbar, editor, cmdBar }, testInfo) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1400, height: 900 })
    await editor.replaceCode('', '@settings(kclVersion = 2.0)')
    await scene.connectionEstablished()
    await scene.settled()
    await toolbar.startSketchOnDefaultPlane('Top plane')
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await editor.expectEditor.toContain('sketch(')
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
    await toolbar.openFeatureTreePane()
    const body = page
      .locator('#bodies-list-pane')
      .getByRole('button', { name: 'Body 1', exact: true })
    await expect(body).toBeVisible()
    const originalCode = await editor.getCurrentCode()
    const video = page.locator('video#video-stream')
    const freeze = page.locator('canvas#freeze-frame')
    const waking = page.getByRole('status').filter({
      hasText: 'Waking from idle...',
    })
    await expect(waking).not.toBeVisible()
    await expect
      .poll(() =>
        video.evaluate(
          (element: HTMLVideoElement) =>
            element.getVideoPlaybackQuality().totalVideoFrames
        )
      )
      .toBeGreaterThan(5)

    try {
      for (let cycle = 1; cycle <= 3; cycle++) {
        const oldPeer = await page.evaluateHandle(
          () => window.engineCommandManager.connection?.peerConnection
        )
        const oldId = await page.evaluate(
          () => window.engineCommandManager.connection?.id
        )
        expect(oldId).toBeTruthy()
        await page.evaluate(() =>
          window.app.settings.send({
            type: 'set.app.streamIdleMode',
            data: { level: 'user', value: 5000 },
          })
        )
        await expect(freeze).toBeVisible({ timeout: 15_000 })
        await expect(waking).not.toBeVisible()
        await expect
          .poll(() => oldPeer.evaluate((peer) => peer?.connectionState))
          .toBe('closed')
        const freezePixels = await freeze.evaluate(
          (canvas: HTMLCanvasElement) => {
            const pixels = canvas
              .getContext('2d')
              ?.getImageData(0, 0, canvas.width, canvas.height).data
            if (!pixels) return 0
            let nonBlack = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8)
                nonBlack++
            }
            return nonBlack / (pixels.length / 4)
          }
        )
        expect(freezePixels).toBeGreaterThan(0.1)
        await page.screenshot({
          path: testInfo.outputPath(`idle-${cycle}.png`),
        })

        await scene.makeMouseHelpers(0.76, 0.72 + cycle * 0.01, {
          format: 'ratio',
        })[1]()
        await expect(waking).toBeVisible()
        await expect(freeze).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(`waking-${cycle}.png`),
        })
        // A green network indicator or a visible frozen canvas is not recovery.
        await expect(freeze).not.toBeVisible({ timeout: 30_000 })
        await expect(waking).not.toBeVisible()
        await expect(video).toBeVisible()
        // A fresh frame must contain the model, not the empty Engine startup
        // background (249 in this default light-theme scene).
        const mean = await video.evaluate((element: HTMLVideoElement) => {
          const sampler = document.createElement('canvas')
          sampler.width = 32
          sampler.height = 18
          const context = sampler.getContext('2d')
          if (!context) throw new Error('No video sampler context')
          context.drawImage(element, 0, 0, 32, 18)
          const pixels = context.getImageData(0, 0, 32, 18).data
          let total = 0
          for (let i = 0; i < pixels.length; i += 4) {
            total += pixels[i] + pixels[i + 1] + pixels[i + 2]
          }
          return total / (32 * 18 * 3)
        })
        expect(mean).toBeGreaterThan(10)
        expect(mean).toBeLessThan(248)
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.paused)
          )
          .toBe(false)
        await page.evaluate(() =>
          window.app.settings.send({
            type: 'set.app.streamIdleMode',
            data: { level: 'user', value: 0 },
          })
        )
        const newId = await page.evaluate(
          () => window.engineCommandManager.connection?.id
        )
        expect(newId).toBeTruthy()
        expect(newId).not.toBe(oldId)
        const frames = await video.evaluate(
          (element: HTMLVideoElement) =>
            element.getVideoPlaybackQuality().totalVideoFrames
        )
        await expect
          .poll(() =>
            video.evaluate(
              (element: HTMLVideoElement) =>
                element.getVideoPlaybackQuality().totalVideoFrames
            )
          )
          .toBeGreaterThan(frames + 3)
        await scene.settled()
        expect(await editor.getCurrentCode()).toBe(originalCode)
        await expect(body).toHaveCount(1)
        await page.screenshot({
          path: testInfo.outputPath(`awake-${cycle}.png`),
        })
        await oldPeer.dispose()
      }
    } finally {
      await page.evaluate(() =>
        window.app.settings.send({
          type: 'set.app.streamIdleMode',
          data: { level: 'user', value: 0 },
        })
      )
    }
  }
)
