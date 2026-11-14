import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createActor, setup, waitFor } from 'xstate'
import { Vector2, Vector3 } from 'three'
import { machine } from '@src/machines/sketchSolve/tools/circleToolDiagram'
import {
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
  createCircleApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'

let wasm: ModuleType
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.restoreAllMocks()
})
function fixture() {
  const sceneInfra = createMockSceneInfra(),
    rustContext = createMockRustContext(),
    kclManager = createMockKclManager()
  sceneInfra.resetMouseListeners = vi.fn()
  vi.spyOn(
    segmentUtilsMap.ArcSegment,
    'removePreviewCircle'
  ).mockImplementation(() => {})
  const delta = createSceneGraphDelta(
    [
      createPointApiObject({ id: 1 }),
      createPointApiObject({ id: 2, x: 10 }),
      createCircleApiObject({ id: 3, center: 1, start: 2 }),
    ],
    [1, 2, 3]
  )
  const add = vi.spyOn(rustContext, 'addSegment').mockResolvedValue({
    kclSource: { text: 'draft' },
    sceneGraphDelta: delta,
  })
  const edit = vi.spyOn(rustContext, 'editSegments').mockResolvedValue({
    kclSource: { text: 'committed' },
    sceneGraphDelta: delta,
    checkpointId: 42,
  })
  const remove = vi.spyOn(rustContext, 'deleteObjects').mockResolvedValue({
    kclSource: { text: 'removed' },
    sceneGraphDelta: createSceneGraphDelta([]),
  })
  const attach = vi.spyOn(sceneInfra, 'setCallbacks')
  const received = vi.fn<(event: SketchSolveMachineEvent) => void>()
  const parent = setup({
    actors: { circle: machine },
    types: {
      context: {} as { sketchExecOutcome: undefined; tool: ToolInput },
      input: {} as ToolInput,
      events: {} as SketchSolveMachineEvent,
    },
  }).createMachine({
    context: ({ input }) => ({ sketchExecOutcome: undefined, tool: input }),
    invoke: {
      id: 'circle',
      src: 'circle',
      input: ({ context }) => context.tool,
    },
    on: { '*': { actions: ({ event }) => received(event) } },
  })
  const actor = createActor(parent, {
    input: { sceneInfra, rustContext, kclManager, sketchId: 0 },
  }).start()
  cleanup.push(() => actor.stop())
  const child = actor.getSnapshot().children.circle
  if (!child) throw new Error('Circle was not invoked')
  const callbacks = attach.mock.calls.at(-1)?.[0]
  if (!callbacks?.onClick) throw new Error('Circle did not attach input')
  const click = async (x: number, y: number) =>
    callbacks.onClick?.({
      wasmInstance: wasm,
      mouseEvent: new MouseEvent('click', { button: 0, shiftKey: true }),
      intersectionPoint: {
        twoD: new Vector2(x, y),
        threeD: new Vector3(x, y, 0),
      },
      intersects: [],
    })
  return { child, add, edit, remove, received, click, callbacks, sceneInfra }
}
it('adapts scene clicks into a committed result and checkpoint for the legacy parent', async () => {
  const { child, add, remove, received, click } = fixture()
  await click(10, 20)
  await click(30, 20)
  expect(add).toHaveBeenCalledOnce()
  expect(received).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'update sketch outcome',
      data: expect.objectContaining({
        sourceDelta: { text: 'committed' },
        checkpointId: 42,
      }),
    })
  )
  child.send({ type: 'unequip' })
  await waitFor(child, (state) => state.status === 'done')
  expect(remove).not.toHaveBeenCalled()
})
it('removes an unfinished draft before acknowledging Escape to the legacy invoker', async () => {
  const { child, remove, received, click } = fixture()
  await click(10, 20)
  child.send({ type: 'escape' })
  await waitFor(child, (state) => state.status === 'done')
  expect(remove).toHaveBeenCalledWith(0, 0, [], [1, 2, 3], expect.anything())
  expect(received).toHaveBeenCalledWith({ type: 'clear draft entities' })
  expect(received).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'update sketch outcome',
      data: expect.objectContaining({
        sourceDelta: { text: 'removed' },
        writeToDisk: false,
      }),
    })
  )
})

it('shares radius-preview rendering and unpublished native preview outcomes with the legacy parent', async () => {
  const { child, callbacks, received, click, sceneInfra } = fixture()
  const visual = vi
    .spyOn(segmentUtilsMap.ArcSegment, 'updatePreviewCircle')
    .mockImplementation(() => {})
  await click(10, 20)
  await callbacks.onMove?.({
    mouseEvent: new MouseEvent('mousemove', { shiftKey: true }),
    intersectionPoint: {
      twoD: new Vector2(13, 24),
      threeD: new Vector3(13, 24, 0),
    },
    intersects: [],
  })
  expect(visual).toHaveBeenCalledWith({
    sceneInfra,
    center: [10, 20],
    radius: 5,
  })
  await vi.waitFor(() =>
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update sketch outcome',
        data: expect.objectContaining({
          sourceDelta: { text: 'committed' },
          writeToDisk: false,
        }),
      })
    )
  )
  child.send({ type: 'unequip' })
  await waitFor(child, (state) => state.status === 'done')
})
