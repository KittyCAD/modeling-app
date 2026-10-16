import {
  getOrderedGraphAndPrimitiveSelections,
  reconcileSelectionOrder,
  removeEnginePrimitiveSelectionFromSelections,
} from '@src/lib/selections'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

const empty: Selections = { graphSelections: [], otherSelections: [] }
const graph = (id: string): Selection => ({
  engineEntityId: id,
  entityRef: { type: 'solid2d_edge', edge_id: id },
  codeRef: { range: [1, 2, 0], pathToNode: [] },
})
const primitive = (id: string): EnginePrimitiveSelection => ({
  type: 'enginePrimitive',
  entityId: id,
  primitiveType: 'edge',
  primitiveIndex: 0,
})
const ids = (selections: Selections) =>
  getOrderedGraphAndPrimitiveSelections(selections).map((selection) =>
    'type' in selection ? selection.entityId : selection.engineEntityId
  )

describe('mixed selection order', () => {
  it('preserves both graph and primitive preselection when the other kind is appended', () => {
    const graphFirst = reconcileSelectionOrder(
      { graphSelections: [graph('a')], otherSelections: [] },
      { graphSelections: [graph('a')], otherSelections: [primitive('b')] }
    )
    expect(ids(graphFirst)).toEqual(['a', 'b'])
    const primitiveFirst = reconcileSelectionOrder(
      { graphSelections: [], otherSelections: [primitive('b')] },
      { graphSelections: [graph('a')], otherSelections: [primitive('b')] }
    )
    expect(ids(primitiveFirst)).toEqual(['b', 'a'])
  })

  it('keeps interleaved order through graph rebuilding and puts a reselected primitive last', () => {
    const first = reconcileSelectionOrder(
      { graphSelections: [graph('a')], otherSelections: [] },
      { graphSelections: [graph('a')], otherSelections: [primitive('b')] }
    )
    const second = reconcileSelectionOrder(first, {
      ...first,
      graphSelections: [...first.graphSelections, graph('c')],
    })
    expect(ids(second)).toEqual(['a', 'b', 'c'])
    const mirrored = reconcileSelectionOrder(second, {
      graphSelections: [graph('c'), graph('a')],
      otherSelections: second.otherSelections,
    })
    expect(ids(mirrored)).toEqual(['a', 'b', 'c'])
    const removed = removeEnginePrimitiveSelectionFromSelections(
      mirrored,
      primitive('b')
    )
    expect(ids(removed)).toEqual(['a', 'c'])
    const reselected = reconcileSelectionOrder(removed, {
      ...removed,
      otherSelections: [primitive('b')],
    })
    expect(ids(reselected)).toEqual(['a', 'c', 'b'])
  })

  it('matches rebuilt entity references without mutating their face order', () => {
    const referenceOnly: Selection = {
      entityRef: { type: 'edge', side_faces: ['front', 'back'] },
    }
    const mixed = reconcileSelectionOrder(empty, {
      graphSelections: [referenceOnly],
      otherSelections: [primitive('b')],
    })
    const rebuilt: Selection = {
      entityRef: { type: 'edge', side_faces: ['back', 'front'] },
    }
    const reconciled = reconcileSelectionOrder(mixed, {
      graphSelections: [graph('new'), rebuilt],
      otherSelections: mixed.otherSelections,
    })
    expect(
      getOrderedGraphAndPrimitiveSelections(reconciled).map((selection) =>
        'type' in selection
          ? selection.entityId
          : (selection.engineEntityId ?? selection.entityRef)
      )
    ).toEqual([rebuilt.entityRef, 'b', 'new'])
    expect(referenceOnly.entityRef).toEqual({
      type: 'edge',
      side_faces: ['front', 'back'],
    })
  })
})
