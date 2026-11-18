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
      ).toHaveLength(17)
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
      ).toHaveLength(17)
    } finally {
      await runtime.dispose()
    }
  })

  it('recognizes vertical sentences and pushes loose words while respecting pinned words', () => {
    const vertical = ['PLNK', 'IS', 'YOU'].map(
      (type, y): Tile => ({ id: `v${y}`, kind: 'word', type, x: 0, y })
    )
    expect(readRules(vertical, initialDefinitions)).toEqual([
      { noun: 'PLNK', property: 'YOU' },
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
          { id: 'p', kind: 'entity', type: 'PLNK', x: 1, y: 1 },
        ],
      },
      () => initialDefinitions
    )
    sentenceGame.step({ x: -1, y: 0 }) // IS is pinned against the left bound.
    expect(sentenceGame.board.tiles.find((t) => t.id === 'p')?.x).toBe(1)
    sentenceGame.step({ x: 0, y: 1 })
    sentenceGame.step({ x: -1, y: 0 }) // YOU is also pinned; no partial push.
    expect(readRules(sentenceGame.board.tiles, initialDefinitions)).toEqual([
      { noun: 'PLNK', property: 'YOU' },
    ])
  })

  it('rolls back a whole word chain when the last word cannot move', () => {
    const game = new Game(
      {
        ...bushPuzzle,
        bounds: { width: 6, height: 6 },
        placements: [
          ...bushPuzzle.placements.filter(
            (t) => t.kind === 'word' && t.y === 1 && t.x < 6
          ),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
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

  it('wins when a pushed word makes the controlled entity itself WIN', () => {
    const words = (sentence: string[], y: number): Tile[] =>
      sentence.map((type, x) => ({
        id: `${x}-${y}`,
        kind: 'word',
        type,
        x: x + 1,
        y,
      }))
    const game = new Game(
      {
        ...bushPuzzle,
        placements: [
          ...words(['PLNK', 'IS', 'YOU'], 0),
          ...words(['PLNK', 'IS'], 3),
          { id: 'win', kind: 'word', type: 'WIN', x: 3, y: 4 },
          { id: 'player', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    expect(game.board.won).toBe(false)
    game.step({ x: 0, y: -1 })
    expect(game.board.won).toBe(true)
    expect(game.board.tiles.find((t) => t.id === 'player')).toMatchObject({
      x: 3,
      y: 4,
    })
    game.undo()
    expect(game.board.won).toBe(false)
  })

  it('does not win from WIN alone without a controlled entity', () => {
    const game = new Game(
      {
        ...bushPuzzle,
        placements: [
          ...['PLNK', 'IS', 'WIN'].map(
            (type, x): Tile => ({
              id: `word-${x}`,
              kind: 'word',
              type,
              x,
              y: 0,
            })
          ),
          { id: 'player', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    game.step({ x: 0, y: 0 })
    expect(game.board.won).toBe(false)
  })

  it('encloses the control sentence and keeps STOP and WIN beyond the hedge', () => {
    const blocked = new Set(
      bushPuzzle.placements
        .filter((t) => t.kind === 'entity' && t.type === 'BUSH')
        .map((t) => `${t.x},${t.y}`)
    )
    const reachable = new Set(['3,5'])
    const queue = [{ x: 3, y: 5 }]
    for (const point of queue) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = point.x + dx,
          y = point.y + dy,
          key = `${x},${y}`
        if (
          x < 0 ||
          y < 0 ||
          x >= bushPuzzle.bounds.width ||
          y >= bushPuzzle.bounds.height ||
          blocked.has(key) ||
          reachable.has(key)
        )
          continue
        reachable.add(key)
        queue.push({ x, y })
      }
    }
    const protectedWords = bushPuzzle.placements.filter(
      (t) => t.kind === 'word' && (t.y === 1 || t.y === 4)
    )
    expect(protectedWords.map((t) => t.type)).toEqual([
      'PLNK',
      'IS',
      'YOU',
      'FLAG',
      'IS',
      'WIN',
      'BUSH',
      'IS',
      'STOP',
    ])
    expect(protectedWords.every((t) => !reachable.has(`${t.x},${t.y}`))).toBe(
      true
    )
    expect(reachable.has('3,3')).toBe(true)
    expect(reachable.has('10,5')).toBe(false)
  })

  it('publishes authored word pixels without changing its meaning or placements', async () => {
    const runtime = await openGame()
    try {
      const definition = runtime.definitions.value.find((d) => d.id === 'PLNK')!
      const board = runtime.game.board
      await runtime.publish({
        ...definition,
        wordSprite: ['10', '01'],
        wordColor: '#ff0000',
      })
      expect(runtime.game.board).toBe(board)
      expect(
        runtime.definitions.value.find((d) => d.id === 'PLNK')?.wordSprite
      ).toEqual(['10', '01'])
      expect(
        runtime.definitions.value.find((d) => d.id === 'PLNK')
      ).toMatchObject({ color: '#c5ed91', wordColor: '#ff0000' })
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'player')?.x).toBe(4)
      expect(
        readRules(runtime.game.board.tiles, runtime.definitions.value)
      ).toContainEqual({ noun: 'PLNK', property: 'YOU' })
    } finally {
      await runtime.dispose()
    }
  })

  it.each(['player', 'word-3-1'])(
    'removes only the selected tile and restores it with undo: %s',
    (id) => {
      const game = new Game(bushPuzzle, () => initialDefinitions)
      const before = game.board
      game.remove(id)
      expect(game.board.tiles.some((tile) => tile.id === id)).toBe(false)
      expect(game.board.tiles).toHaveLength(before.tiles.length - 1)
      expect(game.board.turns).toBe(0)
      game.undo()
      expect(game.board).toEqual(before)
    }
  )

  it('keeps other tiles in the same cell when removing a tile', () => {
    const game = new Game(
      {
        ...bushPuzzle,
        placements: [
          ...bushPuzzle.placements,
          { id: 'overlapping-flag', kind: 'entity', type: 'FLAG', x: 3, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    game.remove('player')
    expect(
      game.board.tiles
        .filter((tile) => tile.x === 3 && tile.y === 5)
        .map((tile) => tile.id)
    ).toEqual(['overlapping-flag'])
    game.undo()
    expect(
      game.board.tiles
        .filter((tile) => tile.x === 3 && tile.y === 5)
        .map((tile) => tile.id)
    ).toEqual(['player', 'overlapping-flag'])
  })

  it('does not consume an undo step when removing a tile that is already gone', () => {
    const game = new Game(bushPuzzle, () => initialDefinitions)
    game.remove('player')
    game.remove('player')
    game.undo()
    expect(game.board.tiles.find((tile) => tile.id === 'player')).toMatchObject(
      { x: 3, y: 5 }
    )
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
