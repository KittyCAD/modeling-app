import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import { machine } from '@src/machines/sketchSolve/tools/filletToolDiagram'
import type { createFilletArcActor } from '@src/machines/sketchSolve/tools/filletToolImpl'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, setup, waitFor } from 'xstate'

type ParentEvent = {
  type: string
  data?: unknown
}

function createHarness({
  selectedIds = [],
  objects,
}: {
  selectedIds?: SketchSolveSelectionId[]
  objects: ApiObject[]
}) {
  const sceneInfra = createMockSceneInfra()
  const sceneGraphDelta = createSceneGraphDelta(objects)
  const actor = createActor(machine, {
    input: {
      sceneInfra,
      rustContext: createMockRustContext(),
      kclManager: createMockKclManager(),
      sketchId: 0,
      initialSelectionIds: selectedIds,
      initialObjects: sceneGraphDelta.new_graph.objects,
    },
  }).start()

  return {
    actor,
    sceneInfra,
  }
}

function createChoosingRadiusHarness() {
  const shared = createPointApiObject({ id: 1, x: 0, y: 0 })
  const lineAEnd = createPointApiObject({ id: 2, x: 10, y: 0 })
  const lineBEnd = createPointApiObject({ id: 3, x: 0, y: 10 })
  const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
  const lineB = createLineApiObject({ id: 11, start: 1, end: 3 })
  const initialObjects = createSceneGraphDelta([
    shared,
    lineAEnd,
    lineBEnd,
    lineA,
    lineB,
  ]).new_graph.objects
  const events: ParentEvent[] = []
  const mockCreateFilletArc: typeof createFilletArcActor = async () => ({
    kclSource: { text: 'create' },
    sceneGraphDelta: createSceneGraphDelta([]),
    draft: {
      arcId: 20,
      arcStartPointId: 21,
      arcEndPointId: 22,
      arcCenterPointId: 23,
      segmentIds: [20],
    },
  })
  const providedMachine = machine.provide({
    actors: {
      createFilletArc: fromPromise(mockCreateFilletArc),
    },
  })

  const parentMachine = setup({
    types: {
      context: {},
      events: {} as ParentEvent,
      input: {},
    },
    actors: {
      childTool: providedMachine,
    },
    actions: {
      'record event': ({ event }) => {
        events.push(event)
      },
    },
  }).createMachine({
    context: {},
    initial: 'running',
    on: {
      'clear draft entities': {
        actions: 'record event',
      },
      'delete draft entities': {
        actions: 'record event',
      },
      'set draft entities': {
        actions: 'record event',
      },
      'update hovered id': {
        actions: 'record event',
      },
      'update sketch outcome': {
        actions: 'record event',
      },
    },
    states: {
      running: {
        invoke: {
          id: 'childTool',
          src: 'childTool',
          input: {
            sceneInfra: createMockSceneInfra(),
            rustContext: createMockRustContext(),
            kclManager: createMockKclManager(),
            sketchId: 0,
            initialSelectionIds: [10, 11],
            initialObjects,
          },
        },
      },
    },
  })

  const actor = createActor(parentMachine, { input: {} }).start()
  const child = actor.getSnapshot().children.childTool
  if (!child) {
    throw new Error('Expected child tool actor to be spawned')
  }

  return {
    actor,
    child,
    events,
  }
}

describe('filletToolDiagram', () => {
  it('starts at the second selection step when one segment is preselected', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const { actor, sceneInfra } = createHarness({
      selectedIds: [10],
      objects: [start, end, line],
    })

    expect(actor.getSnapshot().value).toBe('ready for second segment')
    expect(actor.getSnapshot().context.firstSegmentId).toBe(10)
    expect(sceneInfra.setCallbacks).toHaveBeenCalledTimes(1)
    actor.stop()
  })

  it('ignores one preselected non-segment object', () => {
    const point = createPointApiObject({ id: 1, x: 0, y: 0 })
    const { actor, sceneInfra } = createHarness({
      selectedIds: [1],
      objects: [point],
    })

    expect(actor.getSnapshot().value).toBe('ready for first segment')
    expect(actor.getSnapshot().context.firstSegmentId).toBeUndefined()
    expect(sceneInfra.setCallbacks).toHaveBeenCalledTimes(1)
    actor.stop()
  })

  it('deletes the preview arc when escaping from the radius step', async () => {
    const { actor, child, events } = createChoosingRadiusHarness()
    await waitFor(child, (snapshot) => snapshot.matches('Choosing radius'))

    child.send({ type: 'escape' })

    const eventTypes = events.map((event) => event.type)
    expect(eventTypes).toContain('delete draft entities')
    expect(eventTypes).not.toContain('clear draft entities')
    actor.stop()
  })
})
