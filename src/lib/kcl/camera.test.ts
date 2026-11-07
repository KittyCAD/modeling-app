import type { ModelingCmd } from '@kittycad/viewer-sdk'
import { createKclCamera, type KclCamera } from '@src/lib/kcl/camera'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { afterEach, expect, it, vi } from 'vitest'

function transport() {
  const worker = new EventTarget()
  let settings = {
    center: { x: 1, y: 2, z: 3 },
    pos: { x: 1, y: 2, z: 13 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  }
  const reply = (id: string, type: string, data: unknown = {}) => {
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          from: 'websocket',
          payload: {
            type: 'message',
            data: JSON.stringify({
              success: true,
              request_id: id,
              resp: {
                type: 'modeling',
                data: { modeling_response: { type, data } },
              },
            }),
          },
        },
      })
    )
  }
  const commands: { id: string; cmd: ModelingCmd }[] = []
  const connection = Object.assign(new EventTarget(), {
    channel: new EventTarget(),
    executor: () => ({
      addEventListener: worker.addEventListener.bind(worker, 'message'),
      removeEventListener: worker.removeEventListener.bind(worker, 'message'),
    }),
    send: vi.fn(async (message: string): Promise<unknown> => {
      const request: { cmd_id: string; cmd: ModelingCmd } = JSON.parse(message)
      const { cmd_id: id, cmd } = request
      commands.push({ id, cmd })
      if (cmd.type === 'default_camera_look_at') {
        const orientation = new Quaternion()
          .setFromRotationMatrix(
            new Matrix4().lookAt(
              new Vector3(cmd.vantage.x, cmd.vantage.y, cmd.vantage.z),
              new Vector3(cmd.center.x, cmd.center.y, cmd.center.z),
              new Vector3(cmd.up.x, cmd.up.y, cmd.up.z)
            )
          )
          .invert()
        settings = {
          center: cmd.center,
          pos: cmd.vantage,
          orientation: {
            x: orientation.x,
            y: orientation.y,
            z: orientation.z,
            w: orientation.w,
          },
        }
      }
      reply(id, cmd.type, { settings })
      return { success: true } // The SDK promise is deliberately not the matching response.
    }),
  })
  const camera = createKclCamera(connection)
  cameras.push(camera)
  return { connection, camera, commands, reply, worker }
}
const cameras: KclCamera[] = []
afterEach(() => {
  for (const camera of cameras.splice(0)) camera.dispose()
  vi.useRealTimers()
})

it('follows only its own viewport orientation, inverts the engine quaternion, and unsubscribes', async () => {
  const first = transport()
  const second = transport()
  await vi.waitFor(() => expect(first.camera.state.value.type).toBe('ready'))
  const listener = vi.fn()
  const unsubscribe = first.camera.subscribeOrientation(listener)
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 3
  )
  // Data-channel replies have no success/resp/request_id envelope, unlike WebSocket replies.
  const message = JSON.stringify({
    type: 'camera_drag_move',
    data: {
      settings: {
        center: { x: 0, y: 0, z: 0 },
        pos: { x: 0, y: 0, z: 10 },
        orientation: {
          x: orientation.x,
          y: orientation.y,
          z: orientation.z,
          w: orientation.w,
        },
      },
    },
  })
  first.connection.channel.dispatchEvent(
    new MessageEvent('message', { data: message })
  )
  expect(
    first.camera.getOrientation().angleTo(orientation.clone().invert())
  ).toBeCloseTo(0)
  expect(second.camera.getOrientation().angleTo(new Quaternion())).toBeCloseTo(
    0
  )
  expect(listener).toHaveBeenCalledTimes(1)
  const snapshot = first.camera.getOrientation()
  snapshot.identity()
  expect(
    first.camera.getOrientation().angleTo(orientation.clone().invert())
  ).toBeCloseTo(0)
  unsubscribe()
  first.connection.channel.dispatchEvent(
    new MessageEvent('message', { data: message })
  )
  expect(listener).toHaveBeenCalledTimes(1)
})

it('matches command IDs rather than completing from an unrelated SDK reply', async () => {
  const { camera, connection, commands, reply } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  connection.send.mockImplementation(async (message) => {
    const request: { cmd_id: string; cmd: ModelingCmd } = JSON.parse(message)
    commands.push({ id: request.cmd_id, cmd: request.cmd })
    return { success: true }
  })
  let completed = false
  const operation = camera.orientTo(new Quaternion()).then(() => {
    completed = true
  })
  await vi.waitFor(() => expect(commands).toHaveLength(2))
  reply('unrelated', 'default_camera_get_settings', {})
  await Promise.resolve()
  expect(completed).toBe(false)
  camera.dispose()
  await expect(operation).rejects.toThrow('The camera session closed')
  expect(commands).toHaveLength(2)
})

it('orients around the current target and distance without changing projection', async () => {
  const { camera, commands } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  const target = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2
  )
  await camera.orientTo(target)
  const command = commands.findLast(
    ({ cmd }) => cmd.type === 'default_camera_look_at'
  )?.cmd
  expect(command?.type).toBe('default_camera_look_at')
  if (command?.type !== 'default_camera_look_at') return
  expect(command.center).toEqual({ x: 1, y: 2, z: 3 })
  expect(command.vantage.x).toBeCloseTo(11)
  expect(command.vantage.y).toBeCloseTo(2)
  expect(command.vantage.z).toBeCloseTo(3)
  expect(command.up).toMatchObject({ x: 0, y: 1, z: 0 })
  expect(camera.getOrientation().angleTo(target)).toBeCloseTo(0)
  expect(
    commands.filter(({ cmd }) => cmd.type === 'default_camera_look_at').length
  ).toBeGreaterThan(1)
  expect(commands.at(-1)?.cmd.type).toBe('default_camera_get_settings')
})

it('coalesces drag motion and keeps consecutive drags in order', async () => {
  const { camera, commands } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  camera.beginOrbit()
  camera.orbitBy(4, 5)
  camera.orbitBy(6, -2)
  camera.endOrbit()
  camera.beginOrbit()
  camera.orbitBy(-2, 8)
  camera.endOrbit()
  await vi.waitFor(() => expect(commands).toHaveLength(7))
  expect(commands.slice(1).map(({ cmd }) => cmd)).toEqual([
    {
      type: 'camera_drag_start',
      interaction: 'rotate',
      window: { x: 0, y: 0 },
    },
    {
      type: 'camera_drag_move',
      interaction: 'rotate',
      window: { x: 10, y: 3 },
    },
    { type: 'camera_drag_end', interaction: 'rotate', window: { x: 10, y: 3 } },
    {
      type: 'camera_drag_start',
      interaction: 'rotate',
      window: { x: 0, y: 0 },
    },
    {
      type: 'camera_drag_move',
      interaction: 'rotate',
      window: { x: -2, y: 8 },
    },
    { type: 'camera_drag_end', interaction: 'rotate', window: { x: -2, y: 8 } },
  ])
})

it('surfaces malformed camera settings and bounds an unanswered command', async () => {
  const { camera, connection, commands, reply } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  connection.send.mockImplementation(async (message) => {
    const request: { cmd_id: string; cmd: ModelingCmd } = JSON.parse(message)
    commands.push({ id: request.cmd_id, cmd: request.cmd })
    return { success: true }
  })
  const invalid = camera.orientTo(new Quaternion())
  await vi.waitFor(() => expect(commands).toHaveLength(2))
  reply(commands[1].id, 'default_camera_get_settings', {
    settings: { orientation: { x: 0, y: 0, z: 0, w: 0 } },
  })
  await expect(invalid).rejects.toThrow('invalid camera settings')
  expect(camera.state.value.type).toBe('error')

  vi.useFakeTimers()
  const timedOut = expect(camera.orientTo(new Quaternion())).rejects.toThrow(
    'timed out'
  )
  await vi.advanceTimersByTimeAsync(10_000)
  await timedOut
  expect(camera.state.value.type).toBe('error')
})

it('publishes intermediate orientations and cancels a transition when disposed', async () => {
  const { camera, commands } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  vi.useFakeTimers()
  const target = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2
  )
  const angles: number[] = []
  camera.subscribeOrientation(() =>
    angles.push(new Quaternion().angleTo(camera.getOrientation()))
  )
  const operation = camera.orientTo(target)
  await vi.advanceTimersByTimeAsync(200)
  expect(angles.some((angle) => angle > 0 && angle < Math.PI / 2)).toBe(true)
  const count = commands.length
  camera.dispose()
  await expect(operation).rejects.toThrow('The camera session closed')
  await vi.advanceTimersByTimeAsync(1000)
  expect(commands).toHaveLength(count)
})

it('uses one final pose when reduced motion is requested', async () => {
  const { camera, commands } = transport()
  await vi.waitFor(() => expect(camera.state.value.type).toBe('ready'))
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  try {
    await camera.orientTo(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    )
    expect(
      commands.filter(({ cmd }) => cmd.type === 'default_camera_look_at')
    ).toHaveLength(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
