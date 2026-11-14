import { getSettingsAnnotation } from '@src/lang/queryAst'
import { baseUnitToMm } from '@src/lib/utils'
import { isErr } from '@src/lib/trap'
import { getSketchSolveBlockingIssues } from '@src/machines/sketchSolve/sketchSolveErrors'
import type {
  EditSketchOutcome,
  SketchMutationOutcome,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  updateSketchSelection,
  type SketchSolveSelectionId,
  type SelectionCoordinates,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type {
  MoveToolHost,
  MoveToolState,
} from '@src/machines/sketchSolve/tools/moveTool/host'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import '@src/lib/projectSession/next/testFeature'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { signal } from '@preact/signals-core'
import { Group, Vector3, Vector2, Scene } from 'three'
import { encode } from '@msgpack/msgpack'
import type { EntityReference } from '@kittycad/lib'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { assertParse, execStateFromRust } from '@src/lang/wasm'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import { createSketchInteraction } from '@src/lib/kcl/sketch/definition'
import { circleSketchTool } from '@src/lib/kcl/sketch/tools'
import { createSketchRuntime } from '@src/lib/kcl/sketchRuntime'
import { createSceneSelection } from '@src/lib/scene/selection'
import { createExecutorOutput } from '@src/lib/executors/output'
import { createSceneExecutionSettings } from '@src/lib/scene/settings'
import { ModelingToolbar } from '@src/lib/kcl/ModelingToolbar'
vi.mock('@src/lib/kcl/sketch/surface', () => ({
  createSketchSurface: (
    _infra: unknown,
    _settings: unknown,
    _plane: unknown,
    sketchId: number
  ) => {
    const selected = signal<SketchSolveSelectionId[]>([])
    let hoveredId: SketchSolveSelectionId | null = null
    let duringAreaSelectIds: number[] = []
    let selectionCoordinates: SelectionCoordinates = {}
    return {
      group: new Group(),
      hover: (id: SketchSolveSelectionId | null) => {
        hoveredId = id
      },
      selected,
      select: (ids: SketchSolveSelectionId[]) => {
        selected.value = ids
      },
      getState: (sketchExecOutcome: MoveToolState['sketchExecOutcome']) => ({
        sketchId,
        selectedIds: selected.peek(),
        hoveredId,
        duringAreaSelectIds,
        selectionCoordinates,
        constraintHoverPopups: [],
        showNonVisualConstraints: false,
        sketchExecOutcome,
      }),
      selection: (data: Parameters<MoveToolHost['selection']>[0]) => {
        if (data.duringAreaSelectIds !== undefined)
          duringAreaSelectIds = data.duringAreaSelectIds
        if (data.selectedIds !== undefined) {
          const update = updateSketchSelection(
            selected.peek(),
            data.selectedIds,
            { ...selectionCoordinates, ...data.selectionCoordinates },
            data.replaceExistingSelection
          )
          selected.value = update.selectedIds
          selectionCoordinates = update.selectionCoordinates
        }
      },
      updateHover: (data: Parameters<MoveToolHost['hover']>[0]) => {
        hoveredId = data.hoveredId
      },
      render: vi.fn(),
      dispose: vi.fn(),
    }
  },
}))
vi.mock('@src/clientSideScene/CameraControls', () => ({
  enterSketchModeAndSyncCamera: vi.fn(async () => {}),
}))
let wasm: ModuleType
const cleanup: (() => Promise<void>)[] = []
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function fixture(
  code = '@settings(kclVersion = 3.0)\nanswer = 42',
  presentation: 'streamed' | 'local' = 'streamed'
) {
  const view = modelingTestContext()
  view.editor.dispatch({
    changes: { from: 0, to: view.editor.contents.peek().length, insert: code },
  })
  view.context.executor = {
    ...view.context.executor,
    output: signal(
      createExecutorOutput({ contents: code, src: '/main.kcl', running: false })
    ),
  }
  const configuration = createSceneExecutionSettings(() =>
    view.context.settings.current.peek()
  ).configuration.peek()
  const native = new wasm.Context(
    {
      sendModelingCommandFromWasm: async (
        id: string,
        _range: string,
        command: string
      ) => {
        const request = JSON.parse(command)
        return encode({
          success: true,
          request_id: id,
          resp:
            request.type === 'modeling_cmd_batch_req'
              ? {
                  type: 'modeling_batch',
                  data: {
                    responses: Object.fromEntries(
                      request.requests.map((item: { cmd_id: string }) => [
                        item.cmd_id,
                        { response: { type: 'empty' } },
                      ])
                    ),
                  },
                }
              : {
                  type: 'modeling',
                  data: { modeling_response: { type: 'empty' } },
                },
        })
      },
      fireModelingCommandFromWasm: () => {},
      startNewSession: async () => {},
    },
    {
      readFile: async () => new TextEncoder().encode(code),
      exists: async () => true,
      getAllFiles: async () => JSON.stringify(['/main.kcl']),
    }
  )
  const ast = assertParse(code, wasm)
  const fileSettings = getSettingsAnnotation(ast, wasm)
  if (isErr(fileSettings)) throw fileSettings
  view.resource.runtime.fileSettings.value = fileSettings
  const unitScale = baseUnitToMm(fileSettings.defaultLengthUnit ?? 'mm')
  const state = execStateFromRust(
    await native.executeMock(
      JSON.stringify(ast),
      '/main.kcl',
      JSON.stringify(configuration),
      false
    )
  )
  view.resource.runtime.ast.value = ast
  view.resource.runtime.state.value = {
    ...state,
    defaultPlanes: {
      xy: 'xy',
      xz: 'xz',
      yz: 'yz',
      negXy: 'negXy',
      negXz: 'negXz',
      negYz: 'negYz',
    },
  }
  let picked: EntityReference = { type: 'plane', plane_id: 'xy' }
  const selection = createSceneSelection(
    {
      pick: async () =>
        picked.type === 'plane' && !selection.filter.peek().includes('object')
          ? undefined
          : { reference: picked },
      present: async () => {},
    },
    ['object', 'face', 'region']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  const inputCallbacks: Parameters<SceneInfra['setCallbacks']>[0] = {}
  Object.assign(view.resource, {
    selection,
    sceneInfra: {
      baseUnitMultiplier: unitScale,
      scene: new Scene(),
      getClientSceneScaleFactor: () => 1 / unitScale,
      setCallbacks: (callbacks: unknown) => {
        Object.assign(inputCallbacks, callbacks)
      },
      camControls: {
        camera: { position: new Vector3(10, 10, 10) },
        target: new Vector3(),
        enableRotate: true,
        syncDirection: 'engineToClient',
        disableSketchMode: async () => {},
        transitionToSketch: async () => {},
        snapToPerspectiveBeforeHandingBackControlToEngine: async () => {},
        setCameraProjection: vi.fn(async () => {}),
      },
      resetMouseListeners: () => {},
    },
    presentation,
  })
  view.resource.commands.sendSceneCommand.mockImplementation(
    async (request: any) => {
      const cmd = request.cmd
      const data =
        cmd.type === 'get_sketch_mode_plane'
          ? {
              origin: { x: 5, y: 0, z: 0 },
              x_axis: { x: 1, y: 0, z: 0 },
              y_axis: { x: 0, y: 1, z: 0 },
              z_axis: { x: 0, y: 0, z: 1 },
            }
          : {}
      if (cmd.type === 'entity_get_parent_id') {
        const block = [...state.artifactGraph.values()].find(
          (item) => item.type === 'sketchBlock'
        )
        return {
          success: true,
          resp: {
            type: 'modeling',
            data: {
              modeling_response: {
                type: cmd.type,
                data: {
                  entity_id:
                    block?.type === 'sketchBlock' ? block.pathId : undefined,
                },
              },
            },
          },
        }
      }
      return {
        success: true,
        resp: {
          type: 'modeling',
          data: { modeling_response: { type: cmd.type, data } },
        },
      }
    }
  )
  Object.assign(view.resource.runtime, {
    openSketch: async () =>
      createSketchRuntime(
        native,
        (work) => work(),
        () => configuration,
        () => {},
        () => {}
      ),
  })
  view.context.wasm = Promise.resolve(wasm)
  view.context.interactions = createModelingInteractions(
    () => view.context,
    signal([createSketchInteraction(signal([circleSketchTool]))])
  )
  cleanup.push(async () => {
    await view.context.interactions.close()
    view.dispose()
    native.free()
  })
  return {
    ...view,
    inputCallbacks,
    native,
    selection,
    pick: async (reference: EntityReference) => {
      picked = reference
      await selection.pick({ clientX: 0, clientY: 0 })
    },
  }
}
it.each(['before', 'after'] as const)(
  'starts on a default plane selected %s clicking Start Sketch',
  async (when) => {
    const view = await fixture()
    if (when === 'before') await view.pick({ type: 'plane', plane_id: 'xy' })
    render(<ModelingToolbar context={view.context} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Sketch' }))
    })
    if (when === 'after') {
      expect(
        await screen.findByText('Select a plane, planar face, or sketch')
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Extrude' })
      ).not.toBeInTheDocument()
      await act(async () => {
        await view.pick({ type: 'plane', plane_id: 'xy' })
      })
    }
    await screen.findByRole('button', { name: 'Circle' })
    expect(view.editor.contents.peek()).toContain('sketch(on = XY)')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exit Sketch' }))
    })
    expect(
      await screen.findByRole('button', { name: 'Extrude' })
    ).toBeInTheDocument()
  }
)
it('cancels target picking without changing the document or view selection', async () => {
  const view = await fixture()
  const before = view.editor.contents.peek()
  await view.context.interactions.enter('kcl.sketch.start')
  expect(view.context.interactions.active.peek()?.prompt.peek()).toBe(
    'Select a plane, planar face, or sketch'
  )
  await view.context.interactions.close()
  expect(view.editor.contents.peek()).toBe(before)
  expect(view.selection.dialogOpen.peek()).toBe(false)
  expect(view.selection.selected.peek()).toEqual([])
})

it.each(['before', 'after'] as const)(
  'adapts the single sketch button to a sketch selected %s opening',
  async (when) => {
    const code =
      '@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n c = circle(start = [10mm, 0mm], center = [0mm, 0mm])\n radius(c) == 10mm\n}'
    const view = await fixture(code)
    if (when === 'before')
      await view.pick({ type: 'region', region_id: 'region' })
    render(<ModelingToolbar context={view.context} />)
    expect(
      screen.getAllByRole('button', { name: /^(Start|Edit) Sketch$/ })
    ).toHaveLength(1)
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', {
          name: when === 'before' ? 'Edit Sketch' : 'Start Sketch',
        })
      )
    )
    if (when === 'after')
      await view.pick({ type: 'region', region_id: 'region' })
    await vi.waitFor(() =>
      expect(
        view.context.interactions.active
          .peek()
          ?.toolbar.peek()
          .some((item) => item.title === 'Circle')
      ).toBe(true)
    )
    expect(view.editor.contents.peek()).toBe(code)
  }
)

it('commits two-click circles and drops an unfinished circle on Escape', async () => {
  const view = await fixture()
  await view.pick({ type: 'plane', plane_id: 'xy' })
  await view.context.interactions.enter('kcl.sketch.start')
  await vi.waitFor(() =>
    expect(
      view.context.interactions.active
        .peek()
        ?.toolbar.peek()
        .some((item) => item.title === 'Circle')
    ).toBe(true)
  )
  const session = view.context.interactions.active.peek()!
  session.toolbar
    .peek()
    .find((item) => item.title === 'Circle')!
    .onClick({ metaKey: false, ctrlKey: false })
  await vi.waitFor(() =>
    expect(
      session.toolbar.peek().find((item) => item.title === 'Circle')?.isActive
    ).toBe(true)
  )
  const click = async (x: number, y: number) =>
    view.inputCallbacks.onClick!({
      mouseEvent: new MouseEvent('click', { button: 0, shiftKey: true }),
      intersectionPoint: {
        twoD: new Vector2(x, y),
        threeD: new Vector3(x, y, 0),
      },
      intersects: [],
      wasmInstance: wasm,
    })
  const before = view.editor.contents.peek()
  await click(0, 0)
  expect(view.editor.contents.peek()).toBe(before)
  await click(10, 0)
  expect(view.editor.contents.peek()).toContain('circle(')
  const committed = view.editor.contents.peek()
  await click(20, 20)
  await session.escape()
  expect(view.editor.contents.peek()).toBe(committed)
  expect(session.prompt.peek()).toBe('Sketch editing')
  view.editor.undo()
  await vi.waitFor(() =>
    expect(view.context.interactions.active.peek()).toBeUndefined()
  )
  expect(view.editor.contents.peek()).not.toContain('circle(')
})

it('uses the local sketch camera path while keeping the same picking and native session', async () => {
  const view = await fixture(undefined, 'local')
  await view.context.interactions.enter('kcl.sketch.start')
  await view.pick({ type: 'plane', plane_id: 'xy' })
  await vi.waitFor(() =>
    expect(
      view.context.interactions.active
        .peek()
        ?.toolbar.peek()
        .some((item) => item.title === 'Circle')
    ).toBe(true)
  )
  expect(view.editor.contents.peek()).toContain('sketch(on = XY)')
  await view.context.interactions.close()
  expect(view.selection.dialogOpen.peek()).toBe(false)
})

it.each(['local', 'streamed'] as const)(
  'restores the configured orthographic projection after leaving a %s sketch',
  async (presentation) => {
    const view = await fixture(undefined, presentation)
    view.resource.preferences.camera.value = {
      cameraProjection: 'orthographic',
    }
    await view.pick({ type: 'plane', plane_id: 'xy' })
    await view.context.interactions.enter('kcl.sketch.start')
    await vi.waitFor(() =>
      expect(view.editor.contents.peek()).toContain('sketch(on = XY)')
    )
    const camera = view.context.session.resource.peek()!.sceneInfra.camControls
    const setCameraProjection = vi.spyOn(camera, 'setCameraProjection')
    await view.context.interactions.close()
    expect(setCameraProjection).toHaveBeenCalledWith('orthographic')
  }
)

it.each([
  { presentation: 'streamed' as const, external: true },
  { presentation: 'local' as const, external: true },
  { presentation: 'streamed' as const, external: false },
  { presentation: 'local' as const, external: false },
])(
  'settles pending Circle commits in $presentation mode while preserving external edits: $external',
  async ({ presentation, external }) => {
    const view = await fixture(undefined, presentation)
    await view.pick({ type: 'plane', plane_id: 'xy' })
    await view.context.interactions.enter('kcl.sketch.start')
    await vi.waitFor(() =>
      expect(
        view.context.interactions.active
          .peek()
          ?.toolbar.peek()
          .some((item) => item.title === 'Circle')
      ).toBe(true)
    )
    const session = view.context.interactions.active.peek()!
    session.toolbar
      .peek()
      .find((item) => item.title === 'Circle')!
      .onClick({ metaKey: false, ctrlKey: false })
    await vi.waitFor(() =>
      expect(
        session.toolbar.peek().find((item) => item.title === 'Circle')?.isActive
      ).toBe(true)
    )
    const click = (x: number, y: number) =>
      view.inputCallbacks.onClick!({
        mouseEvent: new MouseEvent('click', { button: 0, shiftKey: true }),
        intersectionPoint: {
          twoD: new Vector2(x, y),
          threeD: new Vector3(x, y, 0),
        },
        intersects: [],
        wasmInstance: wasm,
      })
    await click(0, 0)
    const gate = Promise.withResolvers<undefined>()
    const original = view.native.edit_segments.bind(view.native)
    const editing = vi
      .spyOn(view.native, 'edit_segments')
      .mockImplementationOnce(async (...args) => {
        await gate.promise
        return original(...args)
      })
    const pending = click(10, 0)
    await vi.waitFor(() => expect(editing).toHaveBeenCalled())
    let closing: Promise<void> | undefined
    if (external) {
      view.editor.dispatch({
        changes: { from: 0, insert: '// External edit\n' },
      })
      await vi.waitFor(() =>
        expect(view.context.interactions.active.peek()).toBeUndefined()
      )
    } else closing = view.context.interactions.close()
    gate.resolve(undefined)
    await pending
    await closing
    await view.context.interactions.close()
    if (external) {
      expect(view.editor.contents.peek()).toContain('// External edit')
      expect(view.editor.contents.peek()).not.toContain('circle(')
    } else expect(view.editor.contents.peek()).toContain('circle(')
  }
)

async function movingFixture(
  code: string,
  presentation: 'streamed' | 'local' = 'streamed'
) {
  const view = await fixture(code, presentation)
  const entering = vi.spyOn(view.native, 'edit_sketch')
  await view.pick({ type: 'region', region_id: 'region' })
  await view.context.interactions.enter('kcl.sketch.start')
  await vi.waitFor(() =>
    expect(
      view.context.interactions.active
        .peek()
        ?.toolbar.peek()
        .some((item) => item.title === 'Circle')
    ).toBe(true)
  )
  const initial: EditSketchOutcome = await entering.mock.results[0].value
  const edit = vi.spyOn(view.native, 'edit_segments')
  let pointer = new Vector2()
  const scene = view.context.session.resource.peek()
  if (!scene) throw new Error('Scene is missing')
  Object.assign(scene.sceneInfra, {
    getPlaneIntersectPoint: () => ({
      twoD: pointer,
      threeD: new Vector3(pointer.x, pointer.y, 0),
    }),
  })
  const args = (point: readonly [number, number], type = 'mousemove') => ({
    selected: new Group(),
    mouseEvent: new MouseEvent(type, {
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      shiftKey: true,
    }),
    intersectionPoint: {
      twoD: new Vector2(...point),
      threeD: new Vector3(...point, 0),
    },
    intersects: [],
  })
  const target = (point: readonly [number, number]) => {
    pointer = new Vector2(...point)
    return view.inputCallbacks.onMouseDownSelection?.()
  }
  const start = async (point: readonly [number, number]) => {
    expect(target(point)).toBe(true)
    await view.inputCallbacks.onDragStart?.(args(point, 'mousedown'))
  }
  const preview = (point: readonly [number, number]) =>
    view.inputCallbacks.onDrag?.(args(point))
  const finish = (point: readonly [number, number]) =>
    view.inputCallbacks.onDragEnd?.(args(point, 'mouseup'))
  const click = (point: readonly [number, number]) =>
    view.inputCallbacks.onClick?.({
      ...args(point, 'click'),
      wasmInstance: wasm,
    })
  const lastDelta = async () => {
    const last = edit.mock.results.at(-1)
    if (!last) throw new Error('No native edit was made')
    const result: SketchMutationOutcome = await last.value
    return result.sceneGraphDelta
  }
  return {
    ...view,
    initial,
    edit,
    start,
    preview,
    finish,
    click,
    lastDelta,
    target,
  }
}

it.each(['streamed', 'local'] as const)(
  'previews and commits an existing line endpoint in %s mode as one undoable change',
  async (presentation) => {
    const code =
      '@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n l = line(start = [var 10mm, var 10mm], end = [var 40mm, var 10mm])\n}'
    const view = await movingFixture(code, presentation)
    const before = view.editor.contents.peek()
    await view.start([10, 10])
    await view.preview([15, 20])
    expect(view.editor.contents.peek()).toBe(before)
    await view.finish([15, 20])
    const objects = (await view.lastDelta()).new_graph.objects
    expect(
      objects.filter(isPointSegment).map((obj) => pointToCoords2d(obj))
    ).toEqual(
      expect.arrayContaining([
        [15, 20],
        [40, 10],
      ])
    )
    expect(view.editor.contents.peek()).not.toBe(before)
    view.editor.undo()
    expect(view.editor.contents.peek()).toBe(before)
  }
)
it.each([
  {
    name: 'line',
    source:
      'l = line(start = [var 10mm, var 10mm], end = [var 50mm, var 10mm])',
    from: [30, 10],
    to: [35, 20],
    expected: [
      [15, 20],
      [55, 20],
    ],
  },
  {
    name: 'circle',
    source:
      'c = circle(center = [var 100mm, var 100mm], start = [var 120mm, var 100mm])\n radius(c) == 20mm',
    from: [100, 120],
    to: [110, 125],
    expected: [
      [110, 105],
      [130, 105],
    ],
  },
  {
    name: 'arc',
    source:
      'a = arc(center = [var 100mm, var 100mm], start = [var 120mm, var 100mm], end = [var 100mm, var 120mm])',
    from: [114.1421356, 114.1421356],
    to: [119.1421356, 119.1421356],
    expected: [
      [105, 105],
      [125, 105],
      [105, 125],
    ],
  },
] satisfies {
  name: string
  source: string
  from: [number, number]
  to: [number, number]
  expected: [number, number][]
}[])(
  'translates an existing $name using the legacy drag anchors',
  async ({ source, from, to, expected }) => {
    const view = await movingFixture(
      `@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n ${source}\n}`
    )
    await view.start(from)
    await view.preview(to)
    await view.finish(to)
    const points = (await view.lastDelta()).new_graph.objects
      .filter(isPointSegment)
      .map((obj) => pointToCoords2d(obj))
    expect(points).toEqual(
      expect.arrayContaining(
        expected.map(([x, y]) => [expect.closeTo(x, 2), expect.closeTo(y, 2)])
      )
    )
  }
)
it('drags a multi-selection together without publishing preview source', async () => {
  const view = await movingFixture(
    '@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n a = line(start = [var 10mm, var 10mm], end = [var 50mm, var 10mm])\n b = line(start = [var 10mm, var 40mm], end = [var 50mm, var 40mm])\n}'
  )
  await view.click([30, 10])
  await view.click([30, 40])
  const before = view.editor.contents.peek()
  await view.start([30, 10])
  await view.preview([35, 20])
  expect(view.editor.contents.peek()).toBe(before)
  await view.finish([35, 20])
  const points = (await view.lastDelta()).new_graph.objects
    .filter(isPointSegment)
    .map((obj) => pointToCoords2d(obj))
  expect(points).toEqual(
    expect.arrayContaining([
      [expect.closeTo(15, 2), expect.closeTo(20, 2)],
      [expect.closeTo(55, 2), expect.closeTo(20, 2)],
      [expect.closeTo(15, 2), expect.closeTo(50, 2)],
      [expect.closeTo(55, 2), expect.closeTo(50, 2)],
    ])
  )
})

it.each(['cancel', 'escape', 'external edit'] as const)(
  'settles a pending drag preview safely on %s',
  async (action: 'release' | 'cancel' | 'escape' | 'external edit') => {
    const view = await movingFixture(
      '@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n l = line(start = [var 10mm, var 10mm], end = [var 40mm, var 10mm])\n}'
    )
    const before = view.editor.contents.peek()
    await view.start([10, 10])
    const gate = Promise.withResolvers<undefined>()
    const original = view.native.edit_segments.bind(view.native)
    view.edit.mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
    const preview = view.preview([15, 20])
    await vi.waitFor(() => expect(view.edit).toHaveBeenCalled())
    const restore = vi.spyOn(view.native, 'restore_sketch_checkpoint')
    let complete: Promise<unknown> | undefined
    if (action === 'release') complete = Promise.resolve(view.finish([15, 20]))
    else if (action === 'escape')
      complete = view.context.interactions.active.peek()?.escape()
    else if (action === 'external edit')
      view.editor.dispatch({
        changes: { from: 0, insert: '// External edit\n' },
      })
    else complete = view.context.interactions.close()
    gate.resolve(undefined)
    await preview
    await complete
    if (action === 'release') {
      const points = (await view.lastDelta()).new_graph.objects
        .filter(isPointSegment)
        .map((obj) => pointToCoords2d(obj))
      expect(points).toEqual(
        expect.arrayContaining([
          [15, 20],
          [40, 10],
        ])
      )
      expect(view.editor.contents.peek()).not.toBe(before)
    } else {
      if (action === 'escape')
        expect(view.context.interactions.active.peek()).toBeDefined()
      else await view.context.interactions.close()
      expect(view.editor.contents.peek()).toBe(
        action === 'external edit' ? '// External edit\n' + before : before
      )
      expect(restore).toHaveBeenCalledOnce()
    }
  }
)
it('does not drag a point constrained to the sketch origin', async () => {
  const view = await movingFixture(
    '@settings(kclVersion = 3.0)\nprofile = sketch(on = XY) {\n l = line(start = [var 0mm, var 0mm], end = [var 40mm, var 0mm])\n coincident([l.start, ORIGIN])\n}'
  )
  expect(view.target([0, 0])).toBe(false)
  expect(view.edit).not.toHaveBeenCalled()
})

it('preserves tangency to a fixed line when dragging an arc center', async () => {
  const view = await movingFixture(
    '@settings(kclVersion = 3.0, experimentalFeatures = allow)\nprofile = sketch(on = XY) {\n l = line(start = [var 80mm, var 80mm], end = [var 120mm, var 80mm])\n fixed([l.start, [80mm, 80mm]])\n fixed([l.end, [120mm, 80mm]])\n a = arc(center = [var 100mm, var 100mm], start = [var 80mm, var 100mm], end = [var 120mm, var 100mm])\n radius(a) == 20mm\n tangent([l, a])\n}'
  )
  await view.start([100, 100])
  await view.preview([110, 100])
  await view.finish([110, 100])
  const delta = await view.lastDelta()
  expect(getSketchSolveBlockingIssues(delta)).toEqual([])
  const arc = delta.new_graph.objects.find(
    (obj) => obj.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
  )
  if (arc?.kind.type !== 'Segment' || arc.kind.segment.type !== 'Arc')
    throw new Error('Arc is missing')
  const center = delta.new_graph.objects[arc.kind.segment.center]
  if (!isPointSegment(center)) throw new Error('Arc center is missing')
  expect(pointToCoords2d(center)).toEqual([
    expect.closeTo(110, 2),
    expect.closeTo(100, 2),
  ])
  const points = delta.new_graph.objects
    .filter(isPointSegment)
    .map((obj) => pointToCoords2d(obj))
  expect(points).toEqual(
    expect.arrayContaining([
      [80, 80],
      [120, 80],
    ])
  )
})

it('keeps dragged coordinates in the inch file unit rather than converting them a second time', async () => {
  const view = await movingFixture(
    '@settings(kclVersion = 3.0, defaultLengthUnit = in)\nprofile = sketch(on = XY) {\n l = line(start = [var 1in, var 1in], end = [var 3in, var 1in])\n}'
  )
  await view.start([1, 1])
  await view.preview([2, 2])
  await view.finish([2, 2])
  const points = (await view.lastDelta()).new_graph.objects
    .filter(isPointSegment)
    .map((obj) => pointToCoords2d(obj))
  expect(points).toEqual(
    expect.arrayContaining([
      [expect.closeTo(2, 2), expect.closeTo(2, 2)],
      [expect.closeTo(3, 2), expect.closeTo(1, 2)],
    ])
  )
  expect(view.edit.mock.calls[0][2]).toContain('"units":"Inch"')
})
