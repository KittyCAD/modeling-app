import { showFreezeFrame, showLiveVideoOnNextFrame } from '@src/lib/videoStream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('engine video stream visibility', () => {
  let video: HTMLVideoElement
  let canvas: HTMLCanvasElement
  let drawImage: ReturnType<typeof vi.fn>
  let fireFrame: () => void
  let cancelVideoFrame = vi.fn<(handle: number) => void>()

  beforeEach(() => {
    // happy-dom does not implement the browser's media ready-state constants.
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 })
    video = document.createElement('video')
    canvas = document.createElement('canvas')
    drawImage = vi.fn()

    Object.defineProperties(video, {
      videoWidth: { value: 1280 },
      videoHeight: { value: 720 },
      readyState: {
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
        configurable: true,
      },
    })
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    video.requestVideoFrameCallback = vi.fn((callback) => {
      fireFrame = () => callback(0, {})
      return 1
    })
    cancelVideoFrame = vi.fn()
    video.cancelVideoFrameCallback = cancelVideoFrame
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the final frame until the recovered video presents one', async () => {
    showFreezeFrame(video, canvas)

    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(canvas.style.display).toBe('block')

    const presented = showLiveVideoOnNextFrame(video, canvas)
    expect(canvas.style.display).toBe('block')

    fireFrame()

    await expect(presented).resolves.toBe(true)
    expect(canvas.style.display).toBe('none')
  })

  it('keeps the freeze frame when recovery is interrupted', async () => {
    showFreezeFrame(video, canvas)
    const interrupted = showLiveVideoOnNextFrame(video, canvas)
    const staleFrame = fireFrame

    showFreezeFrame(video, canvas)
    await expect(interrupted).resolves.toBe(false)
    expect(cancelVideoFrame).toHaveBeenCalledWith(1)
    staleFrame()
    expect(canvas.style.display).toBe('block')

    const replaced = showLiveVideoOnNextFrame(video, canvas)
    Object.defineProperty(video, 'srcObject', {
      value: {},
      configurable: true,
    })
    fireFrame()
    await expect(replaced).resolves.toBe(false)
    expect(canvas.style.display).toBe('block')
  })

  it('starts the presentation timeout only while visible', async () => {
    vi.useFakeTimers()
    let visibilityState: DocumentVisibilityState = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibilityState
    )
    const presented = showLiveVideoOnNextFrame(video, canvas, {
      timeoutMs: 10_000,
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(cancelVideoFrame).not.toHaveBeenCalled()

    visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(presented).resolves.toBe(false)
    expect(cancelVideoFrame).toHaveBeenCalledWith(1)
  })

  it('aborts a pending presentation wait', async () => {
    const controller = new AbortController()
    const presented = showLiveVideoOnNextFrame(video, canvas, {
      signal: controller.signal,
    })

    controller.abort()

    await expect(presented).resolves.toBe(false)
    expect(cancelVideoFrame).toHaveBeenCalledWith(1)
  })
})
