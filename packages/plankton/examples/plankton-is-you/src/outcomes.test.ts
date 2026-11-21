import { describe, expect, it } from 'vitest'
import { initialDefinitions } from './content'
import type { Tile } from './game'
import {
  evaluateOutcomes,
  type OutcomeContext,
  type OutcomeRow,
  outcomeMeanings,
  parseOutcomeRows,
  resolveOutcomeVocabulary,
  startingOutcomeRows,
  wordTileSelector,
} from './outcomes'
import { gameContract, openGame } from './registry'

const outcomeWords = resolveOutcomeVocabulary(initialDefinitions, [
  ...outcomeMeanings,
  ...initialDefinitions.map((definition) => wordTileSelector(definition.id)),
])
const empty: OutcomeContext = {
  tiles: [],
  entities: [],
  rules: [],
  controlled: [],
  winning: [],
  losing: [],
}
const player: Tile = { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 }
function program(rows: readonly OutcomeRow[]) {
  const parsed = parseOutcomeRows(rows, outcomeWords)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.program
}

describe('the outcome tile language', () => {
  it('starts with the four promised rows and distinguishes touching from being WIN', () => {
    expect(startingOutcomeRows.map((row) => row.cells)).toEqual([
      ['YOU', 'IS', 'NONE', 'LOSE'],
      ['YOU', 'TOUCH', 'WIN', 'WIN'],
      ['YOU', 'IS', 'WIN', 'WIN'],
      ['YOU', 'TOUCH', 'LOSE', 'LOSE'],
    ])
    const selfWin = {
      ...empty,
      controlled: [player],
      winning: [player],
      losing: [],
    }
    expect(
      evaluateOutcomes(program([startingOutcomeRows[1]]), outcomeWords, selfWin)
        .status
    ).toBe('playing')
    expect(
      evaluateOutcomes(program([startingOutcomeRows[2]]), outcomeWords, selfWin)
        .status
    ).toBe('won')
    const flag = { ...player, id: 'flag', type: 'FLAG' }
    expect(
      evaluateOutcomes(program([startingOutcomeRows[1]]), outcomeWords, {
        ...selfWin,
        winning: [flag],
      }).status
    ).toBe('won')
    expect(
      evaluateOutcomes(program([startingOutcomeRows[2]]), outcomeWords, {
        ...selfWin,
        winning: [flag],
      }).status
    ).toBe('playing')
  })

  it.each([
    ['MISSING', 'IS', 'NONE', 'LOSE'],
    ['YOU', 'YOU', 'WIN', 'WIN'],
    ['YOU', 'TOUCH', 'MISSING', 'LOSE'],
    ['YOU', 'IS', '', 'LOSE'],
    ['YOU', 'IS', 'NONE', 'YOU'],
  ])('rejects an incomplete or ill-typed row: %j', (...cells) => {
    const parsed = parseOutcomeRows([{ id: 'bad', cells }], outcomeWords)
    expect(parsed.ok).toBe(false)
  })

  it.each(
    initialDefinitions.flatMap((definition) =>
      ([0, 2] as const).map((position) => ({ id: definition.id, position }))
    )
  )(
    'can select physical $id words in outcome position $position',
    ({ id, position }) => {
      const word: Tile = { id: 'word', kind: 'word', type: id, x: 2, y: 2 }
      const bush: Tile = {
        id: 'bush',
        kind: 'entity',
        type: 'BUSH',
        x: 2,
        y: 2,
      }
      const row: OutcomeRow = {
        id: 'word-contact',
        cells:
          position === 0
            ? [id, 'TOUCH', 'BUSH', 'WIN']
            : ['BUSH', 'TOUCH', id, 'WIN'],
        wordTiles: [position],
      }
      const context = { ...empty, tiles: [bush, word], entities: [bush] }
      expect(
        evaluateOutcomes(program([row]), outcomeWords, context).status
      ).toBe('won')
      expect(
        evaluateOutcomes(program([row]), outcomeWords, {
          ...context,
          tiles: [bush, { ...word, x: 3 }],
        }).status
      ).toBe('playing')
    }
  )

  it('can use NONE as a physical word in an IS relation instead of as a unary predicate', () => {
    const row: OutcomeRow = {
      id: 'literal-none',
      cells: ['NONE', 'IS', 'NONE', 'WIN'],
      wordTiles: [0, 2],
    }
    const word: Tile = { id: 'none', kind: 'word', type: 'NONE', x: 1, y: 1 }
    expect(
      evaluateOutcomes(program([row]), outcomeWords, {
        ...empty,
        tiles: [word],
      }).status
    ).toBe('won')
    expect(evaluateOutcomes(program([row]), outcomeWords, empty).status).toBe(
      'playing'
    )
  })

  it('requires two distinct physical word tiles for TOUCH', () => {
    const row: OutcomeRow = { id: 'words', cells: ['IS', 'TOUCH', 'IS', 'WIN'] }
    const word: Tile = { id: 'is-one', kind: 'word', type: 'IS', x: 1, y: 1 }
    expect(
      evaluateOutcomes(program([row]), outcomeWords, {
        ...empty,
        tiles: [word],
      }).status
    ).toBe('playing')
    expect(
      evaluateOutcomes(program([row]), outcomeWords, {
        ...empty,
        tiles: [word, { ...word, id: 'is-two' }],
      }).status
    ).toBe('won')
  })

  it('allows an empty program and predicates over a different selected set', () => {
    expect(evaluateOutcomes(program([]), outcomeWords, empty)).toEqual({
      status: 'playing',
    })
    const rows: OutcomeRow[] = [
      { id: 'no-win', cells: ['WIN', 'IS', 'NONE', 'LOSE'] },
    ]
    expect(
      evaluateOutcomes(program(rows), outcomeWords, {
        ...empty,
        controlled: [player],
      })
    ).toMatchObject({
      status: 'lost',
      message: 'No WIN entities remain',
      ruleId: 'no-win',
    })
  })

  it.each([false, true])(
    'keeps LOSE priority when matching rows change order: %s',
    (reverse) => {
      const rows: OutcomeRow[] = [
        { id: 'yes', cells: ['YOU', 'IS', 'NONE', 'WIN'] },
        { id: 'no', cells: ['YOU', 'IS', 'NONE', 'LOSE'] },
      ]
      expect(
        evaluateOutcomes(
          program(reverse ? rows.toReversed() : rows),
          outcomeWords,
          empty
        )
      ).toMatchObject({ status: 'lost', ruleId: 'no' })
    }
  )

  it('does not keep a captured predicate active when its extension is absent', () => {
    expect(
      evaluateOutcomes(
        program(startingOutcomeRows),
        outcomeWords.filter((word) => word.id !== 'NONE'),
        empty
      ).status
    ).toBe('playing')
    expect(
      evaluateOutcomes(
        program(startingOutcomeRows),
        outcomeWords.filter((word) => word.id !== 'IS'),
        empty
      ).status
    ).toBe('playing')
  })
})

describe('live outcome composition', () => {
  it('wins when a player pushes an IS word onto a bush, and undoes that win', async () => {
    const runtime = await openGame()
    try {
      await runtime.publishOutcomeRows([
        ...startingOutcomeRows,
        { id: 'bush-is', cells: ['BUSH', 'TOUCH', 'IS', 'WIN'] },
      ])
      runtime.game.load({
        ...runtime.game.puzzle,
        placements: [
          ...['PLNK', 'IS', 'YOU'].map(
            (type, x): Tile => ({
              id: `rule-${x}`,
              kind: 'word',
              type,
              x,
              y: 0,
            })
          ),
          { id: 'player', kind: 'entity', type: 'PLNK', x: 1, y: 4 },
          { id: 'loose-is', kind: 'word', type: 'IS', x: 2, y: 4 },
          { id: 'bush', kind: 'entity', type: 'BUSH', x: 3, y: 4 },
        ],
      })
      expect(runtime.game.board.status).toBe('playing')
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board.status).toBe('won')
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'loose-is')
      ).toMatchObject({ x: 3, y: 4 })
      runtime.game.undo()
      expect(runtime.game.board.status).toBe('playing')
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'loose-is')
      ).toMatchObject({ x: 2, y: 4 })
    } finally {
      await runtime.dispose()
    }
  })

  it('replaces IS word selection independently from its relation extension', async () => {
    const runtime = await openGame()
    try {
      await runtime.publishOutcomeRows([
        { id: 'contact', cells: ['BUSH', 'TOUCH', 'IS', 'WIN'] },
      ])
      runtime.game.place({
        id: 'bush-on-is',
        kind: 'entity',
        type: 'BUSH',
        x: 2,
        y: 8,
      })
      expect(runtime.game.board.status).toBe('won')
      const relation = runtime.outcomeMeanings.value.find(
        (meaning) => meaning.id === 'IS' && meaning.kind === 'relation'
      )
      const words = runtime.outcomeMeanings.value.find(
        (meaning) => meaning.id === 'IS' && meaning.kind === 'word-selector'
      )
      if (relation?.kind !== 'relation' || words?.kind !== 'word-selector')
        throw new Error('Missing IS contributions')
      await runtime.publishOutcomeMeaning({ ...relation, test: () => false })
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('won')
      await runtime.publishOutcomeMeaning({ ...words, select: () => [] })
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      const is = runtime.definitions.value.find(
        (definition) => definition.id === 'IS'
      )!
      await runtime.publish({ ...is, wordColor: '#ffffff' })
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      await runtime.publishOutcomeMeaning(words)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('won')
    } finally {
      await runtime.dispose()
    }
  })

  it('gives newly authored words selectable extensions and removes them with their definitions', async () => {
    const runtime = await openGame()
    try {
      await runtime.publish({ kind: 'word', id: 'FOG', color: '#ffffff' })
      await runtime.publishOutcomeRows([
        { id: 'fog', cells: ['FOG', 'TOUCH', 'BUSH', 'WIN'] },
      ])
      runtime.game.place({
        id: 'fog-word',
        kind: 'word',
        type: 'FOG',
        x: 7,
        y: 4,
      })
      expect(runtime.game.board.status).toBe('won')
      await runtime.publishOutcomeRows([])
      runtime.game.remove('fog-word')
      await runtime.deleteDefinition('FOG')
      expect(
        runtime.outcomeMeanings.value.some((meaning) => meaning.id === 'FOG')
      ).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps default YOU selection separate from the physical YOU word', async () => {
    const runtime = await openGame()
    try {
      runtime.game.remove('player')
      expect(
        runtime.game.board.tiles.some(
          (tile) => tile.type === 'YOU' && tile.kind === 'word'
        )
      ).toBe(true)
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU entities remain',
      })
      await runtime.publishOutcomeRows([
        {
          id: 'word-you',
          cells: ['YOU', 'IS', 'NONE', 'LOSE'],
          wordTiles: [0],
        },
      ])
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      const you = runtime.game.board.tiles.find(
        (tile) => tile.type === 'YOU' && tile.kind === 'word'
      )!
      runtime.game.remove(you.id)
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU word tiles remain',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('removes the no-YOU rule while preserving the board and its undo history', async () => {
    const runtime = await openGame()
    try {
      runtime.game.remove('player')
      expect(runtime.game.board.status).toBe('lost')
      const board = runtime.game.board
      await runtime.publishOutcomeRows(
        startingOutcomeRows.filter((row) => row.id !== 'no-you')
      )
      expect(runtime.game.board).toBe(board)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      runtime.game.undo()
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'player')
      ).toMatchObject({ x: 3, y: 5 })
      expect(runtime.game.board.status).toBe('playing')
    } finally {
      await runtime.dispose()
    }
  })

  it('can turn an empty YOU set into a win by editing the result tile', async () => {
    const runtime = await openGame()
    try {
      runtime.game.remove('player')
      await runtime.publishOutcomeRows([
        { id: 'edited', cells: ['YOU', 'IS', 'NONE', 'WIN'] },
      ])
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('won')
      runtime.game.undo()
      expect(runtime.game.board.status).toBe('playing')
    } finally {
      await runtime.dispose()
    }
  })

  it('leaves the installed graph and board unchanged when a draft fails to parse', async () => {
    const runtime = await openGame()
    try {
      const before = runtime.outcomeProgram.value,
        board = runtime.game.board
      await expect(
        runtime.publishOutcomeRows([
          { id: 'incomplete', cells: ['YOU', 'IS', '', 'LOSE'] },
        ])
      ).rejects.toThrow('Row 1')
      expect(runtime.outcomeProgram.value).toBe(before)
      expect(runtime.game.board).toBe(board)
      runtime.game.remove('player')
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'No YOU entities remain',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('follows replacement of a real NONE extension without recompiling the program', async () => {
    const runtime = await openGame()
    try {
      runtime.game.remove('player')
      const before = runtime.outcomeProgram.value
      const none = outcomeWords.find((word) => word.id === 'NONE')
      if (none?.kind !== 'unary') throw new Error('Missing NONE predicate')
      await runtime.publishOutcomeMeaning({ ...none, test: () => false })
      expect(runtime.outcomeProgram.value).toEqual(before)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      await runtime.publishOutcomeMeaning(none)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('lost')
      expect(
        runtime.registry
          .debug(gameContract.outcomeMeanings)
          .value.filter((word) => word.key === 'unary:NONE')
      ).toHaveLength(1)
    } finally {
      await runtime.dispose()
    }
  })

  it.each(['IS', 'TOUCH'])(
    'uses the contributed %s relation instead of hardcoded outcome checks',
    async (id) => {
      const runtime = await openGame()
      try {
        if (id === 'IS') {
          for (const [x, type] of ['PLNK', 'IS', 'WIN'].entries())
            runtime.game.place({
              id: `win-${x}`,
              kind: 'word',
              type,
              x: x + 1,
              y: 7,
            })
        } else {
          runtime.game.load({
            ...runtime.game.puzzle,
            placements: runtime.game.puzzle.placements.map((tile) =>
              tile.id === 'goal' ? { ...tile, x: 4, y: 5 } : tile
            ),
          })
          runtime.game.step({ x: 1, y: 0 })
        }
        expect(runtime.game.board.status).toBe('won')
        const predicate = outcomeWords.find((word) => word.id === id)
        if (predicate?.kind !== 'relation') throw new Error('Missing relation')
        await runtime.publishOutcomeMeaning({ ...predicate, test: () => false })
        runtime.game.settle()
        expect(runtime.game.board.status).toBe('playing')
      } finally {
        await runtime.dispose()
      }
    }
  )

  it('shares predicate word artwork through the ordinary vocabulary without changing meaning', async () => {
    const runtime = await openGame()
    try {
      expect(
        runtime.definitions.value
          .filter((word) => ['NONE', 'LOSE', 'TOUCH'].includes(word.id))
          .map((word) => word.id)
          .sort()
      ).toEqual(['LOSE', 'NONE', 'TOUCH'])
      const none = runtime.definitions.value.find((word) => word.id === 'NONE')!
      const board = runtime.game.board
      await runtime.publish({
        ...none,
        wordSprite: ['10', '01'],
        wordColor: '#ffffff',
      })
      expect(runtime.game.board).toBe(board)
      expect(
        runtime.definitions.value.filter((word) => word.id === 'NONE')
      ).toHaveLength(1)
      expect(
        runtime.definitions.value.find((word) => word.id === 'NONE')
      ).toMatchObject({ wordSprite: ['10', '01'], wordColor: '#ffffff' })
      runtime.game.place({
        id: 'normal-none',
        kind: 'word',
        type: 'NONE',
        x: 5,
        y: 8,
      })
      expect(
        runtime.game.board.tiles.find((tile) => tile.id === 'normal-none')
      ).toMatchObject({ type: 'NONE' })
      runtime.game.remove('player')
      expect(runtime.game.board.status).toBe('lost')
    } finally {
      await runtime.dispose()
    }
  })

  it('can select an ordinary noun in an outcome without an extra selector extension', async () => {
    const runtime = await openGame()
    try {
      await runtime.publishOutcomeRows([
        { id: 'noun', cells: ['PLNK', 'IS', 'NONE', 'LOSE'] },
      ])
      runtime.game.remove('player')
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'No PLNK entities remain',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('can select an authored property from the same installed vocabulary', async () => {
    const runtime = await openGame()
    try {
      await runtime.publish({
        kind: 'property',
        id: 'DANGER',
        color: '#ffffff',
        action: 'win',
      })
      await runtime.publishOutcomeRows([
        { id: 'custom', cells: ['YOU', 'TOUCH', 'DANGER', 'LOSE'] },
      ])
      runtime.game.load({
        ...runtime.game.puzzle,
        placements: [
          ...['PLNK', 'IS', 'YOU'].map(
            (type, x): Tile => ({ id: `you-${x}`, kind: 'word', type, x, y: 0 })
          ),
          ...['BUSH', 'IS', 'DANGER'].map(
            (type, x): Tile => ({
              id: `danger-${x}`,
              kind: 'word',
              type,
              x,
              y: 1,
            })
          ),
          { id: 'p', kind: 'entity', type: 'PLNK', x: 3, y: 5 },
          { id: 'b', kind: 'entity', type: 'BUSH', x: 4, y: 5 },
        ],
      })
      runtime.game.step({ x: 1, y: 0 })
      expect(runtime.game.board).toMatchObject({
        status: 'lost',
        message: 'YOU touches DANGER',
        ruleId: 'custom',
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('keeps vocabulary entries referenced by the applied outcome program installed', async () => {
    const runtime = await openGame()
    try {
      await expect(runtime.deleteDefinition('NONE')).rejects.toThrow(
        'outcome references'
      )
      await runtime.publishOutcomeRows(
        startingOutcomeRows.filter((row) => row.id !== 'no-you')
      )
      await runtime.deleteDefinition('NONE')
      expect(runtime.definitions.value.some((word) => word.id === 'NONE')).toBe(
        false
      )
    } finally {
      await runtime.dispose()
    }
  })
})
