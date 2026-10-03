import { createGdtToolbarItems } from '@src/lib/gdtToolbar'
import { describe, expect, it, vi } from 'vitest'

describe('GD&T toolbar', () => {
  it('opens every GD&T command using its existing modeling command identity', () => {
    const send = vi.fn()
    const items = createGdtToolbarItems({ send })

    expect(items.map(({ title }) => title)).toEqual([
      'Angularity',
      'Annotation',
      'Circularity',
      'Concentricity',
      'Cylindricity',
      'Datum',
      'Distance',
      'Flatness',
      'Note',
      'Parallelism',
      'Perpendicularity',
      'Position',
      'Profile',
      'Runout',
      'Straightness',
      'Symmetry',
    ])

    for (const item of items) {
      item.onClick()

      expect(send).toHaveBeenLastCalledWith({
        type: 'Find and select command',
        data: { name: `GDT ${item.title}`, groupId: 'modeling' },
      })
    }
  })
})
