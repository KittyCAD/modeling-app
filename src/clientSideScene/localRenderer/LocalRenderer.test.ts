import type { EntityType } from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import type { TessellationResponse } from '@src/clientSideScene/localRenderer/nativeBrep/protocol'
import type { KclManager } from '@src/lang/KclManager'
import type { LocalSelectionCommandHandler } from '@src/clientSideScene/localSelectionCommandProxy'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { Signal } from '@src/lib/signal'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'
import { Themes } from '@src/lib/theme'
import {
  BoxGeometry,
  Group,
  Mesh,
  type Object3D,
  type OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/KclManager', () => ({
  KclManagerEvents: {
    ExecutionDone: 'execution-done',
    FileChanged: 'file-changed',
  },
}))
vi.mock('@src/lib/debugger', () => ({ EngineDebugger: { addLog: vi.fn() } }))
vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({ settings: { modeling: { base_unit: 'mm' } } }),
}))
vi.mock('@src/lib/trap', () => ({ reportRejection: vi.fn() }))
vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(async () => {}),
}))

import { LocalRenderer } from '@src/clientSideScene/localRenderer/LocalRenderer'
import { PlaneRenderer } from '@src/clientSideScene/localRenderer/PlaneRenderer'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type { Artifact } from '@src/lang/wasm'

// Exercise the real export/GLTFLoader lifecycle without requesting a GPU device.
type RendererInternals = {
  initialize(): Promise<void>
  scheduleRender(): void
  gpu: FakeGpu | null
  currentModel: Group | null
  executionPreviewModel: Object3D | null
  nextExecutionPreviewAt: number
  pickingSuspendedForPreview: boolean
  nativePreviewBusy: boolean
  nativePreviewUnavailable: boolean
  nativePreviewNotice: HTMLDivElement | null
  captureExecutionPreview: (command: EngineCommand) => Promise<void>
  loadedSceneGeneration: number | null
  rebuildSelectionTargets(): void
  camera: PerspectiveCamera | OrthographicCamera | null
  handleLocalSelectionCommand: LocalSelectionCommandHandler
  syncSelectionFromEngine(): Promise<void>
  baseRenderDirty: boolean
  pointerOverCanvas: boolean
  ambientOcclusionPipeline: {
    pipeline: { dispose(): void }
    scenePass: { dispose(): void }
    aoPass: { dispose(): void }
    denoisePass: { dispose(): void } | null
    denoiseNoiseTexture: { dispose(): void } | null
  } | null
}

// What initialize() creates, minus the GPU. Only the plane renderer is real.
function fakeGpu() {
  const lines = () => ({
    lines: {},
    getSelectionTargets: vi.fn(() => []),
    buildEdges: vi.fn(),
    addTo: vi.fn(),
    removeFromParent: vi.fn(),
    setVisible: vi.fn(),
    setColor: vi.fn(),
    dispose: vi.fn(),
  })
  return {
    renderer: {
      dispose: vi.fn(() => Promise.resolve()),
      domElement: document.createElement('canvas'),
    },
    device: null,
    scene: new Scene(),
    envMapLoader: { dispose: vi.fn() },
    edgeRenderer: lines(),
    sketchLineRenderer: lines(),
    planeRenderer: new PlaneRenderer(Themes.Light),
    integerIdPicker: {
      pick: vi.fn<() => Promise<{ target: Mesh | null; stale: boolean }>>(),
      invalidate: vi.fn(),
      setTargets: vi.fn(),
      setEdgesVisible: vi.fn(),
      clearModel: vi.fn(),
      dispose: vi.fn(),
    },
    selectionHighlightRenderer: {
      setTargets: vi.fn(),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setBackgroundColor: vi.fn(),
      clearModel: vi.fn(),
      dispose: vi.fn(),
    },
  }
}
type FakeGpu = ReturnType<typeof fakeGpu>

function fixture(
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(
    45,
    1,
    0.1,
    10000
  )
) {
  const manager = Object.assign(new EventTarget(), {
    path: '/model.kcl',
    diagnosticsSignal: signal<{ severity: string }[]>([]),
    artifactGraph: new Map([['triangle', { type: 'sweep' }]]),
    engineSceneGenerationSignal: signal(0),
    execState: { engineSceneGeneration: null },
    isExecutingSignal: signal(false),
    selectionFilter: signal<EntityType[]>([...defaultSelectionFilter]),
    get isExecuting() {
      return this.isExecutingSignal.value
    },
    systemDeps: { settings: {} },
    engineCommandManager: {
      sendSceneCommand: vi.fn(),
      sendCommand: vi
        .fn()
        .mockResolvedValue([
          { success: true, resp: { type: 'export', data: { files: [] } } },
        ]),
      executionIsStale: false,
    },
    rustContext: {
      defaultPlanes: { xy: 'plane-xy', yz: 'plane-yz', xz: 'plane-xz' },
      export: vi
        .fn<() => Promise<ModelingAppFile[] | undefined>>()
        .mockResolvedValue([triangleGlb()]),
    },
    sceneInfra: {
      baseUnitMultiplier: 1,
      baseUnitChange: new Signal(),
      camControls: {
        camera,
        isDragging: false,
        wasDragging: false,
        hoverPickingDisabled: false,
        target: new Vector3(),
        onCameraChange: vi.fn(),
      },
    },
  })
  Object.defineProperty(manager, 'isExecuting', {
    get: () => manager.isExecutingSignal.value,
  })
  manager.sceneInfra.camControls.camera.position.set(100, -100, 100)
  const onModelLoadSettled = vi.fn()
  const renderer = new LocalRenderer(
    document.createElement('div'),
    manager as unknown as KclManager,
    {
      theme: Themes.Light,
      enableSSAO: false,
      shouldHighlightEdges: false,
      fixedSizeGrid: true,
      backfaceColor: '#00D5FF',
      onModelLoadSettled,
    }
  )
  const state = renderer as unknown as RendererInternals
  const gpu = fakeGpu()
  state.gpu = gpu
  // Executions rebuild the engine scene unless they were answered from the cache.
  const done = (successful = true, sceneChanged = true) => {
    if (sceneChanged) manager.engineSceneGenerationSignal.value += 1
    manager.isExecutingSignal.value = false
    manager.dispatchEvent(
      new CustomEvent('execution-done', {
        detail: { successful, isInterrupted: false, hasErrors: !successful },
      })
    )
  }
  return { renderer, state, gpu, manager, done, onModelLoadSettled }
}

function stubPreviewWorker() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onerror: null,
    onmessage: null as
      | ((event: MessageEvent<TessellationResponse>) => void)
      | null,
  }
  vi.stubGlobal(
    'Worker',
    vi.fn(function () {
      return worker
    })
  )
  return worker
}

function nativeExportResponse() {
  return [
    {
      success: true,
      resp: {
        type: 'export',
        data: { files: [{ name: 'output.glb', contents: [123, 125] }] },
      },
    },
  ]
}

describe('local GLB loading', () => {
  beforeEach(() => {
    const prototype = LocalRenderer.prototype as unknown as RendererInternals
    vi.spyOn(prototype, 'initialize').mockResolvedValue(undefined)
    vi.spyOn(prototype, 'scheduleRender').mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The unit project keeps mock calls between tests, which run shuffled, so
    // clear the camera reset mock.
    vi.mocked(resetCameraPosition).mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function planeFixture(id = 'plane-xy') {
    const f = fixture()
    const {
      planeRenderer: planes,
      integerIdPicker: picker,
      selectionHighlightRenderer: highlights,
    } = f.gpu
    planes.updateDefaultPlanes(f.manager.rustContext.defaultPlanes)
    planes.updateOffsetPlanes(new Map([['offset', offsetPlane()]]))
    const target = planes.planes.get(id)?.mesh
    if (!target) throw new Error('Missing plane mesh')
    picker.pick.mockResolvedValue({ target, stale: false })
    const setDefaultVisibility = vi.spyOn(planes, 'setDefaultVisibility')
    f.state.camera = new PerspectiveCamera()
    f.state.pointerOverCanvas = true
    f.renderer.setPickingEnabled(true)
    const pick = (click = false) =>
      f.state.handleLocalSelectionCommand(
        {
          type: 'modeling_cmd_req',
          cmd_id: 'pick-request',
          cmd: click
            ? {
                type: 'query_entity_type_with_point',
                selected_at_window: { x: 10, y: 20 },
                selection_type: 'add',
              }
            : {
                type: 'highlight_set_entity',
                selected_at_window: { x: 10, y: 20 },
              },
        },
        { streamDimensions: { width: 800, height: 600 } }
      )
    const defaultTargets = [...planes.planes.values()]
      .filter((plane) => plane.defaultPlane)
      .map(({ mesh }) => mesh)
    return {
      ...f,
      target,
      defaultTargets,
      picker,
      highlights,
      pick,
      setDefaultVisibility,
    }
  }

  it.each(['plane-xy', 'offset'])(
    'maps %s hits and selection to the same hover/click/highlight path',
    async (id) => {
      const f = planeFixture(id)
      expect((await f.pick())?.unreliableModelingResponse).toEqual({
        type: 'highlight_set_entity',
        data: { entity_id: id },
      })
      expect(f.highlights.setHover).toHaveBeenLastCalledWith([f.target])
      const result = await f.pick(true)
      expect(result?.modelingResponse).toEqual({
        type: 'query_entity_type_with_point',
        data: { reference: { type: 'plane', plane_id: id } },
      })
      expect(result?.websocketResponse).toMatchObject({
        success: true,
        request_id: 'pick-request',
      })
      const engineSelects = (entity_ids: string[]) =>
        f.manager.engineCommandManager.sendSceneCommand.mockResolvedValue({
          resp: {
            type: 'modeling',
            data: {
              modeling_response: { type: 'select_get', data: { entity_ids } },
            },
          },
        })
      engineSelects([id])
      await f.state.syncSelectionFromEngine()
      expect(f.highlights.setSelection).toHaveBeenLastCalledWith([f.target])
      engineSelects([])
      await f.state.syncSelectionFromEngine()
      expect(f.highlights.setSelection).toHaveBeenLastCalledWith([])
      f.renderer.dispose()
    }
  )

  it('does not pick while dragging, in sketch editing, or outside the canvas', async () => {
    const f = planeFixture()
    f.manager.sceneInfra.camControls.isDragging = true
    await f.pick()
    await f.pick(true)
    f.manager.sceneInfra.camControls.isDragging = false
    f.manager.sceneInfra.camControls.wasDragging = true
    await f.pick(true)
    f.renderer.setPickingEnabled(false)
    await f.pick()
    f.renderer.setPickingEnabled(true)
    f.state.pointerOverCanvas = false
    await f.pick()
    expect(f.picker.pick).not.toHaveBeenCalled()
    f.renderer.dispose()
  })

  it('ignores stale GPU results and returns an empty selection for a miss', async () => {
    const f = planeFixture()
    f.picker.pick.mockResolvedValueOnce({
      target: f.target,
      stale: true,
    })
    expect(await f.pick()).toEqual({})
    f.picker.pick.mockResolvedValueOnce({
      target: null,
      stale: false,
    })
    expect((await f.pick(true))?.modelingResponse).toEqual({
      type: 'query_entity_type_with_point',
      data: { reference: undefined },
    })
    f.renderer.dispose()
  })

  it.each<[EntityType[], boolean]>([
    [['object'], true],
    [['curve'], true],
    [['edge'], false],
    [['solid3d'], false],
    [['face', 'object'], false],
  ])('includes standalone curves for filter %j: %s', (filter, included) => {
    const f = fixture()
    f.state.currentModel = new Group()
    f.manager.selectionFilter.value = filter
    f.state.rebuildSelectionTargets()
    expect(f.gpu.integerIdPicker.setTargets.mock.lastCall?.[3]).toEqual(
      included
        ? { source: f.gpu.sketchLineRenderer.lines, targets: [] }
        : undefined
    )
    f.renderer.dispose()
  })

  function selectionFixture() {
    const f = planeFixture()
    const model = new Group()
    const face = new Mesh()
    face.userData.faceUuid = 'face'
    model.add(face)
    f.state.currentModel = model
    f.state.loadedSceneGeneration = f.manager.engineSceneGenerationSignal.value
    f.state.rebuildSelectionTargets()
    f.picker.pick.mockResolvedValue({ target: face, stale: false })
    return f
  }

  it.each<EntityType>(['solid3d', 'object'])(
    'hovers the face without the engine but clicks select its body with the %s filter',
    async (type) => {
      const f = selectionFixture()
      f.manager.selectionFilter.value = [type]
      expect((await f.pick())?.unreliableModelingResponse?.data.entity_id).toBe(
        'face'
      )
      expect(
        f.manager.engineCommandManager.sendSceneCommand
      ).not.toHaveBeenCalled()
      f.manager.engineCommandManager.sendSceneCommand.mockResolvedValue({
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'query_entity_type',
              data: {
                reference: {
                  type: 'face',
                  face_id: 'face',
                  topology_fallback: { parent_id: 'body', primitive_index: 0 },
                },
              },
            },
          },
        },
      })
      expect((await f.pick(true))?.modelingResponse?.data.reference).toEqual({
        type: 'solid3d',
        solid3d_id: 'body',
      })
      f.renderer.dispose()
    }
  )

  it('exports once after successful execution and loads standard geometry/materials', async () => {
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    expect(f.manager.rustContext.export).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'gltf',
        storage: 'binary',
        presentation: 'compact',
        include_uuids: true,
        extras: ['sketches', 'regions'],
      },
      { settings: { modeling: { base_unit: 'mm' } } }
    )
    const mesh = f.state.currentModel?.children[0]
    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    expect(mesh.geometry.getAttribute('position').count).toBe(3)
    expect(mesh.material).toBeInstanceOf(MeshStandardNodeMaterial)
    expect(mesh.material.metalness).toBe(0.3)
    expect(mesh.material.roughness).toBe(0.4)
    expect(resetCameraPosition).toHaveBeenCalledExactlyOnceWith({
      sceneInfra: f.manager.sceneInfra,
      settingsActor: f.manager.systemDeps.settings,
    })
    expect(f.onModelLoadSettled).toHaveBeenCalledExactlyOnceWith(true)
    f.renderer.dispose()
  })

  it('keeps planes in fit bounds until their visibility update follows the model load', async () => {
    const f = fixture()
    f.gpu.planeRenderer.updateDefaultPlanes(f.manager.rustContext.defaultPlanes)
    f.done()
    await vi.waitFor(() => expect(f.renderer.isLoadedSceneCurrent()).toBe(true))
    const model = f.state.currentModel
    if (!model) throw new Error('Missing model')
    model.scale.setScalar(0.001)

    const boundsWithPlanes = f.renderer.getFitBounds()
    expect(f.renderer.hasVisibleDefaultPlanes).toBe(true)
    f.renderer.setDefaultPlaneVisibility({ xy: false, xz: false, yz: false })
    expect(f.renderer.hasVisibleDefaultPlanes).toBe(false)
    const modelBounds = f.renderer.getFitBounds()
    expect(modelBounds?.getSize(new Vector3()).length()).toBeLessThan(
      boundsWithPlanes?.getSize(new Vector3()).length() ?? 0
    )
    f.renderer.dispose()
  })

  const previewCheckpoint: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: 'extrude',
    cmd: { type: 'extrude', target: 'profile', distance: 5 },
  }

  it('stops requesting preview exports until the Engine connection changes', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    const manager = f.manager.engineCommandManager
    Object.assign(manager, { connection: { id: 'old' } })
    manager.sendCommand.mockResolvedValue(nativeExportResponse())
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    await f.state.captureExecutionPreview(previewCheckpoint)
    worker.onmessage?.({
      data: {
        id: worker.postMessage.mock.calls[0][0].id,
        error: 'Engine did not return a mesh-free B-rep preview',
        unsupportedExport: true,
      },
    } as MessageEvent<TessellationResponse>)

    f.manager.isExecutingSignal.value = false
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    await f.state.captureExecutionPreview(previewCheckpoint)
    expect(manager.sendCommand).toHaveBeenCalledOnce()

    Object.assign(manager, { connection: { id: 'replacement' } })
    await f.state.captureExecutionPreview(previewCheckpoint)
    expect(manager.sendCommand).toHaveBeenCalledTimes(2)
    f.renderer.dispose()
  })

  it('captures geometry changes in a mixed batch but ignores selection commands', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    const selection: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: 'select',
      cmd: { type: 'select_clear' },
    }
    await f.state.captureExecutionPreview(selection)
    expect(f.manager.engineCommandManager.sendCommand).not.toHaveBeenCalled()
    await f.state.captureExecutionPreview({
      type: 'modeling_cmd_batch_req',
      batch_id: 'mixed',
      requests: [
        { cmd_id: selection.cmd_id, cmd: selection.cmd },
        { cmd_id: previewCheckpoint.cmd_id, cmd: previewCheckpoint.cmd },
      ],
      responses: true,
    })
    expect(f.manager.engineCommandManager.sendCommand).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledOnce()
    f.renderer.dispose()
  })

  it('preserves a useful preview when later meshes are empty until final GLB loads', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    const finalExport = Promise.withResolvers<ModelingAppFile[]>()
    f.manager.rustContext.export.mockReturnValue(finalExport.promise)
    const complete = (empty: boolean) =>
      worker.onmessage?.({
        data: {
          id: worker.postMessage.mock.lastCall?.[0].id,
          positions: empty
            ? new Float32Array()
            : new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array(empty ? 0 : 9),
          faceCount: empty ? 0 : 1,
        },
      } as MessageEvent<TessellationResponse>)
    f.state.nextExecutionPreviewAt = 0
    await f.state.captureExecutionPreview(previewCheckpoint)
    complete(false)
    const preview = f.state.executionPreviewModel
    expect(preview).not.toBeNull()
    f.state.nextExecutionPreviewAt = 0
    await f.state.captureExecutionPreview(previewCheckpoint)
    complete(true)
    expect(f.state.executionPreviewModel).toBe(preview)
    expect(f.state.nativePreviewBusy).toBe(false)
    f.done()
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3))
    complete(true)
    expect(f.state.executionPreviewModel).toBe(preview)
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    finalExport.resolve([triangleGlb()])
    await vi.waitFor(() => expect(f.renderer.isLoadedSceneCurrent()).toBe(true))
    expect(f.state.executionPreviewModel).toBeNull()
    expect(f.onModelLoadSettled).toHaveBeenCalledOnce()
    f.renderer.dispose()
  })

  it('starts final GLB export while the worker finishes its current mesh and queues the final snapshot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = stubPreviewWorker()
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    const finalExport = Promise.withResolvers<ModelingAppFile[] | undefined>()
    f.manager.rustContext.export.mockReturnValue(finalExport.promise)
    await f.state.captureExecutionPreview(previewCheckpoint)
    expect(f.state.nativePreviewBusy).toBe(true)
    f.manager.isExecutingSignal.value = false
    f.done()
    await vi.waitFor(() =>
      expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    )
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    const previous = worker.postMessage.mock.calls[0][0].id as number
    const final = worker.postMessage.mock.calls[1][0].id as number
    worker.onmessage?.({
      data: { id: previous, error: 'Old job finished' },
    } as MessageEvent<TessellationResponse>)
    expect(f.state.nativePreviewBusy).toBe(true)
    worker.onmessage?.({
      data: { id: final, error: 'Expected fixture failure' },
    } as MessageEvent<TessellationResponse>)
    expect(f.state.nativePreviewBusy).toBe(false)
    finalExport.resolve([triangleGlb()])
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    f.renderer.dispose()
  })

  it('starts final GLB export before the final native response and skips a snapshot arriving after GLB', async () => {
    const f = fixture()
    const native = Promise.withResolvers<unknown[]>()
    f.manager.engineCommandManager.sendCommand.mockReturnValue(native.promise)
    f.done()
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    native.resolve(nativeExportResponse())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.state.executionPreviewModel).toBeNull()
    expect(f.renderer.isLoadedSceneCurrent()).toBe(true)
    f.renderer.dispose()
  })

  it('keeps the native preview until final GLB replaces it and rejects late worker results', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    const finalExport = Promise.withResolvers<ModelingAppFile[] | undefined>()
    f.manager.rustContext.export.mockReturnValue(finalExport.promise)
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    f.done()
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    const result = {
      data: {
        id: worker.postMessage.mock.calls[0][0].id,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(9),
        faceCount: 1,
      },
    } as MessageEvent<TessellationResponse>
    f.manager.sceneInfra.camControls.isDragging = true
    const onmessage = worker.onmessage
    if (!onmessage) throw new Error('Missing worker callback')
    onmessage(result)
    expect(resetCameraPosition).not.toHaveBeenCalled()
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.state.executionPreviewModel).not.toBeNull()
    expect(f.state.nativePreviewNotice?.textContent).toBe(
      'Preview · updating model…'
    )
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    expect(f.renderer.isLoadedSceneCurrent()).toBe(false)
    finalExport.resolve([triangleGlb()])
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    expect(f.state.executionPreviewModel).toBeNull()
    expect(f.state.nativePreviewNotice).toBeNull()
    expect(resetCameraPosition).toHaveBeenCalledExactlyOnceWith({
      sceneInfra: f.manager.sceneInfra,
      settingsActor: f.manager.systemDeps.settings,
    })
    expect(f.onModelLoadSettled).toHaveBeenCalledWith(true)
    onmessage(result)
    expect(f.state.executionPreviewModel).toBeNull()
    f.renderer.dispose()
  })

  it('retains an explicitly labelled native preview when final export fails, without making it selectable', async () => {
    vi.stubGlobal(
      'Worker',
      vi.fn(() => ({ terminate: vi.fn() }))
    )
    const f = fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const preview = new Group()
    f.state.executionPreviewModel = preview
    f.gpu.scene.add(preview)
    f.manager.engineCommandManager.sendCommand.mockRejectedValueOnce(
      new Error('Native snapshot unavailable')
    )
    f.manager.rustContext.export.mockResolvedValueOnce(undefined)
    f.done()
    await vi.waitFor(() => expect(f.state.nativePreviewNotice).not.toBeNull())
    expect(f.state.executionPreviewModel).toBe(preview)
    expect(f.state.nativePreviewNotice?.textContent).toContain('Preview only')
    expect(f.renderer.isLoadedSceneCurrent()).toBe(false)
    expect(f.onModelLoadSettled).toHaveBeenCalledWith()
    f.manager.isExecutingSignal.value = true
    expect(f.state.nativePreviewNotice).toBeNull()
    expect(f.state.executionPreviewModel).toBeNull()
    f.renderer.dispose()
  })

  it('coalesces deferred native checkpoints and cancels them on disposal', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      f.manager.isExecutingSignal.value = true
      f.state.nextExecutionPreviewAt = performance.now() + 100
      f.manager.engineCommandManager.sendCommand.mockResolvedValue([
        { success: true, resp: { type: 'export', data: { files: [] } } },
      ])
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await f.state.captureExecutionPreview(previewCheckpoint)
      await f.state.captureExecutionPreview(previewCheckpoint)
      expect(f.manager.engineCommandManager.sendCommand).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(150)
      expect(f.manager.engineCommandManager.sendCommand).toHaveBeenCalledTimes(
        1
      )
      f.state.nativePreviewUnavailable = false
      f.state.nextExecutionPreviewAt = performance.now() + 100
      await f.state.captureExecutionPreview(previewCheckpoint)
      f.renderer.dispose()
      await vi.advanceTimersByTimeAsync(150)
      expect(f.manager.engineCommandManager.sendCommand).toHaveBeenCalledTimes(
        1
      )
    } finally {
      f.renderer.dispose()
      vi.useRealTimers()
    }
  })

  it('bounds the native worker queue without blocking execution, captures beyond two previews, and drops stale results', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = stubPreviewWorker()
    const f = fixture()
    expect(
      (f.manager as unknown as KclManager).engineCommandManager
        .executionBatchPreview
    ).toBe(f.state.captureExecutionPreview)
    f.manager.isExecutingSignal.value = true
    const snapshot = new TextEncoder().encode('{"version":1,"bodies":[]}')
    f.manager.engineCommandManager.sendCommand.mockResolvedValue([
      {
        success: true,
        resp: {
          type: 'export',
          data: {
            files: [{ name: 'output.glb', contents: Array.from(snapshot) }],
          },
        },
      },
    ])
    for (let i = 0; i < 3; i++) {
      f.state.nextExecutionPreviewAt = 0
      await f.state.captureExecutionPreview(previewCheckpoint)
      if (i === 0) {
        f.state.nextExecutionPreviewAt = 0
        await f.state.captureExecutionPreview(previewCheckpoint)
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
      }
      const previous = f.state.executionPreviewModel
      worker.onmessage?.({
        data: {
          id: worker.postMessage.mock.calls[i][0].id,
          positions: new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0]),
          normals: new Float32Array(9),
          faceCount: 1,
        },
      } as MessageEvent<TessellationResponse>)
      expect(f.state.executionPreviewModel).not.toBeNull()
      expect(f.state.executionPreviewModel).not.toBe(previous)
    }
    expect(worker.postMessage).toHaveBeenCalledTimes(3)
    const previewCommand =
      f.manager.engineCommandManager.sendCommand.mock.calls[0][1].command.cmd
    expect(previewCommand).toMatchObject({
      format: { type: 'gltf', brep_only: true },
    })
    expect(previewCommand).not.toHaveProperty('compression')
    const id = worker.postMessage.mock.calls[2][0].id as number
    const onmessage = worker.onmessage
    if (!onmessage) throw new Error('Missing worker callback')
    f.manager.isExecutingSignal.value = false
    f.manager.isExecutingSignal.value = true
    onmessage({
      data: {
        id,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(9),
        faceCount: 1,
      },
    } as MessageEvent<TessellationResponse>)
    expect(f.state.executionPreviewModel).toBeNull()
    f.renderer.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('recovers worker failures with bounded retries and releases hung work', async () => {
    vi.useFakeTimers()
    const workers: {
      postMessage: ReturnType<typeof vi.fn>
      terminate: ReturnType<typeof vi.fn>
      onmessage: ((event: MessageEvent<TessellationResponse>) => void) | null
      onerror: ((event: { message: string }) => void) | null
    }[] = []
    vi.stubGlobal(
      'Worker',
      vi.fn(function () {
        const worker = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null,
        }
        workers.push(worker)
        return worker
      })
    )
    const f = fixture()
    f.manager.engineCommandManager.sendCommand.mockResolvedValue([
      {
        resp: {
          type: 'export',
          data: {
            files: [{ name: 'output.glb', contents: [123, 125] }],
          },
        },
      },
    ])
    f.manager.isExecutingSignal.value = true
    expect(workers).toHaveLength(0)
    for (let i = 0; i < 3; i++) {
      f.state.nextExecutionPreviewAt = 0
      await f.state.captureExecutionPreview(previewCheckpoint)
      if (i === 0) await vi.advanceTimersByTimeAsync(30_000)
      else workers[i].onerror?.({ message: 'Worker failed to load' })
      expect(workers[i].terminate).toHaveBeenCalledOnce()
      expect(f.state.nativePreviewBusy).toBe(false)
    }
    expect(f.state.nativePreviewUnavailable).toBe(true)
    f.manager.isExecutingSignal.value = false
    f.manager.isExecutingSignal.value = true
    expect(f.state.nativePreviewUnavailable).toBe(false)
    f.state.nextExecutionPreviewAt = 0
    await f.state.captureExecutionPreview(previewCheckpoint)
    expect(workers).toHaveLength(4)
    f.renderer.dispose()
    expect(workers[3].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an old capture release the next execution capture', async () => {
    const f = fixture()
    let finishOld!: (response: unknown[]) => void
    let finishNew!: (response: unknown[]) => void
    f.manager.engineCommandManager.sendCommand
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve
          })
      )
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    const oldCapture = f.state.captureExecutionPreview(previewCheckpoint)
    f.manager.isExecutingSignal.value = false
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    const newCapture = f.state.captureExecutionPreview(previewCheckpoint)
    finishOld([{}])
    await oldCapture
    await f.state.captureExecutionPreview(previewCheckpoint)
    expect(f.manager.engineCommandManager.sendCommand).toHaveBeenCalledTimes(2)
    finishNew([{}])
    await newCapture
    f.renderer.dispose()
  })

  it.each(['constructor', 'postMessage'])(
    'recovers a synchronous worker %s failure without blocking final export',
    async (failure) => {
      const worker = {
        postMessage: vi.fn(() => {
          throw new Error('Cannot post')
        }),
        terminate: vi.fn(),
      }
      vi.stubGlobal(
        'Worker',
        vi.fn(() => {
          if (failure === 'constructor') throw new Error('Cannot start worker')
          return worker
        })
      )
      const f = fixture()
      f.manager.isExecutingSignal.value = true
      f.manager.engineCommandManager.sendCommand.mockResolvedValue([
        {
          resp: {
            type: 'export',
            data: {
              files: [{ name: 'output.glb', contents: [123, 125] }],
            },
          },
        },
      ])
      f.state.nextExecutionPreviewAt = 0
      await expect(
        f.state.captureExecutionPreview(previewCheckpoint)
      ).resolves.toBeUndefined()
      expect(f.state.nativePreviewBusy).toBe(false)
      f.done()
      await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
      expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
      f.renderer.dispose()
    }
  )

  it('releases geometry and materials once across repeated previews', () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    const internals = f.renderer as unknown as {
      submitNativePreview(snapshot: string, version: number): void
      executionVersion: number
    }
    const disposals: ReturnType<typeof vi.spyOn>[] = []
    for (let i = 0; i < 3; i++) {
      internals.submitNativePreview('{}', internals.executionVersion)
      worker.onmessage?.({
        data: {
          id: worker.postMessage.mock.lastCall?.[0].id,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          faceCount: 1,
        },
      } as MessageEvent<TessellationResponse>)
      const model = f.state.executionPreviewModel as Mesh
      disposals.push(vi.spyOn(model.geometry, 'dispose'))
      disposals.push(
        vi.spyOn(model.material as MeshStandardNodeMaterial, 'dispose')
      )
    }
    f.renderer.dispose()
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('retains the committed model while a preview is displayed, then replaces both with the final scene', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const committed = f.state.currentModel
    f.onModelLoadSettled.mockClear()
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    await f.state.captureExecutionPreview(previewCheckpoint)
    worker.onmessage?.({
      data: {
        id: worker.postMessage.mock.lastCall?.[0].id,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(9),
        faceCount: 1,
      },
    } as MessageEvent<TessellationResponse>)
    const preview = f.state.executionPreviewModel
    expect(preview).not.toBeNull()
    expect(f.state.currentModel).toBe(committed)
    expect(committed?.visible).toBe(false)
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    expect(f.renderer.isLoadedSceneCurrent()).toBe(true)
    f.done()
    expect(f.state.executionPreviewModel).toBe(preview)
    await vi.waitFor(() => expect(f.state.executionPreviewModel).toBeNull())
    expect(f.state.currentModel).not.toBe(committed)
    expect(f.onModelLoadSettled).toHaveBeenCalledExactlyOnceWith(true)
    f.renderer.dispose()
  })

  it('discards a preview response from an older execution', async () => {
    const f = fixture()
    const response = Promise.withResolvers<unknown>()
    f.manager.engineCommandManager.sendCommand.mockReturnValue(response.promise)
    f.manager.isExecutingSignal.value = true
    f.state.nextExecutionPreviewAt = 0
    const capture = f.state.captureExecutionPreview(previewCheckpoint)
    f.manager.isExecutingSignal.value = false
    f.manager.isExecutingSignal.value = true
    response.resolve(nativeExportResponse())
    await capture
    expect(f.state.executionPreviewModel).toBeNull()
    expect(f.state.currentModel).toBeNull()
    f.renderer.dispose()
  })

  it('keeps the loaded model when an execution leaves the scene unchanged', async () => {
    const f = fixture()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const model = f.state.currentModel
    f.onModelLoadSettled.mockClear()

    f.manager.isExecutingSignal.value = true
    f.done(true, false)

    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.state.currentModel).toBe(model)
    expect(f.onModelLoadSettled).toHaveBeenCalledExactlyOnceWith()
    f.renderer.dispose()
  })

  it('discards an export if a newer execution starts before it arrives', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<ModelingAppFile[]>()
    f.manager.rustContext.export.mockReturnValueOnce(pending.promise)
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync')
    f.done()
    expect(f.renderer.isLoadedSceneCurrent()).toBe(false)
    f.manager.isExecutingSignal.value = true
    pending.resolve([triangleGlb()])
    await pending.promise
    expect(parse).not.toHaveBeenCalled()
    expect(f.state.currentModel).toBeNull()
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    expect(f.renderer.isLoadedSceneCurrent()).toBe(true)
    f.renderer.dispose()
  })

  it.each(['missing GLB', 'export rejection', 'parse rejection'])(
    'clears the old model on %s, preserving default planes',
    async (failure) => {
      const f = planeFixture()
      const referencePlane = f.gpu.planeRenderer.planes.get('plane-xy')?.group
      if (!referencePlane) throw new Error('Missing reference plane')
      f.gpu.scene.add(referencePlane)
      f.done()
      await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
      const mesh = f.state.currentModel?.children[0]
      if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
      const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose')
      const disposeMaterial = vi.spyOn(mesh.material, 'dispose')
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      if (failure === 'missing GLB') {
        f.manager.rustContext.export.mockResolvedValueOnce(undefined)
      } else if (failure === 'export rejection') {
        f.manager.rustContext.export.mockRejectedValueOnce(
          new Error('Export failed')
        )
      } else {
        vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockRejectedValueOnce(
          new Error('Invalid GLB')
        )
      }
      f.manager.isExecutingSignal.value = true
      f.done()
      await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce())

      expect(f.state.currentModel).toBeNull()
      expect(disposeGeometry).toHaveBeenCalledOnce()
      expect(disposeMaterial).toHaveBeenCalledOnce()
      expect(f.gpu.scene.children).toEqual([referencePlane])
      // The edge and sketch-line data are empty: the fake edge renderers have no lines.
      expect(f.picker.setTargets).toHaveBeenLastCalledWith(
        f.defaultTargets,
        null,
        { source: f.gpu.edgeRenderer.lines, targets: [] },
        { source: f.gpu.sketchLineRenderer.lines, targets: [] }
      )
      expect(f.highlights.setTargets).toHaveBeenLastCalledWith(f.defaultTargets)
      expect(f.state.baseRenderDirty).toBe(true)
      // Once for the first model, once for the failure.
      expect(f.onModelLoadSettled).toHaveBeenCalledTimes(2)
      expect(f.onModelLoadSettled).toHaveBeenLastCalledWith()
      expect(f.manager.rustContext.export).toHaveBeenCalledTimes(2)
      f.renderer.dispose()
    }
  )

  it('keeps the failed run preview unselectable and clears it on a file switch', () => {
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    const preview = new Mesh(new BoxGeometry())
    f.state.executionPreviewModel = preview
    f.gpu.scene.add(preview)
    f.done(false)
    expect(f.state.executionPreviewModel).toBe(preview)
    expect(f.state.nativePreviewNotice?.textContent).toBe(
      'Build failed · partial preview'
    )
    expect(f.state.pickingSuspendedForPreview).toBe(true)
    f.renderer.setPickingEnabled(true)
    expect(f.state.pickingSuspendedForPreview).toBe(true)
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    f.manager.path = '/another-file.kcl'
    f.manager.dispatchEvent(new CustomEvent('file-changed'))
    expect(f.state.executionPreviewModel).toBeNull()
    expect(f.state.currentModel).toBeNull()
    expect(f.state.nativePreviewNotice).toBeNull()
    f.manager.diagnosticsSignal.value = [{ severity: 'error' }]
    expect(f.state.nativePreviewNotice?.textContent).toBe(
      'Build failed · no preview available'
    )
    f.renderer.dispose()
  })

  it('does not install an in-flight final model after a same-file parse error', async () => {
    const f = fixture()
    const exported = Promise.withResolvers<ModelingAppFile[]>()
    f.manager.rustContext.export.mockReturnValue(exported.promise)
    const refresh = (
      f.renderer as unknown as { refreshModel(): Promise<void> }
    ).refreshModel()
    f.manager.diagnosticsSignal.value = [{ severity: 'error' }]
    expect(f.state.pickingSuspendedForPreview).toBe(true)
    exported.resolve([triangleGlb()])
    await refresh
    expect(f.state.currentModel).toBeNull()
    expect(f.state.pickingSuspendedForPreview).toBe(true)
    expect(f.state.nativePreviewNotice?.textContent).toContain('Build failed')
    f.renderer.dispose()
  })

  it('retains the same-file model on a parse error, but not when identical text belongs to another file', async () => {
    const f = fixture()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const previous = f.state.currentModel
    f.manager.diagnosticsSignal.value = [{ severity: 'error' }]
    expect(f.state.currentModel).toBe(previous)
    expect(f.state.nativePreviewNotice?.textContent).toBe(
      'Build failed · previous successful model'
    )
    f.manager.path = '/new-file.kcl'
    f.manager.dispatchEvent(new CustomEvent('file-changed'))
    expect(f.state.currentModel).toBeNull()
    f.renderer.dispose()
  })

  it('restores picking after undoing a parse error to a cached model', async () => {
    const f = fixture()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const previous = f.state.currentModel
    const { integerIdPicker: picker, selectionHighlightRenderer: highlights } =
      f.gpu
    picker.setTargets.mockClear()
    picker.clearModel.mockClear()
    highlights.setTargets.mockClear()
    highlights.clearModel.mockClear()

    f.manager.diagnosticsSignal.value = [{ severity: 'error' }]
    expect(picker.clearModel).toHaveBeenCalled()
    expect(highlights.clearModel).toHaveBeenCalled()
    f.manager.isExecutingSignal.value = true
    f.manager.diagnosticsSignal.value = []
    f.done(true, false)

    expect(f.state.currentModel).toBe(previous)
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.state.pickingSuspendedForPreview).toBe(false)
    expect(picker.setTargets).toHaveBeenCalledOnce()
    expect(highlights.setTargets).toHaveBeenCalledOnce()
    f.renderer.dispose()
  })

  it('captures surviving geometry for an early failure without requesting final GLTF', async () => {
    const worker = stubPreviewWorker()
    const f = fixture()
    f.manager.engineCommandManager.sendCommand.mockResolvedValue(
      nativeExportResponse()
    )
    f.done(false)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    const onmessage = worker.onmessage
    if (!onmessage) throw new Error('Missing worker callback')
    onmessage({
      data: {
        id: worker.postMessage.mock.calls[0][0].id,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(9),
        faceCount: 1,
      },
    } as MessageEvent<TessellationResponse>)
    expect(f.state.executionPreviewModel).not.toBeNull()
    expect(f.state.nativePreviewNotice?.textContent).toBe(
      'Build failed · partial preview'
    )
    expect(f.state.pickingSuspendedForPreview).toBe(true)
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    f.manager.path = '/other.kcl'
    f.manager.dispatchEvent(new CustomEvent('file-changed'))
    onmessage({
      data: {
        id: worker.postMessage.mock.calls[0][0].id,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(9),
      },
    } as MessageEvent<TessellationResponse>)
    expect(f.state.executionPreviewModel).toBeNull()
    f.renderer.dispose()
  })

  it('does not export failed executions and settles failed exports without retrying', async () => {
    const f = fixture()
    f.done(false)
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    expect(f.onModelLoadSettled).toHaveBeenCalledOnce()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    f.manager.rustContext.export.mockResolvedValueOnce(undefined)
    f.manager.isExecutingSignal.value = true
    f.done()
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce())
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.onModelLoadSettled).toHaveBeenCalledTimes(2)
    f.renderer.dispose()
  })

  it('frees the ambient occlusion pipeline when SSAO is turned off', () => {
    const f = fixture()
    f.renderer.setEnableSSAO(true)
    const dispose = vi.fn()
    f.state.ambientOcclusionPipeline = {
      pipeline: { dispose },
      scenePass: { dispose },
      aoPass: { dispose },
      denoisePass: null,
      denoiseNoiseTexture: null,
    }
    f.renderer.setEnableSSAO(false)
    expect(dispose).toHaveBeenCalledTimes(3)
    expect(f.state.ambientOcclusionPipeline).toBeNull()
    f.renderer.dispose()
  })
})

// A minimal standard GLB: no Zoo extensions/extras or external resources.
function offsetPlane(): Extract<Artifact, { type: 'plane' }> {
  return {
    type: 'plane',
    id: 'offset',
    pathIds: [],
    codeRef: { range: [0, 1, 0], pathToNode: [], nodePath: { steps: [] } },
    planeInfo: {
      origin: { x: 0, y: 0, z: 20, units: 'mm' },
      xAxis: { x: 1, y: 0, z: 0, units: null },
      yAxis: { x: 0, y: 1, z: 0, units: null },
      zAxis: { x: 0, y: 0, z: 1, units: null },
    },
    size: 100,
  }
}

function triangleGlb(): ModelingAppFile {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const json = JSON.stringify({
    asset: { version: '2.0' },
    // Engine exports carry this; here it describes no faces or edges. Like the
    // engine, it omits every empty array except curves3D.
    extensionsUsed: ['KITTYCAD_boundary_representation'],
    extensions: {
      KITTYCAD_boundary_representation: { curves3D: [] },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      { pbrMetallicRoughness: { metallicFactor: 0.3, roughnessFactor: 0.4 } },
    ],
    buffers: [{ byteLength: vertices.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: vertices.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  })
  const jsonBytes = new TextEncoder().encode(
    json.padEnd(Math.ceil(json.length / 4) * 4, ' ')
  )
  const bytes = new Uint8Array(
    12 + 8 + jsonBytes.length + 8 + vertices.byteLength
  )
  const header = new DataView(bytes.buffer)
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, bytes.length, true)
  header.setUint32(12, jsonBytes.length, true)
  header.setUint32(16, 0x4e4f534a, true)
  bytes.set(jsonBytes, 20)
  const binOffset = 20 + jsonBytes.length
  header.setUint32(binOffset, vertices.byteLength, true)
  header.setUint32(binOffset + 4, 0x004e4942, true)
  bytes.set(new Uint8Array(vertices.buffer), binOffset + 8)
  return { name: 'model.glb', contents: Array.from(bytes) }
}
