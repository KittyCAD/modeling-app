import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { IntegerIdPickTarget } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { LocalSelectionCommandProvider } from '@src/clientSideScene/localSelectionCommandProxy'
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
import { PlaneRenderer } from '@src/clientSideScene/localRenderer/PlaneRenderer'
import type { Artifact } from '@src/lang/wasm'

// Exercise the real export/GLTFLoader lifecycle without requesting a GPU device.
type RendererInternals = {
  initialize(): Promise<void>
  scheduleRender(): void
  renderer: { dispose(): void; domElement: HTMLCanvasElement } | null
  scene: Scene | null
  currentModel: Group | null
  planeRenderer: PlaneRenderer | null
  pendingModelRefresh: boolean
  modelLoadSettledAfterRender: boolean
  previewCamera: PerspectiveCamera | OrthographicCamera | null
  syncPreviewCameraFromShared(): void
  handleLocalSelectionCommand: LocalSelectionCommandProvider['handleCommand']
  clearPlaneHover(): void
  rebuildPlaneTargets(): void
  baseRenderDirty: boolean
  pointerOverCanvas: boolean
  integerIdPicker: {
    pick: ReturnType<
      typeof vi.fn<
        () => Promise<{
          target: IntegerIdPickTarget | null
          diagnostics: { stale: boolean }
        }>
      >
    >
    invalidate: ReturnType<typeof vi.fn>
    setTargets: ReturnType<typeof vi.fn>
    clearModel: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } | null
  selectionHighlightRenderer: {
    setTargets: ReturnType<typeof vi.fn>
    setHover: ReturnType<typeof vi.fn>
    setSelection: ReturnType<typeof vi.fn>
    clearModel: ReturnType<typeof vi.fn>
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
    artifactGraph: new Map([['triangle', { type: 'sweep' }]]),
    isExecutingSignal: signal(false),
    get isExecuting() {
      return this.isExecutingSignal.value
    },
    systemDeps: { settings: {} },
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  function planeFixture(id = 'plane-xy') {
    const f = fixture()
    const planes = new PlaneRenderer(Themes.Light)
    planes.updateDefaultPlanes(f.manager.rustContext.defaultPlanes)
    planes.updateOffsetPlanes(new Map([['offset', offsetPlane()]]))
    const object = planes.planes.get(id)?.mesh
    if (!object) throw new Error('Missing plane mesh')
    const target = { object }
    const picker = {
      pick: vi
        .fn()
        .mockResolvedValue({ target, diagnostics: { stale: false } }),
      invalidate: vi.fn(),
      setTargets: vi.fn(),
      clearModel: vi.fn(),
      dispose: vi.fn(),
    }
    const highlights = {
      setTargets: vi.fn(),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      clearModel: vi.fn(),
      dispose: vi.fn(),
    }
    f.state.planeRenderer = planes
    const setDefaultVisibility = vi.spyOn(planes, 'setDefaultVisibility')
    f.state.integerIdPicker = picker
    f.state.selectionHighlightRenderer = highlights
    f.state.previewCamera = new PerspectiveCamera()
    f.state.pointerOverCanvas = true
    f.renderer.setPlaneInteractionEnabled(true)
    const pick = (click = false) =>
      f.state.handleLocalSelectionCommand(
        {
          type: 'modeling_cmd_req',
          cmd_id: 'pick-request',
          cmd: click
            ? {
                type: 'select_with_point',
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
      .map(({ mesh }) => ({ object: mesh }))
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
        type: 'select_with_point',
        data: { entity_id: id },
      })
      expect(result?.websocketResponse).toMatchObject({
        success: true,
        request_id: 'pick-request',
      })
      f.renderer.setSelectedPlane(id)
      expect(f.highlights.setSelection).toHaveBeenLastCalledWith([f.target])
      f.renderer.setSelectedPlane(null)
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
    f.renderer.setPlaneInteractionEnabled(false)
    await f.pick()
    f.renderer.setPlaneInteractionEnabled(true)
    f.state.pointerOverCanvas = false
    await f.pick()
    expect(f.picker.pick).not.toHaveBeenCalled()
    f.renderer.dispose()
  })

  it('keeps offset selection when defaults are hidden and clears it when the offset is removed', () => {
    const f = planeFixture('offset')
    f.renderer.setSelectedPlane('offset')
    f.renderer.setDefaultPlaneVisibility({ xy: false, xz: false, yz: false })
    expect(f.highlights.setSelection).toHaveBeenLastCalledWith([f.target])
    f.state.planeRenderer?.updateOffsetPlanes(new Map())
    f.state.rebuildPlaneTargets()
    expect(f.highlights.setSelection).toHaveBeenLastCalledWith([])
    expect(f.highlights.setHover).toHaveBeenLastCalledWith(null)
    const defaultTargets = [
      ...(f.state.planeRenderer?.planes.values() ?? []),
    ].map(({ mesh }) => ({ object: mesh }))
    expect(f.picker.setTargets).toHaveBeenLastCalledWith(defaultTargets, null)
    expect(f.highlights.setTargets).toHaveBeenLastCalledWith(defaultTargets)
    f.renderer.dispose()
  })

  it('applies visibility, invalidates picking, and hides highlights until the plane is shown again', async () => {
    const f = planeFixture()
    await f.pick()
    f.renderer.setSelectedPlane('plane-xy')
    f.picker.invalidate.mockClear()
    f.state.baseRenderDirty = false

    f.renderer.setDefaultPlaneVisibility({ xy: false, xz: true, yz: true })
    expect(f.setDefaultVisibility).toHaveBeenLastCalledWith({
      xy: false,
      xz: true,
      yz: true,
    })
    expect(f.picker.invalidate).toHaveBeenCalledOnce()
    expect(f.state.baseRenderDirty).toBe(true)
    expect(f.highlights.setHover).toHaveBeenLastCalledWith(null)
    expect(f.highlights.setSelection).toHaveBeenLastCalledWith([])

    f.renderer.setDefaultPlaneVisibility({ xy: true, xz: false, yz: false })
    expect(f.highlights.setSelection).toHaveBeenLastCalledWith([f.target])
    expect(f.picker.setTargets).not.toHaveBeenCalled()
    f.renderer.dispose()
  })

  it('retains visibility set before initialization and when model targets are rebuilt', () => {
    const f = planeFixture()
    const { planeRenderer } = f.state
    f.state.planeRenderer = null
    const visibility = { xy: false, xz: true, yz: false }
    f.renderer.setDefaultPlaneVisibility(visibility)
    f.renderer.setSelectedPlane('plane-xy')

    f.state.planeRenderer = planeRenderer
    f.state.rebuildPlaneTargets()
    expect(f.setDefaultVisibility).toHaveBeenLastCalledWith(visibility)
    expect(f.highlights.setSelection).toHaveBeenLastCalledWith([])
    f.state.rebuildPlaneTargets()
    expect(f.setDefaultVisibility).toHaveBeenLastCalledWith(visibility)
    f.renderer.dispose()
  })

  it('discards pending hover readbacks when plane visibility changes', async () => {
    const f = planeFixture()
    let resolvePick = () => {}
    f.picker.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePick = () =>
            resolve({ target: f.target, diagnostics: { stale: false } })
        })
    )
    const pending = f.pick()
    f.renderer.setDefaultPlaneVisibility({ xy: false, xz: true, yz: true })
    resolvePick()
    expect(await pending).toEqual({})
    expect(f.highlights.setHover).toHaveBeenLastCalledWith(null)
    f.renderer.dispose()
  })

  it('does not apply a GPU hover result after the pointer leaves or execution starts', async () => {
    const f = planeFixture()
    let resolvePick = () => {}
    f.picker.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePick = () =>
            resolve({ target: f.target, diagnostics: { stale: false } })
        })
    )
    const pending = f.pick()
    f.state.clearPlaneHover()
    resolvePick()
    expect(await pending).toEqual({})
    expect(f.highlights.setHover).toHaveBeenLastCalledWith(null)

    const next = f.pick()
    f.manager.isExecutingSignal.value = true
    resolvePick()
    expect(await next).toEqual({})
    expect(f.highlights.setHover).toHaveBeenLastCalledWith(null)
    f.renderer.dispose()
  })

  it('ignores stale GPU results and returns an empty selection for a miss', async () => {
    const f = planeFixture()
    f.picker.pick.mockResolvedValueOnce({
      target: f.target,
      diagnostics: { stale: true },
    })
    expect(await f.pick()).toEqual({})
    f.picker.pick.mockResolvedValueOnce({
      target: null,
      diagnostics: { stale: false },
    })
    expect((await f.pick(true))?.modelingResponse).toEqual({
      type: 'select_with_point',
      data: { entity_id: undefined },
    })
    f.renderer.dispose()
  })

  it('updates plane scale on camera, fixed-grid setting, and file-unit changes', () => {
    const f = fixture()
    f.state.planeRenderer = new PlaneRenderer(Themes.Light)
    const updateScale = vi.spyOn(f.state.planeRenderer, 'updateScale')
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

  it('clears an empty execution without exporting, while preserving default planes', async () => {
    const f = planeFixture()
    const referencePlane = f.state.planeRenderer?.planes.get('plane-xy')?.group
    if (!referencePlane) throw new Error('Missing reference plane')
    f.state.scene?.add(referencePlane)
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const mesh = f.state.currentModel?.children[0]
    if (!(mesh instanceof Mesh)) throw new Error('Missing mesh')
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(mesh.material, 'dispose')
    const disposePlane = vi.spyOn(f.target.object.geometry, 'dispose')

    f.manager.isExecutingSignal.value = true
    f.manager.artifactGraph.clear()
    f.done()

    expect(f.state.currentModel).toBeNull()
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(disposePlane).not.toHaveBeenCalled()
    expect(f.state.scene?.children).toEqual([referencePlane])
    expect(f.picker.setTargets).toHaveBeenLastCalledWith(f.defaultTargets, null)
    expect(f.highlights.setTargets).toHaveBeenLastCalledWith(f.defaultTargets)
    expect(f.state.baseRenderDirty).toBe(true)
    expect(f.state.modelLoadSettledAfterRender).toBe(true)
    f.renderer.dispose()
  })

  it('does not restore a stale GLB after an empty execution completes', async () => {
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
    f.manager.isExecutingSignal.value = true
    f.manager.artifactGraph.clear()
    f.done()
    pending.resolve(gltf)
    await vi.waitFor(() => expect(disposeGeometry).toHaveBeenCalledOnce())
    expect(f.state.currentModel).toBeNull()
    expect(f.manager.rustContext.export).toHaveBeenCalledOnce()
    expect(f.state.modelLoadSettledAfterRender).toBe(true)
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

  it.each(['missing GLB', 'export rejection', 'parse rejection'])(
    'clears the old model on %s, preserving default planes',
    async (failure) => {
      const f = planeFixture()
      const referencePlane =
        f.state.planeRenderer?.planes.get('plane-xy')?.group
      if (!referencePlane) throw new Error('Missing reference plane')
      f.state.scene?.add(referencePlane)
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
      expect(f.state.scene?.children).toEqual([referencePlane])
      expect(f.picker.setTargets).toHaveBeenLastCalledWith(
        f.defaultTargets,
        null
      )
      expect(f.highlights.setTargets).toHaveBeenLastCalledWith(f.defaultTargets)
      expect(f.state.baseRenderDirty).toBe(true)
      expect(f.onModelLoadSettled).toHaveBeenCalledOnce()
      expect(f.manager.rustContext.export).toHaveBeenCalledTimes(2)
      f.renderer.dispose()
    }
  )

  it('renders offset planes even when GLB export fails, and clears them on empty execution', async () => {
    const f = fixture()
    const scene = new Scene()
    f.state.scene = scene
    f.state.planeRenderer = new PlaneRenderer(Themes.Light)
    f.state.planeRenderer.addTo(scene)
    const root = scene.children[0]
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const defaults = [...root.children]
    const offset = offsetPlane()
    f.manager.artifactGraph.clear()
    f.manager.artifactGraph.set(offset.id, offset)
    f.manager.rustContext.export.mockResolvedValueOnce(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    f.done()
    expect(root.children.map((child) => child.name)).toEqual([
      'XY',
      'YZ',
      'XZ',
      'offset',
    ])
    await vi.waitFor(() => expect(f.state.currentModel).toBeNull())
    expect(scene.children).toEqual([root])
    expect(root.children).toHaveLength(4)
    f.manager.artifactGraph.clear()
    f.done()
    expect(root.children).toEqual(defaults)
    f.renderer.dispose()
    expect(scene.children).toHaveLength(0)
  })

  it('ignores an old export failure after a newer model has loaded', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<ModelingAppFile[]>()
    f.manager.rustContext.export.mockReturnValueOnce(pending.promise)
    f.done()
    f.manager.isExecutingSignal.value = true
    f.done()
    await vi.waitFor(() => expect(f.state.currentModel).not.toBeNull())
    const current = f.state.currentModel
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    pending.reject(new Error('Old export failed'))
    await pending.promise.catch(() => {})
    expect(f.state.currentModel).toBe(current)
    expect(errorLog).not.toHaveBeenCalled()
    expect(f.onModelLoadSettled).not.toHaveBeenCalled()
    f.renderer.dispose()
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
