import { describe, expect, it } from 'vitest'
import {
  type ToolbarEntry,
  type ToolbarGroup,
  toolbarItemsFrom,
} from '@src/lib/toolbarItems'

const entry = (overrides: Partial<ToolbarEntry> = {}): ToolbarEntry => ({
  commandId: 'thing.extrude',
  itemId: 'thing.item.extrude',
  mode: 'modeling',
  ...overrides,
})

const group: ToolbarGroup = {
  id: 'transform',
  itemId: 'thing.group.transform',
  title: 'Transform',
  icon: 'move',
}

describe('deriving buttons from tools', () => {
  it('gives an ungrouped tool a button of its own', () => {
    const items = toolbarItemsFrom(
      [entry({ section: 'create', order: 10 })],
      []
    )

    expect(items).toEqual([
      {
        kind: 'command',
        id: 'thing.item.extrude',
        mode: 'modeling',
        section: 'create',
        order: 10,
        commandId: 'thing.extrude',
      },
    ])
  })

  it('collects a group and keeps its members in order', () => {
    const items = toolbarItemsFrom(
      [
        entry({
          commandId: 'thing.rotate',
          itemId: 'i.rotate',
          group: 'transform',
          order: 20,
        }),
        entry({
          commandId: 'thing.translate',
          itemId: 'i.translate',
          group: 'transform',
          order: 10,
        }),
      ],
      [group]
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'group',
      id: 'thing.group.transform',
      title: 'Transform',
      commandIds: ['thing.translate', 'thing.rotate'],
    })
  })

  /* One source of truth: a group is where its tools are. */
  it('takes a group’s mode, section and position from its first member', () => {
    const items = toolbarItemsFrom(
      [
        entry({
          group: 'transform',
          mode: 'annotating',
          section: 'edit',
          order: 40,
        }),
      ],
      [group]
    )

    expect(items[0]).toMatchObject({
      mode: 'annotating',
      section: 'edit',
      order: 40,
    })
  })

  /*
   * Which is what lets a group survive its members being removed — a caret over
   * an empty menu is worse than a missing button.
   */
  it('leaves out a group nobody joined', () => {
    expect(toolbarItemsFrom([entry()], [group])).toHaveLength(1)
    expect(toolbarItemsFrom([], [group])).toEqual([])
  })

  it('leaves a grouped tool out of the ungrouped buttons', () => {
    const items = toolbarItemsFrom([entry({ group: 'transform' })], [group])

    expect(items.filter((item) => item.kind === 'command')).toEqual([])
  })

  /*
   * It invents no ids. Each catalogue names its own commands and buttons, so the
   * naming rule stays with whoever has to keep it stable.
   */
  it('uses the ids it was given, unchanged', () => {
    const items = toolbarItemsFrom(
      [entry({ commandId: 'a::b', itemId: 'weird id' })],
      []
    )

    expect(items[0]).toMatchObject({ id: 'weird id', commandId: 'a::b' })
  })
})
