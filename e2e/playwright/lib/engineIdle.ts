import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { installVideoRecoveryProbe } from '@e2e/playwright/lib/videoRecovery'
import { expect, type Page, type TestInfo } from '@playwright/test'

export const wakingStatus = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Reconnecting' })
export const recovery = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Failed to connect.' })

export async function setIdleTimeout(page: Page, value: number) {
  await page.evaluate((value) => {
    window.app.settings.send({
      type: 'set.app.streamIdleMode',
      data: { level: 'user', value },
    })
  }, value)
}

export async function createBody(
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
  await expect(
    page.locator('#bodies-list-pane').getByRole('button', {
      name: 'Body 1',
      exact: true,
    })
  ).toBeVisible()
  await expect(wakingStatus(page)).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('body-created.png') })
}

export async function enterIdle(page: Page) {
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

export async function expectRecovered(
  page: Page,
  testInfo: TestInfo,
  reconnect: () => Promise<unknown>,
  screenshotName = 'recovered.png'
) {
  // Capture the old source before the trigger; the reconnect UI can disappear
  // while that old source is still attached to this same video element.
  const probe = await page.evaluateHandle(installVideoRecoveryProbe)
  try {
    const recoveryDeadline = Date.now() + 40_000
    await reconnect()
    await expect
      .poll(() => probe.evaluate((probe) => probe.ready()), {
        timeout: Math.max(1, recoveryDeadline - Date.now()),
        message: 'Replacement video source and scene setup complete',
      })
      .toBe(true)
    const video = page.locator('video#video-stream')
    // Source setup and freeze removal share the existing recovery deadline.
    await expect(page.locator('canvas#freeze-frame')).not.toBeVisible({
      timeout: Math.max(1, recoveryDeadline - Date.now()),
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
    await probe.evaluate((probe) => probe.beginPlayback())
    await expect
      .poll(() => probe.evaluate((probe) => probe.playback()), {
        timeout: 5000,
        message: 'Fresh presented frames from the same recovered stream',
      })
      .toBe('advancing')
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
  } finally {
    const diagnostics = await probe
      .evaluate((probe) => probe.stop())
      .catch(() => ({
        collectionError: 'Recovery page was unavailable during cleanup',
      }))
    await testInfo.attach(`video-${screenshotName}.json`, {
      contentType: 'application/json',
      body: JSON.stringify(diagnostics),
    })
    await probe.dispose()
  }
}
