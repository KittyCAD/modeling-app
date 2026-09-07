import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page, TestInfo } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'

test.use({
  userFeatures: [
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
  ],
})
test.describe.configure({ timeout: 120_000 })

const wakingStatus = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Waking from idle...' })
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

async function createBody(
  {
    page,
    scene,
    toolbar,
    editor,
    cmdBar,
  }: Pick<Fixtures, 'scene' | 'toolbar' | 'editor' | 'cmdBar'> & { page: Page },
  testInfo: TestInfo
) {
  await page.setViewportSize({ width: 1400, height: 900 })
  await editor.replaceCode('', '@settings(kclVersion = 2.0)')
  await scene.connectionEstablished()
  await scene.settled()
  await page.screenshot({ path: testInfo.outputPath('scene-ready.png') })
  await toolbar.startSketchOnDefaultPlane('Top plane')
  await expect(toolbar.exitSketchBtn).toBeEnabled()
  await editor.expectEditor.toContain('sketch(')
  await toolbar.rectangleBtn.click()
  await scene.makeMouseHelpers(0.35, 0.35, { format: 'ratio' })[0]()
  await scene.makeMouseHelpers(0.65, 0.65, { format: 'ratio' })[0]()
  await toolbar.exitSketch()
  await scene.settled()
  await page.screenshot({ path: testInfo.outputPath('profile-created.png') })
  await toolbar.extrudeButton.click()
  await scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })[0]()
  await cmdBar.progressCmdBar()
  await cmdBar.argumentInput.locator('[contenteditable]').fill('5mm')
  await cmdBar.progressCmdBar()
  await page.screenshot({ path: testInfo.outputPath('extrude-review.png') })
  await cmdBar.submit()
  await scene.settled()
  await toolbar.openFeatureTreePane()
  await expect(
    page.locator('#bodies-list-pane').getByRole('button', {
      name: 'Body 1',
      exact: true,
    })
  ).toBeVisible()
  await expect(wakingStatus(page)).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('body-created.png') })
}

async function enterIdle(page: Page) {
  const peer = await page.evaluateHandle(
    () => window.engineCommandManager.connection?.peerConnection
  )
  await setIdleTimeout(page, 5000)
  await expect(page.locator('canvas#freeze-frame')).toBeVisible({
    timeout: 15_000,
  })
  await expect
    .poll(() => peer.evaluate((value) => value?.connectionState))
    .toBe('closed')
  await expect(wakingStatus(page)).not.toBeVisible()
  await peer.dispose()
}

async function expectRecovered(
  page: Page,
  testInfo: TestInfo,
  screenshotName = 'recovered.png'
) {
  const video = page.locator('video#video-stream')
  await expect(page.locator('canvas#freeze-frame')).not.toBeVisible({
    timeout: 40_000,
  })
  await expect(recovery(page)).not.toBeVisible()
  await expect(wakingStatus(page)).not.toBeVisible()
  await expect(video).toBeVisible()
  await expect(
    page.locator('#bodies-list-pane').getByRole('button', {
      name: 'Body 1',
      exact: true,
    })
  ).toHaveCount(1)
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
  // The decoded frame must contain the model, not the blank startup background.
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
  await page.screenshot({ path: testInfo.outputPath(screenshotName) })
}

// Hold the first Engine-start attempt and reject all five retries on demand.
// This exercises the real retry/UI path without waiting for network timeouts.
async function holdFailingStarts(page: Page) {
  return page.evaluateHandle(() => {
    const manager = window.engineCommandManager
    const originalStart = manager.start.bind(manager)
    let attempts = 0
    let rejectFirst = () => {}
    manager.start = async () => {
      attempts++
      if (attempts === 1) {
        await new Promise<void>((_resolve, reject) => {
          rejectFirst = () => reject(new Error('Injected Engine-start failure'))
        })
      }
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
}

test.beforeEach(async ({ page, scene, toolbar, editor, cmdBar }, testInfo) => {
  await createBody({ page, scene, toolbar, editor, cmdBar }, testInfo)
})

test.afterEach(async ({ page }) => {
  await setIdleTimeout(page, 0)
  await page.context().setOffline(false)
})

test(
  'input while idle and browser-offline keeps recovery visible',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, editor }, testInfo) => {
    const code = await editor.getCurrentCode()
    await enterIdle(page)
    const starts = await page.evaluateHandle(() => {
      const manager = window.engineCommandManager
      const originalStart = manager.start.bind(manager)
      let offlineAttempts = 0
      manager.start = (...args) => {
        if (!navigator.onLine) offlineAttempts++
        return originalStart(...args)
      }
      return {
        offlineAttempts: () => offlineAttempts,
        restore: () => {
          manager.start = originalStart
        },
      }
    })
    // getUtils().emulateNetworkConditions only dispatches manager events;
    // use the browser's offline state and actual window event here.
    try {
      await page.context().setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await expect(recovery(page)).toBeVisible()
      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await page.screenshot({
        path: testInfo.outputPath('offline-after-input.png'),
      })
      // The final UI can miss a false wake that already exhausted its retries.
      expect(await starts.evaluate((state) => state.offlineAttempts())).toBe(0)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()
    } finally {
      await starts.evaluate((state) => state.restore())
      await starts.dispose()
    }
    await setIdleTimeout(page, 0)
    await page.context().setOffline(false)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
    await expectRecovered(page, testInfo)
    await scene.settled()
    expect(await editor.getCurrentCode()).toBe(code)
  }
)

test(
  'online recovery clears idle state before an unrelated connection failure',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, editor }, testInfo) => {
    const code = await editor.getCurrentCode()
    await enterIdle(page)
    // Keep input-driven idle handling enabled, but prevent a second idle
    // teardown from changing the cause of the disconnect under test.
    await setIdleTimeout(page, 120_000)
    await page.context().setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
    await expect(recovery(page)).toBeVisible()
    await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
    await expect(wakingStatus(page)).not.toBeVisible()
    await page.context().setOffline(false)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
    await expectRecovered(page, testInfo, 'online-recovered.png')
    await scene.makeMouseHelpers(0.76, 0.74, { format: 'ratio' })[1]()

    const starts = await holdFailingStarts(page)
    try {
      // Inject a separate, non-idle close and fail its ordinary reconnects.
      await page.evaluate((eventName) => {
        window.engineCommandManager.tearDown()
        window.engineCommandManager.dispatchEvent(
          new CustomEvent(eventName, { detail: { code: '1001' } })
        )
      }, EngineConnectionManagerEvents.WebsocketClosed)
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(1)
      await starts.evaluate((state) => state.reject())
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(5)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()

      await scene.makeMouseHelpers(0.76, 0.75, { format: 'ratio' })[1]()
      await page.screenshot({
        path: testInfo.outputPath('unrelated-failure-after-input.png'),
      })
      // Count attempts too: a false wake could exhaust retries so quickly
      // that the final screenshot alone would miss it.
      expect(await starts.evaluate((state) => state.attempts())).toBe(5)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()
    } finally {
      await starts.evaluate((state) => state.restore())
      await starts.dispose()
    }
    await recovery(page)
      .getByRole('button', { name: /Reconnect/ })
      .click()
    await expectRecovered(page, testInfo)
    await scene.settled()
    expect(await editor.getCurrentCode()).toBe(code)
  }
)

test(
  'browser-offline interrupts a pending idle wake and clears its status',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, editor }, testInfo) => {
    const code = await editor.getCurrentCode()
    await enterIdle(page)
    const starts = await holdFailingStarts(page)
    try {
      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await expect(wakingStatus(page)).toBeVisible()
      await setIdleTimeout(page, 0)
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(1)
      await page.screenshot({ path: testInfo.outputPath('pending-wake.png') })
      await page.context().setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('wake-interrupted.png'),
      })
      await starts.evaluate((state) => state.reject())
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(5)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()
    } finally {
      await starts.evaluate((state) => state.restore())
      await starts.dispose()
    }
    await page.context().setOffline(false)
    await expectRecovered(page, testInfo)
    await scene.settled()
    expect(await editor.getCurrentCode()).toBe(code)
  }
)

test(
  'exhausted idle-wake retries clear status before manual reconnect',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, editor }, testInfo) => {
    const code = await editor.getCurrentCode()
    await enterIdle(page)
    const starts = await holdFailingStarts(page)
    try {
      await scene.makeMouseHelpers(0.76, 0.73, { format: 'ratio' })[1]()
      await expect(wakingStatus(page)).toBeVisible()
      await setIdleTimeout(page, 0)
      await page.screenshot({ path: testInfo.outputPath('pending-wake.png') })
      await starts.evaluate((state) => state.reject())
      await expect
        .poll(() => starts.evaluate((state) => state.attempts()))
        .toBe(5)
      await expect(recovery(page)).toBeVisible()
      await expect(wakingStatus(page)).not.toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('retries-exhausted.png'),
      })
    } finally {
      await starts.evaluate((state) => state.restore())
      await starts.dispose()
    }
    await recovery(page)
      .getByRole('button', { name: /Reconnect/ })
      .click()
    await expect(wakingStatus(page)).not.toBeVisible()
    await expectRecovered(page, testInfo)
    await scene.settled()
    expect(await editor.getCurrentCode()).toBe(code)
  }
)
