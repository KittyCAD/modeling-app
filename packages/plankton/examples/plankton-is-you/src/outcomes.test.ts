import { describe, expect, it } from 'vitest'
import type { Tile } from './game'
import {
  evaluateOutcomes,
  type OutcomeContext,
  type OutcomeRow,
  outcomeWords,
  parseOutcomeRows,
  startingOutcomeRows,
} from './outcomes'
import { gameContract, openGame } from './registry'

const empty: OutcomeContext = { controlled: [], winning: [], losing: [] }
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
    const selfWin = { controlled: [player], winning: [player], losing: [] }
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
    ['NONE', 'IS', 'NONE', 'LOSE'],
    ['YOU', 'YOU', 'WIN', 'WIN'],
    ['YOU', 'TOUCH', 'NONE', 'LOSE'],
    ['YOU', 'IS', '', 'LOSE'],
    ['YOU', 'IS', 'NONE', 'YOU'],
  ])('rejects an incomplete or ill-typed row: %j', (...cells) => {
    const parsed = parseOutcomeRows([{ id: 'bad', cells }], outcomeWords)
    expect(parsed.ok).toBe(false)
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
      await runtime.publishOutcomeWord({ ...none, test: () => false })
      expect(runtime.outcomeProgram.value).toEqual(before)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('playing')
      await runtime.publishOutcomeWord(none)
      runtime.game.settle()
      expect(runtime.game.board.status).toBe('lost')
      expect(
        runtime.registry
          .debug(gameContract.outcomeWords)
          .value.filter((word) => word.key === 'NONE')
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
        await runtime.publishOutcomeWord({ ...predicate, test: () => false })
        runtime.game.settle()
        expect(runtime.game.board.status).toBe('playing')
      } finally {
        await runtime.dispose()
      }
    }
  )

  it('saves predicate artwork without changing its meaning or the running board', async () => {
    const runtime = await openGame()
    try {
      const none = outcomeWords.find((word) => word.id === 'NONE')!
      const board = runtime.game.board
      await runtime.publishOutcomeWord({
        ...none,
        wordSprite: ['10', '01'],
        color: '#ffffff',
      })
      expect(runtime.game.board).toBe(board)
      expect(
        runtime.outcomeWords.value.find((word) => word.id === 'NONE')
      ).toMatchObject({ wordSprite: ['10', '01'], color: '#ffffff' })
      runtime.game.remove('player')
      expect(runtime.game.board.status).toBe('lost')
    } finally {
      await runtime.dispose()
    }
  })
})
