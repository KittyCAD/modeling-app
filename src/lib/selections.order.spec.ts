import {
  getOrderedGraphAndPrimitiveSelections,
  reconcileSelectionOrder,
  removeEnginePrimitiveSelectionFromSelections,
  removeReferenceFromSelections,
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

  it('keeps ordinary single-collection selections unchanged', () => {
    const selection: Selections = {
      graphSelections: [graph('a')],
      otherSelections: [],
    }
    expect(reconcileSelectionOrder(empty, selection)).toBe(selection)
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

  it('retains primitive positions when graph selection pills are removed and reselected', () => {
    const selection = reconcileSelectionOrder(empty, {
      graphSelections: [
        { ...graph('a'), selectionOrder: 0 },
        { ...graph('c'), selectionOrder: 2 },
      ],
      otherSelections: [{ ...primitive('b'), selectionOrder: 1 }],
    })
    const removed = removeReferenceFromSelections(selection, {
      id: 'graph:a',
      label: 'Edge',
      code: 'edgeA',
      graphSelection: graph('a'),
    })
    const reselected = reconcileSelectionOrder(removed, {
      ...removed,
      graphSelections: [...removed.graphSelections, graph('a')],
    })
    expect(ids(reselected)).toEqual(['b', 'c', 'a'])
  })

  it('honors restored complete-selection ordinals and defines unranked fallback order', () => {
    const selection: Selections = {
      graphSelections: [{ ...graph('a'), selectionOrder: 2 }],
      otherSelections: [{ ...primitive('b'), selectionOrder: 0 }],
    }
    const previous: Selections = {
      graphSelections: [{ ...graph('a'), selectionOrder: 0 }],
      otherSelections: [{ ...primitive('b'), selectionOrder: 1 }],
    }
    expect(ids(reconcileSelectionOrder(previous, selection))).toEqual([
      'b',
      'a',
    ])
    expect(
      ids(
        reconcileSelectionOrder(empty, {
          graphSelections: [graph('a'), graph('c')],
          otherSelections: [primitive('b')],
        })
      )
    ).toEqual(['a', 'c', 'b'])
  })

  it('distinguishes engine entities sharing the same code range', () => {
    const previous = reconcileSelectionOrder(empty, {
      graphSelections: [graph('copy1')],
      otherSelections: [primitive('b')],
    })
    const next = reconcileSelectionOrder(previous, {
      ...previous,
      graphSelections: [...previous.graphSelections, graph('copy2')],
    })
    expect(ids(next)).toEqual(['copy1', 'b', 'copy2'])
  })
})
