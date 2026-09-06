import { showFreezeFrame, showLiveVideoOnNextFrame } from '@src/lib/videoStream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('engine video stream visibility', () => {
  let video: HTMLVideoElement
  let canvas: HTMLCanvasElement
  let drawImage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    video = document.createElement('video')
    canvas = document.createElement('canvas')

    Object.defineProperties(video, {
      videoWidth: { value: 1280 },
      videoHeight: { value: 720 },
    })
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The canvas test setup needs a 2D context')
    drawImage = vi.spyOn(context, 'drawImage')
  })

  it('shows a copy of the final video frame before hiding the stream', () => {
    expect(showFreezeFrame(video, canvas)).toBe(true)

    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(canvas.style.display).toBe('block')
    expect(video.style.display).toBe('none')
  })

  it('keeps the freeze frame until the reconnected video renders a frame', () => {
    const frameCallbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => {
      frameCallbacks.push(callback)
      return 1
    })
    video.style.display = 'none'
    canvas.style.display = 'block'

    showLiveVideoOnNextFrame(video, canvas)

    expect(video.style.display).toBe('none')
    expect(canvas.style.display).toBe('block')

    frameCallbacks[0](0, {
      expectedDisplayTime: 0,
      presentationTime: 0,
      mediaTime: 0,
      presentedFrames: 1,
      width: 1280,
      height: 720,
    })

    expect(video.style.display).toBe('block')
    expect(canvas.style.display).toBe('none')
  })
})
