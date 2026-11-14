import { createMoveToolInteraction } from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { createMockRustContext } from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import type * as SketchScene from '@src/clientSideScene/sketchScene'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import { Scene, Vector2, Vector3 } from 'three'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { createSketchSurface } from '@src/lib/kcl/sketch/surface'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import {
  createMockSceneInfra,
  createPointApiObject,
  createLineApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { updateSceneGraphFromDelta } from '@src/machines/sketchSolve/sketchSceneGraph'

vi.mock('@src/machines/sketchSolve/sketchSceneGraph', () => ({
  updateSceneGraphFromDelta: vi.fn(),
}))
vi.mock('@src/clientSideScene/sketchScene', async (original) => ({
  ...(await original<typeof SketchScene>()),
  updateSketchGrid: vi.fn(),
}))
let wasm: ModuleType
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
afterEach(() => vi.clearAllMocks())
it('renders live sketch selection and hover, retains them on frame updates, and restores picking after a tool', async () => {
  const view = modelingTestContext(),
    infra = createMockSceneInfra(),
    canvas = document.createElement('canvas')
  const callbacks: Parameters<SceneInfra['setCallbacks']>[0] = {}
  const frame: { callback: (() => void) | null } = { callback: null }
  Object.assign(infra, {
    scene: new Scene(),
    renderer: { domElement: canvas },
    resumeRendering: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    setOnBeforeRender: (callback: (() => void) | null) => {
      frame.callback = callback
    },
    setCallbacks: (next: Parameters<SceneInfra['setCallbacks']>[0]) =>
      Object.assign(callbacks, next),
    resetMouseListeners: () => {
      callbacks.onClick = undefined
      callbacks.onMove = undefined
    },
  })
  const surface = createSketchSurface(
    infra,
    view.context.settings,
    { entityId: 'xy', origin: [0, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] },
    0
  )
  let move: ReturnType<typeof createMoveToolInteraction> | undefined
  try {
    const sketch: ApiObject = {
      ...createPointApiObject({ id: 0 }),
      kind: {
        type: 'Sketch',
        args: { on: { default: 'xy' } },
        constraints: [],
        plane: 5,
        segments: [1, 2, 3],
      },
    }
    const delta = createSceneGraphDelta([
      sketch,
      createPointApiObject({ id: 1, x: 10, y: 10 }),
      createPointApiObject({ id: 2, x: 50, y: 10 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
    ])
    surface.render(delta)
    const activate = () =>
      createMoveToolInteraction({
        sceneInfra: infra,
        sketchId: 0,
        getState: () =>
          surface.getState({
            sourceDelta: { text: '' },
            sceneGraphDelta: delta,
          }),
        getCheckpointId: () => null,
        getLengthUnit: () => undefined,
        getSettings: () => jsAppSettings(view.context.settings.current.peek()),
        getModelingSettings: () =>
          view.context.settings.current.peek().modeling,
        mutations: createMockRustContext(),
        isCurrent: () => true,
        selection: surface.selection,
        hover: surface.updateHover,
        outcome: () => {},
        onError: (cause) => {
          throw cause
        },
      })
    move = activate()
    await callbacks.onClick?.({
      wasmInstance: wasm,
      mouseEvent: new MouseEvent('click', { button: 0 }),
      intersectionPoint: {
        twoD: new Vector2(10, 10),
        threeD: new Vector3(10, 10, 0),
      },
      intersects: [],
    })
    await callbacks.onMove?.({
      mouseEvent: new MouseEvent('mousemove'),
      intersectionPoint: {
        twoD: new Vector2(30, 10),
        threeD: new Vector3(30, 10, 0),
      },
      intersects: [],
    })
    frame.callback?.()
    expect(surface.selected.peek()).toEqual([1])
    expect(surface.hovered.peek()).toBe(3)
    expect(updateSceneGraphFromDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedIds: [1],
        context: expect.objectContaining({ selectedIds: [1], hoveredId: 3 }),
      })
    )
    canvas.dispatchEvent(new MouseEvent('mouseleave'))
    expect(surface.hovered.peek()).toBeNull()
    expect(surface.selected.peek()).toEqual([1])
    infra.setCallbacks({ onClick: () => {} })
    await move.dispose()
    move = activate()
    await callbacks.onClick?.({
      wasmInstance: wasm,
      mouseEvent: new MouseEvent('click', { button: 0 }),
      intersectionPoint: {
        twoD: new Vector2(10, 10),
        threeD: new Vector3(10, 10, 0),
      },
      intersects: [],
    })
    expect(surface.selected.peek()).toEqual([])
    surface.select([1])
    surface.render(createSceneGraphDelta([sketch]))
    expect(surface.selected.peek()).toEqual([])
  } finally {
    await move?.dispose()
    surface.dispose()
    view.dispose()
  }
  expect(infra.scene.children).toHaveLength(0)
})
