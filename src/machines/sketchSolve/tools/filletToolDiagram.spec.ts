import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import { machine } from '@src/machines/sketchSolve/tools/filletToolDiagram'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'

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
})
