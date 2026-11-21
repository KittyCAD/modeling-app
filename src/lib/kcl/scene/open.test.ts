import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { emptyExecState } from '@src/lang/wasm'
import { createKclRuntime } from '@src/lib/kcl/execution/runtime'
import { openKclScene } from '@src/lib/kcl/scene/open'
import { createScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import {
  connectScene,
  type SceneConnection,
} from '@src/lib/kcl/scene/connection'
import {
  EngineConnectionManagerEvents,
  EngineConnectionEvents,
} from '@src/lib/engineConnection/utils'
import { Themes } from '@src/lib/theme'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  createTestKclRuntime,
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'

const owned = vi.hoisted(() => {
  const managers: TestManager[] = []
  const cameras: TestInfra['camControls'][] = []
  const infra: TestInfra[] = []
  const disposeInfra = vi.fn()
  class TestManager extends EventTarget {
    connection = new EventTarget()
    isReady = true
    settings = { viewportRendering: {} }
    pendingCommands = {}
    constructor() {
      super()
      managers.push(this)
    }
    setTheme = vi.fn(async () => {})
    setDefaultSystemProperties = vi.fn(async () => {})
    setHighlightEdges = vi.fn(async () => {})
    setShowScaleGrid = vi.fn(async () => {})
    setViewportRendering = vi.fn()
  }
  class TestInfra {
    theme = 'system'
    resumeRendering = vi.fn()
    renderer = { domElement: document.createElement('canvas') }
    labelRenderer = { domElement: document.createElement('div') }
    camControls = {
      localCameraMode: false,
      resetLocalCameraToDefaultView: vi.fn(),
      onWindowResize: vi.fn(),
      initTouchControls: vi.fn(),
      setCameraProjection: vi.fn(async () => {}),
      setCameraView: vi.fn(async () => {}),
    }
    constructor() {
      cameras.push(this.camControls)
      infra.push(this)
    }
    animate = vi.fn()
    onCanvasResized = vi.fn()
    dispose = disposeInfra
  }
  return { managers, cameras, infra, disposeInfra, TestManager, TestInfra }
})
vi.mock('@src/lib/engineConnection/connectionManager', () => ({
  ConnectionManager: owned.TestManager,
}))
vi.mock('@src/clientSideScene/sceneInfra', () => ({
  SceneInfra: owned.TestInfra,
}))
vi.mock('@src/lib/kcl/scene/connection', () => ({ connectScene: vi.fn() }))
vi.mock('@src/lib/kcl/execution/runtime', () => ({ createKclRuntime: vi.fn() }))
vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(async () => {}),
}))
beforeEach(() => {
  vi.clearAllMocks()
  owned.managers.length = 0
  owned.cameras.length = 0
  owned.infra.length = 0
})
function setup() {
  const connection = {
    presentation: 'streamed',
    id: 'test-connection',
    mediaStream: undefined,
    attachVideo: vi.fn<SceneConnection['attachVideo']>(() =>
      vi.fn<() => void>()
    ),
    resize: vi.fn<SceneConnection['resize']>(async () => {}),
    send: vi.fn<SceneConnection['send']>(async () => null),
    dispose: vi.fn(),
  } satisfies SceneConnection
  const model = createTestKclRuntime()
  vi.mocked(connectScene).mockResolvedValue(connection)
  vi.mocked(createKclRuntime).mockResolvedValue(model)
  const settings = createTestSettings()
  const preferences = createScenePresentationPreferences(
    () => settings.current.value
  )
  return {
    connection,
    model,
    preferences,
    options: {
      wasm: new Promise<ModuleType>(() => {}),
      settings,
      preferences,
      nativeSettings: createTestKclExecutionSettings(
        () => settings.current.value
      ),
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
it('frames a local camera only once across renderer attachments, and independently for another scene', async () => {
  const { options, preferences } = setup()
  const first = await openKclScene({ ...options, presentation: 'local' })
  const second = await openKclScene({ ...options, presentation: 'local' })
  if (first instanceof Error || second instanceof Error)
    return expect.fail('Unable to open scenes')
  try {
    expect(first.localHost?.claimInitialCameraFrame?.()).toBe(true)
    expect(first.localHost?.claimInitialCameraFrame?.()).toBe(false)
    expect(second.localHost?.claimInitialCameraFrame?.()).toBe(true)
  } finally {
    await first.dispose()
    await second.dispose()
    preferences.dispose()
  }
})

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
  pending.resolve(model)
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
  const camera = owned.cameras[0]
  const manager = owned.managers[0]
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
    const manager = owned.managers[0]
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
  const manager = owned.managers[0]
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

it.each(['local', 'streamed'] as const)(
  'keeps sketch overlays contrasted against the %s viewport when theme or rendering style changes',
  async (presentation) => {
    const { options, preferences } = setup()
    const settings = options.settings.current.peek()
    settings.app.theme.user = Themes.Light
    settings.modeling.viewportRendering.user = 'default'
    const scene = await openKclScene({ ...options, presentation })
    if (scene instanceof Error) return expect.fail(scene.message)
    const infra = owned.infra[0]
    try {
      // Overlay contrast must be ready before opening sketch or awaiting camera updates.
      expect(infra.theme).toBe(Themes.Dark)
      await scene.applySettings()
      expect(infra.theme).toBe(Themes.Dark)
      infra.resumeRendering.mockClear()
      settings.modeling.viewportRendering.user = 'retrocad'
      await scene.applySettings()
      expect(infra.theme).toBe(
        presentation === 'local' ? Themes.Dark : Themes.Light
      )
      if (presentation === 'streamed')
        expect(infra.resumeRendering).toHaveBeenCalled()
      settings.app.theme.user = Themes.Dark
      await scene.applySettings()
      expect(infra.theme).toBe(Themes.Light)
      settings.modeling.viewportRendering.user = 'default'
      await scene.applySettings()
      infra.resumeRendering.mockClear()
      settings.app.theme.user = Themes.Light
      await scene.applySettings()
      expect(infra.theme).toBe(Themes.Dark)
      expect(infra.resumeRendering).toHaveBeenCalled()
    } finally {
      await scene.dispose()
      preferences.dispose()
    }
  }
)

it.each([
  EngineConnectionManagerEvents.WebsocketClosed,
  EngineConnectionManagerEvents.peerConnectionDisconnected,
  EngineConnectionManagerEvents.peerConnectionFailed,
  EngineConnectionManagerEvents.dataChannelClose,
])(
  'reports %s for the captured scene and stops listening after disposal',
  async (event) => {
    const { options, preferences } = setup()
    const scene = await openKclScene({ ...options, presentation: 'streamed' })
    if (scene instanceof Error) throw scene
    const manager = owned.managers[0]
    manager.dispatchEvent(
      new CustomEvent(event, {
        detail: { code: '1006', reconnectRequested: false },
      })
    )
    expect(options.onDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: true,
        details: expect.objectContaining({
          eventType: event,
          websocketCloseCode: '1006',
          reconnectRequested: false,
        }),
      })
    )
    options.onDisconnect.mockClear()
    await scene.dispose()
    manager.dispatchEvent(
      new CustomEvent(event, {
        detail: { code: '1006', reconnectRequested: false },
      })
    )
    expect(options.onDisconnect).not.toHaveBeenCalled()
    preferences.dispose()
  }
)

it('does not fit a newly loaded local model over a restored camera', async () => {
  const { options, preferences } = setup()
  const scene = await openKclScene({ ...options, presentation: 'local' })
  if (scene instanceof Error) return expect.fail(scene.message)
  const pose = { ...createTestKclScene().snapshotCamera(), is_ortho: true }
  try {
    await scene.restoreCamera(pose)
    expect(scene.localHost?.claimInitialCameraFrame?.()).toBe(false)
    expect(owned.cameras[0].setCameraView).toHaveBeenCalledWith(pose)
  } finally {
    await scene.dispose()
    preferences.dispose()
  }
})
it.each(['local', 'streamed'] as const)(
  'delivers asynchronous engine responses only to their owning %s runtime',
  async (presentation) => {
    const first = setup()
    const firstResponse = first.model.sendResponse
    const firstScene = await openKclScene({ ...first.options, presentation })
    if (firstScene instanceof Error) return expect.fail(firstScene.message)
    const receiver = vi.mocked(connectScene).mock.calls.at(-1)?.[0].rustContext
    const second = setup()
    const secondResponse = second.model.sendResponse
    const secondScene = await openKclScene({ ...second.options, presentation })
    if (secondScene instanceof Error) return expect.fail(secondScene.message)
    try {
      expect(receiver).toBeDefined()
      const response = {
        success: true,
        request_id: 'response-id',
        resp: {
          type: 'modeling',
          data: { modeling_response: { type: 'empty' } },
        },
      } as const
      await receiver?.sendResponse(response)
      expect(firstResponse).toHaveBeenCalledExactlyOnceWith(response)
      expect(secondResponse).not.toHaveBeenCalled()
      await firstScene.dispose()
      await receiver?.sendResponse(response)
      expect(firstResponse).toHaveBeenCalledTimes(1)
    } finally {
      await firstScene.dispose()
      await secondScene.dispose()
      first.preferences.dispose()
      second.preferences.dispose()
    }
  }
)
