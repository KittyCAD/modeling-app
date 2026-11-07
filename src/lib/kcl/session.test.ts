import { signal } from '@preact/signals-core'
import { Themes } from '@src/lib/theme'
import type { KclSceneSettings } from '@src/lib/kcl/settings'
import {
  createKclSession,
  type KclSources,
  type KclStreamView,
} from '@src/lib/kcl/session'
import { afterEach, expect, it, vi } from 'vitest'

/** A controllable transport exercises lifecycle and ordering without a remote engine or WASM. */
function fakeViewer() {
  const worker = new EventTarget()
  const rtc = Object.assign(new EventTarget(), {
    send: vi.fn(
      async (_message: string): Promise<unknown> => ({ success: true })
    ),
    executor: () => ({
      submit,
      addEventListener: worker.addEventListener.bind(worker, 'message'),
      removeEventListener: worker.removeEventListener.bind(worker, 'message'),
    }),
  })
  const submit = vi.fn(
    async (
      _contents: KclSources,
      _options: { mainKclPathName: string }
    ): Promise<unknown> => ({ values: {} })
  )
  const viewer: KclStreamView = Object.assign(new EventTarget(), {
    el: document.createElement('div'),
    start: vi.fn(),
    rtc,
    deconstructor: vi.fn(),
  })
  return { viewer, submit, rtc }
}
const sessions: ReturnType<typeof createKclSession>[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const setup = () => {
  const fake = fakeViewer()
  const create = vi.fn(async () => fake.viewer)
  const session = createKclSession(create)
  sessions.push(session)
  return { ...fake, create, session }
}
const visibleContainer = () =>
  Object.defineProperties(document.createElement('div'), {
    clientWidth: { value: 640, configurable: true },
    clientHeight: { value: 360, configurable: true },
  })
const connect = async (
  session: ReturnType<typeof createKclSession>,
  viewer: KclStreamView
) => {
  const detach = session.mount(visibleContainer())
  await Promise.resolve()
  viewer.dispatchEvent(new Event('ready'))
  return detach
}

it('waits for a mounted, ready stream; remounting and editing reuse its connection', async () => {
  const { session, viewer, create, submit } = setup()
  const result = session.execute(
    'first',
    '/original.kcl',
    new AbortController().signal
  )
  expect(create).not.toHaveBeenCalled()
  const detach = await connect(session, viewer)
  expect(await result).toEqual({ result: { values: {} } })
  expect(submit).toHaveBeenCalledWith('first', {
    mainKclPathName: '/original.kcl',
  })
  detach()
  session.mount(visibleContainer())
  await session.execute('second', '/renamed.kcl', new AbortController().signal)
  expect(create).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenLastCalledWith('second', {
    mainKclPathName: '/renamed.kcl',
  })
  expect(viewer.deconstructor).not.toHaveBeenCalled()
  session.dispose()
  session.dispose()
  expect(viewer.deconstructor).toHaveBeenCalledOnce()
})

it('passes a project file map and selected nested entrypoint to the SDK unchanged', async () => {
  const { session, viewer, submit } = setup()
  await connect(session, viewer)
  const sources = new Map([
    ['/project/scenes/main.kcl', 'import "parts/main.kcl" as part'],
    ['/project/scenes/parts/main.kcl', 'export length = 10mm'],
  ])
  await session.execute(
    sources,
    '/project/scenes/main.kcl',
    new AbortController().signal
  )
  expect(submit).toHaveBeenCalledExactlyOnceWith(sources, {
    mainKclPathName: '/project/scenes/main.kcl',
  })
})

it('serializes SDK submissions and skips interrupted queued inputs', async () => {
  const { session, viewer, submit } = setup()
  await connect(session, viewer)
  const first = Promise.withResolvers<unknown>()
  submit.mockReturnValueOnce(first.promise)
  const firstSignal = new AbortController()
  const run = session.execute('first', 'first.kcl', firstSignal.signal)
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
  firstSignal.abort()
  const obsolete = new AbortController()
  const skipped = session.execute('obsolete', 'old.kcl', obsolete.signal)
  obsolete.abort()
  const latest = session.execute(
    'latest',
    'new.kcl',
    new AbortController().signal
  )
  expect(submit).toHaveBeenCalledOnce()
  first.resolve({ values: {} })
  expect(await run).toBeInstanceOf(Error)
  expect(await skipped).toBeInstanceOf(Error)
  expect(await latest).not.toBeInstanceOf(Error)
  expect(submit.mock.calls.map(([contents]) => contents)).toEqual([
    'first',
    'latest',
  ])
})

it('releases a viewer acquired after the executor closes', async () => {
  const { viewer } = fakeViewer()
  const acquisition = Promise.withResolvers<KclStreamView>()
  const session = createKclSession(() => acquisition.promise)
  sessions.push(session)
  session.mount(visibleContainer())
  session.dispose()
  acquisition.resolve(viewer)
  await Promise.resolve()
  expect(viewer.deconstructor).toHaveBeenCalledOnce()
  expect(viewer.el.parentElement).toBeNull()
  expect(viewer.start).not.toHaveBeenCalled()
})

it('settles pending execution on disposal and reports connection failures', async () => {
  const { session, viewer, submit } = setup()
  await connect(session, viewer)
  submit.mockReturnValueOnce(new Promise(() => {}))
  const run = session.execute(
    'pending',
    'main.kcl',
    new AbortController().signal
  )
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
  session.dispose()
  expect(await run).toEqual(new Error('The executor closed'))
  const failing = createKclSession(async () => new Error('Sign in first'))
  sessions.push(failing)
  failing.mount(visibleContainer())
  expect(await failing.execute('', '', new AbortController().signal)).toEqual(
    new Error('Sign in first')
  )
})

it('times out a connection that never becomes ready', async () => {
  vi.useFakeTimers()
  const { session, viewer } = setup()
  session.mount(visibleContainer())
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(session.state.value).toMatchObject({ type: 'error' })
  expect(
    await session.execute('', '', new AbortController().signal)
  ).toBeInstanceOf(Error)
  expect(viewer.deconstructor).toHaveBeenCalledOnce()
})

it('settles hung executions on timeout and keeps a failed session closed', async () => {
  vi.useFakeTimers()
  const { session, viewer, submit, create } = setup()
  await connect(session, viewer)
  submit.mockReturnValueOnce(new Promise(() => {}))
  const run = session.execute(
    'pending',
    'main.kcl',
    new AbortController().signal
  )
  await vi.advanceTimersByTimeAsync(60_000)
  expect(await run).toBeInstanceOf(Error)
  expect(
    await session.execute('later', 'main.kcl', new AbortController().signal)
  ).toBeInstanceOf(Error)
  expect(submit).toHaveBeenCalledOnce()
  session.dispose()
  expect(viewer.deconstructor).toHaveBeenCalledOnce()
  expect(create).toHaveBeenCalledOnce()
})

it('waits for a hidden tab to have a real size before starting its connection timeout', async () => {
  vi.useFakeTimers()
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )
  const { session, create, viewer } = setup()
  const container = document.createElement('div')
  session.mount(container)
  await vi.advanceTimersByTimeAsync(35_000)
  expect(create).not.toHaveBeenCalled()
  expect(session.state.value.type).toBe('connecting')
  Object.defineProperties(container, {
    clientWidth: { value: 643 },
    clientHeight: { value: 363 },
  })
  resize()
  await Promise.resolve()
  expect(create).toHaveBeenCalledWith({ width: 640, height: 360 })
  expect(viewer.start).toHaveBeenCalledOnce()
  viewer.dispatchEvent(new Event('ready'))
  expect(session.state.value.type).toBe('ready')
  expect(disconnect).toHaveBeenCalledOnce()
})

it('does not start a hidden tab after it is detached or its executor closes', async () => {
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )
  const { session, create } = setup()
  let size = 0
  const hidden = Object.defineProperties(document.createElement('div'), {
    clientWidth: { get: () => size },
    clientHeight: { get: () => size },
  })
  const detach = session.mount(hidden)
  detach()
  expect(disconnect).toHaveBeenCalledOnce()
  size = 640
  resize()
  await Promise.resolve()
  expect(create).not.toHaveBeenCalled()
  size = 0
  session.mount(hidden)
  session.dispose()
  size = 640
  resize()
  await Promise.resolve()
  expect(create).not.toHaveBeenCalled()
  expect(disconnect).toHaveBeenCalledTimes(2)
})

it('updates connected scenes without executing KCL again and restores preferences after each run', async () => {
  const settings = signal<KclSceneSettings>({
    theme: Themes.Light,
    backfaceColor: '#123456',
    highlightEdges: false,
    showScaleGrid: false,
    fixedSizeGrid: false,
    defaultUnit: 'mm',
    cameraProjection: 'orthographic',
  })
  const { viewer, rtc, submit } = fakeViewer()
  const session = createKclSession(async () => viewer, settings)
  sessions.push(session)
  await connect(session, viewer)
  const commands = () =>
    rtc.send.mock.calls.map(
      ([message]) =>
        JSON.parse(message).cmd as { type: string; hidden?: boolean }
    )
  await vi.waitFor(() =>
    expect(commands()).toContainEqual({
      type: 'edge_lines_visible',
      hidden: true,
    })
  )
  expect(submit).not.toHaveBeenCalled()
  rtc.send.mockClear()
  settings.value = {
    ...settings.peek(),
    theme: Themes.Dark,
    highlightEdges: true,
    showScaleGrid: true,
  }
  await vi.waitFor(() =>
    expect(commands()).toContainEqual({
      type: 'edge_lines_visible',
      hidden: false,
    })
  )
  expect(submit).not.toHaveBeenCalled()
  expect(commands()).toContainEqual(
    expect.objectContaining({ type: 'set_background_color' })
  )
  rtc.send.mockClear()
  await session.execute('contents', 'main.kcl', new AbortController().signal)
  const afterRun = commands()
  expect(afterRun).toContainEqual({ type: 'scene_clear_all' })
  expect(afterRun).toContainEqual({ type: 'edge_lines_visible', hidden: false })
  expect(afterRun).toContainEqual(
    expect.objectContaining({ type: 'set_default_system_properties' })
  )
  expect(afterRun).not.toContainEqual(
    expect.objectContaining({ type: 'default_camera_set_orthographic' })
  )
  session.dispose()
  rtc.send.mockClear()
  settings.value = { ...settings.peek(), theme: Themes.Light }
  await Promise.resolve()
  expect(rtc.send).not.toHaveBeenCalled()
})

it('waits for the current KCL run before applying the latest changed preferences', async () => {
  const settings = signal<KclSceneSettings>({
    theme: Themes.Light,
    backfaceColor: '#123456',
    highlightEdges: false,
    showScaleGrid: false,
    fixedSizeGrid: false,
    defaultUnit: 'mm',
    cameraProjection: 'orthographic',
  })
  const { viewer, rtc, submit } = fakeViewer()
  const session = createKclSession(async () => viewer, settings)
  sessions.push(session)
  await connect(session, viewer)
  await session.execute('first', 'main.kcl', new AbortController().signal)
  const pending = Promise.withResolvers<unknown>()
  submit.mockReturnValueOnce(pending.promise)
  const run = session.execute(
    'second',
    'main.kcl',
    new AbortController().signal
  )
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  rtc.send.mockClear()
  settings.value = { ...settings.peek(), backfaceColor: '#ff0000' }
  settings.value = { ...settings.peek(), backfaceColor: '#00ff00' }
  expect(rtc.send).not.toHaveBeenCalled()
  pending.resolve({ values: {} })
  await run
  const commands = rtc.send.mock.calls.map(
    ([message]) => JSON.parse(message).cmd
  )
  expect(commands).toContainEqual(
    expect.objectContaining({
      type: 'set_default_system_properties',
      backface_color: { r: 0, g: 1, b: 0, a: 1 },
    })
  )
  expect(commands).not.toContainEqual(
    expect.objectContaining({ backface_color: { r: 1, g: 0, b: 0, a: 1 } })
  )
})
