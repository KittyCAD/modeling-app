import { emptyExecState } from '@src/lang/wasm'
import type { KclSceneResource, OpenKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
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
  session.dispose()
  expect(resource.dispose).toHaveBeenCalledOnce()
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
  expect(second.runtime.execute).toHaveBeenCalledWith(latest)
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
