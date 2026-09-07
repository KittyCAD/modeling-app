import {
  createBody,
  enterIdle,
  expectRecovered,
  recovery,
  setIdleTimeout,
  wakingStatus,
} from '@e2e/playwright/lib/engineIdle'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
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

for (const failure of ['websocket', 'data-channel']) {
  test(
    `${failure} close preserves the scene throughout automatic reconnect`,
    { tag: ['@web', '@skipLocalEngine'] },
    async ({ page, editor }, testInfo) => {
      await setIdleTimeout(page, 0)
      const code = await editor.getCurrentCode()
      const state = await page.evaluateHandle(() => {
        const manager = window.engineCommandManager
        const connection = manager.connection!
        const start = manager.start.bind(manager)
        let held = false
        let resume = () => {}
        const pending = new Promise<void>((resolve) => {
          resume = resolve
        })
        // Delay the replacement so its video cannot hide a black reconnect gap.
        manager.start = async (...args) => {
          held = true
          await pending
          return start(...args)
        }
        return {
          close: (failure: string) => {
            if (failure === 'websocket') connection.websocket!.close(1000)
            else connection.unreliableDataChannel!.close()
          },
          held: () => held,
          peerState: () => connection.peerConnection?.connectionState,
          resume: () => {
            manager.start = start
            resume()
          },
        }
      })
      try {
        await state.evaluate((state, failure) => state.close(failure), failure)
        await expect
          .poll(() => state.evaluate((state) => state.held()))
          .toBe(true)
        await expect
          .poll(() => state.evaluate((state) => state.peerState()))
          .toBe('closed')
        expect(await page.evaluate(() => navigator.onLine)).toBe(true)
        const freeze = page.locator('canvas#freeze-frame')
        await expect(freeze).toBeVisible()
        const background = await freeze.evaluate(
          (canvas: HTMLCanvasElement) => {
            const pixel = canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data
            return pixel ? pixel[0] + pixel[1] + pixel[2] : 0
          }
        )
        expect(background).toBeGreaterThan(24)
        await page.screenshot({
          path: testInfo.outputPath(`${failure}-reconnecting.png`),
        })
        await expectRecovered(page, testInfo, () =>
          state.evaluate((state) => state.resume())
        )
        expect(await editor.getCurrentCode()).toBe(code)
      } finally {
        await state.evaluate((state) => state.resume())
        await state.dispose()
      }
    }
  )
}

test(
  'browser offline and online preserves the active scene without idling',
  { tag: ['@web', '@skipLocalEngine'] },
  async ({ page, scene, editor }, testInfo) => {
    test.setTimeout(180_000)
    await setIdleTimeout(page, 0)
    const code = await editor.getCurrentCode()
    const freeze = page.locator('canvas#freeze-frame')

    for (let cycle = 1; cycle <= 3; cycle++) {
      const peer = await page.evaluateHandle(
        () => window.engineCommandManager.connection?.peerConnection
      )
      await page.context().setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await expect(recovery(page)).toBeVisible()
      await expect
        .poll(() => peer.evaluate((value) => value?.connectionState))
        .toBe('closed')
      await peer.dispose()
      // No idle snapshot exists: browser-offline must preserve the active video
      // before closing its peer, including after a previous reconnect.
      await expect(freeze).toBeVisible()
      const background = await freeze.evaluate((canvas: HTMLCanvasElement) => {
        const pixel = canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data
        return pixel ? pixel[0] + pixel[1] + pixel[2] : 0
      })
      expect(background).toBeGreaterThan(24)
      await page.screenshot({
        path: testInfo.outputPath(`offline-${cycle}.png`),
      })

      await expectRecovered(
        page,
        testInfo,
        async () => {
          await page.context().setOffline(false)
          await expect
            .poll(() => page.evaluate(() => navigator.onLine))
            .toBe(true)
          await expect(freeze).toBeVisible()
          await page.screenshot({
            path: testInfo.outputPath(`reconnecting-${cycle}.png`),
          })
        },
        `online-${cycle}.png`
      )
      await scene.settled()
      expect(await editor.getCurrentCode()).toBe(code)
    }
  }
)

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
    await expectRecovered(page, testInfo, async () => {
      await page.context().setOffline(false)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
    })
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
    await expectRecovered(
      page,
      testInfo,
      async () => {
        await page.context().setOffline(false)
        await expect
          .poll(() => page.evaluate(() => navigator.onLine))
          .toBe(true)
      },
      'online-recovered.png'
    )
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
    await expectRecovered(page, testInfo, () =>
      recovery(page)
        .getByRole('button', { name: /Reconnect/ })
        .click()
    )
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
    await expectRecovered(page, testInfo, () =>
      page.context().setOffline(false)
    )
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
    await expectRecovered(page, testInfo, async () => {
      await recovery(page)
        .getByRole('button', { name: /Reconnect/ })
        .click()
      await expect(wakingStatus(page)).not.toBeVisible()
    })
    await scene.settled()
    expect(await editor.getCurrentCode()).toBe(code)
  }
)
