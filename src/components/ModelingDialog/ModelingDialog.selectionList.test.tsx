import { SelectionList } from '@kittycad/ui-components'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/selections', () => ({
  getSelectionTypeDisplayText: (_ast: unknown, selection: Selections) => {
    const graph = selection.graphSelections[0]
    return graph
      ? `Profile ${graph.codeRef.range[0]}`
      : `Profile ${selection.otherSelections[0]}`
  },
  canSubmitSelectionArg: vi.fn(),
  getSelectionCountByType: vi.fn(),
}))

import {
  getSelectionListItems,
  moveSelectionInSequence,
} from '@src/components/ModelingDialog/ModelingDialog.logic'

function graphSelection(offset: number): Selection {
  return { codeRef: { range: [offset, offset + 1, 0], pathToNode: [] } }
}

function OrderedSelections({ initial }: { initial: Selections }) {
  const [selection, setSelection] = useState(initial)
  return (
    <SelectionList
      items={getSelectionListItems({}, selection)}
      ordered
      onMove={(item, direction) => {
        const next = moveSelectionInSequence(
          selection,
          item.source,
          item.index,
          direction
        )
        if (next) setSelection(next)
      }}
    />
  )
}

describe('ordered selection row identity', () => {
  it.each([
    {
      name: 'graph selections',
      selection: {
        graphSelections: [0, 1, 2].map(graphSelection),
        otherSelections: [],
      } satisfies Selections,
      labels: ['Profile 0', 'Profile 1', 'Profile 2'],
    },
    {
      name: 'non-code selections',
      selection: {
        graphSelections: [],
        otherSelections: ['x-axis', 'y-axis', 'z-axis'],
      } satisfies Selections,
      labels: ['Profile x-axis', 'Profile y-axis', 'Profile z-axis'],
    },
  ])('keeps focus on the moved row in $name', ({ selection, labels }) => {
    render(<OrderedSelections initial={selection} />)
    const moveUp = screen.getByRole('button', {
      name: 'Move selection 3 up',
    })
    moveUp.focus()

    // Keyboard activation clicks the focused button. It must remain attached
    // to the moved selection so a second activation moves that same selection.
    fireEvent.click(moveUp)
    expect(moveUp).toHaveFocus()
    expect(moveUp).toHaveAccessibleName('Move selection 2 up')
    expect(
      screen
        .getAllByRole('listitem')
        .map((row) => within(row).getByText(/^Profile /).textContent)
    ).toEqual([labels[0], labels[2], labels[1]])

    fireEvent.click(moveUp)
    expect(
      screen
        .getAllByRole('listitem')
        .map((row) => within(row).getByText(/^Profile /).textContent)
    ).toEqual([labels[2], labels[0], labels[1]])
  })

  it('keeps entity and pattern instances distinct despite shared code ranges', () => {
    const first = graphSelection(0)
    const selections: Selections = {
      graphSelections: [
        { ...first, engineEntityId: 'first' },
        { ...first, engineEntityId: 'second' },
        { ...first, engineEntityId: 'first', patternIndex: 1 },
        { ...first, engineEntityId: 'first', patternIndex: 2 },
      ],
      otherSelections: [],
    }
    const ids = getSelectionListItems({}, selections).map((item) => item.id)
    const reversed = structuredClone(selections)
    reversed.graphSelections.reverse()

    expect(new Set(ids).size).toBe(ids.length)
    expect(getSelectionListItems({}, reversed).map((item) => item.id)).toEqual(
      ids.toReversed()
    )
  })

  it('disambiguates repeated references without changing unrelated row IDs', () => {
    const repeated = graphSelection(0)
    const selections: Selections = {
      graphSelections: [repeated, graphSelection(1), structuredClone(repeated)],
      otherSelections: ['x-axis', 'y-axis', 'x-axis'],
    }
    const ids = getSelectionListItems({}, selections).map((item) => item.id)
    const reordered: Selections = {
      graphSelections: [
        selections.graphSelections[0],
        selections.graphSelections[2],
        selections.graphSelections[1],
      ],
      otherSelections: ['x-axis', 'x-axis', 'y-axis'],
    }

    expect(new Set(ids).size).toBe(6)
    expect(getSelectionListItems({}, reordered).map((item) => item.id)).toEqual(
      [ids[0], ids[2], ids[1], ids[3], ids[5], ids[4]]
    )
  })
})
