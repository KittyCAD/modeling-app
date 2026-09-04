import type { FuseResult } from 'fuse.js'

import {
  COMMAND_PALETTE_USAGE_STORAGE_KEY,
  rankCommandSearchResults,
  readCommandPaletteUsage,
  recordCommandPaletteUsage,
} from '@src/lib/commandPaletteUsage'
import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import { describe, expect, it, vi } from 'vitest'

const DAY_MS = 24 * 60 * 60 * 1000

function command(name: string, overrides: Partial<Command> = {}): Command {
  return {
    name,
    groupId: 'test',
    needsReview: false,
    onSubmit: () => {},
    ...overrides,
    scopes: overrides.scopes ?? GLOBAL_COMMAND_SCOPES,
  }
}

function storageWith(initialValue: string | null = null) {
  let value = initialValue

  return {
    getItem: vi.fn((key: string) =>
      key === COMMAND_PALETTE_USAGE_STORAGE_KEY ? value : null
    ),
    setItem: vi.fn((key: string, nextValue: string) => {
      if (key === COMMAND_PALETTE_USAGE_STORAGE_KEY) {
        value = nextValue
      }
    }),
  }
}

function rank(
  commands: Command[],
  history: ReturnType<typeof readCommandPaletteUsage>,
  {
    scores = commands.map(() => 0.01),
    isDisabled = () => false,
    now = 0,
  }: {
    scores?: number[]
    isDisabled?: (command: Command) => boolean
    now?: number
  } = {}
) {
  const results: FuseResult<Command>[] = commands.map((item, refIndex) => ({
    item,
    refIndex,
    score: scores[refIndex],
  }))
  return rankCommandSearchResults(results, history, isDisabled, now)
}

describe('command palette usage persistence', () => {
  it('increments and restores stable command keys', () => {
    const storage = storageWith()
    const commandWithId = command('Renamable command', { id: 'stable-id' })
    const fallbackCommand = command('Fallback command')

    recordCommandPaletteUsage(commandWithId, 100, storage)
    recordCommandPaletteUsage(commandWithId, 200, storage)
    recordCommandPaletteUsage(fallbackCommand, 300, storage)

    const history = readCommandPaletteUsage(storage)
    expect(history.get(commandKey(commandWithId))).toEqual({
      count: 2,
      lastUsedAt: 200,
    })
    expect(history.get(commandKey(fallbackCommand))).toEqual({
      count: 1,
      lastUsedAt: 300,
    })
  })

  it('fails open for invalid or unavailable storage', () => {
    expect(readCommandPaletteUsage(storageWith('{not-json'))).toEqual(new Map())
    expect(
      readCommandPaletteUsage(storageWith(' '.repeat(64 * 1024 + 1)))
    ).toEqual(new Map())
    expect(
      readCommandPaletteUsage(
        storageWith(JSON.stringify({ version: 2, entries: [] }))
      )
    ).toEqual(new Map())

    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new Error('Storage unavailable')
      }),
      setItem: vi.fn(() => {
        throw new Error('Storage unavailable')
      }),
    }
    expect(readCommandPaletteUsage(unavailableStorage)).toEqual(new Map())
    expect(() =>
      recordCommandPaletteUsage(command('Test'), 100, unavailableStorage)
    ).not.toThrow()
  })

  it('keeps only the 100 most recently selected commands', () => {
    const storage = storageWith()

    for (let index = 0; index < 101; index++) {
      recordCommandPaletteUsage(
        command(`Command ${index}`, { id: `command-${index}` }),
        index,
        storage
      )
    }

    const history = readCommandPaletteUsage(storage)
    expect(history.size).toBe(100)
    expect(history.has('command-0')).toBe(false)
    expect(history.has('command-100')).toBe(true)
  })
})

describe('command palette usage ranking', () => {
  it('promotes selected matches and increases the boost with frequency', () => {
    const storage = storageWith()
    const resetLayout = command('Reset layout')
    const resetView = command('Reset view')
    recordCommandPaletteUsage(resetView, 100, storage)

    expect(
      rank([resetLayout, resetView], readCommandPaletteUsage(storage), {
        now: 100,
      })
    ).toEqual([resetView, resetLayout])

    recordCommandPaletteUsage(resetLayout, 100, storage)
    recordCommandPaletteUsage(resetLayout, 100, storage)
    expect(
      rank([resetLayout, resetView], readCommandPaletteUsage(storage), {
        now: 100,
      })
    ).toEqual([resetLayout, resetView])
  })

  it('allows a recent selection to outrank several old selections', () => {
    const storage = storageWith()
    const frequentOld = command('Open older')
    const recent = command('Open recent')
    recordCommandPaletteUsage(frequentOld, 0, storage)
    recordCommandPaletteUsage(frequentOld, 0, storage)
    recordCommandPaletteUsage(frequentOld, 0, storage)
    recordCommandPaletteUsage(recent, 30 * DAY_MS, storage)

    expect(
      rank([frequentOld, recent], readCommandPaletteUsage(storage), {
        now: 30 * DAY_MS,
      })
    ).toEqual([recent, frequentOld])
  })

  it('does not let usage overcome a clearly better text match', () => {
    const storage = storageWith()
    const exact = command('Rectangle')
    const weaker = command('Create named view')
    for (let count = 0; count < 10; count++) {
      recordCommandPaletteUsage(weaker, 100, storage)
    }

    expect(
      rank([exact, weaker], readCommandPaletteUsage(storage), {
        now: 100,
        scores: [0.005, 0.04],
      })
    ).toEqual([exact, weaker])
  })

  it('tracks variants of the same machine event separately', () => {
    const storage = storageWith()
    const line = command('change tool', { displayName: 'Line' })
    const tangentialArc = command('change tool', {
      displayName: 'Tangential Arc',
    })
    recordCommandPaletteUsage(tangentialArc, 100, storage)

    expect(
      rank([line, tangentialArc], readCommandPaletteUsage(storage), {
        now: 100,
      })
    ).toEqual([tangentialArc, line])
  })

  it('keeps disabled commands last regardless of usage', () => {
    const storage = storageWith()
    const enabled = command('Reset layout')
    const disabled = command('Reset view', { disabled: true })
    recordCommandPaletteUsage(disabled, 100, storage)

    expect(
      rank([disabled, enabled], readCommandPaletteUsage(storage), {
        isDisabled: (candidate) => Boolean(candidate.disabled),
        now: 100,
      })
    ).toEqual([enabled, disabled])
  })

  it('preserves Fuse order when there is no history', () => {
    const commands = [command('Second'), command('First')]

    expect(rank(commands, new Map(), { scores: [0.01, 0.02] })).toEqual(
      commands
    )
  })
})
