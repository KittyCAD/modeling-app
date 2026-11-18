import { describe, expect, it } from 'vitest'
import { type ActionRecipe, compileAction } from './actions'
import { compileProperty } from './content'
import type { Tile } from './game'
import { openGame, type Runtime } from './registry'

const opening: ActionRecipe = {
  id: 'PAIR',
  label: 'Pair reaction',
  trigger: 'contact',
  conditions: [{ target: 'other', property: 'LOCK', present: true }],
  effects: [
    { kind: 'destroy', target: 'other' },
    { kind: 'destroy', target: 'self' },
  ],
}
const entity = (id: string, type: string, x: number): Tile => ({
  id,
  kind: 'entity',
  type,
  x,
  y: 7,
})
const sentence = (noun: string, property: string, y: number): Tile[] =>
  [noun, 'IS', property].map((type, x) => ({
    id: `${noun}-${property}-${x}`,
    kind: 'word',
    type,
    x,
    y,
  }))
const rules = [
  ...sentence('PLNK', 'YOU', 0),
  ...sentence('DOOR', 'LOCK', 1),
  ...sentence('KEY', 'OPEN', 2),
  ...sentence('KEY', 'PUSH', 3),
  ...sentence('BOX', 'PUSH', 4),
  ...sentence('BUSH', 'STOP', 5),
]
function load(
  runtime: Runtime,
  entities: readonly Tile[],
  extra: readonly Tile[] = []
) {
  runtime.game.load({
    ...runtime.game.puzzle,
    bounds: { width: 8, height: 8 },
    placements: [...rules, ...extra, ...entities],
  })
}
async function authored(recipe: ActionRecipe = opening) {
  const runtime = await openGame()
  for (const id of ['DOOR', 'KEY', 'BOX'])
    await runtime.publish({
      kind: 'entity',
      id,
      color: '#ffffff',
      sprite: ['1'],
    })
  await runtime.publish(
    compileProperty({ id: 'LOCK', color: '#ffffff', action: 'block' })
  )
  await runtime.publish(
    compileProperty({ id: 'OPEN', color: '#ffffff', action: recipe.id })
  )
  await runtime.publishAction(compileAction(recipe))
  load(runtime, [
    entity('p', 'PLNK', 1),
    entity('key', 'KEY', 2),
    entity('door', 'DOOR', 3),
  ])
  return runtime
}

describe('runtime-authored contact actions and PUSH', () => {
  it('pushes a key into a locked door, consumes both, and undoes the whole turn', async () => {
    const runtime = await authored()
    try {
      const before = runtime.game.board
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'p')?.x).toBe(2)
      expect(
        runtime.game.board.tiles.some((t) => t.id === 'key' || t.id === 'door')
      ).toBe(false)
      expect(runtime.game.board.status).toBe('playing')
      runtime.game.undo()
      expect(runtime.game.board).toEqual(before)
    } finally {
      await runtime.dispose()
    }
  })

  it.each([
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ])('opens a pushed key and door in direction %j', async (direction) => {
    const runtime = await authored()
    try {
      runtime.game.load({
        ...runtime.game.puzzle,
        bounds: { width: 12, height: 12 },
        placements: [
          ...rules,
          { ...entity('p', 'PLNK', 6), y: 8 },
          { ...entity('key', 'KEY', 6 + direction.x), y: 8 + direction.y },
          {
            ...entity('door', 'DOOR', 6 + 2 * direction.x),
            y: 8 + 2 * direction.y,
          },
        ],
      })
      runtime.game.step(direction)
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'p')
      ).toMatchObject({ x: 6 + direction.x, y: 8 + direction.y })
      expect(
        runtime.game.board.tiles.some(
          (tile) => tile.id === 'key' || tile.id === 'door'
        )
      ).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it('completes the effect batch when destroying this entity before the other entity', async () => {
    const runtime = await authored({
      ...opening,
      effects: [
        { kind: 'destroy', target: 'self' },
        { kind: 'destroy', target: 'other' },
      ],
    })
    try {
      runtime.game.step({ x: 1, y: 0 })
      expect(
        runtime.game.board.tiles.some(
          (tile) => tile.id === 'key' || tile.id === 'door'
        )
      ).toBe(false)
      expect(runtime.game.board.tiles.find((tile) => tile.id === 'p')?.x).toBe(
        2
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('can push an entity that also carries a blocking property', async () => {
    const runtime = await authored()
    try {
      load(
        runtime,
        [entity('p', 'PLNK', 1), entity('box', 'BOX', 2)],
        sentence('BOX', 'STOP', 6)
      )
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((tile) => tile.id === 'p')?.x).toBe(
        2
      )
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'box')?.x
      ).toBe(3)
    } finally {
      await runtime.dispose()
    }
  })

  it('still blocks a mover that does not have the matching OPEN action', async () => {
    const runtime = await authored()
    try {
      load(runtime, [entity('p', 'PLNK', 2), entity('door', 'DOOR', 3)])
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'p')?.x).toBe(2)
      expect(runtime.game.board.tiles.some((t) => t.id === 'door')).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })

  it('requires the active property rule rather than the key sprite or noun', async () => {
    const runtime = await authored()
    try {
      runtime.game.remove('KEY-OPEN-2')
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'p')?.x).toBe(1)
      expect(runtime.game.board.tiles.find((t) => t.id === 'key')?.x).toBe(2)
      expect(runtime.game.board.tiles.some((t) => t.id === 'door')).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })

  it('runs the same interaction when LOCK moves into a stationary OPEN entity', async () => {
    const runtime = await authored()
    try {
      load(
        runtime,
        [entity('door', 'DOOR', 1), entity('key', 'KEY', 2)],
        sentence('DOOR', 'YOU', 6)
      )
      runtime.game.step({ x: 1, y: 0 })
      expect(
        runtime.game.board.tiles.some((t) => t.id === 'door' || t.id === 'key')
      ).toBe(false)
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU entities remain',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('pushes a chain of entities and words without treating non-PUSH entities as pushable', async () => {
    const runtime = await authored()
    try {
      load(runtime, [
        entity('p', 'PLNK', 0),
        entity('a', 'BOX', 1),
        entity('b', 'BOX', 2),
        { id: 'text', kind: 'word', type: 'IS', x: 3, y: 7 },
      ])
      runtime.game.step({ x: 1, y: 0 })
      expect(
        ['p', 'a', 'b', 'text'].map(
          (id) => runtime.game.board.tiles.find((t) => t.id === id)?.x
        )
      ).toEqual([1, 2, 3, 4])
      runtime.game.undo()
      expect(
        ['p', 'a', 'b', 'text'].map(
          (id) => runtime.game.board.tiles.find((t) => t.id === id)?.x
        )
      ).toEqual([0, 1, 2, 3])
      load(runtime, [
        entity('p', 'PLNK', 0),
        entity('a', 'BOX', 1),
        entity('unmarked', 'FLAG', 2),
      ])
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'a')?.x).toBe(2)
      expect(runtime.game.board.tiles.find((t) => t.id === 'unmarked')?.x).toBe(
        2
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('moves shared push-chain occupants once when two pushable entities start stacked', async () => {
    const runtime = await authored()
    try {
      load(runtime, [
        entity('p', 'PLNK', 0),
        entity('a', 'BOX', 1),
        entity('b', 'BOX', 1),
        entity('shared', 'BOX', 2),
      ])
      runtime.game.step({ x: 1, y: 0 })
      expect(
        ['p', 'a', 'b', 'shared'].map(
          (id) => runtime.game.board.tiles.find((tile) => tile.id === id)?.x
        )
      ).toEqual([1, 2, 2, 3])
      runtime.game.undo()
      expect(
        ['p', 'a', 'b', 'shared'].map(
          (id) => runtime.game.board.tiles.find((tile) => tile.id === id)?.x
        )
      ).toEqual([0, 1, 1, 2])
    } finally {
      await runtime.dispose()
    }
  })

  it('restores a consumed key and door when a different branch of the push fails', async () => {
    const runtime = await authored()
    try {
      load(runtime, [
        entity('p', 'PLNK', 1),
        entity('key', 'KEY', 2),
        entity('box', 'BOX', 2),
        entity('door', 'DOOR', 3),
        entity('wall', 'BUSH', 3),
      ])
      runtime.game.step({ x: 1, y: 0 })
      expect(
        ['p', 'key', 'box', 'door', 'wall'].map(
          (id) => runtime.game.board.tiles.find((t) => t.id === id)?.x
        )
      ).toEqual([1, 2, 2, 3, 3])
      runtime.game.undo()
      expect(runtime.game.board.turns).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('rolls back destruction when the contact recipe also blocks the move', async () => {
    const runtime = await authored({
      ...opening,
      effects: [{ kind: 'destroy', target: 'other' }, { kind: 'block' }],
    })
    try {
      runtime.game.step({ x: 1, y: 0 })
      expect(
        ['p', 'key', 'door'].map(
          (id) => runtime.game.board.tiles.find((t) => t.id === id)?.x
        )
      ).toEqual([1, 2, 3])
    } finally {
      await runtime.dispose()
    }
  })

  it('matches all positive and negative property conditions on either participant', async () => {
    const runtime = await authored({
      ...opening,
      conditions: [
        { target: 'other', property: 'LOCK', present: true },
        { target: 'self', property: 'PUSH', present: false },
      ],
    })
    try {
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.some((t) => t.id === 'door')).toBe(true)
      await runtime.publishAction(
        compileAction({
          ...opening,
          conditions: [
            { target: 'other', property: 'LOCK', present: true },
            { target: 'self', property: 'PUSH', present: true },
          ],
        })
      )
      runtime.game.step({ x: 1, y: 0 })
      expect(
        runtime.game.board.tiles.some((t) => t.id === 'key' || t.id === 'door')
      ).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it('uses the same contact dispatch for movement caused by a turn action', async () => {
    const runtime = await authored()
    try {
      await runtime.publishAction(
        compileAction({
          id: 'WALK',
          label: 'Walk',
          trigger: 'turn',
          conditions: [],
          effects: [{ kind: 'step-forward', blocked: 'wait' }],
        })
      )
      await runtime.publish(
        compileProperty({ id: 'MOVE', color: '#ffffff', action: 'WALK' })
      )
      load(
        runtime,
        [
          entity('p', 'PLNK', 1),
          entity('key', 'KEY', 2),
          entity('door', 'DOOR', 3),
        ],
        sentence('KEY', 'MOVE', 6)
      )
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'p')?.x).toBe(1)
      expect(
        runtime.game.board.tiles.some((t) => t.id === 'key' || t.id === 'door')
      ).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it('applies a contact action once even when two properties select it', async () => {
    const runtime = await authored()
    try {
      const calls: string[] = []
      await runtime.publishAction({
        id: 'PAIR',
        label: 'Observe',
        description: 'Observe contacts',
        onContact: (self, other, contact) => {
          if (contact.hasProperty(other, 'LOCK'))
            calls.push(`${self.id}:${other.id}`)
        },
      })
      await runtime.publish(
        compileProperty({ id: 'ALSO', color: '#ffffff', action: 'PAIR' })
      )
      load(
        runtime,
        [
          entity('p', 'PLNK', 1),
          entity('key', 'KEY', 2),
          entity('door', 'DOOR', 3),
        ],
        sentence('KEY', 'ALSO', 6)
      )
      runtime.game.step({ x: 1, y: 0 })
      expect(calls).toEqual(['key:door'])
    } finally {
      await runtime.dispose()
    }
  })

  it('checks turn-action property conditions before applying effects', async () => {
    const runtime = await authored({
      id: 'PAIR',
      label: 'Conditional',
      trigger: 'turn',
      conditions: [{ target: 'self', property: 'PUSH', present: false }],
      effects: [{ kind: 'destroy', target: 'self' }],
    })
    try {
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.some((t) => t.id === 'key')).toBe(true)
      await runtime.publishAction(
        compileAction({
          id: 'PAIR',
          label: 'Conditional',
          trigger: 'turn',
          conditions: [{ target: 'self', property: 'PUSH', present: true }],
          effects: [{ kind: 'destroy', target: 'self' }],
        })
      )
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.some((t) => t.id === 'key')).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })
})
