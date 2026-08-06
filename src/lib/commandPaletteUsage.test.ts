import Fuse from 'fuse.js'

import {
  COMMAND_PALETTE_USAGE_STORAGE_KEY,
  rankCommandSearchResults,
  readCommandPaletteUsage,
  recordCommandPaletteUsage,
} from '@src/lib/commandPaletteUsage'
import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'
import { describe, expect, it, vi } from 'vitest'

function command(name: string, overrides: Partial<Command> = {}): Command {
  return {
    name,
    groupId: 'test',
    needsReview: false,
    onSubmit: () => {},
    ...overrides,
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

function search(commands: Command[], query: string) {
  return new Fuse(commands, {
    keys: ['displayName', 'name', 'description'],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
  }).search(query)
}

function rank(
  commands: Command[],
  query: string,
  history: ReturnType<typeof readCommandPaletteUsage>,
  isDisabled: (command: Command) => boolean = () => false
) {
  return rankCommandSearchResults(search(commands, query), history, isDisabled)
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
      rank([resetLayout, resetView], 'reset', readCommandPaletteUsage(storage))
    ).toEqual([resetView, resetLayout])

    recordCommandPaletteUsage(resetLayout, 200, storage)
    recordCommandPaletteUsage(resetLayout, 300, storage)
    expect(
      rank([resetLayout, resetView], 'reset', readCommandPaletteUsage(storage))
    ).toEqual([resetLayout, resetView])
  })

  it('uses recency when matching commands have equal counts', () => {
    const storage = storageWith()
    const older = command('Open older')
    const newer = command('Open newer')
    recordCommandPaletteUsage(older, 100, storage)
    recordCommandPaletteUsage(newer, 200, storage)

    expect(
      rank([older, newer], 'open', readCommandPaletteUsage(storage))
    ).toEqual([newer, older])
  })

  it('tracks variants of the same machine event separately', () => {
    const storage = storageWith()
    const line = command('change tool', { displayName: 'Line' })
    const tangentialArc = command('change tool', {
      displayName: 'Tangential Arc',
    })
    recordCommandPaletteUsage(tangentialArc, 100, storage)

    expect(
      rank([line, tangentialArc], 'change', readCommandPaletteUsage(storage))
    ).toEqual([tangentialArc, line])
  })

  it('keeps disabled commands last regardless of usage', () => {
    const storage = storageWith()
    const enabled = command('Reset layout')
    const disabled = command('Reset view', { disabled: true })
    recordCommandPaletteUsage(disabled, 100, storage)

    expect(
      rank(
        [disabled, enabled],
        'reset',
        readCommandPaletteUsage(storage),
        (candidate) => Boolean(candidate.disabled)
      )
    ).toEqual([enabled, disabled])
  })

  it('preserves Fuse order when there is no history', () => {
    const commands = [command('Second'), command('First')]
    const results = search(commands, 's')

    expect(rankCommandSearchResults(results, new Map(), () => false)).toEqual(
      results.map(({ item }) => item)
    )
  })
})
