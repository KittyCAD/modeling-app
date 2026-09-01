import {
  getResponsiveToolbarHiddenItemIds,
  getResponsiveToolbarLayout,
} from '@src/lib/aiFirstCad/responsiveToolbar'
import { describe, expect, it } from 'vitest'

const entries = [
  { id: 'sketch', icon: 'sketch', showTitle: true },
  { id: 'extrude', icon: 'extrude' },
  { id: 'sweep', icon: 'sweep' },
  'break' as const,
  { id: 'fillet', icon: 'fillet' },
  { id: 'booleans', array: [{ icon: 'union' }] },
]

describe('getResponsiveToolbarHiddenItemIds', () => {
  it('keeps every toolbar item when they fit', () => {
    expect(getResponsiveToolbarHiddenItemIds(entries, 400)).toEqual([])
  })

  it('expands visible dropdown groups', () => {
    expect(getResponsiveToolbarLayout(entries, 400)).toEqual({
      expandedDropdownItemIds: ['booleans'],
      hiddenItemIds: [],
    })
  })

  it('keeps the leading command and moves the non-fitting tail to overflow', () => {
    expect(getResponsiveToolbarHiddenItemIds(entries, 180)).toEqual([
      'sweep',
      'fillet',
      'booleans',
    ])
  })

  it('moves an expanded group into the shared overflow when it stops fitting', () => {
    const groupedEntries = [
      { id: 'sketch', icon: 'sketch', showTitle: true },
      {
        id: 'booleans',
        array: [{ icon: 'union' }, { icon: 'subtract' }, { icon: 'intersect' }],
      },
    ]

    expect(getResponsiveToolbarLayout(groupedEntries, 185)).toEqual({
      expandedDropdownItemIds: [],
      hiddenItemIds: ['booleans'],
    })
  })
})
