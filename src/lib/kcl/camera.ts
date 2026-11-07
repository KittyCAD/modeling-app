import type { ModelingCmd } from '@kittycad/viewer-sdk'
import { signal } from '@preact/signals-core'
import type { GizmoCamera } from '@src/components/gizmo/camera'
import { readKclResult } from '@src/lib/kcl/result'
import { isErr, reportRejection } from '@src/lib/trap'
import { Quaternion, Vector3 } from 'three'
import { isRecord, isReducedMotion } from '@src/lib/utils'

/** The SDK worker exposes reliable replies; viewport drag replies arrive on the data channel. */
export interface KclCameraConnection extends EventTarget {
  channel?: EventTarget
  executor(): {
    addEventListener(listener: (event: Event) => void): void
    removeEventListener(listener: (event: Event) => void): void
  }
  send(message: string): Promise<unknown>
}

interface CameraSnapshot {
  center: { x: number; y: number; z: number }
  pos: { x: number; y: number; z: number }
  orientation: { x: number; y: number; z: number; w: number }
}
function readPoint(value: unknown) {
  if (!isRecord(value)) return undefined
  const { x, y, z } = value
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    return undefined
  return { x, y, z }
}
function readSettings(value: unknown): CameraSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const center = readPoint(value.center)
  const pos = readPoint(value.pos)
  const xyz = readPoint(value.orientation)
  const w = isRecord(value.orientation) ? value.orientation.w : undefined
  if (
    !center ||
    !pos ||
    !xyz ||
    typeof w !== 'number' ||
    !Number.isFinite(w) ||
    xyz.x * xyz.x + xyz.y * xyz.y + xyz.z * xyz.z + w * w === 0
  )
    return undefined
  return { center, pos, orientation: { ...xyz, w } }
}
/** Parse only modeling envelopes; signaling and WASM results are unrelated to this camera. */
function readResponse(value: unknown) {
  const decoded = decode(value)
  if (!isRecord(decoded) || typeof decoded.success !== 'boolean')
    return undefined
  const id =
    typeof decoded.request_id === 'string' ? decoded.request_id : undefined
  const resp = decoded.resp
  const data =
    isRecord(resp) && resp.type === 'modeling' ? resp.data : undefined
  const modeling =
    isRecord(data) && isRecord(data.modeling_response)
      ? data.modeling_response
      : undefined
  return { id, success: decoded.success, modeling, decoded }
}
function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

type CameraState =
  | { type: 'loading' | 'ready' }
  | { type: 'error'; error: Error }

/** One engine-owned camera per executor. Commands are correlated by ID, never by arrival order. */
export function createKclCamera(connection: KclCameraConnection) {
  const state = signal<CameraState>({ type: 'loading' })
  let settings: CameraSnapshot | undefined
  let disposed = false
  let queue = Promise.resolve()
  let channel: EventTarget | undefined
  let cancelTransition: (() => void) | undefined
  let drag:
    | {
        window: { x: number; y: number }
        pendingMove?: { x: number; y: number }
        moving: boolean
      }
    | undefined
  const listeners = new Set<() => void>()
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >()
  const worker = connection.executor()

  const publish = (next: CameraSnapshot) => {
    settings = next
    state.value = { type: 'ready' }
    for (const listener of listeners) listener()
  }
  const receiveOrientation = (
    modeling: Record<string, unknown> | undefined
  ) => {
    if (disposed) return
    if (
      modeling &&
      [
        'default_camera_get_settings',
        'camera_drag_move',
        'camera_drag_end',
        'default_camera_zoom',
        'zoom_to_fit',
      ].some((type) => type === modeling.type)
    ) {
      const next = isRecord(modeling.data)
        ? readSettings(modeling.data.settings)
        : undefined
      if (next) {
        publish(next)
      }
    }
  }
  const receive = (value: unknown) => {
    if (disposed) return
    const response = readResponse(value)
    if (!response) return
    const command = response.id ? pending.get(response.id) : undefined
    if (!response.success) {
      const result = readKclResult(response.decoded)
      command?.reject(
        isErr(result)
          ? result
          : new Error('The engine rejected the camera command')
      )
      return
    }
    const modeling = response.modeling
    receiveOrientation(modeling)
    command?.resolve(modeling)
  }
  const onWorkerMessage = (event: Event) => {
    if (!(event instanceof MessageEvent)) return
    const message: unknown = event.data
    if (
      !isRecord(message) ||
      message.from !== 'websocket' ||
      !isRecord(message.payload) ||
      message.payload.type !== 'message'
    )
      return
    receive(message.payload.data)
  }
  const onChannelMessage = (event: Event) => {
    if (!(event instanceof MessageEvent)) return
    const modeling = decode(event.data)
    if (isRecord(modeling)) receiveOrientation(modeling)
  }
  const attachChannel = () => {
    channel?.removeEventListener('message', onChannelMessage)
    channel = connection.channel
    channel?.addEventListener('message', onChannelMessage)
  }
  worker.addEventListener(onWorkerMessage)
  connection.addEventListener('datachannel', attachChannel)
  attachChannel()

  const request = async (cmd: ModelingCmd): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('The camera session closed'))
    const id = crypto.randomUUID()
    const result = Promise.withResolvers<unknown>()
    pending.set(id, result)
    const timeout = setTimeout(
      () => result.reject(new Error('The camera command timed out')),
      10_000
    )
    // SDK send() resolves on an arbitrary WebSocket reply. Only the matched worker reply completes this request.
    try {
      connection
        .send(JSON.stringify({ type: 'modeling_cmd_req', cmd_id: id, cmd }))
        .catch(result.reject)
      return await result.promise
    } finally {
      clearTimeout(timeout)
      pending.delete(id)
    }
  }
  const report = (error: unknown) => {
    if (!disposed) reportRejection(error)
  }
  const enqueue = (work: () => Promise<void>) => {
    const operation = queue.then(async () => {
      if (disposed) return
      try {
        await work()
      } catch (cause) {
        const error = isErr(cause)
          ? cause
          : new Error('Unable to control the camera', { cause })
        if (!disposed) state.value = { type: 'error', error }
        return Promise.reject(error)
      }
    })
    queue = operation.catch(() => {})
    return operation
  }
  const refresh = async () => {
    const response = await request({ type: 'default_camera_get_settings' })
    if (
      !isRecord(response) ||
      response.type !== 'default_camera_get_settings' ||
      !isRecord(response.data) ||
      !readSettings(response.data.settings)
    )
      return Promise.reject(
        new Error('The engine returned invalid camera settings')
      )
  }
  enqueue(refresh).catch(report)

  const camera: GizmoCamera = {
    getOrientation: () =>
      settings
        ? new Quaternion(
            settings.orientation.x,
            settings.orientation.y,
            settings.orientation.z,
            settings.orientation.w
          )
            .normalize()
            .invert()
        : new Quaternion(),
    subscribeOrientation(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    orientTo: (orientation) => {
      const target = orientation.clone().normalize()
      return enqueue(async () => {
        await refresh()
        if (!settings || disposed) return
        const center = new Vector3(
          settings.center.x,
          settings.center.y,
          settings.center.z
        )
        const position = new Vector3(
          settings.pos.x,
          settings.pos.y,
          settings.pos.z
        )
        const distance = position.distanceTo(center)
        const initial = camera.getOrientation()
        const snapshot = settings
        const duration = isReducedMotion() ? 0 : 500
        const started = performance.now()
        // Wait for each engine acknowledgement before sending the next pose, so slow
        // connections skip intermediate poses rather than building a stale command backlog.
        await new Promise<void>((resolve, reject) => {
          let frame = 0
          cancelTransition = () => {
            cancelAnimationFrame(frame)
            reject(new Error('The camera session closed'))
          }
          const step = (now: number) => {
            if (disposed) return
            const progress =
              duration === 0 ? 1 : Math.min((now - started) / duration, 1)
            const eased =
              progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2
            const orientation = initial.clone().slerp(target, eased)
            const vantage = new Vector3(0, 0, distance)
              .applyQuaternion(orientation)
              .add(center)
            const up = new Vector3(0, 1, 0).applyQuaternion(orientation)
            const engineOrientation = orientation.clone().invert()
            publish({
              center: snapshot.center,
              pos: { x: vantage.x, y: vantage.y, z: vantage.z },
              orientation: {
                x: engineOrientation.x,
                y: engineOrientation.y,
                z: engineOrientation.z,
                w: engineOrientation.w,
              },
            })
            request({
              type: 'default_camera_look_at',
              center: snapshot.center,
              vantage,
              up,
            })
              .then(() => {
                if (disposed) return
                if (progress === 1) resolve()
                else frame = requestAnimationFrame(step)
              })
              .catch(reject)
          }
          if (duration === 0) step(started)
          else frame = requestAnimationFrame(step)
        }).finally(() => {
          cancelTransition = undefined
        })
        await refresh()
      })
    },
    beginOrbit() {
      drag = { window: { x: 0, y: 0 }, moving: false }
      enqueue(async () => {
        await request({
          type: 'camera_drag_start',
          interaction: 'rotate',
          window: { x: 0, y: 0 },
        })
      }).catch(report)
    },
    orbitBy(dx, dy) {
      if (!drag) return
      const current = drag
      current.window = { x: current.window.x + dx, y: current.window.y + dy }
      current.pendingMove = current.window
      if (current.moving) return
      current.moving = true
      enqueue(async () => {
        try {
          while (current.pendingMove && !disposed) {
            const window = current.pendingMove
            current.pendingMove = undefined
            await request({
              type: 'camera_drag_move',
              interaction: 'rotate',
              window,
            })
          }
        } finally {
          current.moving = false
        }
      }).catch(report)
    },
    endOrbit() {
      if (!drag) return
      const window = drag.window
      drag = undefined
      enqueue(async () => {
        await request({
          type: 'camera_drag_end',
          interaction: 'rotate',
          window,
        })
      }).catch(report)
    },
  }
  return Object.assign(camera, {
    id: crypto.randomUUID(),
    state,
    dispose() {
      disposed = true
      cancelTransition?.()
      worker.removeEventListener(onWorkerMessage)
      channel?.removeEventListener('message', onChannelMessage)
      connection.removeEventListener('datachannel', attachChannel)
      for (const command of pending.values())
        command.reject(new Error('The camera session closed'))
      pending.clear()
      listeners.clear()
    },
  })
}
export type KclCamera = ReturnType<typeof createKclCamera>
