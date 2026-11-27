import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { preflightEngineVideoCodecSupport } from '@src/lib/engineConnection/videoCodecSupport'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'

const videoOwners = new WeakMap<HTMLVideoElement, symbol>()

/** Streamed scenes require media; locally rendered scenes use a geometry-only connection. */
export type ScenePresentation = 'streamed' | 'local'

export type SceneConnectionManager = Pick<
  ConnectionManager,
  | 'start'
  | 'started'
  | 'tearDown'
  | 'handleResize'
  | 'sendSceneCommand'
  | 'lastConnectionError'
> & {
  readonly connection:
    | { readonly id: string; readonly mediaStream: MediaStream | undefined }
    | undefined
}

/** A captured connection cannot send, resize, or dispose a later opening on the same manager. */
export interface SceneConnection {
  readonly presentation: ScenePresentation
  readonly id: string
  readonly mediaStream: MediaStream | undefined
  send: ConnectionManager['sendSceneCommand']
  resize: ConnectionManager['handleResize']
  attachVideo: (video: HTMLVideoElement) => (() => void) | Error
  dispose: () => void
}

export async function connectScene({
  manager,
  token,
  size,
  presentation,
  timeoutMs,
  signal,
  rustContext,
  kclVersion,
  prepareForReconnect,
  onStreamReady,
}: {
  manager: SceneConnectionManager
  token: string
  size: { width: number; height: number }
  presentation: ScenePresentation
  timeoutMs: number
  signal?: AbortSignal
  rustContext?: RustContext
  kclVersion?: KclVersion
  prepareForReconnect?: (signal: AbortSignal) => Promise<undefined | Error>
  onStreamReady?: (ready: boolean) => void
}): Promise<SceneConnection | Error> {
  if (signal?.aborted) return new Error('Scene connection was cancelled')
  if (!token) return new Error('Sign in to connect to the engine')
  if (manager.started)
    return new Error('The scene is already connected or connecting')
  let disposed = false
  let captured: SceneConnectionManager['connection']
  const attachments = new Set<() => void>()
  const current = () =>
    !disposed && captured !== undefined && manager.connection === captured
  const dispose = () => {
    if (disposed) return
    const ownsConnection = current()
    disposed = true
    signal?.removeEventListener('abort', onAbort)
    for (const detach of attachments) detach()
    attachments.clear()
    if (ownsConnection)
      manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
  }
  let interrupt!: (error: Error) => void
  const interrupted = new Promise<Error>((resolve) => {
    interrupt = resolve
  })
  const onAbort = () => {
    dispose()
    interrupt(new Error('Scene connection was cancelled'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    dispose()
    interrupt(new Error('Timed out connecting to the scene'))
  }, timeoutMs)
  const open = async (): Promise<SceneConnection | Error> => {
    if (presentation === 'streamed') {
      const error = await preflightEngineVideoCodecSupport()
      if (disposed) return new Error('Scene connection was cancelled')
      if (error) {
        manager.lastConnectionError = error
        return error
      }
    }
    if (disposed) return new Error('Scene connection was cancelled')
    if (manager.started)
      return new Error('The scene is already connected or connecting')
    const starting = manager.start({
      ...size,
      token,
      geometryOnly: presentation === 'local',
      rustContext,
      kclVersion,
      prepareForReconnect,
      onConnectionCreated: (connection) => {
        captured = connection
      },
      setStreamIsReady: (ready) => {
        if (current()) onStreamReady?.(ready)
      },
    })
    captured ??= manager.connection
    await starting
    if (!current()) {
      dispose()
      return new Error('The scene connection changed while connecting')
    }
    const connection = captured!
    const mediaStream = connection.mediaStream
    if (presentation === 'streamed' && !mediaStream) {
      dispose()
      return new Error('The scene connection has no video stream')
    }
    return {
      id: connection.id,
      presentation,
      mediaStream,
      send: (command, forceWebsocket) =>
        current()
          ? manager.sendSceneCommand(command, forceWebsocket)
          : Promise.reject(new Error('The scene connection is closed')),
      resize: (nextSize) =>
        current()
          ? manager.handleResize(nextSize)
          : Promise.reject(new Error('The scene connection is closed')),
      attachVideo: (video) => {
        if (!current()) return new Error('The scene connection is closed')
        if (!mediaStream)
          return new Error('Locally rendered scenes have no video stream')
        const owner = Symbol('scene-video')
        video.srcObject = mediaStream
        videoOwners.set(video, owner)
        const detach = () => {
          if (videoOwners.get(video) === owner) {
            videoOwners.delete(video)
            if (video.srcObject === mediaStream) video.srcObject = null
          }
          attachments.delete(detach)
        }
        attachments.add(detach)
        return detach
      },
      dispose,
    }
  }
  try {
    const result = await Promise.race([open(), interrupted])
    if (isErr(result)) dispose()
    return result
  } catch (cause) {
    dispose()
    return isErr(cause)
      ? cause
      : new Error('Unable to connect to the scene', { cause })
  } finally {
    clearTimeout(timer)
  }
}
