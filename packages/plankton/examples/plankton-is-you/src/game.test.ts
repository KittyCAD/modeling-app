import { describe, expect, it } from 'vitest'
import { bushPuzzle, compileProperty, initialDefinitions } from './content'
import { Game, readRules, type Tile } from './game'
import { gameContract, openGame } from './registry'

const dieWord: Tile = {
  id: 'authored-word',
  kind: 'word',
  type: 'DIE',
  x: 3,
  y: 8,
}

describe('the living vocabulary', () => {
  it('keeps the flag unreachable until a new property clears the full-height hedge', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      expect(
        runtime.registry.get(gameContract.puzzles).map((p) => p.id)
      ).toEqual(['through-the-hedge'])
      for (let i = 0; i < 8; i++) game.step({ x: 1, y: 0 })
      expect(game.board.tiles.find((t) => t.id === 'player')?.x).toBe(6)
      expect(game.board.won).toBe(false)
      const boardBeforePublish = game.board
      await runtime.publish(
        compileProperty({ id: 'DIE', color: '#ee927d', action: 'destroy-self' })
      )
      expect(game.board).toBe(boardBeforePublish)
      expect(runtime.definitions.value.some((d) => d.id === 'DIE')).toBe(true)
      game.place(dieWord)
      game.step({ x: 0, y: 0 })
      expect(
        game.board.tiles.filter((t) => t.kind === 'entity' && t.type === 'BUSH')
      ).toEqual([])
      for (let i = 0; i < 4; i++) game.step({ x: 1, y: 0 })
      expect(game.board.won).toBe(true)
      game.undo()
      expect(game.board.won).toBe(false)
      expect(game.board.tiles.find((t) => t.id === 'player')?.x).toBe(9)
    } finally {
      await runtime.dispose()
    }
  })

  it('retains the sprite update, current board, and undo history when replacing an extension', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      game.step({ x: 1, y: 0 })
      const board = game.board
      const sprite = Array(8).fill('11111111')
      await runtime.publish({
        kind: 'entity',
        id: 'BUSH',
        color: '#ff0000',
        sprite,
      })
      expect(game.board).toBe(board)
      const bushes = runtime.definitions.value.filter((d) => d.id === 'BUSH')
      expect(bushes).toHaveLength(1)
      expect(bushes[0]).toMatchObject({ color: '#ff0000', sprite })
      game.undo()
      expect(game.board.tiles.find((t) => t.id === 'player')?.x).toBe(3)
      await runtime.loadPuzzle(bushPuzzle.id)
      expect(
        runtime.definitions.value.find((d) => d.id === 'BUSH')
      ).toMatchObject({ color: '#ff0000' })
    } finally {
      await runtime.dispose()
    }
  })

  it('does not activate an uninstalled word or destroy word tiles', async () => {
    const runtime = await openGame()
    try {
      const { game } = runtime
      // An imported placement can contain unknown words; it has no meaning yet.
      game.load({
        ...bushPuzzle,
        placements: [...bushPuzzle.placements, dieWord],
      })
      game.step({ x: 0, y: 0 })
      expect(
        game.board.tiles.filter((t) => t.kind === 'entity' && t.type === 'BUSH')
      ).toHaveLength(10)
      await runtime.publish(
        compileProperty({ id: 'DIE', color: '#ee927d', action: 'destroy-self' })
      )
      game.step({ x: 0, y: 0 })
      expect(game.board.tiles.some((t) => t.id === dieWord.id)).toBe(true)
      expect(
        game.board.tiles.filter((t) => t.kind === 'entity' && t.type === 'BUSH')
      ).toHaveLength(0)
      game.undo()
      expect(
        game.board.tiles.filter((t) => t.kind === 'entity' && t.type === 'BUSH')
      ).toHaveLength(10)
    } finally {
      await runtime.dispose()
    }
  })

  it('recognizes vertical sentences and pushes loose words while respecting pinned words', () => {
    const vertical = ['PLANKTON', 'IS', 'YOU'].map(
      (type, y): Tile => ({ id: `v${y}`, kind: 'word', type, x: 0, y })
    )
    expect(readRules(vertical, initialDefinitions)).toEqual([
      { noun: 'PLANKTON', property: 'YOU' },
    ])
    const game = new Game(
      {
        ...bushPuzzle,
        placements: [
          ...bushPuzzle.placements,
          { id: 'loose-word', kind: 'word', type: 'WIN', x: 4, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles.find((t) => t.id === 'loose-word')).toMatchObject({
      x: 5,
      y: 5,
    })
    expect(game.board.tiles.find((t) => t.id === 'player')).toMatchObject({
      x: 4,
      y: 5,
    })
    const sentenceGame = new Game(
      {
        ...bushPuzzle,
        placements: [
          ...vertical,
          { id: 'p', kind: 'entity', type: 'PLANKTON', x: 1, y: 1 },
        ],
      },
      () => initialDefinitions
    )
    sentenceGame.step({ x: -1, y: 0 }) // IS is pinned against the left bound.
    expect(sentenceGame.board.tiles.find((t) => t.id === 'p')?.x).toBe(1)
    sentenceGame.step({ x: 0, y: 1 })
    sentenceGame.step({ x: -1, y: 0 }) // YOU is also pinned; no partial push.
    expect(readRules(sentenceGame.board.tiles, initialDefinitions)).toEqual([
      { noun: 'PLANKTON', property: 'YOU' },
    ])
  })

  it('rolls back a whole word chain when the last word cannot move', () => {
    const game = new Game(
      {
        ...bushPuzzle,
        bounds: { width: 6, height: 6 },
        placements: [
          ...bushPuzzle.placements.filter(
            (t) => t.kind === 'word' && t.y === 1
          ),
          { id: 'p', kind: 'entity', type: 'PLANKTON', x: 3, y: 5 },
          { id: 'a', kind: 'word', type: 'FLAG', x: 4, y: 5 },
          { id: 'b', kind: 'word', type: 'WIN', x: 5, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    const before = game.board.tiles
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles).toEqual(before)
  })

  it.each([
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ])(
    'keeps tiles inside the fixed bounds after repeated moves in direction %j',
    (direction) => {
      const game = new Game(bushPuzzle, () => initialDefinitions)
      for (let i = 0; i < 30; i++) game.step(direction)
      expect(
        game.board.tiles.every(
          (t) => t.x >= 0 && t.y >= 0 && t.x < 12 && t.y < 10
        )
      ).toBe(true)
    }
  )
})
