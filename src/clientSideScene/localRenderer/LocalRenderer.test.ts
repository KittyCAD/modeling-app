import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { Signal } from '@src/lib/signal'
import { Themes } from '@src/lib/theme'
import {
  type Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
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

import { LocalRenderer } from '@src/clientSideScene/localRenderer/LocalRenderer'

// Exercise the real export/GLTFLoader lifecycle without requesting a GPU device.
type RendererInternals = {
  initialize(): Promise<void>
  scheduleRender(): void
  renderer: { dispose(): void; domElement: HTMLCanvasElement } | null
  scene: Scene | null
  currentModel: Group | null
  pendingModelRefresh: boolean
  modelLoadSettledAfterRender: boolean
  previewCamera: PerspectiveCamera | OrthographicCamera | null
  syncPreviewCameraFromShared(): void
  defaultPlaneRenderer: {
    updateScale: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } | null
}

function fixture(
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(
    45,
    1,
    0.1,
    10000
  )
) {
  const manager = Object.assign(new EventTarget(), {
    isExecutingSignal: signal(false),
    get isExecuting() {
      return this.isExecutingSignal.value
    },
    systemDeps: { settings: {} },
    rustContext: {
      export: vi
        .fn<() => Promise<ModelingAppFile[] | undefined>>()
        .mockResolvedValue([triangleGlb()]),
    },
    sceneInfra: {
      baseUnitMultiplier: 1,
      baseUnitChange: new Signal(),
      camControls: {
        camera,
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
      onVisibilityChange: vi.fn(),
      onModelLoadSettled,
    }
  )
  const state = renderer as unknown as RendererInternals
  state.renderer = {
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
  }
  state.scene = new Scene()
  const done = (successful = true) => {
    manager.isExecutingSignal.value = false
    manager.dispatchEvent(
      new CustomEvent('execution-done', {
        detail: { successful, isInterrupted: false, hasErrors: !successful },
      })
    )
  }
  return { renderer, state, manager, done, onModelLoadSettled }
}

describe('local GLB loading', () => {
  beforeEach(() => {
    const prototype = LocalRenderer.prototype as unknown as RendererInternals
    vi.spyOn(prototype, 'initialize').mockResolvedValue(undefined)
    vi.spyOn(prototype, 'scheduleRender').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('updates plane scale on camera, fixed-grid setting, and file-unit changes', () => {
    const f = fixture()
    const updateScale = vi.fn()
    f.state.defaultPlaneRenderer = { updateScale, dispose: vi.fn() }
    const controls = f.manager.sceneInfra.camControls
    controls.camera.position.set(100, 0, 0)
    f.state.syncPreviewCameraFromShared()
    expect(updateScale).toHaveBeenLastCalledWith(100, 0.1)
    controls.camera.position.set(1000, 0, 0)
    f.state.syncPreviewCameraFromShared()
    expect(updateScale).toHaveBeenLastCalledWith(1000, 0.1)

    f.renderer.setFixedSizeGrid(false)
    expect(updateScale).toHaveBeenLastCalledWith(1000, undefined)
    f.renderer.setFixedSizeGrid(true)
    expect(updateScale).toHaveBeenLastCalledWith(1000, 0.1)

    f.manager.sceneInfra.baseUnitMultiplier = 25.4
    f.manager.sceneInfra.baseUnitChange.dispatch()
    expect(updateScale).toHaveBeenLastCalledWith(1000, 2.54)
    f.renderer.dispose()
    updateScale.mockClear()
    f.manager.sceneInfra.baseUnitChange.dispatch()
    expect(updateScale).not.toHaveBeenCalled()
  })

  it('preserves orthographic negative near planes and tiny perspective near planes', () => {
    const f = fixture()
    f.state.previewCamera = new PerspectiveCamera()
    f.manager.sceneInfra.camControls.camera = new OrthographicCamera(
      -20,
      20,
      20,
      -20,
      -10000,
      10000
    )
    f.manager.sceneInfra.camControls.camera.position.set(100, -100, 100)
    f.state.syncPreviewCameraFromShared()
    expect(f.state.previewCamera).toBeInstanceOf(OrthographicCamera)
    expect(f.state.previewCamera.near).toBe(-10)
    expect(f.state.previewCamera.far).toBe(10)

    f.manager.sceneInfra.camControls.camera = new PerspectiveCamera(
      45,
      1,
      0.001,
      10
    )
    f.manager.sceneInfra.camControls.camera.position.set(0.1, -0.1, 0.1)
    f.state.syncPreviewCameraFromShared()
    expect(f.state.previewCamera).toBeInstanceOf(PerspectiveCamera)
    expect(f.state.previewCamera.near).toBeCloseTo(0.000001, 10)
    expect(f.state.previewCamera.far).toBe(0.01)
    f.renderer.dispose()
  })

  it('exports once after successful execution and loads standard geometry/materials', async () => {
    const f = fixture()
    f.manager.isExecutingSignal.value = true
    expect(f.manager.rustContext.export).not.toHaveBeenCalled()
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    expect(f.manager.rustContext.export).toHaveBeenCalledExactlyOnceWith(
      { type: 'gltf', storage: 'binary', presentation: 'compact' },
      { settings: { modeling: { base_unit: 'mm' } } }
    )
    const mesh = f.state.currentModel?.children[0]
    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    expect(mesh.geometry.getAttribute('position').count).toBe(3)
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
    expect(mesh.material.metalness).toBe(0.3)
    expect(mesh.material.roughness).toBe(0.4)
    expect(f.manager.sceneInfra.camControls.target.toArray()).toEqual([
      500, -0, 500,
    ])
    expect(f.state.modelLoadSettledAfterRender).toBe(true)
    f.renderer.dispose()
  })

  it('replaces and disposes the old model without refitting the camera', async () => {
    const f = fixture()
    // Reference geometry is not part of the export, its bounds, or its disposal.
    const referencePlane = new Mesh(
      new PlaneGeometry(1000, 1000),
      new MeshStandardMaterial()
    )
    referencePlane.name = 'default-planes'
    referencePlane.position.set(1000, 0, 0)
    f.state.scene?.add(referencePlane)
    const disposeReference = vi.spyOn(referencePlane.geometry, 'dispose')
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    expect(f.manager.sceneInfra.camControls.target.toArray()).toEqual([
      500, -0, 500,
    ])
    const old = f.state.currentModel
    const mesh = old?.children[0]
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(mesh.material, 'dispose')
    f.manager.isExecutingSignal.value = true
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBe(old))
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(f.state.scene?.children).toHaveLength(2)
    expect(f.state.scene?.children).toContain(referencePlane)
    expect(disposeReference).not.toHaveBeenCalled()
    expect(
      f.manager.sceneInfra.camControls.onCameraChange
    ).toHaveBeenCalledOnce()
    f.renderer.dispose()
    referencePlane.geometry.dispose()
    referencePlane.material.dispose()
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

  it('disposes a parsed model if the renderer was unmounted while parsing', async () => {
    const f = fixture()
    const gltf = await new GLTFLoader().parseAsync(
      new Uint8Array(triangleGlb().contents).buffer,
      ''
    )
    const mesh = gltf.scene.children[0]
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose')
    const pending = Promise.withResolvers<typeof gltf>()
    const parse = vi
      .spyOn(GLTFLoader.prototype, 'parseAsync')
      .mockReturnValueOnce(pending.promise)
    f.done()
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce())
    f.renderer.dispose()
    pending.resolve(gltf)
    await vi.waitFor(() => expect(disposeGeometry).toHaveBeenCalledOnce())
    expect(f.state.currentModel).toBeNull()
  })

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
})

// A minimal standard GLB: no Zoo extensions/extras or external resources.
function triangleGlb(): ModelingAppFile {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const json = JSON.stringify({
    asset: { version: '2.0' },
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
