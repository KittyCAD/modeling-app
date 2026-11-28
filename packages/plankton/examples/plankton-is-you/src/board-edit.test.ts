import { describe, expect, it } from 'vitest'
import { type Brush, paintBoard } from './board-edit'
import type { Tile } from './game'
import { openGame } from './registry'

const brush: Brush = { kind: 'entity', type: 'BUSH' }
const stack: readonly Tile[] = [
  { id: 'bush', kind: 'entity', type: 'BUSH', x: 0, y: 0 },
  { id: 'is', kind: 'word', type: 'IS', x: 0, y: 0 },
  { id: 'player', kind: 'entity', type: 'PLNK', x: 4, y: 4 },
]

describe('board painting', () => {
  it('replaces every word and entity in a cell with one equipped tile', () => {
    const tiles = paintBoard(
      stack,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { kind: 'word', type: 'WIN' }
    )
    expect(tiles.filter((tile) => tile.x === 0 && tile.y === 0)).toMatchObject([
      { kind: 'word', type: 'WIN' },
    ])
    expect(tiles).toHaveLength(2)
    expect(tiles.find((tile) => tile.id === 'player')).toBe(stack[2])
    expect(stack).toHaveLength(3)
  })

  it('erases a whole stack without clearing other cells', () => {
    expect(paintBoard(stack, { x: 0, y: 0 }, { x: 0, y: 0 }, null)).toEqual([
      stack[2],
    ])
  })

  it.each([
    {
      from: { x: 0, y: 1 },
      to: { x: 4, y: 1 },
      cells: [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
      ],
    },
    {
      from: { x: 2, y: 4 },
      to: { x: 2, y: 0 },
      cells: [
        [2, 4],
        [2, 3],
        [2, 2],
        [2, 1],
        [2, 0],
      ],
    },
    {
      from: { x: 0, y: 0 },
      to: { x: 3, y: 3 },
      cells: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
    },
  ])(
    'fills skipped cells in a drag from $from to $to',
    ({ from, to, cells }) => {
      const tiles = paintBoard([], from, to, brush)
      expect(tiles.map((tile) => [tile.x, tile.y])).toEqual(cells)
      expect(paintBoard(tiles, from, to, null)).toEqual([])
    }
  )

  it('does not replace an already equipped tile on repeated pointer samples', () => {
    const tile: Tile = { ...brush, id: 'kept', x: 1, y: 1 }
    const tiles = [tile]
    expect(paintBoard(tiles, tile, tile, brush)).toBe(tiles)
    expect(paintBoard(tiles, { x: 0, y: 0 }, { x: 0, y: 0 }, null)).toBe(tiles)
  })
})

describe('placement sessions', () => {
  it('keeps the game unchanged while painting and accepts a whole session as one undoable edit', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      const original = game.board
      let tiles = paintBoard(
        original.tiles,
        { x: 3, y: 5 },
        { x: 3, y: 5 },
        null
      )
      tiles = paintBoard(
        tiles,
        { x: 1, y: 4 },
        { x: 1, y: 4 },
        { kind: 'entity', type: 'PLNK' }
      )
      tiles = paintBoard(tiles, { x: 1, y: 7 }, { x: 4, y: 7 }, brush)
      expect(game.board).toBe(original)
      game.edit(tiles)
      expect(game.board).toMatchObject({ status: 'playing', turns: 0 })
      expect(
        game.board.tiles.find(
          (tile) => tile.type === 'PLNK' && tile.kind === 'entity'
        )
      ).toMatchObject({ x: 1, y: 4 })
      game.undo()
      expect(game.board.tiles).toEqual(original.tiles)
      expect(game.board.turns).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('can discard a draft without changing the board or movement undo history', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      game.step({ x: 1, y: 0 })
      const before = game.board
      const discarded = paintBoard(
        before.tiles,
        { x: 4, y: 5 },
        { x: 4, y: 5 },
        null
      )
      expect(discarded.some((tile) => tile.id === 'player')).toBe(false)
      expect(game.board).toBe(before)
      expect(
        game.board.tiles.find((tile) => tile.id === 'player')
      ).toMatchObject({ x: 4, y: 5 })
      expect(game.board.status).toBe('playing')
      game.undo()
      expect(
        game.board.tiles.find((tile) => tile.id === 'player')
      ).toMatchObject({ x: 3, y: 5 })
    } finally {
      await runtime.dispose()
    }
  })

  it('does not add an undo entry when accepting an unchanged draft', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      game.step({ x: 1, y: 0 })
      let draft = paintBoard(
        game.board.tiles,
        { x: 1, y: 7 },
        { x: 1, y: 7 },
        brush
      )
      draft = paintBoard(draft, { x: 1, y: 7 }, { x: 1, y: 7 }, null)
      game.edit(draft)
      game.undo()
      expect(game.board.turns).toBe(0)
      expect(
        game.board.tiles.find((tile) => tile.id === 'player')
      ).toMatchObject({ x: 3, y: 5 })
    } finally {
      await runtime.dispose()
    }
  })

  it('evaluates loss when edits are accepted and restores play on undo', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      const tiles = paintBoard(
        game.board.tiles,
        { x: 3, y: 5 },
        { x: 3, y: 5 },
        null
      )
      expect(game.board.status).toBe('playing')
      game.edit(tiles)
      expect(game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU entities remain',
      })
      game.undo()
      expect(game.board.status).toBe('playing')
    } finally {
      await runtime.dispose()
    }
  })
})
