import type { EntityReference } from '@kittycad/lib'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import {
  createEntityStyling,
  type EntityStyle,
} from '@src/lib/scene/entityStyling'

const style: EntityStyle = {
  color: [0.2, 0.5, 0.8],
  fillOpacity: 0.05,
  outlineOpacity: 0.3,
  priority: 10,
  lineWidth: 1,
}
const face = (id: string) => ({ type: 'face' as const, face_id: id })
function group(owner: ReturnType<typeof createEntityStyling<EntityReference>>) {
  const handle = owner.service.createGroup(style)
  if (handle instanceof Error) throw handle
  return handle
}
it('keeps groups independent and expires old leases when the scene resets', () => {
  const owner = createEntityStyling(),
    a = group(owner),
    b = group(owner)
  a.set([face('a')])
  b.set([face('b')])
  a.clear()
  expect(owner.service.groups.peek().map((group) => group.entities)).toEqual([
    [],
    [face('b')],
  ])
  owner.reset()
  const current = group(owner)
  current.set([face('current')])
  expect(a.set([face('stale')])).toBeInstanceOf(Error)
  a.dispose()
  b.clear()
  expect(owner.service.groups.peek().map((group) => group.entities)).toEqual([
    [face('current')],
  ])
  owner.dispose()
  expect(current.set([face('closed')])).toBeInstanceOf(Error)
  expect(owner.service.groups.peek()).toEqual([])
})
it('copies caller inputs and keeps creation order stable across replacements', () => {
  const owner = createEntityStyling(),
    a = group(owner),
    b = group(owner)
  const entities = [face('first')]
  a.set(entities)
  const ids = owner.service.groups.peek().map((group) => group.id)
  entities[0].face_id = 'mutated'
  expect(owner.service.groups.peek()[0].entities).toEqual([face('first')])
  b.set([face('second')])
  a.set([face('replacement')])
  expect(owner.service.groups.peek().map((group) => group.id)).toEqual(ids)
  owner.dispose()
})
it('does not allow another group to overwrite or remove a surviving group', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { maxLength: 30 }), (operations) => {
      const owner = createEntityStyling(),
        a = group(owner),
        b = group(owner)
      b.set([face('survivor')])
      for (const populate of operations) {
        if (populate) a.set([face('other')])
        else a.clear()
        expect(owner.service.groups.peek()[1].entities).toEqual([
          face('survivor'),
        ])
      }
      a.dispose()
      expect(
        owner.service.groups.peek().map((group) => group.entities)
      ).toEqual([[face('survivor')]])
      owner.dispose()
    })
  )
})
it.each([NaN, Infinity, -1, 2])(
  'rejects invalid opacity %s before allocating a group',
  (opacity) => {
    const owner = createEntityStyling()
    expect(
      owner.service.createGroup({ ...style, fillOpacity: opacity })
    ).toBeInstanceOf(Error)
    expect(owner.service.groups.peek()).toEqual([])
    owner.dispose()
  }
)
