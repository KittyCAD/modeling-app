import { installVideoRecoveryProbe } from '@e2e/playwright/lib/videoRecovery'
import type { Page } from '@playwright/test'
// Browser-only tests of the test probe: no Zoo fixture, account or Engine.
import { expect, test } from '@playwright/test'

async function controlledVideo(page: Page) {
  await page.setContent('<video id="video-stream"></video>')
  return page.evaluateHandle(() => {
    const video = document.querySelector<HTMLVideoElement>('video')!
    let frames = 205
    let nextCallback = 0
    const callbacks = new Map<number, VideoFrameRequestCallback>()
    video.requestVideoFrameCallback = (callback) => {
      callbacks.set(++nextCallback, callback)
      return nextCallback
    }
    video.cancelVideoFrameCallback = (id) => {
      callbacks.delete(id)
    }
    video.getVideoPlaybackQuality = () => ({
      totalVideoFrames: frames,
      droppedVideoFrames: 0,
      corruptedVideoFrames: 0,
      creationTime: performance.now(),
    })
    window.engineDebugger = {
      logs: [],
    } as unknown as typeof window.engineDebugger
    window.engineCommandManager = {} as typeof window.engineCommandManager
    const log = (label: string, message: string) => {
      window.engineDebugger.logs.push({
        label,
        message,
        time: Date.now(),
        stack: '',
        metadata: null,
      })
    }
    const load = () => {
      const source = new MediaStream()
      video.srcObject = source
      frames = 0
      window.engineCommandManager.connection = {
        id: source.id,
        mediaStream: source,
        peerConnection: {
          connectionState: 'connected',
          iceConnectionState: 'connected',
          getStats: async () =>
            new Map([
              [
                'video',
                {
                  type: 'inbound-rtp',
                  kind: 'video',
                  id: 'video',
                  timestamp: performance.now(),
                  bytesReceived: 1000,
                  packetsReceived: 10,
                  framesReceived: frames,
                  framesDecoded: frames,
                },
              ],
            ]),
        },
      } as unknown as typeof window.engineCommandManager.connection
      log('attemptToConnectToEngine', 'setIsSceneReady(true)')
    }
    const complete = () =>
      log('tryConnecting', 'setAppState({ isStreamAcceptingInput: true })')
    load()
    complete()
    frames = 205
    return {
      load,
      complete,
      frame: (count: number) => {
        frames = count
        const pending = [...callbacks.values()]
        callbacks.clear()
        pending.forEach((callback) =>
          callback(performance.now(), {
            presentedFrames: count,
            mediaTime: count / 60,
            expectedDisplayTime: performance.now(),
            presentationTime: performance.now(),
            width: 640,
            height: 480,
          })
        )
      },
      pendingCallbacks: () => callbacks.size,
    }
  })
}

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
              getStats: async () => new Map(),
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
      } finally {
        await probe.evaluate((probe) => probe.stop())
        await media.evaluate((media) => media.stop())
        await probe.dispose()
        await media.dispose()
      }
    })

    test('waits for source replacement and scene replay, ignoring the old frame total', async ({
      page,
    }) => {
      const control = await controlledVideo(page)
      const oldFrames = await page
        .locator('video')
        .evaluate(
          (video: HTMLVideoElement) =>
            video.getVideoPlaybackQuality().totalVideoFrames
        )
      const probe = await page.evaluateHandle(installVideoRecoveryProbe)
      try {
        expect(await probe.evaluate((probe) => probe.ready())).toBe(false)
        await control.evaluate((control) => control.load())
        // A connected new peer is not sufficient; the previous readiness log is stale.
        expect(await probe.evaluate((probe) => probe.ready())).toBe(false)
        await control.evaluate((control) => control.complete())
        expect(await probe.evaluate((probe) => probe.ready())).toBe(true)
        await probe.evaluate((probe) => probe.beginPlayback())
        await control.evaluate((control) => control.frame(44))
        expect(await probe.evaluate((probe) => probe.playback())).toBe(
          'waiting'
        )
        await control.evaluate((control) => control.frame(107))
        await expect
          .poll(() => probe.evaluate((probe) => probe.playback()))
          .toBe('advancing')
        // Replay the original assertion: it falsely fails these same healthy samples.
        await expect(
          expect
            .poll(
              () =>
                page
                  .locator('video')
                  .evaluate(
                    (video: HTMLVideoElement) =>
                      video.getVideoPlaybackQuality().totalVideoFrames
                  ),
              { timeout: 100 }
            )
            .toBeGreaterThan(oldFrames + 3)
        ).rejects.toThrow()
      } finally {
        await probe.evaluate((probe) => probe.stop())
        expect(
          await control.evaluate((control) => control.pendingCallbacks())
        ).toBe(0)
        await probe.dispose()
        await control.dispose()
      }
    })

    test('keeps a truly stalled stream failing and captures receive/decode diagnostics', async ({
      page,
    }) => {
      const control = await controlledVideo(page)
      const probe = await page.evaluateHandle(installVideoRecoveryProbe)
      try {
        await control.evaluate((control) => {
          control.load()
          control.complete()
        })
        await probe.evaluate((probe) => probe.beginPlayback())
        await control.evaluate((control) => control.frame(103))
        await expect(
          expect
            .poll(() => probe.evaluate((probe) => probe.playback()), {
              timeout: 750,
            })
            .toBe('advancing')
        ).rejects.toThrow()
      } finally {
        const diagnostics = await probe.evaluate((probe) => probe.stop())
        expect(JSON.stringify(diagnostics)).toContain('"framesDecoded":103')
        expect(JSON.stringify(diagnostics)).toContain('"lastPresented":103')
        expect(
          await control.evaluate((control) => control.pendingCallbacks())
        ).toBe(0)
        await probe.dispose()
        await control.dispose()
      }
    })

    test('rejects a second source replacement instead of silently rebasing', async ({
      page,
    }) => {
      const control = await controlledVideo(page)
      const probe = await page.evaluateHandle(installVideoRecoveryProbe)
      try {
        await control.evaluate((control) => {
          control.load()
          control.complete()
        })
        await probe.evaluate((probe) => probe.beginPlayback())
        await control.evaluate((control) => control.frame(103))
        await control.evaluate((control) => {
          control.load()
          control.complete()
          control.frame(200)
        })
        expect(await probe.evaluate((probe) => probe.playback())).toBe(
          'source-changed'
        )
      } finally {
        await probe.evaluate((probe) => probe.stop())
        await probe.dispose()
        await control.dispose()
      }
    })
  }
)
