import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { createKclRuntime } from '@src/lib/kcl/runtime'
import { openKclScene } from '@src/lib/kcl/scene'
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import { connectScene, type SceneConnection } from '@src/lib/scene/connection'
import { EngineConnectionEvents } from '@src/lib/engineConnection/utils'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { beforeEach, expect, it, vi } from 'vitest'

const owned = vi.hoisted(() => ({
  managers: [] as object[],
  cameras: [] as object[],
  disposeInfra: vi.fn(),
}))
vi.mock('@src/lib/engineConnection/connectionManager', () => ({
  ConnectionManager: class {
    connection = new EventTarget()
    isReady = true
    settings = { viewportRendering: {} }
    constructor() {
      owned.managers.push(this)
    }
    setTheme = vi.fn(async () => {})
    setDefaultSystemProperties = vi.fn(async () => {})
    setHighlightEdges = vi.fn(async () => {})
    setShowScaleGrid = vi.fn(async () => {})
    setViewportRendering = vi.fn()
  },
}))
vi.mock('@src/clientSideScene/sceneInfra', () => ({
  SceneInfra: class {
    renderer = { domElement: document.createElement('canvas') }
    labelRenderer = { domElement: document.createElement('div') }
    camControls = {
      localCameraMode: false,
      resetLocalCameraToDefaultView: vi.fn(),
      onWindowResize: vi.fn(),
      initTouchControls: vi.fn(),
      setCameraProjection: vi.fn(async () => {}),
    }
    constructor() {
      owned.cameras.push(this.camControls)
    }
    animate = vi.fn()
    onCanvasResized = vi.fn()
    dispose = owned.disposeInfra
  },
}))
vi.mock('@src/lib/scene/connection', () => ({ connectScene: vi.fn() }))
vi.mock('@src/lib/kcl/runtime', () => ({ createKclRuntime: vi.fn() }))
vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(async () => {}),
}))
beforeEach(() => {
  vi.clearAllMocks()
  owned.managers.length = 0
  owned.cameras.length = 0
})
function setup() {
  const connection = {
    attachVideo: vi.fn<SceneConnection['attachVideo']>(() =>
      vi.fn<() => void>()
    ),
    resize: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
  const model = {
    events: new EventTarget(),
    state: signal(emptyExecState()),
    failed: signal(false),
    executing: signal(false),
    exportModel: vi.fn(),
    dispose: vi.fn(async () => {}),
  }
  vi.mocked(connectScene).mockResolvedValue(
    connection as unknown as Exclude<
      Awaited<ReturnType<typeof connectScene>>,
      Error
    >
  )
  vi.mocked(createKclRuntime).mockResolvedValue(
    model as unknown as Awaited<ReturnType<typeof createKclRuntime>>
  )
  const settings = {
    current: signal(createSettings()),
    actor: {},
  } as unknown as SettingsRegistryService
  const preferences = createScenePresentationPreferences(
    () => settings.current.value
  )
  return {
    connection,
    model,
    preferences,
    options: {
      wasm: Promise.resolve({} as ModuleType),
      settings,
      preferences,
      token: 'token',
      size: { width: 640, height: 360 },
      signal: new AbortController().signal,
      onDisconnect: vi.fn(),
    },
  }
}
it.each(['local', 'streamed'] as const)(
  'supplies the native model to the %s presentation and releases owned resources',
  async (presentation) => {
    const { connection, model, preferences, options } = setup()
    const scene = await openKclScene({ ...options, presentation })
    if (scene instanceof Error) return expect.fail(scene.message)
    expect(connectScene).toHaveBeenCalledWith(
      expect.objectContaining({ presentation, manager: owned.managers[0] })
    )
    expect(scene.element.querySelectorAll('video')).toHaveLength(
      presentation === 'streamed' ? 1 : 0
    )
    expect(connection.attachVideo).toHaveBeenCalledTimes(
      presentation === 'streamed' ? 1 : 0
    )
    await scene.applySettings()
    expect(connection.send).not.toHaveBeenCalled()
    if (presentation === 'local') {
      expect(scene.localHost?.sceneInfra.camControls.localCameraMode).toBe(true)
      model.state.value = { ...emptyExecState(), engineSceneGeneration: 7 }
      expect(scene.localHost?.currentSceneGeneration()).toBe(7)
      expect(scene.localHost?.sceneGeneration.value).toBe(7)
      model.failed.value = true
      expect(scene.localHost?.hasErrors()).toBe(true)
      expect(scene.localHost?.exportModel).toBe(model.exportModel)
    } else expect(scene.localHost).toBeUndefined()
    await scene.dispose()
    await scene.dispose()
    expect(model.dispose).toHaveBeenCalledOnce()
    expect(connection.dispose).toHaveBeenCalledOnce()
    preferences.dispose()
  }
)
it('does not share a connection manager or camera between KCL scenes', async () => {
  const { options, preferences } = setup()
  const first = await openKclScene({ ...options, presentation: 'local' })
  const second = await openKclScene({ ...options, presentation: 'streamed' })
  expect(owned.managers[0]).not.toBe(owned.managers[1])
  expect(owned.cameras[0]).not.toBe(owned.cameras[1])
  if (!(first instanceof Error)) await first.dispose()
  if (!(second instanceof Error)) await second.dispose()
  preferences.dispose()
})
it('releases a connection if native startup completes after cancellation', async () => {
  const { options, preferences, model, connection } = setup()
  const pending =
    Promise.withResolvers<Awaited<ReturnType<typeof createKclRuntime>>>()
  vi.mocked(createKclRuntime).mockReturnValue(pending.promise)
  const controller = new AbortController()
  const opening = openKclScene({
    ...options,
    signal: controller.signal,
    presentation: 'local',
  })
  await vi.waitFor(() => expect(createKclRuntime).toHaveBeenCalledOnce())
  controller.abort()
  pending.resolve(
    model as unknown as Awaited<ReturnType<typeof createKclRuntime>>
  )
  expect(await opening).toBeInstanceOf(Error)
  expect(connection.dispose).toHaveBeenCalledOnce()
  expect(model.dispose).toHaveBeenCalledOnce()
  expect(owned.cameras).toHaveLength(0)
  preferences.dispose()
})

it('applies only changed camera and stream preferences, preserving the camera on renderer changes', async () => {
  const { options, preferences } = setup()
  const scene = await openKclScene({ ...options, presentation: 'streamed' })
  if (scene instanceof Error) return expect.fail(scene.message)
  const camera = owned.cameras[0] as {
    setCameraProjection: ReturnType<typeof vi.fn>
    initTouchControls: ReturnType<typeof vi.fn>
  }
  const manager = owned.managers[0] as {
    setTheme: ReturnType<typeof vi.fn>
    setViewportRendering: ReturnType<typeof vi.fn>
  }
  try {
    await scene.applySettings()
    options.settings.current.peek().modeling.highlightEdges.user =
      !options.settings.current.peek().modeling.highlightEdges.current
    await scene.applySettings()
    await scene.applySettings()
    expect(camera.setCameraProjection).toHaveBeenCalledOnce()
    expect(camera.initTouchControls).toHaveBeenCalledOnce()
    expect(manager.setTheme).toHaveBeenCalledOnce()
    expect(manager.setViewportRendering).toHaveBeenCalledOnce()
    options.settings.current.peek().modeling.cameraProjection.user =
      options.settings.current.peek().modeling.cameraProjection.current ===
      'orthographic'
        ? 'perspective'
        : 'orthographic'
    await scene.applySettings()
    expect(camera.setCameraProjection).toHaveBeenCalledTimes(2)
    expect(camera.initTouchControls).toHaveBeenCalledOnce()
    expect(manager.setTheme).toHaveBeenCalledOnce()
    expect(manager.setViewportRendering).toHaveBeenCalledOnce()
  } finally {
    await scene.dispose()
    preferences.dispose()
  }
})

it.each(['local', 'streamed'] as const)(
  'releases the %s connection and its close listener if native startup fails',
  async (presentation) => {
    const { options, preferences, connection } = setup()
    const failure = new Error('Native initialization failed')
    vi.mocked(createKclRuntime).mockRejectedValueOnce(failure)
    expect(await openKclScene({ ...options, presentation })).toBe(failure)
    expect(connection.dispose).toHaveBeenCalledOnce()
    const manager = owned.managers[0] as { connection: EventTarget }
    manager.connection.dispatchEvent(new Event(EngineConnectionEvents.Closed))
    expect(options.onDisconnect).not.toHaveBeenCalled()
    expect(owned.cameras).toHaveLength(0)
    preferences.dispose()
  }
)

it('releases native and Three.js resources when video cannot attach', async () => {
  const { options, preferences, connection, model } = setup()
  const failure = new Error('Video attachment failed')
  connection.attachVideo.mockReturnValueOnce(failure)
  expect(await openKclScene({ ...options, presentation: 'streamed' })).toBe(
    failure
  )
  expect(connection.dispose).toHaveBeenCalledOnce()
  expect(model.dispose).toHaveBeenCalledOnce()
  expect(owned.disposeInfra).toHaveBeenCalledOnce()
  preferences.dispose()
})

it('tracks the captured connection and removes its close listener on disposal', async () => {
  const { options, preferences } = setup()
  const scene = await openKclScene({ ...options, presentation: 'local' })
  if (scene instanceof Error) return expect.fail(scene.message)
  const manager = owned.managers[0] as { connection: EventTarget }
  const opened = manager.connection
  expect(scene.isConnected()).toBe(true)
  manager.connection = new EventTarget()
  expect(scene.isConnected()).toBe(false)
  manager.connection.dispatchEvent(new Event(EngineConnectionEvents.Closed))
  expect(options.onDisconnect).not.toHaveBeenCalled()
  opened.dispatchEvent(new Event(EngineConnectionEvents.Closed))
  expect(options.onDisconnect).toHaveBeenCalledOnce()
  await scene.dispose()
  opened.dispatchEvent(new Event(EngineConnectionEvents.Closed))
  expect(options.onDisconnect).toHaveBeenCalledOnce()
  preferences.dispose()
})
