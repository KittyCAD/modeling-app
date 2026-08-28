import { describe, expect, it } from 'vitest'
import type { Command } from '@src/contracts/commands'
import type { ToolbarItem } from '@src/contracts/sceneModes'
import { resolveToolbar } from '@src/features/sceneToolbar/resolveToolbar'

const command = (id: string): Command => ({
  id,
  title: id,
  run: () => {},
})

const registry = (...ids: string[]) => {
  const commands = new Map(ids.map((id) => [id, command(id)]))
  return (id: string) => commands.get(id)
}

const button = (
  id: string,
  overrides: Partial<ToolbarItem> = {}
): ToolbarItem =>
  ({
    kind: 'command',
    id,
    mode: 'modeling',
    commandId: id,
    ...overrides,
  }) as ToolbarItem

const resolve = (
  items: readonly ToolbarItem[],
  options: {
    mode?: string | null
    commands?: (id: string) => Command | undefined
    lastUsed?: ReadonlyMap<string, string>
  } = {}
) =>
  resolveToolbar({
    items,
    mode: options.mode === undefined ? 'modeling' : options.mode,
    commandFor: options.commands ?? registry('extrude', 'fillet', 'chamfer'),
    lastUsed: options.lastUsed ?? new Map(),
  })

describe('resolving a mode toolbar', () => {
  it('shows only the active mode', () => {
    const sections = resolve([
      button('extrude'),
      button('fillet', { mode: 'annotating' }),
    ])

    expect(sections).toHaveLength(1)
    expect(sections[0].entries.map((entry) => entry.id)).toEqual(['extrude'])
  })

  it('has nothing to show before a mode exists', () => {
    expect(resolve([button('extrude')], { mode: null })).toEqual([])
  })

  it('sorts by order, with the id as a tiebreaker', () => {
    const sections = resolve([
      button('fillet', { order: 10 }),
      button('chamfer', { order: 10 }),
      button('extrude', { order: 1 }),
    ])

    expect(sections[0].entries.map((entry) => entry.id)).toEqual([
      'extrude',
      'chamfer',
      'fillet',
    ])
  })

  /* Sections are how a divider survives being contributed by someone else. */
  it('separates named sections, ordered by their earliest item', () => {
    const sections = resolve([
      button('chamfer', { section: 'modify', order: 20 }),
      button('extrude', { section: 'create', order: 10 }),
      button('fillet', { section: 'modify', order: 30 }),
    ])

    expect(sections.map((section) => section.id)).toEqual(['create', 'modify'])
    expect(sections[1].entries.map((entry) => entry.id)).toEqual([
      'chamfer',
      'fillet',
    ])
  })

  it('keeps an item added later inside its section rather than between two', () => {
    const sections = resolve([
      button('extrude', { section: 'create', order: 10 }),
      button('fillet', { section: 'modify', order: 20 }),
      // Contributed by another feature, with an order that falls in the middle.
      button('chamfer', { section: 'create', order: 15 }),
    ])

    expect(sections.map((section) => section.entries.map((e) => e.id))).toEqual(
      [['extrude', 'chamfer'], ['fillet']]
    )
  })

  /*
   * A missing command is a bug in a contribution, not a state to render: a
   * disabled button promises an action that exists.
   */
  it('drops an item whose command was never registered', () => {
    const sections = resolve([button('extrude'), button('nonexistent')])

    expect(sections[0].entries.map((entry) => entry.id)).toEqual(['extrude'])
  })

  it('has no sections at all when nothing resolves', () => {
    expect(resolve([button('nonexistent')])).toEqual([])
  })
})

describe('resolving a toolbar group', () => {
  const group = (overrides: Partial<ToolbarItem> = {}): ToolbarItem =>
    ({
      kind: 'group',
      id: 'modify',
      mode: 'modeling',
      title: 'Modify',
      commandIds: ['fillet', 'chamfer'],
      ...overrides,
    }) as ToolbarItem

  it('puts the first command on the face until something is used', () => {
    const sections = resolve([group()])
    const entry = sections[0].entries[0]

    expect(entry.kind).toBe('group')
    if (entry.kind !== 'group') return
    expect(entry.face.id).toBe('fillet')
    expect(entry.commands.map((c) => c.id)).toEqual(['fillet', 'chamfer'])
  })

  it('puts the last used command on the face', () => {
    const sections = resolve([group()], {
      lastUsed: new Map([['modify', 'chamfer']]),
    })
    const entry = sections[0].entries[0]

    expect(entry.kind === 'group' && entry.face.id).toBe('chamfer')
  })

  it('ignores a remembered command that is no longer in the group', () => {
    const sections = resolve([group()], {
      lastUsed: new Map([['modify', 'extrude']]),
    })
    const entry = sections[0].entries[0]

    expect(entry.kind === 'group' && entry.face.id).toBe('fillet')
  })

  it('keeps the contributed order in the menu, not the recency order', () => {
    const sections = resolve([group()], {
      lastUsed: new Map([['modify', 'chamfer']]),
    })
    const entry = sections[0].entries[0]

    expect(entry.kind === 'group' && entry.commands.map((c) => c.id)).toEqual([
      'fillet',
      'chamfer',
    ])
  })

  it('leaves out commands that do not exist', () => {
    const sections = resolve([
      group({
        commandIds: ['fillet', 'gone', 'chamfer'],
      }),
    ])
    const entry = sections[0].entries[0]

    expect(entry.kind === 'group' && entry.commands.map((c) => c.id)).toEqual([
      'fillet',
      'chamfer',
    ])
  })

  /* A caret asking a question with one answer is a worse button. */
  it('collapses to a plain button when one command is left', () => {
    const sections = resolve([group({ commandIds: ['fillet', 'gone'] })])
    const entry = sections[0].entries[0]

    expect(entry.kind).toBe('command')
    expect(entry.kind === 'command' && entry.command.id).toBe('fillet')
    // Still keyed by the group, so it does not collide with a button of its own.
    expect(entry.id).toBe('modify')
  })

  it('disappears when none of its commands exist', () => {
    expect(resolve([group({ commandIds: ['gone', 'also-gone'] })])).toEqual([])
  })
})
