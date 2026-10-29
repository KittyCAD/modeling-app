import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { LocalSelectionCommandHandler } from '@src/clientSideScene/localSelectionCommandProxy'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { Signal } from '@src/lib/signal'
import { Themes } from '@src/lib/theme'
import {
  type Group,
  Mesh,
  MeshStandardMaterial,
  type OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/KclManager', () => ({
  KclManagerEvents: { ExecutionDone: 'execution-done' },
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
  previewCamera: PerspectiveCamera | OrthographicCamera | null
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
      dispose: vi.fn(),
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
    artifactGraph: new Map([['triangle', { type: 'sweep' }]]),
    engineSceneGenerationSignal: signal(0),
    isExecutingSignal: signal(false),
    get isExecuting() {
      return this.isExecutingSignal.value
    },
    systemDeps: { settings: {} },
    engineCommandManager: { sendSceneCommand: vi.fn() },
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
  manager.sceneInfra.camControls.camera.position.set(100, -100, 100)
  const onModelLoadSettled = vi.fn()
  const renderer = new LocalRenderer(
    document.createElement('div'),
    manager as unknown as KclManager,
    {
      theme: Themes.Light,
      enableSSAO: false,
      highlightEdges: false,
      fixedSizeGrid: true,
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
  afterEach(() => vi.restoreAllMocks())

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
    f.state.previewCamera = new PerspectiveCamera()
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
      expect(f.highlights.setHover).toHaveBeenLastCalledWith(f.target)
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
      },
      { settings: { modeling: { base_unit: 'mm' } } }
    )
    const mesh = f.state.currentModel?.children[0]
    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    expect(mesh.geometry.getAttribute('position').count).toBe(3)
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
    expect(mesh.material.metalness).toBe(0.3)
    expect(mesh.material.roughness).toBe(0.4)
    expect(resetCameraPosition).toHaveBeenCalledExactlyOnceWith({
      sceneInfra: f.manager.sceneInfra,
      settingsActor: f.manager.systemDeps.settings,
    })
    expect(f.onModelLoadSettled).toHaveBeenCalledExactlyOnceWith(true)
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
    f.manager.isExecutingSignal.value = true
    pending.resolve([triangleGlb()])
    await pending.promise
    expect(parse).not.toHaveBeenCalled()
    expect(f.state.currentModel).toBeNull()
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
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

  it('does not export failed executions and settles failed exports without retrying', async () => {
    const f = fixture()
    f.done(false)
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    expect(f.onModelLoadSettled).toHaveBeenCalledOnce()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    f.manager.rustContext.export.mockResolvedValueOnce(undefined)
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
