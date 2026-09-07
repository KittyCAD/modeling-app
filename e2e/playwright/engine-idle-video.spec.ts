import {
  createBody,
  enterIdle,
  expectRecovered,
  setIdleTimeout,
  wakingStatus,
} from '@e2e/playwright/lib/engineIdle'
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
    await createBody({ page, scene, toolbar, editor, cmdBar }, testInfo)
    const originalCode = await editor.getCurrentCode()
    const freeze = page.locator('canvas#freeze-frame')
    await expect
      .poll(() =>
        page
          .locator('video#video-stream')
          .evaluate(
            (element: HTMLVideoElement) =>
              element.getVideoPlaybackQuality().totalVideoFrames
          )
      )
      .toBeGreaterThan(5)

    try {
      for (let cycle = 1; cycle <= 3; cycle++) {
        await enterIdle(page)
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

        await expectRecovered(
          page,
          testInfo,
          async () => {
            await scene.makeMouseHelpers(0.76, 0.72 + cycle * 0.01, {
              format: 'ratio',
            })[1]()
            await expect(wakingStatus(page)).toBeVisible()
            await expect(freeze).toBeVisible()
            await page.screenshot({
              path: testInfo.outputPath(`waking-${cycle}.png`),
            })
          },
          `awake-${cycle}.png`
        )
        await setIdleTimeout(page, 0)
        await scene.settled()
        expect(await editor.getCurrentCode()).toBe(originalCode)
      }
    } finally {
      await setIdleTimeout(page, 0)
    }
  }
)
