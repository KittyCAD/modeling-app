import { TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { settingsToToml, tomlToSettings } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const peers: RTCPeerConnection[] = []
    ;(window as any).__diagnosticPeers = peers
    const NativePeer = window.RTCPeerConnection
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args)
        peers.push(this)
      }
    }
  })
})

test.afterEach(async ({ page }, testInfo) => {
  const capture = () => page.evaluate(async () => {
    const video = document.querySelector<HTMLVideoElement>('#video-stream')
    if (!video) return { missingVideo: true }
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : null
    const style = getComputedStyle(video)
    let pixel: number[] | undefined
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      pixel = [...ctx.getImageData(Math.floor(canvas.width * .9), Math.floor(canvas.height * .3), 1, 1).data]
    }
    const peer = window.engineCommandManager.connection?.peerConnection
    const stats = peer ? await peer.getStats() : undefined
    const incoming: Record<string, unknown>[] = []
    stats?.forEach(stat => {
      if (stat.type === 'inbound-rtp') {
        incoming.push({ ...Object.fromEntries(['kind', 'bytesReceived', 'framesReceived', 'framesDecoded', 'framesDropped', 'frameWidth', 'frameHeight', 'decoderImplementation', 'keyFramesDecoded', 'pliCount', 'firCount', 'nackCount', 'packetsLost'].map(key => [key, stat[key]])), codec: stats?.get(stat.codecId) })
      }
    })
    return {
      visibility: document.visibilityState,
      paused: video.paused,
      muted: video.muted,
      readyState: video.readyState,
      currentTime: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      error: video.error?.code,
      display: style.display,
      visibilityStyle: style.visibility,
      opacity: style.opacity,
      tracks: stream?.getVideoTracks().map(track => ({ muted: track.muted, enabled: track.enabled, readyState: track.readyState })),
      pixel,
      incoming,
      streamMatches: stream === window.engineCommandManager.connection?.mediaStream,
      trackMatches: stream?.getVideoTracks()[0] === peer?.getReceivers().find(r => r.track.kind === 'video')?.track,
      peers: ((window as any).__diagnosticPeers as RTCPeerConnection[] | undefined)?.map(p => ({ current: p === peer, state: p.connectionState, tracks: p.getReceivers().map(r => r.track.readyState) })),
    }
  })
  const before = await capture()
  await testInfo.attach('video-before-play', {
    body: JSON.stringify(before, null, 2),
    contentType: 'application/json',
  })
  if (testInfo.status === testInfo.expectedStatus) return
  const playResult = await page.evaluate(async () => {
    try {
      return await Promise.race([
        document.querySelector<HTMLVideoElement>('#video-stream')?.play().then(() => 'resolved'),
        new Promise(resolve => setTimeout(() => resolve('timed out'), 3000)),
      ])
    } catch (error) {
      return String(error)
    }
  })
  await page.waitForTimeout(300)
  const after = await capture()
  await testInfo.attach('video-diagnostic', {
    body: JSON.stringify({ before, playResult, after }, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('after-play', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#video-stream')!
    const stream = window.engineCommandManager.connection?.mediaStream
    video.srcObject = null
    video.srcObject = stream ?? null
    void video.play().catch(() => {})
  })
  await page.waitForTimeout(2000)
  await testInfo.attach('video-after-reattach', { body: JSON.stringify(await capture()), contentType: 'application/json' })
  await page.evaluate(() => {
    const current = window.engineCommandManager.connection?.peerConnection
    for (const peer of (window as any).__diagnosticPeers as RTCPeerConnection[]) {
      if (peer !== current) {
        for (const receiver of peer.getReceivers()) receiver.track.stop()
        peer.close()
      }
    }
  })
  await page.waitForTimeout(2000)
  await testInfo.attach('video-after-stop-old-tracks', { body: JSON.stringify(await capture()), contentType: 'application/json' })
})

test(
  'shared SSAO and cloud rendering styles persist across reloads',
  { tag: '@web' },
  async ({ page, folderSetupFn, fs, homePage, scene }) => {
    // The shared fixture disables SSAO. Remove that override to test the default.
    const settings = tomlToSettings(
      await page.evaluate(
        (key) => localStorage.getItem(key) || '',
        TEST_SETTINGS_KEY
      )
    )
    delete settings.settings?.modeling?.enable_ssao
    settings.settings = {
      ...settings.settings,
      modeling: {
        ...settings.settings?.modeling,
        use_local_renderer: false,
      },
      app: {
        ...settings.settings?.app,
        appearance: { theme: 'light' },
      },
    }
    // WebKit reports startup fetches interrupted by a reload as CORS errors.
    // Let those requests finish before either of the setup reloads.
    await page.waitForLoadState('networkidle')
    await page.addInitScript(
      ({ key, value }) => {
        // The shared fixture resets user settings on reload. Restore the app's
        // saved settings so this test can exercise persistence too.
        const savedKey = 'viewport-rendering-saved-settings'
        localStorage.setItem(key, sessionStorage.getItem(savedKey) ?? value)
        window.addEventListener('beforeunload', () => {
          sessionStorage.setItem(savedKey, localStorage.getItem(key) ?? value)
        })
      },
      { key: TEST_SETTINGS_KEY, value: settingsToToml(settings) }
    )
    await page.waitForLoadState('networkidle')

    await folderSetupFn(async (dir) => {
      const project = await fs.join(dir, 'viewport-rendering')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(`// Rendering preview
// A cylinder for checking viewport styles.
@settings(kclVersion = 3.0, defaultLengthUnit = mm)
profile = sketch(on = XY) {
  rim = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([rim.center, ORIGIN])
  horizontal([rim.start, rim.center])
  radius(rim) == 10mm
}
disk = region(point = [0, 0], sketch = profile)
cylinder = extrude(disk, length = 10)
hide(profile)
`)
      )
      // A project override from the early preview must not pin the shader.
      await fs.writeFile(
        await fs.join(project, 'project.toml'),
        new TextEncoder().encode(
          '[settings.meta]\nid = "a3e7bfb3-df47-4c99-9e9c-b39b586a8615"\n[settings.modeling]\nviewport_rendering = "phosphor"\nenable_ssao = false\n'
        )
      )
    })

    const modes: (string | null)[] = []
    page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (url.searchParams.has('video_res_width')) {
        modes.push(url.searchParams.get('post_effect'))
      }
    })
    const rendering = page.getByTestId('modeling-viewportRendering')
    const openSettings = async () => {
      await page.getByRole('link', { name: 'Settings' }).last().click()
      await page.getByRole('radio', { name: 'User' }).click()
    }

    await homePage.openProject('viewport-rendering')
    await scene.settled()
    expect(modes).toEqual(['ssao'])
    const backgroundPoint = { x: 0.9, y: 0.3 }
    await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(
      page.getByRole('heading', { name: 'Rendering style', exact: true })
    ).toBeVisible()
    await expect(rendering).toHaveValue('default')
    await expect(rendering.locator('option')).toHaveText([
      'Default',
      'Retro CAD',
      'Phosphor',
    ])
    const ssao = page.locator('input[name="modeling-enableSSAO"]')
    const toggleSSAO = () => page.locator('label').filter({ has: ssao }).click()
    await expect(ssao).toBeChecked()

    for (const mode of ['phosphor', 'retrocad']) {
      const connectionCount = modes.length
      const previousPeer = await page.evaluateHandle(
        () => window.engineCommandManager.connection?.peerConnection
      )
      await scene.waitForExecutionDoneAfter(async () => {
        await rendering.selectOption(mode)
        await expect(ssao).toBeChecked()
        await expect(ssao).toBeDisabled()
        await page.getByTestId('settings-close-button').click()
      })
      await scene.settled()
      expect(await previousPeer.evaluate((peer) => peer?.connectionState)).toBe(
        'closed'
      )
      await previousPeer.dispose()
      expect(modes.slice(connectionCount)).toEqual([mode])
      await scene.expectPixelColor([0, 0, 0], backgroundPoint, 10, {
        format: 'ratio',
      })
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      await openSettings()
      await expect(rendering).toHaveValue(mode)

      await scene.waitForExecutionDoneAfter(async () => {
        await rendering.selectOption('default')
        await expect(ssao).toBeEnabled()
        await page.getByTestId('settings-close-button').click()
      })
      await scene.settled()
      expect(modes.slice(connectionCount)).toEqual([mode, 'ssao'])
      await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
        format: 'ratio',
      })
      await openSettings()
      await expect(ssao).toBeChecked()
    }
    await scene.waitForExecutionDoneAfter(async () => {
      await rendering.selectOption('retrocad')
      await page.getByTestId('settings-close-button').click()
    })
    await scene.settled()
    await openSettings()
    await expect(ssao).toBeChecked()
    await expect(ssao).toBeDisabled()

    const search = page.getByPlaceholder(/^Search settings/)
    await search.fill('Rendering style')
    await expect(
      page.getByRole('option', { name: /Rendering style/ })
    ).toBeVisible()
    await search.press('Escape')
    await search.fill('')
    const connectionCount = modes.length
    const localRenderer = page.locator(
      'input[name="modeling-useLocalRenderer"]'
    )
    await page.locator('label').filter({ has: localRenderer }).click()
    await expect(localRenderer).toBeChecked()
    await expect(page.getByTestId('viewportRendering')).toHaveCount(0)
    await expect(ssao).toBeEnabled()
    await expect(ssao).toBeChecked()
    await search.fill('Rendering style')
    await expect(
      page.getByRole('option', { name: /Rendering style/ })
    ).toHaveCount(0)
    await search.press('Escape')
    await search.fill('')
    await page.waitForFunction(() =>
      window.app.settings.actor.getSnapshot().matches('idle')
    )
    expect(modes).toHaveLength(connectionCount)
    expect(
      await page.evaluate(() => window.engineCommandManager.geometryOnly)
    ).toBe(false)
    await page.getByTestId('settings-close-button').click()

    await page.reload()
    await scene.settled()
    expect(
      await page.evaluate(() => window.engineCommandManager.geometryOnly)
    ).toBe(true)
    await openSettings()
    await expect(ssao).toBeChecked()
    await expect(ssao).toBeEnabled()
    await toggleSSAO()
    await expect(ssao).not.toBeChecked()
    await page.waitForFunction(() =>
      window.app.settings.actor.getSnapshot().matches('idle')
    )
    await page.getByTestId('settings-close-button').click()
    await page.reload()
    await scene.settled()
    await openSettings()
    await expect(ssao).not.toBeChecked()
    await page.locator('label').filter({ has: localRenderer }).click()
    await expect(localRenderer).not.toBeChecked()
    await expect(rendering).toHaveValue('retrocad')
    await expect(ssao).not.toBeChecked()
    await expect(ssao).toBeDisabled()
    await page.waitForFunction(() =>
      window.app.settings.actor.getSnapshot().matches('idle')
    )
    expect(
      await page.evaluate(() => window.engineCommandManager.geometryOnly)
    ).toBe(true)
    await page.getByTestId('settings-close-button').click()

    modes.length = 0
    await page.reload()
    await scene.settled()
    expect(modes).toEqual(['retrocad'])
    await scene.expectPixelColor([0, 0, 0], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(rendering).toHaveValue('retrocad')
    await expect(ssao).not.toBeChecked()
    await page.getByRole('radio', { name: 'This project' }).click()
    await expect(rendering).toHaveCount(0)
    await expect(ssao).toHaveCount(0)
    await page.getByRole('radio', { name: 'User' }).click()

    await scene.waitForExecutionDoneAfter(async () => {
      await rendering.selectOption('default')
      await page.getByTestId('settings-close-button').click()
    })
    await scene.settled()
    await expect.poll(() => modes.at(-1)).toBe('noeffect')
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(rendering).toHaveValue('default')
    await expect(ssao).toBeEnabled()
    await expect(ssao).not.toBeChecked()
  }
)
