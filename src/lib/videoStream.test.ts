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
      fireFrame = () => callback(0, {} as VideoFrameCallbackMetadata)
      return 1
    })
    cancelVideoFrame = vi.fn()
    video.cancelVideoFrameCallback = cancelVideoFrame
  })

  it('shows the final frame until the reconnected video renders', () => {
    expect(showFreezeFrame(video, canvas)).toBe(true)

    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(canvas.style.display).toBe('block')
    expect(video.style.display).not.toBe('none')

    const onLive = vi.fn()
    showLiveVideoOnNextFrame(video, canvas, onLive)
    expect(canvas.style.display).toBe('block')
    expect(onLive).not.toHaveBeenCalled()

    fireFrame()

    expect(canvas.style.display).toBe('none')
    expect(onLive).toHaveBeenCalledTimes(1)
  })

  it('ignores stale callbacks after another idle or stream replacement', () => {
    const onLive = vi.fn()
    showFreezeFrame(video, canvas)
    showLiveVideoOnNextFrame(video, canvas, onLive)
    const staleFrame = fireFrame

    showFreezeFrame(video, canvas)
    expect(cancelVideoFrame).toHaveBeenCalledWith(1)
    // A callback already queued before cancellation must also be harmless.
    staleFrame()
    expect(canvas.style.display).toBe('block')
    expect(onLive).not.toHaveBeenCalled()

    showLiveVideoOnNextFrame(video, canvas, onLive)
    Object.defineProperty(video, 'srcObject', { value: {}, configurable: true })
    fireFrame()
    expect(canvas.style.display).toBe('block')
    expect(onLive).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
