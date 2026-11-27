import { signal } from '@preact/signals-core'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import { emptyExecState } from '@src/lang/wasm'
import type { KclSceneResource, OpenKclScene } from '@src/lib/kcl/scene/open'
import { createKclSession } from '@src/lib/kcl/modeling/session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTestKclScene } from '@src/lib/kcl/testFixtures'

let resize: () => void
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const snapshot = { src: 'main.kcl', files: new Map() }
const runSignal = () => new AbortController().signal
const scene = createTestKclScene
function container(width = 200) {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { value: 150 },
  })
  return element
}

it('waits for a visible size and retains the scene across presentation attachments', async () => {
  const resource = scene()
  const open = vi.fn<OpenKclScene>().mockResolvedValue(resource)
  const session = createKclSession(open)
  const parent = container(0)
  const detach = session.attach(parent)
  expect(open).not.toHaveBeenCalled()
  Object.defineProperty(parent, 'clientWidth', { value: 200 })
  resize()
  await session.execute(snapshot, runSignal())
  detach()
  expect(resource.dispose).not.toHaveBeenCalled()
  session.attach(container())
  expect(open).toHaveBeenCalledOnce()
  expect(session.element.contains(resource.element)).toBe(true)
  session.dispose()
})

it('disposes the scene only once when cleanup repeats', async () => {
  const resource = scene()
  const session = createKclSession(async () => resource)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    session.dispose()
    session.dispose()
    expect(resource.dispose).toHaveBeenCalledOnce()
  } finally {
    session.dispose()
  }
})

it.each(['local', 'streamed'] as const)(
  'serializes %s executions and frames streamed models once',
  async (presentation) => {
    const resource = scene(presentation)
    const pending = Promise.withResolvers<ReturnType<typeof emptyExecState>>()
    vi.mocked(resource.runtime.execute).mockReturnValueOnce(pending.promise)
    const session = createKclSession(async () => resource)
    session.attach(container())
    const first = session.execute(snapshot, runSignal())
    const second = session.execute(snapshot, runSignal())
    await vi.waitFor(() =>
      expect(resource.runtime.execute).toHaveBeenCalledOnce()
    )
    pending.resolve(emptyExecState())
    expect(await first).not.toBeInstanceOf(Error)
    expect(await second).not.toBeInstanceOf(Error)
    expect(resource.runtime.execute).toHaveBeenCalledTimes(2)
    expect(resource.frameModel).toHaveBeenCalledTimes(
      presentation === 'streamed' ? 1 : 0
    )
    session.dispose()
  }
)

it('releases a late opening when the executor closes during startup', async () => {
  const opening = Promise.withResolvers<KclSceneResource | Error>()
  const session = createKclSession(() => opening.promise)
  session.attach(container())
  const run = session.execute(snapshot, runSignal())
  session.dispose()
  expect(await run).toBeInstanceOf(Error)
  const resource = scene()
  opening.resolve(resource)
  await vi.waitFor(() => expect(resource.dispose).toHaveBeenCalledOnce())
  expect(session.state.peek().type).toBe('closed')
  expect(session.element.childElementCount).toBe(0)
})

it('does not publish success when interrupted during camera/settings work', async () => {
  const resource = scene()
  const framing = Promise.withResolvers<undefined>()
  vi.mocked(resource.frameModel).mockImplementation(async () => {
    await framing.promise
  })
  const session = createKclSession(async () => resource)
  const controller = new AbortController()
  session.attach(container())
  const run = session.execute(snapshot, controller.signal)
  await vi.waitFor(() => expect(resource.frameModel).toHaveBeenCalledOnce())
  controller.abort()
  framing.resolve(undefined)
  expect(await run).toBeInstanceOf(Error)
  session.dispose()
})

it('bounds startup even when WASM initialization never settles', async () => {
  vi.useFakeTimers()
  const session = createKclSession(() => new Promise(() => {}))
  session.attach(container())
  const run = session.execute(snapshot, runSignal())
  await vi.advanceTimersByTimeAsync(60_000)
  expect(await run).toBeInstanceOf(Error)
  expect(session.state.peek().type).toBe('error')
  session.dispose()
})

it('settles running and queued work on disconnect without starting another native execution', async () => {
  const resource = scene()
  vi.mocked(resource.runtime.execute).mockReturnValue(new Promise(() => {}))
  let disconnect!: (error: Error) => void
  const session = createKclSession(async (_size, _signal, fail) => {
    disconnect = fail
    return resource
  })
  session.attach(container())
  const first = session.execute(snapshot, runSignal())
  const second = session.execute(snapshot, runSignal())
  await vi.waitFor(() =>
    expect(resource.runtime.execute).toHaveBeenCalledOnce()
  )
  disconnect(new Error('Connection lost'))
  expect(await first).toBeInstanceOf(Error)
  expect(await second).toBeInstanceOf(Error)
  expect(resource.runtime.execute).toHaveBeenCalledOnce()
  expect(resource.dispose).toHaveBeenCalledOnce()
  session.dispose()
})

it('reopens a disconnected mounted scene on focus and refreshes its current executor once', async () => {
  const first = scene(),
    second = scene()
  let disconnect: (error: Error) => void = () => {}
  const open = vi
    .fn<OpenKclScene>()
    .mockImplementationOnce(async (_size, _signal, onDisconnect) => {
      disconnect = onDisconnect
      return first
    })
    .mockResolvedValueOnce(second)
  const refresh = vi.fn()
  const session = createKclSession(open, refresh)
  const parent = container()
  const detach = session.attach(parent)
  await session.execute(snapshot, runSignal())
  disconnect(new Error('Idle connection expired'))
  expect(session.resource.peek()).toBeUndefined()
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(session.resource.peek()).toBe(second))
  expect(open).toHaveBeenCalledTimes(2)
  expect(refresh).toHaveBeenCalledOnce()
  const latest = { ...snapshot, src: 'latest.kcl' }
  await session.execute(latest, runSignal())
  expect(vi.mocked(second.runtime.execute).mock.calls[0][0]).toBe(latest)
  disconnect(new Error('Late close from previous connection'))
  expect(session.resource.peek()).toBe(second)
  detach()
  session.dispose()
  window.dispatchEvent(new Event('focus'))
  expect(open).toHaveBeenCalledTimes(2)
})

it('recovers a stale captured connection on focus without reopening a healthy sibling', async () => {
  const one = scene(),
    replacement = scene(),
    two = scene()
  let connected = true
  one.isConnected = () => connected
  two.isConnected = () => true
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(one)
    .mockResolvedValueOnce(replacement)
  const siblingOpen = vi.fn<OpenKclScene>().mockResolvedValue(two)
  const session = createKclSession(open),
    sibling = createKclSession(siblingOpen)
  const detach = session.attach(container()),
    detachSibling = sibling.attach(container())
  await session.execute(snapshot, runSignal())
  await sibling.execute(snapshot, runSignal())
  connected = false
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(session.resource.peek()).toBe(replacement))
  expect(sibling.resource.peek()).toBe(two)
  expect(siblingOpen).toHaveBeenCalledOnce()
  expect(two.dispose).not.toHaveBeenCalled()
  detach()
  detachSibling()
  session.dispose()
  sibling.dispose()
})

it('ignores late resize failures from a retired connection', async () => {
  const first = scene(),
    second = scene()
  const resizing = Promise.withResolvers<undefined>()
  let connected = true
  first.isConnected = () => connected
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const session = createKclSession(open)
  const detach = session.attach(container())
  await session.execute(snapshot, runSignal())
  vi.mocked(first.resize).mockImplementationOnce(() => resizing.promise)
  resize()
  connected = false
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(session.resource.peek()).toBe(second))
  resizing.reject(new Error('Old resize failed'))
  await Promise.resolve()
  await Promise.resolve()
  expect(session.state.peek().type).toBe('ready')
  expect(session.resource.peek()).toBe(second)
  detach()
  session.dispose()
})

it('keeps local scenes alive past the idle timeout', async () => {
  vi.useFakeTimers()
  const resource = scene('local')
  resource.preferences = { ...resource.preferences, idleTimeout: signal(1000) }
  const session = createKclSession(async () => resource)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    await vi.advanceTimersByTimeAsync(1100)
    expect(session.resource.peek()).toBe(resource)
    expect(resource.dispose).not.toHaveBeenCalled()
  } finally {
    session.dispose()
  }
})

it('restores the streamed camera after resuming from idle', async () => {
  vi.useFakeTimers()
  const first = scene('streamed'),
    second = scene('streamed')
  first.preferences = { ...first.preferences, idleTimeout: signal(1000) }
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const session = createKclSession(open)
  const parent = container()
  session.attach(parent)
  try {
    await session.execute(snapshot, runSignal())
    const pose = first.snapshotCamera()
    await vi.advanceTimersByTimeAsync(1100)
    expect(session.state.peek().type).toBe('idle')
    expect(first.dispose).toHaveBeenCalledOnce()
    parent.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(0)
    await session.execute(snapshot, runSignal())
    expect(second.restoreCamera).toHaveBeenCalledWith({
      ...pose,
      is_ortho:
        second.preferences.camera.peek().cameraProjection === 'orthographic',
    })
    expect(second.frameModel).not.toHaveBeenCalled()
  } finally {
    session.dispose()
  }
})

it('does not idle during execution or while the user is interacting', async () => {
  vi.useFakeTimers()
  const resource = scene()
  resource.preferences = { ...resource.preferences, idleTimeout: signal(1000) }
  const session = createKclSession(async () => resource)
  const parent = container()
  session.attach(parent)
  try {
    await session.execute(snapshot, runSignal())
    resource.runtime.executing.value = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(resource.dispose).not.toHaveBeenCalled()
    resource.runtime.executing.value = false
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(800)
      parent.dispatchEvent(new PointerEvent('pointermove'))
    }
    expect(resource.dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(session.state.peek().type).toBe('idle')
  } finally {
    session.dispose()
  }
})

it.each([true, false])(
  'retries a retryable=%s transport loss without moving a healthy sibling',
  async (retryable) => {
    vi.useFakeTimers()
    const first = scene(),
      replacement = scene(),
      siblingScene = scene()
    let disconnect: (error: Error) => void = () => {}
    const open = vi
      .fn<OpenKclScene>()
      .mockImplementationOnce(async (_size, _signal, closed) => {
        disconnect = closed
        return first
      })
      .mockResolvedValue(replacement)
    const session = createKclSession(open),
      sibling = createKclSession(async () => siblingScene)
    session.attach(container())
    sibling.attach(container())
    try {
      await session.execute(snapshot, runSignal())
      await sibling.execute(snapshot, runSignal())
      const pose = first.snapshotCamera()
      disconnect(new SceneDisconnected('WebSocket closed', retryable))
      await vi.advanceTimersByTimeAsync(1000)
      if (retryable) {
        expect(session.resource.peek()).toBe(replacement)
        await session.execute(snapshot, runSignal())
        expect(replacement.restoreCamera).toHaveBeenCalledWith({
          ...pose,
          is_ortho:
            replacement.preferences.camera.peek().cameraProjection ===
            'orthographic',
        })
        expect(replacement.frameModel).not.toHaveBeenCalled()
      } else {
        window.dispatchEvent(new Event('focus'))
        expect(open).toHaveBeenCalledOnce()
        expect(session.state.peek().type).toBe('error')
      }
      expect(sibling.resource.peek()).toBe(siblingScene)
      expect(siblingScene.dispose).not.toHaveBeenCalled()
    } finally {
      session.dispose()
      sibling.dispose()
    }
  }
)

it('cancels a pending automatic retry on disposal and discards its saved camera', async () => {
  vi.useFakeTimers()
  let disconnect: (error: Error) => void = () => {}
  const first = scene()
  const open = vi
    .fn<OpenKclScene>()
    .mockImplementation(async (_size, _signal, closed) => {
      disconnect = closed
      return first
    })
  const session = createKclSession(open)
  session.attach(container())
  await session.execute(snapshot, runSignal())
  disconnect(new SceneDisconnected('Lost connection'))
  session.dispose()
  await vi.advanceTimersByTimeAsync(10000)
  window.dispatchEvent(new Event('online'))
  expect(open).toHaveBeenCalledOnce()
  const fresh = scene(),
    next = createKclSession(async () => fresh)
  next.attach(container())
  await next.execute(snapshot, runSignal())
  expect(fresh.frameModel).toHaveBeenCalledOnce()
  expect(fresh.restoreCamera).not.toHaveBeenCalled()
  next.dispose()
})

it('bounds repeated startup failures after a transport loss until the user retries', async () => {
  vi.useFakeTimers()
  let disconnect: (error: Error) => void = () => {}
  const first = scene()
  const open = vi
    .fn<OpenKclScene>()
    .mockImplementationOnce(async (_size, _signal, closed) => {
      disconnect = closed
      return first
    })
    .mockResolvedValue(new Error('Still unavailable'))
  const session = createKclSession(open)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    disconnect(new SceneDisconnected('Connection lost'))
    await vi.advanceTimersByTimeAsync(20000)
    expect(open).toHaveBeenCalledTimes(4)
    expect(session.state.peek().type).toBe('error')
    session.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(open).toHaveBeenCalledTimes(5)
  } finally {
    session.dispose()
  }
})

it('does not spend the failure retry budget on requested connection rebuilds', async () => {
  vi.useFakeTimers()
  let disconnect: (error: Error) => void = () => {}
  const open = vi
    .fn<OpenKclScene>()
    .mockImplementation(async (_size, _signal, closed) => {
      disconnect = closed
      return scene()
    })
  const session = createKclSession(open)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    for (let i = 0; i < 4; i++) {
      disconnect(
        new SceneDisconnected('Requested rebuild', true, {
          reconnectRequested: true,
        })
      )
      await vi.advanceTimersByTimeAsync(1000)
      expect(session.state.peek().type).toBe('ready')
      await session.execute(snapshot, runSignal())
    }
    expect(open).toHaveBeenCalledTimes(5)
  } finally {
    session.dispose()
  }
})

it('retires a hidden scene on renderer changes and opens its replacement when the viewport becomes visible', async () => {
  const first = scene('local'),
    second = scene('streamed')
  const disposed = Promise.withResolvers<undefined>()
  vi.mocked(first.dispose).mockImplementation(() => disposed.promise)
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const session = createKclSession(open)
  const parent = container()
  const detach = session.attach(parent)
  try {
    await session.execute(snapshot, runSignal())
    const pose = first.snapshotCamera()
    Object.defineProperty(parent, 'clientWidth', { value: 0 })
    session.replaceScene()
    const run = session.execute(snapshot, runSignal())
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(session.resource.peek()).toBeUndefined()
    Object.defineProperty(parent, 'clientWidth', { value: 200 })
    resize()
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()
    disposed.resolve(undefined)
    expect(await run).not.toBeInstanceOf(Error)
    expect(open).toHaveBeenCalledTimes(2)
    expect(second.restoreCamera).toHaveBeenCalledWith(pose)
    expect(second.frameModel).not.toHaveBeenCalled()
  } finally {
    disposed.resolve(undefined)
    detach()
    session.dispose()
  }
})

it('discards late startup results after switching the renderer again', async () => {
  const pending = Promise.withResolvers<KclSceneResource | Error>()
  const late = scene('local'),
    replacement = scene('streamed')
  const open = vi
    .fn<OpenKclScene>()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(replacement)
  const session = createKclSession(open)
  session.attach(container())
  const abandoned = session.execute(snapshot, runSignal())
  try {
    session.replaceScene()
    expect(await abandoned).toBeInstanceOf(Error)
    expect(await session.execute(snapshot, runSignal())).not.toBeInstanceOf(
      Error
    )
    pending.resolve(late)
    await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledOnce())
    expect(session.resource.peek()).toBe(replacement)
    expect(replacement.restoreCamera).not.toHaveBeenCalled()
  } finally {
    pending.resolve(late)
    session.dispose()
  }
})

it('retains the original camera when another renderer switch interrupts camera restoration', async () => {
  const first = scene('streamed'),
    second = scene('local'),
    third = scene('streamed')
  const restoring = Promise.withResolvers<undefined>()
  const executing = Promise.withResolvers<ReturnType<typeof emptyExecState>>()
  vi.mocked(second.restoreCamera).mockImplementation(() => restoring.promise)
  vi.mocked(third.runtime.execute).mockImplementation(() => executing.promise)
  const pose = { ...first.snapshotCamera(), eye_offset: 789 }
  vi.mocked(first.snapshotCamera).mockReturnValue(pose)
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
    .mockResolvedValueOnce(third)
  const session = createKclSession(open)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    session.replaceScene()
    const abandoned = session.execute(snapshot, runSignal())
    await vi.waitFor(() =>
      expect(second.restoreCamera).toHaveBeenCalledWith(pose)
    )
    session.replaceScene()
    const latest = session.execute(snapshot, runSignal())
    expect(await abandoned).toBeInstanceOf(Error)
    await vi.waitFor(() => expect(third.runtime.execute).toHaveBeenCalledOnce())
    restoring.resolve(undefined)
    await Promise.resolve()
    executing.resolve(emptyExecState())
    expect(await latest).not.toBeInstanceOf(Error)
    expect(third.restoreCamera).toHaveBeenCalledWith(pose)
    expect(third.frameModel).not.toHaveBeenCalled()
  } finally {
    restoring.resolve(undefined)
    executing.resolve(emptyExecState())
    session.dispose()
  }
})

it('honors a changed projection preference during ordinary connection recovery', async () => {
  let connected = true
  const first = scene('streamed', { isConnected: () => connected })
  const second = scene('streamed')
  second.preferences = {
    ...second.preferences,
    camera: signal({
      ...second.preferences.camera.peek(),
      cameraProjection: 'orthographic',
    }),
  }
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const session = createKclSession(open)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    const pose = first.snapshotCamera()
    connected = false
    session.reconnect()
    expect(await session.execute(snapshot, runSignal())).not.toBeInstanceOf(
      Error
    )
    expect(second.restoreCamera).toHaveBeenCalledWith({
      ...pose,
      is_ortho: true,
    })
  } finally {
    session.dispose()
  }
})

it('resumes an idle streamed scene when execution is requested without viewport input', async () => {
  vi.useFakeTimers()
  const first = scene('streamed'),
    second = scene('streamed')
  first.preferences = { ...first.preferences, idleTimeout: signal(1000) }
  const open = vi
    .fn<OpenKclScene>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const replay = vi.fn()
  const session = createKclSession(open, replay)
  session.attach(container())
  try {
    await session.execute(snapshot, runSignal())
    const pose = first.snapshotCamera()
    await vi.advanceTimersByTimeAsync(1100)
    expect(session.state.peek().type).toBe('idle')
    const requested = { src: 'edited.kcl', files: new Map() }
    const configuration = { requested: 'settings' }
    expect(
      await session.execute(requested, runSignal(), configuration)
    ).not.toBeInstanceOf(Error)
    expect(second.runtime.execute).toHaveBeenCalledExactlyOnceWith(
      requested,
      configuration
    )
    expect(second.restoreCamera).toHaveBeenCalledWith({
      ...pose,
      is_ortho:
        second.preferences.camera.peek().cameraProjection === 'orthographic',
    })
    expect(second.frameModel).not.toHaveBeenCalled()
    expect(replay).not.toHaveBeenCalled()
  } finally {
    session.dispose()
  }
})
