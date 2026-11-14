import { expect, it } from 'vitest'
import fc from 'fast-check'
import { Vector2, Vector3 } from 'three'
import {
  createSketchClickCallback,
  getClosestSelectionTarget,
} from '@src/machines/sketchSolve/interaction/selection'
import {
  createMockSceneInfra,
  createPointApiObject,
  createLineApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  updateSketchSelection,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'

it('uses the same point, line, and origin priorities for hover and click selection', async () => {
  const infra = createMockSceneInfra()
  const objects = createSceneGraphDelta([
    createPointApiObject({ id: 1, x: 10, y: 10 }),
    createPointApiObject({ id: 2, x: 50, y: 10 }),
    createLineApiObject({ id: 3, start: 1, end: 2 }),
  ]).new_graph.objects
  let selected: SketchSolveSelectionId[] = []
  const click = createSketchClickCallback({
    sceneInfra: infra,
    getApiObjects: () => objects,
    onUpdateSelectedIds: (data) => {
      selected = updateSketchSelection(
        selected,
        data.selectedIds,
        {},
        data.replaceExistingSelection
      ).selectedIds
    },
  })
  const at = async (x: number, y: number) =>
    click({
      mouseEvent: new MouseEvent('click', { button: 0 }),
      intersectionPoint: {
        twoD: new Vector2(x, y),
        threeD: new Vector3(x, y, 0),
      },
      intersects: [],
    })
  expect(getClosestSelectionTarget([10, 10], objects, infra)?.selectionId).toBe(
    1
  )
  await at(10, 10)
  expect(selected).toEqual([1])
  await at(30, 10)
  expect(selected).toEqual([1, 3])
  await at(10, 10)
  expect(selected).toEqual([3])
  await at(0, 0)
  expect(selected).toEqual([3, 'origin'])
  await at(1000, 1000)
  expect(selected).toEqual([])
})
it('toggles one ID without dropping other selections or retaining coordinates for removed entities', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 0, max: 100 }), { minLength: 1 }),
      (ids) => {
        const first = ids[0]
        const selected = updateSketchSelection(ids, [first], {
          [first]: [10, 20],
        })
        expect(selected.selectedIds).toEqual(ids.slice(1))
        expect(selected.selectionCoordinates[first]).toBeUndefined()
        expect(
          updateSketchSelection(selected.selectedIds, [first], {}, true)
            .selectedIds
        ).toEqual([first])
        expect(updateSketchSelection(ids, []).selectedIds).toEqual([])
      }
    )
  )
})
