import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  connectScene,
  type SceneConnectionManager,
  type ScenePresentation,
} from '@src/lib/scene/connection'
import {
  preflightEngineVideoCodecSupport,
  UnsupportedEngineVideoCodecError,
} from '@src/lib/engineConnection/videoCodecSupport'
import { requireSuccess } from '@src/lib/editors/testViews'
import type * as VideoCodecSupport from '@src/lib/engineConnection/videoCodecSupport'

vi.mock('@src/lib/engineConnection/videoCodecSupport', async (original) => ({
  ...(await original<typeof VideoCodecSupport>()),
  preflightEngineVideoCodecSupport: vi.fn(),
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(preflightEngineVideoCodecSupport)
    .mockReset()
    .mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function transport(presentation: ScenePresentation = 'streamed') {
  let started = false
  const mediaStream =
    presentation === 'streamed' ? new MediaStream() : undefined
  let connection: SceneConnectionManager['connection']
  const manager = {
    get started() {
      return started
    },
    lastConnectionError:
      undefined as SceneConnectionManager['lastConnectionError'],
    get connection() {
      return connection
    },
    start: vi.fn(
      async (
        options: Parameters<SceneConnectionManager['start']>[0]
      ): Promise<undefined> => {
        started = true
        connection = { id: 'first', mediaStream }
        options.onConnectionCreated?.(connection)
        return undefined
      }
    ),
    tearDown: vi.fn(() => {
      started = false
      connection = undefined
    }),
    sendSceneCommand: vi
      .fn<SceneConnectionManager['sendSceneCommand']>()
      .mockResolvedValue(null),
    handleResize: vi
      .fn<SceneConnectionManager['handleResize']>()
      .mockResolvedValue(undefined),
  } satisfies SceneConnectionManager
  return {
    manager,
    mediaStream,
    replace: () => {
      connection = { id: 'second', mediaStream: new MediaStream() }
    },
  }
}
const options = (
  manager: SceneConnectionManager,
  presentation: ScenePresentation = 'streamed'
) => ({
  manager,
  token: 'token',
  size: { width: 512, height: 512 },
  presentation,
  timeoutMs: 1000,
})

it.each(['streamed', 'local'] as const)(
  'opens %s scenes through the existing connection transport',
  async (presentation) => {
    const { manager, mediaStream } = transport(presentation)
    const scene = requireSuccess(
      await connectScene(options(manager, presentation))
    )
    expect(manager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        geometryOnly: presentation === 'local',
        width: 512,
        height: 512,
      })
    )
    expect(preflightEngineVideoCodecSupport).toHaveBeenCalledTimes(
      presentation === 'streamed' ? 1 : 0
    )
    const video = document.createElement('video')
    const attachment = scene.attachVideo(video)
    if (presentation === 'local') expect(attachment).toBeInstanceOf(Error)
    else {
      expect(video.srcObject).toBe(mediaStream)
      requireSuccess(attachment)()
      expect(video.srcObject).toBeNull()
      requireSuccess(scene.attachVideo(video))
    }
    scene.dispose()
    scene.dispose()
    expect(manager.tearDown).toHaveBeenCalledTimes(1)
    if (presentation === 'streamed') expect(video.srcObject).toBeNull()
  }
)

it('does not detach or close a replacement presentation', async () => {
  const { manager, replace } = transport()
  const scene = requireSuccess(await connectScene(options(manager)))
  const video = document.createElement('video')
  requireSuccess(scene.attachVideo(video))
  const replacementMedia = new MediaStream()
  video.srcObject = replacementMedia
  replace()
  await expect(scene.resize({ width: 1024, height: 512 })).rejects.toThrow(
    'closed'
  )
  await expect(
    scene.send({
      type: 'modeling_cmd_req',
      cmd_id: 'fit',
      cmd: { type: 'zoom_to_fit', animated: false, object_ids: [], padding: 0 },
    })
  ).rejects.toThrow('closed')
  scene.dispose()
  expect(video.srcObject).toBe(replacementMedia)
  expect(manager.tearDown).not.toHaveBeenCalled()
  expect(manager.sendSceneCommand).not.toHaveBeenCalled()
  expect(manager.handleResize).not.toHaveBeenCalled()
})

it.each(['abort', 'timeout'] as const)(
  'cleans up its pending connection on %s',
  async (action) => {
    const { manager } = transport('local')
    const started = manager.start.getMockImplementation()!
    const pending = Promise.withResolvers<undefined>()
    manager.start.mockImplementation(async (args) => {
      await started(args)
      await pending.promise
      return undefined
    })
    const controller = new AbortController()
    const connecting = connectScene({
      ...options(manager, 'local'),
      signal: controller.signal,
    })
    if (action === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(1000)
    expect(await connecting).toBeInstanceOf(Error)
    expect(manager.tearDown).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await pending.promise
    expect(manager.connection).toBeUndefined()
  }
)

it.each(['abort', 'timeout'] as const)(
  'cancels during codec inspection on %s without waiting for the browser offer',
  async (action) => {
    const { manager } = transport()
    const inspection = Promise.withResolvers<undefined>()
    vi.mocked(preflightEngineVideoCodecSupport).mockReturnValueOnce(
      inspection.promise
    )
    const controller = new AbortController()
    const connecting = connectScene({
      ...options(manager),
      signal: controller.signal,
    })
    if (action === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(1000)
    expect(await connecting).toBeInstanceOf(Error)
    expect(manager.start).not.toHaveBeenCalled()
    inspection.resolve(undefined)
    await inspection.promise
    expect(manager.start).not.toHaveBeenCalled()
  }
)

it('keeps a newer attachment when an older attachment of the same media is released', async () => {
  const { manager, mediaStream } = transport()
  const scene = requireSuccess(await connectScene(options(manager)))
  const video = document.createElement('video')
  const old = requireSuccess(scene.attachVideo(video))
  const latest = requireSuccess(scene.attachVideo(video))
  old()
  expect(video.srcObject).toBe(mediaStream)
  latest()
  expect(video.srcObject).toBeNull()
  scene.dispose()
})

it('preserves terminal codec errors without allocating an engine connection', async () => {
  const { manager } = transport()
  const error = new UnsupportedEngineVideoCodecError(['video/vp8'])
  vi.mocked(preflightEngineVideoCodecSupport).mockResolvedValueOnce(error)
  expect(await connectScene(options(manager))).toBe(error)
  expect(manager.lastConnectionError).toBe(error)
  expect(manager.start).not.toHaveBeenCalled()
})

it('captures ownership before synchronous cancellation during startup', async () => {
  const { manager } = transport('local')
  const start = manager.start.getMockImplementation()!
  const controller = new AbortController()
  manager.start.mockImplementation(async (args) => {
    const result = start(args)
    controller.abort()
    return result
  })
  expect(
    await connectScene({
      ...options(manager, 'local'),
      signal: controller.signal,
    })
  ).toBeInstanceOf(Error)
  expect(manager.tearDown).toHaveBeenCalledTimes(1)
  expect(manager.connection).toBeUndefined()
})
