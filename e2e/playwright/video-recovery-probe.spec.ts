import { installVideoRecoveryProbe } from '@e2e/playwright/lib/videoRecovery'
// Verify browser playback without a Zoo fixture, account or Engine.
import { expect, test } from '@playwright/test'

test.describe(
  'video recovery probe',
  { tag: ['@web', '@skipLocalEngine'] },
  () => {
    test('observes actual presented frames from a replacement canvas stream', async ({
      page,
    }) => {
      await page.setContent(
        '<canvas width="160" height="90"></canvas><video id="video-stream" autoplay muted></video>'
      )
      const media = await page.evaluateHandle(() => {
        const canvas = document.querySelector('canvas')!
        const context = canvas.getContext('2d')!
        const video = document.querySelector('video')!
        const sources: MediaStream[] = []
        let paint = 0
        let frame = 0
        const draw = () => {
          context.fillStyle = `rgb(${frame++ % 255},80,100)`
          context.fillRect(0, 0, canvas.width, canvas.height)
          paint = requestAnimationFrame(draw)
        }
        window.engineDebugger = {
          logs: [],
        } as unknown as typeof window.engineDebugger
        window.engineCommandManager = {} as typeof window.engineCommandManager
        const replace = () => {
          const source = canvas.captureStream(30)
          sources.push(source)
          video.srcObject = source
          window.engineCommandManager.connection = {
            id: source.id,
            mediaStream: source,
            peerConnection: {
              connectionState: 'connected',
            },
          } as unknown as typeof window.engineCommandManager.connection
          for (const [label, message] of [
            ['attemptToConnectToEngine', 'setIsSceneReady(true)'],
            ['tryConnecting', 'setAppState({ isStreamAcceptingInput: true })'],
          ])
            window.engineDebugger.logs.push({
              label,
              message,
              time: Date.now(),
              metadata: null,
              stack: '',
            })
        }
        replace()
        draw()
        return {
          replace,
          stop: () => {
            cancelAnimationFrame(paint)
            sources.forEach((source) =>
              source.getTracks().forEach((track) => track.stop())
            )
          },
        }
      })
      const probe = await page.evaluateHandle(installVideoRecoveryProbe)
      try {
        expect(await probe.evaluate((probe) => probe.ready())).toBe(false)
        await media.evaluate((media) => media.replace())
        await expect
          .poll(() => probe.evaluate((probe) => probe.ready()))
          .toBe(true)
        await probe.evaluate((probe) => probe.beginPlayback())
        await expect
          .poll(() => probe.evaluate((probe) => probe.playback()), {
            timeout: 5000,
          })
          .toBe('advancing')
        await media.evaluate((media) => media.replace())
        expect(await probe.evaluate((probe) => probe.playback())).toBe(
          'source-changed'
        )
      } finally {
        await probe.evaluate((probe) => probe.stop())
        await media.evaluate((media) => media.stop())
        await probe.dispose()
        await media.dispose()
      }
    })
  }
)
