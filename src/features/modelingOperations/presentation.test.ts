import { describe, expect, it } from 'vitest'
import type { OperationPresentation } from '@src/contracts/operationPresentation'
import {
  arrangeFields,
  emptyLayout,
  layoutFor,
} from '@src/features/modelingOperations/presentation'

const base: OperationPresentation = {
  operationId: 'modeling.extrude',
  groups: [
    { id: 'profile', title: 'Profile' },
    { id: 'advanced', title: 'More options', collapsible: true },
  ],
  fields: {
    sketches: { group: 'profile', emptyLabel: 'Click a sketch.' },
    length: { group: 'profile', order: 1 },
    twistAngle: { group: 'advanced' },
  },
}

describe('folding layout contributions', () => {
  it('has nothing to say about an operation nobody laid out', () => {
    expect(layoutFor([base], 'modeling.revolve')).toBe(emptyLayout)
  })

  it('merges field by field, so one addition does not restate a layout', () => {
    const extra: OperationPresentation = {
      operationId: 'modeling.extrude',
      fields: { length: { hint: 'Negative goes the other way.' } },
    }

    const layout = layoutFor([base, extra], 'modeling.extrude')

    expect(layout.fields.length).toEqual({
      group: 'profile',
      order: 1,
      hint: 'Negative goes the other way.',
    })
    // Untouched fields survive a contribution that never mentioned them.
    expect(layout.fields.sketches?.emptyLabel).toBe('Click a sketch.')
  })

  it('keeps a group where it was first declared, and lets the last word fill it in', () => {
    const described: OperationPresentation = {
      operationId: 'modeling.extrude',
      groups: [{ id: 'advanced', title: 'More options', defaultOpen: false }],
    }

    const layout = layoutFor([base, described], 'modeling.extrude')

    expect(layout.groups.map((group) => group.id)).toEqual([
      'profile',
      'advanced',
    ])
    expect(layout.groups[1]).toMatchObject({
      title: 'More options',
      collapsible: true,
      defaultOpen: false,
    })
  })
})

describe('arranging arguments into groups', () => {
  const layout = layoutFor([base], 'modeling.extrude')

  it('puts each argument in its group, groups in declared order', () => {
    expect(arrangeFields(layout, ['sketches', 'length', 'twistAngle'])).toEqual(
      [
        { group: layout.groups[0], names: ['sketches', 'length'] },
        { group: layout.groups[1], names: ['twistAngle'] },
      ]
    )
  })

  it('leads with the arguments that named no group', () => {
    const arranged = arrangeFields(layout, ['sketches', 'symmetric'])

    expect(arranged[0]).toEqual({ group: null, names: ['symmetric'] })
  })

  it('shows an argument whose group nobody declared rather than losing it', () => {
    const arranged = arrangeFields(
      layoutFor(
        [{ operationId: 'x', fields: { length: { group: 'nowhere' } } }],
        'x'
      ),
      ['length']
    )

    expect(arranged).toEqual([{ group: null, names: ['length'] }])
  })

  it('leaves declared order alone where the layout says nothing', () => {
    const arranged = arrangeFields(emptyLayout, ['a', 'b', 'c'])

    expect(arranged).toEqual([{ group: null, names: ['a', 'b', 'c'] }])
  })

  it('drops a group with nothing in it', () => {
    const arranged = arrangeFields(layout, ['twistAngle'])

    expect(arranged.map((entry) => entry.group?.id)).toEqual(['advanced'])
  })
})
