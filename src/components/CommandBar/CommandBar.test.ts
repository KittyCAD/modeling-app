import { describe, expect, it } from 'vitest'

import { isCommandVisibleInSearch } from '@src/components/CommandBar/commandSearchVisibility'
import type { Command } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

function command(overrides: Partial<Command> = {}): Command {
  return {
    name: 'Test command',
    groupId: 'test',
    needsReview: false,
    onSubmit: () => undefined,
    ...overrides,
    scopes: overrides.scopes ?? GLOBAL_COMMAND_SCOPES,
  }
}

describe('isCommandVisibleInSearch', () => {
  it('shows ordinary commands', () => {
    expect(isCommandVisibleInSearch(command(), false)).toBe(true)
  })

  it('hides commands explicitly hidden from search', () => {
    expect(
      isCommandVisibleInSearch(command({ hideFromSearch: true }), false)
    ).toBe(false)
  })

  it('allows commands with hideFromSearch explicitly false', () => {
    expect(
      isCommandVisibleInSearch(command({ hideFromSearch: false }), false)
    ).toBe(true)
  })

  it('hides commands hidden on both platforms', () => {
    expect(isCommandVisibleInSearch(command({ hide: 'both' }), false)).toBe(
      false
    )
  })

  it('hides web-hidden commands on web', () => {
    expect(isCommandVisibleInSearch(command({ hide: 'web' }), false)).toBe(
      false
    )
  })

  it('shows web-hidden commands on desktop', () => {
    expect(isCommandVisibleInSearch(command({ hide: 'web' }), true)).toBe(true)
  })

  it('hides desktop-hidden commands on desktop', () => {
    expect(isCommandVisibleInSearch(command({ hide: 'desktop' }), true)).toBe(
      false
    )
  })

  it('shows desktop-hidden commands on web', () => {
    expect(isCommandVisibleInSearch(command({ hide: 'desktop' }), false)).toBe(
      true
    )
  })
})
