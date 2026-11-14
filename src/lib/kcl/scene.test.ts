import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { createKclRuntime } from '@src/lib/kcl/runtime'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSceneSettings } from '@src/lib/kcl/settings'
import { connectScene } from '@src/lib/scene/connection'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { beforeEach, expect, it, vi } from 'vitest'

const owned = vi.hoisted(() => ({
  managers: [] as object[],
  cameras: [] as object[],
}))
vi.mock('@src/lib/engineConnection/connectionManager', () => ({
  ConnectionManager: class {
    connection = new EventTarget()
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
    dispose = vi.fn()
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
    attachVideo: vi.fn(() => vi.fn()),
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
  const preferences = createKclSceneSettings(() => settings.current.value)
  return {
    connection,
    model,
    preferences,
    options: {
      wasm: Promise.resolve({} as ModuleType),
      settings,
      preferences: preferences.current,
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
