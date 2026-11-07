import { writeProjectThumbnailFile } from '@src/lib/desktop'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('@src/lib/desktop', () => ({ writeProjectThumbnailFile: vi.fn() }))

const frames = new Map<number, VideoFrameRequestCallback>()
const encodings: BlobCallback[] = []
let nextFrameId = 0

function presentFrame() {
  const pending = [...frames.values()]
  frames.clear()
  const now = performance.now()
  for (const callback of pending)
    callback(now, {
      presentationTime: now,
      expectedDisplayTime: now,
      width: 100,
      height: 80,
      mediaTime: 1,
      presentedFrames: 1,
      processingDuration: 0,
    })
}

async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

function capture(isCurrent = () => true) {
  return createThumbnailPNGOnDesktop({
    fileOperations: testFileOperations,
    projectDirectoryWithoutEndingSlash: '/project',
    isCurrent,
  })
}

beforeEach(() => {
  // Happy DOM omits this standard media readiness constant.
  Object.defineProperty(HTMLMediaElement, 'HAVE_CURRENT_DATA', {
    configurable: true,
    value: 2,
  })
  frames.clear()
  encodings.length = 0
  Object.defineProperty(
    HTMLVideoElement.prototype,
    'requestVideoFrameCallback',
    {
      configurable: true,
      value: (callback: VideoFrameRequestCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      },
    }
  )
  Object.defineProperty(
    HTMLVideoElement.prototype,
    'cancelVideoFrameCallback',
    {
      configurable: true,
      value: (id: number) => {
        frames.delete(id)
      },
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => {
      encodings.push(callback)
    }
  )
  vi.mocked(writeProjectThumbnailFile).mockResolvedValue(undefined)
  const video = document.createElement('video')
  video.id = 'video-stream'
  vi.spyOn(video, 'readyState', 'get').mockReturnValue(2)
  vi.spyOn(video, 'paused', 'get').mockReturnValue(false)
  vi.spyOn(video, 'ended', 'get').mockReturnValue(false)
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-engine', '')
  canvas.width = 100
  canvas.height = 80
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 80)
  )
  document.body.append(video, canvas)
})

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  Reflect.deleteProperty(HTMLMediaElement, 'HAVE_CURRENT_DATA')
  Reflect.deleteProperty(
    HTMLVideoElement.prototype,
    'requestVideoFrameCallback'
  )
  Reflect.deleteProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback')
})

test('out-of-order PNG encodings cannot overwrite the newest thumbnail', async () => {
  capture()
  expect(encodings).toHaveLength(0)
  presentFrame()
  capture()
  expect(encodings).toHaveLength(1)
  presentFrame()
  expect(encodings).toHaveLength(2)
  encodings[1](new Blob([new Uint8Array([2])]))
  await flush()
  expect(writeProjectThumbnailFile).toHaveBeenCalledExactlyOnceWith(
    testFileOperations,
    new Uint8Array([2]),
    '/project'
  )
  encodings[0](new Blob([new Uint8Array([1])]))
  await flush()
  expect(writeProjectThumbnailFile).toHaveBeenCalledTimes(1)
})

test('serializes already-started file writes so the latest bytes win', async () => {
  let release: (() => void) | undefined
  const pendingWrite = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(writeProjectThumbnailFile).mockReturnValueOnce(pendingWrite)
  capture()
  presentFrame()
  encodings[0](new Blob([new Uint8Array([1])]))
  await flush()
  capture()
  presentFrame()
  encodings[1](new Blob([new Uint8Array([2])]))
  await flush()
  expect(writeProjectThumbnailFile).toHaveBeenCalledTimes(1)
  release?.()
  await flush()
  expect(writeProjectThumbnailFile).toHaveBeenLastCalledWith(
    testFileOperations,
    new Uint8Array([2]),
    '/project'
  )
  expect(writeProjectThumbnailFile).toHaveBeenCalledTimes(2)
})

test('drops a capture when editor ownership is lost during encoding', async () => {
  let current = true
  capture(() => current)
  presentFrame()
  current = false
  encodings[0](new Blob([new Uint8Array([1])]))
  await flush()
  expect(writeProjectThumbnailFile).not.toHaveBeenCalled()
})

test('owner disposal cancels a pending video frame without waiting for another frame', () => {
  const cancel = capture()
  expect(frames.size).toBe(1)
  cancel?.()
  expect(frames.size).toBe(0)
  presentFrame()
  expect(encodings).toHaveLength(0)
  expect(writeProjectThumbnailFile).not.toHaveBeenCalled()
})

test('skips unloaded or paused streams and cancels pending new frames on stream or page exit', () => {
  const video = document.getElementById('video-stream')
  if (!(video instanceof HTMLVideoElement)) expect.fail('Missing fixture video')
  vi.spyOn(video, 'readyState', 'get').mockReturnValue(0)
  capture()
  expect(frames.size).toBe(0)
  expect(encodings).toHaveLength(0)
  vi.spyOn(video, 'readyState', 'get').mockReturnValue(2)
  vi.spyOn(video, 'paused', 'get').mockReturnValue(true)
  capture()
  expect(frames.size).toBe(0)
  vi.spyOn(video, 'paused', 'get').mockReturnValue(false)
  for (const event of ['pause', 'ended', 'emptied', 'pagehide']) {
    capture()
    expect(frames.size).toBe(1)
    if (event === 'pagehide') window.dispatchEvent(new Event(event))
    else video.dispatchEvent(new Event(event))
    expect(frames.size).toBe(0)
    expect(encodings).toHaveLength(0)
  }
})
