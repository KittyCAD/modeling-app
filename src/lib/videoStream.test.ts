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
      fireFrame = () =>
        callback(0, {
          expectedDisplayTime: 0,
          width: 1280,
          height: 720,
          mediaTime: 0,
          presentationTime: 0,
          presentedFrames: 1,
        })
      return 1
    })
    cancelVideoFrame = vi.fn()
    video.cancelVideoFrameCallback = cancelVideoFrame
  })

  it('overlays the final frame without hiding the autoplay video', () => {
    expect(showFreezeFrame(video, canvas)).toBe(true)

    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(canvas.style.display).toBe('block')
    expect(video.style.display).not.toBe('none')
  })

  it('keeps the freeze frame until the reconnected video renders a frame', () => {
    const frameCallbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => {
      frameCallbacks.push(callback)
      return 1
    })
    canvas.style.display = 'block'
    const onLive = vi.fn(() => {
      expect(canvas.style.display).toBe('none')
    })

    showLiveVideoOnNextFrame(video, canvas, onLive)

    expect(video.style.display).not.toBe('none')
    expect(canvas.style.display).toBe('block')
    expect(onLive).not.toHaveBeenCalled()

    frameCallbacks[0](0, {} as VideoFrameCallbackMetadata)

    expect(video.style.display).not.toBe('none')
    expect(canvas.style.display).toBe('none')
    expect(onLive).toHaveBeenCalledTimes(1)
  })

  it('preserves an existing freeze frame if another idle interrupts wake-up', () => {
    showFreezeFrame(video, canvas)
    drawImage.mockClear()
    Object.defineProperty(video, 'readyState', { value: 0 })

    expect(showFreezeFrame(video, canvas)).toBe(true)
    expect(drawImage).not.toHaveBeenCalled()
    expect(canvas.width).toBe(1280)
    expect(canvas.style.display).toBe('block')
  })

  it('does not capture a stream with no current frame', () => {
    Object.defineProperty(video, 'readyState', { value: 1 })
    expect(showFreezeFrame(video, canvas)).toBe(false)
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('cancels a pending reveal when idle begins again', () => {
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
  })

  it('does not reveal a replacement stream using an older stream callback', () => {
    const onLive = vi.fn()
    showFreezeFrame(video, canvas)
    showLiveVideoOnNextFrame(video, canvas, onLive)
    Object.defineProperty(video, 'srcObject', { value: {}, configurable: true })
    fireFrame()
    expect(canvas.style.display).toBe('block')
    expect(onLive).not.toHaveBeenCalled()
  })

  it('only the latest reveal request can reveal the video', () => {
    showFreezeFrame(video, canvas)
    showLiveVideoOnNextFrame(video, canvas)
    const staleFrame = fireFrame
    showLiveVideoOnNextFrame(video, canvas)
    staleFrame()
    expect(canvas.style.display).toBe('block')
    fireFrame()
    expect(canvas.style.display).toBe('none')
  })

  it('cancels the animation-frame fallback on another idle', () => {
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      value: undefined,
    })
    let renderFallback = () => {}
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      renderFallback = () => callback(0)
      return 42
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    showFreezeFrame(video, canvas)
    showLiveVideoOnNextFrame(video, canvas)
    showFreezeFrame(video, canvas)
    expect(cancel).toHaveBeenCalledWith(42)
    renderFallback()
    expect(canvas.style.display).toBe('block')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
