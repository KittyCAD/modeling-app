import { describe, expect, it, vi } from 'vitest'
import {
  createActor,
  createMachine,
  assign,
  fromPromise,
  waitFor,
} from 'xstate'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import { Themes } from '@src/lib/theme'
import { machine as splineTool } from '@src/machines/sketchSolve/tools/splineTool'
import {
  createControlPointSplineApiObject,
  createMockKclManager,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createLeftMouseEvent(detail = 1): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail,
    shiftKey: true,
  })
  Object.defineProperty(event, 'which', { value: 1 })
  return event
}

function createSketchApiObject(id: number) {
  return {
    id,
    kind: {
      type: 'Sketch' as const,
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple' as const, range: [0, 0, 0], node_path: null },
  }
}

function createToolHarness(toolMachine = splineTool) {
  const scene = new Group()
  const sketchSolveGroup = new Group()
  sketchSolveGroup.name = SKETCH_SOLVE_GROUP
  scene.add(sketchSolveGroup)

  let callbacks: Record<string, any> = {}
  const sceneInfra = {
    scene,
    setCallbacks: vi.fn((nextCallbacks) => {
      callbacks = nextCallbacks as Record<string, any>
    }),
    getClientSceneScaleFactor: vi.fn(() => 1),
    theme: Themes.Light,
  } as any

  const parentMachine = createMachine({
    types: {} as {
      context: {
        sketchExecOutcome: {
          sourceDelta: SourceDelta
          sceneGraphDelta: SceneGraphDelta
        }
        draftEntities?: { segmentIds: number[]; constraintIds: number[] }
      }
      events:
        | {
            type: 'update sketch outcome'
            data: {
              sourceDelta: SourceDelta
              sceneGraphDelta: SceneGraphDelta
            }
          }
        | {
            type: 'set draft entities'
            data: { segmentIds: number[]; constraintIds: number[] }
          }
        | { type: 'clear draft entities' }
    },
    context: {
      sketchExecOutcome: {
        sourceDelta: { text: '' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([
          createSketchApiObject(0),
        ] as any),
      },
      draftEntities: undefined,
    },
    invoke: {
      id: 'tool',
      src: toolMachine,
      input: {
        sceneInfra,
        rustContext: createMockRustContext(),
        kclManager: createMockKclManager(),
        sketchId: 0,
      },
    },
    on: {
      'update sketch outcome': {
        actions: assign({
          sketchExecOutcome: ({ event }) => ({
            sourceDelta: event.data.sourceDelta,
            sceneGraphDelta: event.data.sceneGraphDelta,
          }),
        }),
      },
      'set draft entities': {
        actions: assign({
          draftEntities: ({ event }) => event.data,
        }),
      },
      'clear draft entities': {
        actions: assign({
          draftEntities: undefined,
        }),
      },
    },
  })

  const actor = createActor(parentMachine).start()

  return {
    actor,
    sceneInfra,
    sketchSolveGroup,
    getDraftEntities: () => actor.getSnapshot().context.draftEntities,
    getCallbacks: () => callbacks,
  }
}

function createSplineSceneGraphDelta({
  pointIds = [1, 2, 3],
  splineId = 4,
}: {
  pointIds?: [number, number, number] | [number, number, number, number]
  splineId?: number
}) {
  const points = pointIds.map((id, index) =>
    createPointApiObject({ id, x: index * 10, y: index * 5 })
  )
  const spline = createControlPointSplineApiObject({
    id: splineId,
    controls: pointIds as number[],
  })
  return createSceneGraphDelta(
    [createSketchApiObject(0) as any, ...points, spline],
    [0, ...pointIds, splineId]
  )
}

describe('splineTool', () => {
  it('keeps the first phase purely visual until the first move after the second click', async () => {
    const createInitialSpline = vi.fn(async ({ input }: any) => ({
      kclSource: { text: 'test' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
      splineId: 4,
      draftPointId: 3,
      newlyAddedEntities: {
        segmentIds: [1, 2, 3, 4],
        constraintIds: [],
      },
    }))

    const toolMachine = splineTool.provide({
      actors: {
        createInitialSpline: fromPromise(createInitialSpline as any) as any,
      },
    })
    const { actor, sketchSolveGroup, getCallbacks } =
      createToolHarness(toolMachine)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 20 } },
    })

    expect(createInitialSpline).not.toHaveBeenCalled()

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 30, y: 40 } },
    })

    expect(createInitialSpline).not.toHaveBeenCalled()
    expect(
      sketchSolveGroup.getObjectByName('spline-tool-preview')
    ).toBeInstanceOf(Line2)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 25, y: 35 } },
    })

    expect(createInitialSpline).not.toHaveBeenCalled()

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 50, y: 60 } },
    })

    await waitFor(actor, () => createInitialSpline.mock.calls.length === 1)
    const createInput = (createInitialSpline.mock.calls as any)[0]?.[0]?.input
    expect(createInput).toBeDefined()

    expect(createInput?.points).toEqual([
      [10, 20],
      [25, 35],
      [50, 60],
    ])

    actor.stop()
  })

  it('reuses a single ephemeral preview line before the spline exists', () => {
    const { actor, sketchSolveGroup, getCallbacks } = createToolHarness()

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 20 } },
    })

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 30, y: 40 } },
    })
    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 35, y: 45 } },
    })
    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 40, y: 50 } },
    })

    const previewLines = sketchSolveGroup.children.filter(
      (child) => child.name === 'spline-tool-preview'
    )
    expect(previewLines).toHaveLength(1)

    actor.stop()
  })

  it('cleans up the first-click preview line when escape cancels before spline creation', async () => {
    const { actor, sketchSolveGroup, getCallbacks } = createToolHarness()

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 20 } },
    })

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 30, y: 40 } },
    })

    expect(
      sketchSolveGroup.getObjectByName('spline-tool-preview')
    ).toBeInstanceOf(Line2)
    ;(actor as any).getSnapshot().children.tool.send({ type: 'escape' })

    await waitFor(
      actor,
      () =>
        sketchSolveGroup.getObjectByName('spline-tool-preview') === undefined
    )

    actor.stop()
  })

  it('appends a new draft control point only after the next move following a commit click', async () => {
    const createInitialSpline = vi.fn(async () => ({
      kclSource: { text: 'initial' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
      splineId: 4,
      draftPointId: 3,
      newlyAddedEntities: {
        segmentIds: [1, 2, 3, 4],
        constraintIds: [],
      },
    }))
    const finalizeDraftPoint = vi.fn(async () => ({
      kclSource: { text: 'finalized' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
    }))
    const appendDraftPoint = vi.fn(async () => ({
      kclSource: { text: 'appended' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3, 5] }),
      draftPointId: 5,
      newlyAddedEntities: {
        segmentIds: [5],
        constraintIds: [],
      },
    }))

    const toolMachine = splineTool.provide({
      actors: {
        createInitialSpline: fromPromise(createInitialSpline as any) as any,
        finalizeDraftPoint: fromPromise(finalizeDraftPoint as any) as any,
        appendDraftPoint: fromPromise(appendDraftPoint as any) as any,
      },
    })
    const { actor, getCallbacks } = createToolHarness(toolMachine)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 0, y: 0 } },
    })
    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 0 } },
    })
    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })

    await waitFor(actor, () => createInitialSpline.mock.calls.length === 1)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })

    await waitFor(actor, () => finalizeDraftPoint.mock.calls.length === 1)
    expect(appendDraftPoint).not.toHaveBeenCalled()

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 40, y: 30 } },
    })

    await waitFor(actor, () => appendDraftPoint.mock.calls.length === 1)
    const appendInput = (appendDraftPoint.mock.calls as any)[0]?.[0]?.input
    expect(appendInput).toBeDefined()
    expect(appendInput?.points).toEqual([
      [0, 0],
      [10, 5],
      [20, 10],
    ])
    expect(appendInput?.draftPoint).toEqual([40, 30])

    actor.stop()
  })

  it('keeps appending even when the rebuilt spline points shift during solving', async () => {
    const createInitialSpline = vi.fn(async () => ({
      kclSource: { text: 'initial' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
      splineId: 4,
      draftPointId: 3,
      newlyAddedEntities: {
        segmentIds: [1, 2, 3, 4],
        constraintIds: [],
      },
    }))
    const finalizeDraftPoint = vi.fn(async () => ({
      kclSource: { text: 'finalized' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
    }))
    const appendDraftPoint = vi.fn(async () => {
      const p1 = createPointApiObject({ id: 10, x: 0.2, y: -0.1, owner: 20 })
      const p2 = createPointApiObject({ id: 11, x: 9.7, y: 4.9, owner: 20 })
      const p3 = createPointApiObject({ id: 12, x: 19.8, y: 10.4, owner: 20 })
      const p4 = createPointApiObject({ id: 13, x: 39.6, y: 30.2, owner: 20 })
      const spline = createControlPointSplineApiObject({
        id: 20,
        controls: [10, 11, 12, 13],
      })
      return {
        kclSource: { text: 'appended' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta(
          [createSketchApiObject(0) as any, p1, p2, p3, p4, spline],
          [10, 11, 12, 13, 20]
        ),
        newlyAddedEntities: {
          segmentIds: [10, 11, 12, 13, 20],
          constraintIds: [],
        },
      }
    })

    const toolMachine = splineTool.provide({
      actors: {
        createInitialSpline: fromPromise(createInitialSpline as any) as any,
        finalizeDraftPoint: fromPromise(finalizeDraftPoint as any) as any,
        appendDraftPoint: fromPromise(appendDraftPoint as any) as any,
      },
    })
    const { actor, getCallbacks } = createToolHarness(toolMachine)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 0, y: 0 } },
    })
    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 0 } },
    })
    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })
    await waitFor(actor, () => createInitialSpline.mock.calls.length === 1)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })
    await waitFor(actor, () => finalizeDraftPoint.mock.calls.length === 1)

    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 40, y: 30 } },
    })

    await waitFor(actor, () => appendDraftPoint.mock.calls.length === 1)
    await waitFor(
      actor,
      () =>
        (actor as any).getSnapshot().children.tool?.getSnapshot()?.value ===
        'Animating draft point'
    )

    actor.stop()
  })

  it('keeps the spline draft-active until escape ends the current spline', async () => {
    const createInitialSpline = vi.fn(async () => ({
      kclSource: { text: 'initial' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
      splineId: 4,
      draftPointId: 3,
      newlyAddedEntities: {
        segmentIds: [1, 2, 3, 4],
        constraintIds: [],
      },
    }))
    const finalizeDraftPoint = vi.fn(async () => ({
      kclSource: { text: 'finalized' } as SourceDelta,
      sceneGraphDelta: createSplineSceneGraphDelta({ pointIds: [1, 2, 3] }),
    }))

    const toolMachine = splineTool.provide({
      actors: {
        createInitialSpline: fromPromise(createInitialSpline as any) as any,
        finalizeDraftPoint: fromPromise(finalizeDraftPoint as any) as any,
      },
    })
    const { actor, getCallbacks, getDraftEntities } =
      createToolHarness(toolMachine)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 0, y: 0 } },
    })
    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 10, y: 0 } },
    })
    getCallbacks().onMove({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })

    await waitFor(actor, () => createInitialSpline.mock.calls.length === 1)
    expect(getDraftEntities()?.segmentIds.length).toBeGreaterThan(0)

    getCallbacks().onClick({
      mouseEvent: createLeftMouseEvent(),
      intersectionPoint: { twoD: { x: 20, y: 10 } },
    })
    await waitFor(actor, () => finalizeDraftPoint.mock.calls.length === 1)
    expect(getDraftEntities()?.segmentIds.length).toBeGreaterThan(0)
    ;(actor as any).getSnapshot().children.tool.send({ type: 'escape' })
    await waitFor(
      actor,
      () =>
        (actor as any).getSnapshot().children.tool?.getSnapshot()?.value ===
        'ready for first point click'
    )
    expect(getDraftEntities()).toBeUndefined()
    expect((actor as any).getSnapshot().children.tool).toBeTruthy()

    actor.stop()
  })
})
