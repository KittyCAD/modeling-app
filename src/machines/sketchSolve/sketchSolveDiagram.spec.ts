import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { KclManager } from '@src/lang/KclManager'
import { Themes } from '@src/lib/theme'
import { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { CHILD_TOOL_DONE_EVENT } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createMockRustContext,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Group } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

const startedActors: Array<{ stop: () => void }> = []

afterEach(() => {
  for (const actor of startedActors) {
    actor.stop()
  }
  startedActors.length = 0
  vi.restoreAllMocks()
})

function createSketchSolveHarness() {
  const scene = new Group()
  const sketchSolveGroup = new Group()
  sketchSolveGroup.name = SKETCH_SOLVE_GROUP
  scene.add(sketchSolveGroup)

  const sceneInfra = {
    scene,
    setCallbacks: vi.fn(),
    setOnBeforeRender: vi.fn(),
    getClientSceneScaleFactor: vi.fn(() => 1),
    getPlaneIntersectPoint: vi.fn(() => null),
    isAreaSelectActive: false,
    theme: Themes.Light,
  }
  const rustContext = createMockRustContext()
  const kclManager = {
    code: 'sketch001 = startSketchOn(XY)',
    editorView: {
      dispatch: vi.fn(),
    },
    fileSettings: {
      defaultLengthUnit: 'Mm',
    },
    sceneInfra,
    sceneEntitiesManager: {
      initSketchSolveEntityOrientation: vi.fn(),
    },
    rustContext,
    setHighlightRange: vi.fn(),
    setSketchSolveDiagnostics: vi.fn(),
    syncSketchSolveOutcome: vi.fn(),
    updateCodeEditor: vi.fn(),
    wasmInstancePromise: Promise.resolve({}),
    systemDeps: {
      settings: {},
    },
  }

  const actor = createActor(
    sketchSolveMachine.provide({
      actions: {
        'send tool equipped to parent': () => {},
        'send tool unequipped to parent': () => {},
      },
    }),
    {
      input: {
        kclManager: kclManager as unknown as KclManager,
        initialSketchSolvePlane: null,
        sketchId: 0,
        initialSceneGraphDelta: createSceneGraphDelta([]),
      },
    }
  ).start()
  startedActors.push(actor)

  return { actor }
}

describe('sketchSolveMachine selection clearing', () => {
  it('clears the selection when an equipped child tool completes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { actor } = createSketchSolveHarness()

    actor.send({ type: 'equip tool', data: { tool: 'dimensionTool' } })
    expect(actor.getSnapshot().matches('using tool')).toBe(true)

    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [10], duringAreaSelectIds: [11] },
    })
    expect(actor.getSnapshot().context.selectedIds).toEqual([10])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([11])

    actor.send({ type: CHILD_TOOL_DONE_EVENT })

    expect(actor.getSnapshot().matches('move and select')).toBe(true)
    expect(actor.getSnapshot().context.selectedIds).toEqual([])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })

  it('keeps the selection when the equipped child tool requests it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { actor } = createSketchSolveHarness()

    actor.send({
      type: 'equip tool',
      data: { tool: 'dimensionTool' },
      keepSelection: true,
    })
    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [10], duringAreaSelectIds: [11] },
    })

    actor.send({ type: CHILD_TOOL_DONE_EVENT })

    expect(actor.getSnapshot().matches('move and select')).toBe(true)
    expect(actor.getSnapshot().context.selectedIds).toEqual([10])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })

  it('clears the selection when constraint editing stops', () => {
    const { actor } = createSketchSolveHarness()

    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [12], duringAreaSelectIds: [13] },
    })
    actor.send({
      type: 'start editing constraint',
      data: { constraintId: 12 },
    })

    actor.send({ type: 'stop editing constraint' })

    expect(actor.getSnapshot().context.editingConstraintId).toBeUndefined()
    expect(actor.getSnapshot().context.selectedIds).toEqual([])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })
})
