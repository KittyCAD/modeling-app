import { describe, expect, it } from 'vitest'
import { builtInActions, compileAction } from './actions'
import { bushPuzzle, compileProperty, initialDefinitions } from './content'
import {
  type Definition,
  Game,
  type Puzzle,
  readRules,
  type Tile,
} from './game'
import { outcomeWords, parseOutcomeRows, startingOutcomeRows } from './outcomes'
import { gameContract, openGame } from './registry'

function createGame(puzzle: Puzzle, definitions: () => readonly Definition[]) {
  return new Game(puzzle, {
    definitions,
    actions: () => builtInActions,
    outcomeWords: () => outcomeWords,
    outcomeProgram: () => {
      const parsed = parseOutcomeRows(startingOutcomeRows, outcomeWords)
      if (!parsed.ok) throw new Error(parsed.errors.join('; '))
      return parsed.program
    },
  })
}

function sentence(noun: string, property: string, y: number): Tile[] {
  return [noun, 'IS', property].map((type, x) => ({
    id: `${noun}-${property}-${x}`,
    kind: 'word',
    type,
    x,
    y,
  }))
}

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
      expect(game.board.status).not.toBe('won')
      const boardBeforePublish = game.board
      await runtime.publish(
        compileProperty({ id: 'DIE', color: '#ee927d', action: 'destroy' })
      )
      expect(game.board).toBe(boardBeforePublish)
      expect(runtime.definitions.value.some((d) => d.id === 'DIE')).toBe(true)
      game.place(dieWord)
      game.step({ x: 0, y: 0 })
      expect(
        game.board.tiles.filter((t) => t.kind === 'entity' && t.type === 'BUSH')
      ).toEqual([])
      for (let i = 0; i < 4; i++) game.step({ x: 1, y: 0 })
      expect(game.board.status).toBe('won')
      game.undo()
      expect(game.board.status).not.toBe('won')
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
        compileProperty({ id: 'DIE', color: '#ee927d', action: 'destroy' })
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
    const game = createGame(
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
    const sentenceGame = createGame(
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
    const game = createGame(
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
    expect(game.board.tiles.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      before.map(({ id, x, y }) => ({ id, x, y }))
    )
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
    const game = createGame(
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
    expect(game.board.status).not.toBe('won')
    game.step({ x: 0, y: -1 })
    expect(game.board.status).toBe('won')
    expect(game.board.tiles.find((t) => t.id === 'player')).toMatchObject({
      x: 3,
      y: 4,
    })
    game.undo()
    expect(game.board.status).not.toBe('won')
  })

  it('does not win from WIN alone without a controlled entity', () => {
    const game = createGame(
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
    expect(game.board.status).not.toBe('won')
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

  it('installs MOVE at runtime, reverses at bounds, and follows action replacement', async () => {
    const runtime = await openGame()
    try {
      await runtime.publish(
        compileProperty({ id: 'MOVE', color: '#ffffff', action: 'MOVE' })
      )
      runtime.game.load({
        ...bushPuzzle,
        bounds: { width: 6, height: 4 },
        placements: [
          ...['PLNK', 'IS', 'YOU'].map(
            (type, x): Tile => ({ id: `you-${x}`, kind: 'word', type, x, y: 0 })
          ),
          ...['BUSH', 'IS', 'MOVE'].map(
            (type, x): Tile => ({
              id: `move-${x}`,
              kind: 'word',
              type,
              x,
              y: 1,
            })
          ),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 0, y: 3 },
          { id: 'b', kind: 'entity', type: 'BUSH', x: 4, y: 3 },
        ],
      })
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'b')?.x).toBe(4)
      const board = runtime.game.board
      await runtime.publishAction(
        compileAction({
          id: 'MOVE',
          label: 'Move',
          operation: 'step-forward',
          blocked: 'reverse',
        })
      )
      expect(runtime.game.board).toBe(board)
      await runtime.publish(
        compileProperty({ id: 'GO', color: '#ffffff', action: 'MOVE' })
      )
      for (const [x, type] of ['BUSH', 'IS', 'GO'].entries()) {
        runtime.game.place({ id: `alias-${x}`, kind: 'word', type, x, y: 2 })
      }
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'b')?.x).toBe(5)
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'b')).toMatchObject({
        x: 4,
        facing: { x: -1, y: 0 },
      })
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.find((t) => t.id === 'b')?.x).toBe(3)
      await runtime.publishAction(
        compileAction({
          id: 'MOVE',
          label: 'Remove',
          operation: 'destroy-self',
          blocked: 'wait',
        })
      )
      runtime.game.step({ x: 0, y: 0 })
      expect(runtime.game.board.tiles.some((t) => t.id === 'b')).toBe(false)
      runtime.game.undo()
      expect(runtime.game.board.tiles.find((t) => t.id === 'b')?.x).toBe(3)
      expect(runtime.actions.value.filter((a) => a.id === 'MOVE')).toHaveLength(
        1
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('loses when movement disconnects YOU and undo restores control', () => {
    const game = createGame(
      {
        ...bushPuzzle,
        placements: [
          ...['PLNK', 'IS', 'YOU'].map(
            (type, x): Tile => ({
              id: `you-${x}`,
              kind: 'word',
              type,
              x: x + 1,
              y: 2,
            })
          ),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 3 },
        ],
      },
      () => initialDefinitions
    )
    game.step({ x: 0, y: -1 })
    expect(game.board.status).toBe('lost')
    expect(game.board.status).not.toBe('won')
    const lostBoard = game.board
    game.step({ x: 1, y: 0 })
    expect(game.board).toBe(lostBoard)
    game.undo()
    expect(game.board.status).not.toBe('lost')
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles.find((t) => t.id === 'p')?.x).toBe(4)
  })

  it.each(['PLNK', 'BUSH'])(
    'loses when %s IS YOU is connected but has no matching entity',
    (noun) => {
      const game = createGame(
        {
          ...bushPuzzle,
          placements: [
            ...sentence(noun, 'YOU', 0),
            { id: 'other', kind: 'entity', type: 'FLAG', x: 5, y: 5 },
          ],
        },
        () => initialDefinitions
      )
      game.settle()
      expect(readRules(game.board.tiles, initialDefinitions)).toContainEqual({
        noun,
        property: 'YOU',
      })
      expect(game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU entities remain',
      })
    }
  )

  it('keeps playing when one YOU sentence disconnects but another remains active', () => {
    const game = createGame(
      {
        ...bushPuzzle,
        placements: [
          ...sentence('PLNK', 'YOU', 0),
          ...sentence('BUSH', 'YOU', 1),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
          { id: 'b', kind: 'entity', type: 'BUSH', x: 6, y: 5 },
        ],
      },
      () => initialDefinitions
    )
    game.remove('PLNK-YOU-2')
    expect(game.board.status).toBe('playing')
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles.find((tile) => tile.id === 'p')?.x).toBe(3)
    expect(game.board.tiles.find((tile) => tile.id === 'b')?.x).toBe(7)
  })

  it('keeps playing when one YOU entity is destroyed and loses after the last one is removed', () => {
    const definitions = [
      ...initialDefinitions,
      compileProperty({ id: 'DIE', color: '#ffffff', action: 'destroy' }),
    ]
    const game = createGame(
      {
        ...bushPuzzle,
        placements: [
          ...sentence('PLNK', 'YOU', 0),
          ...sentence('BUSH', 'YOU', 1),
          ...sentence('PLNK', 'DIE', 2),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
          { id: 'b', kind: 'entity', type: 'BUSH', x: 6, y: 5 },
        ],
      },
      () => definitions
    )
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles.some((tile) => tile.id === 'p')).toBe(false)
    expect(game.board.status).toBe('playing')
    game.step({ x: 1, y: 0 })
    expect(game.board.tiles.find((tile) => tile.id === 'b')?.x).toBe(8)
    game.remove('b')
    expect(game.board).toMatchObject({
      status: 'lost',
      message: 'No YOU entities remain',
    })
    game.undo()
    expect(game.board.status).toBe('playing')
  })

  it.each([
    { active: true, expected: 'lost' },
    { active: false, expected: 'playing' },
  ])(
    'Lose on contact requires an active property rule: $active',
    ({ active, expected }) => {
      const definitions = [
        ...initialDefinitions,
        compileProperty({ id: 'DANGER', color: '#ee927d', action: 'lose' }),
      ]
      const game = createGame(
        {
          ...bushPuzzle,
          placements: [
            ...sentence('PLNK', 'YOU', 0),
            ...(active ? sentence('BUSH', 'DANGER', 1) : []),
            { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
            { id: 'spare', kind: 'entity', type: 'PLNK', x: 0, y: 5 },
            { id: 'hazard', kind: 'entity', type: 'BUSH', x: 4, y: 5 },
          ],
        },
        () => definitions
      )
      game.step({ x: 1, y: 0 })
      expect(game.board.status).toBe(expected)
      expect(game.board.tiles.find((tile) => tile.id === 'p')).toMatchObject({
        x: 4,
        y: 5,
      })
      expect(game.board.tiles.some((tile) => tile.id === 'spare')).toBe(true)
      if (active)
        expect(game.board).toMatchObject({
          message: 'YOU touched a losing entity',
        })
      game.undo()
      expect(game.board.status).toBe('playing')
      expect(game.board.tiles.find((tile) => tile.id === 'p')?.x).toBe(3)
    }
  )

  it('loses when YOU touches a tile that is both winning and losing', () => {
    const definitions = [
      ...initialDefinitions,
      compileProperty({ id: 'DANGER', color: '#ee927d', action: 'lose' }),
    ]
    const game = createGame(
      {
        ...bushPuzzle,
        placements: [
          ...sentence('PLNK', 'YOU', 0),
          ...sentence('FLAG', 'WIN', 1),
          ...sentence('FLAG', 'DANGER', 2),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
          { id: 'flag', kind: 'entity', type: 'FLAG', x: 4, y: 5 },
        ],
      },
      () => definitions
    )
    game.step({ x: 1, y: 0 })
    expect(game.board).toMatchObject({
      status: 'lost',
      message: 'YOU touched a losing entity',
    })
  })

  it('can repair a disconnected YOU sentence while editing a lost board', () => {
    const game = createGame(bushPuzzle, () => initialDefinitions)
    game.remove('word-3-1')
    expect(game.board.status).toBe('lost')
    game.place({ id: 'repair', kind: 'word', type: 'YOU', x: 3, y: 1 })
    expect(game.board.status).not.toBe('lost')
    game.undo()
    expect(game.board.status).toBe('lost')
    game.undo()
    expect(game.board.status).not.toBe('lost')
  })

  it('checks outcomes after destruction, so a destroyed YOU cannot win', () => {
    const definitions = [
      ...initialDefinitions,
      compileProperty({ id: 'DIE', color: '#ffffff', action: 'destroy' }),
    ]
    const game = createGame(
      {
        ...bushPuzzle,
        placements: [
          ...['PLNK', 'IS', 'YOU'].map(
            (type, x): Tile => ({ id: `you-${x}`, kind: 'word', type, x, y: 0 })
          ),
          ...['PLNK', 'IS', 'DIE'].map(
            (type, x): Tile => ({ id: `die-${x}`, kind: 'word', type, x, y: 1 })
          ),
          ...['FLAG', 'IS', 'WIN'].map(
            (type, x): Tile => ({ id: `win-${x}`, kind: 'word', type, x, y: 2 })
          ),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
          { id: 'f', kind: 'entity', type: 'FLAG', x: 4, y: 5 },
        ],
      },
      () => definitions
    )
    game.step({ x: 1, y: 0 })
    expect(game.board).toMatchObject({
      status: 'lost',
      message: 'No YOU entities remain',
    })
    expect(readRules(game.board.tiles, definitions)).toContainEqual({
      noun: 'PLNK',
      property: 'YOU',
    })
    expect(game.board.tiles.some((t) => t.id === 'p')).toBe(false)
    game.undo()
    expect(game.board).toMatchObject({ status: 'playing' })
  })

  it('reevaluates loss when a live action provider removes player control', async () => {
    const runtime = await openGame()
    try {
      const before = runtime.game.board
      await runtime.publishAction({
        id: 'control',
        label: 'Disconnected',
        description: 'No controls',
      })
      expect(runtime.game.board).toBe(before)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('lost')
      await runtime.publishAction(
        builtInActions.find((a) => a.id === 'control')!
      )
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      expect(runtime.game.board.turns).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('deletes an unused vocabulary item without allowing removal of a placed definition', async () => {
    const runtime = await openGame()
    try {
      await expect(runtime.deleteDefinition('PLNK')).rejects.toThrow(
        'Remove placed tiles'
      )
      await runtime.publish(
        compileProperty({ id: 'DIE', color: '#ffffff', action: 'destroy' })
      )
      await runtime.deleteDefinition('DIE')
      expect(runtime.definitions.value.some((d) => d.id === 'DIE')).toBe(false)
      await runtime.publish({ ...initialDefinitions[0], wordColor: '#ff0000' })
      expect(runtime.definitions.value.some((d) => d.id === 'DIE')).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it.each(['player', 'word-3-1'])(
    'removes only the selected tile and restores it with undo: %s',
    (id) => {
      const game = createGame(bushPuzzle, () => initialDefinitions)
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
    const game = createGame(
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
    const game = createGame(bushPuzzle, () => initialDefinitions)
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
      const game = createGame(bushPuzzle, () => initialDefinitions)
      for (let i = 0; i < 30; i++) game.step(direction)
      expect(
        game.board.tiles.every(
          (t) => t.x >= 0 && t.y >= 0 && t.x < 12 && t.y < 10
        )
      ).toBe(true)
    }
  )
})
