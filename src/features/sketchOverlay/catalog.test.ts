import { describe, expect, it } from 'vitest'
import {
  SKETCH_ACTIONS,
  SKETCH_GROUPS,
  sketchToolbarItems,
} from '@src/features/sketchOverlay/catalog'
import { CONSTRAINT_TOOLS } from '@src/lib/sketch/constraints'
import { SKETCH_TOOL_IDS } from '@src/lib/sketch/tools'

/**
 * The ways this list can contradict itself.
 *
 * The same suite the modelling catalogue has, and for the same reason: a
 * catalogue is data, and data that is wrong is wrong at build time rather than
 * when somebody presses the button. Two of these — the key clash and the
 * completeness checks — cover the failure that was actually possible before
 * there was one list: a segment tool and a constraint quietly claiming the same
 * letter, because nothing compared the two tables.
 */

describe('the sketch catalogue', () => {
  it('gives every action a distinct command id', () => {
    const ids = SKETCH_ACTIONS.map((action) => action.commandId)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every action a distinct toolbar item id', () => {
    const ids = SKETCH_ACTIONS.map((action) => action.itemId)

    expect(new Set(ids).size).toBe(ids.length)
  })

  /*
   * The one that could not be checked before. Segment tools, constraints and the
   * dimension were three lists, so nothing said whether `d` or `x` had already
   * been taken.
   */
  it('binds each key at most once per mode', () => {
    const seen = new Set<string>()
    const clashes: string[] = []

    for (const action of SKETCH_ACTIONS) {
      if (!action.key) continue
      const slot = `${action.mode}:${action.key}`
      if (seen.has(slot)) clashes.push(slot)
      seen.add(slot)
    }

    expect(clashes).toEqual([])
  })

  it('gives every action an icon and a description', () => {
    for (const action of SKETCH_ACTIONS) {
      expect(action.icon, action.commandId).toBeTruthy()
      expect(action.description, action.commandId).toBeTruthy()
    }
  })

  /* A tooltip, not a manual. */
  it('describes an action in one sentence', () => {
    for (const action of SKETCH_ACTIONS) {
      expect(action.description.length, action.commandId).toBeLessThan(120)
      expect(
        action.description.split('. ').length,
        action.commandId
      ).toBeLessThan(3)
    }
  })

  it('names a group that exists for every grouped action', () => {
    const groups = new Set(SKETCH_GROUPS.map((group) => group.id))

    for (const action of SKETCH_ACTIONS) {
      if (!action.group) continue
      expect(groups, action.commandId).toContain(action.group)
    }
  })

  /* A group is one button; its members cannot be in two toolbars or two runs. */
  it('puts every group member in the same mode and section', () => {
    for (const group of SKETCH_GROUPS) {
      const members = SKETCH_ACTIONS.filter(
        (action) => action.group === group.id
      )
      const modes = new Set(members.map((action) => action.mode))
      const sections = new Set(members.map((action) => action.section))

      expect(modes.size, group.id).toBeLessThan(2)
      expect(sections.size, group.id).toBeLessThan(2)
    }
  })
})

describe('what the catalogue covers', () => {
  /*
   * Every tool the draft model can equip has a way to equip it. A tool with
   * behaviour and no button is unreachable, which is the kind of thing that only
   * shows up when somebody asks why the arc is missing.
   */
  it('offers exactly one button per drawing tool', () => {
    const offered = SKETCH_ACTIONS.flatMap((action) =>
      action.what.kind === 'tool' ? [action.what.tool] : []
    )

    expect([...offered].sort()).toEqual([...SKETCH_TOOL_IDS].sort())
  })

  /* And the same the other way: a constraint the matcher knows is pressable. */
  it('offers exactly one button per constraint', () => {
    const offered = SKETCH_ACTIONS.flatMap((action) =>
      action.what.kind === 'constraint' ? [action.what.constraint] : []
    )

    expect([...offered].sort()).toEqual(
      CONSTRAINT_TOOLS.map((tool) => tool.id).sort()
    )
  })

  it('takes each constraint’s name from the matcher’s own table', () => {
    for (const tool of CONSTRAINT_TOOLS) {
      const action = SKETCH_ACTIONS.find(
        (candidate) =>
          candidate.what.kind === 'constraint' &&
          candidate.what.constraint === tool.id
      )

      // One name in two places is one name to get wrong — and the session puts
      // this one in a message when a selection cannot take the constraint.
      expect(action?.title).toBe(tool.title)
    }
  })

  it('offers exactly one dimension button', () => {
    const dimensions = SKETCH_ACTIONS.filter(
      (action) => action.what.kind === 'dimension'
    )

    expect(dimensions).toHaveLength(1)
  })
})

describe('the toolbar it derives', () => {
  it('gives every button a command that is one of the actions', () => {
    const commands = new Set(SKETCH_ACTIONS.map((action) => action.commandId))

    for (const item of sketchToolbarItems()) {
      const ids = item.kind === 'group' ? item.commandIds : [item.commandId]
      for (const id of ids) expect(commands).toContain(id)
    }
  })

  it('collects the constraints into one button and leaves the rest alone', () => {
    const items = sketchToolbarItems()
    const groups = items.filter((item) => item.kind === 'group')

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'sketch.group.constraints',
      title: 'Constraints',
    })
    // Six drawing tools and the dimension, each with a button of its own.
    expect(items.filter((item) => item.kind === 'command')).toHaveLength(
      SKETCH_TOOL_IDS.length + 1
    )
  })

  it('keeps the constraints in the order the catalogue lists them', () => {
    const group = sketchToolbarItems().find((item) => item.kind === 'group')
    const expected = SKETCH_ACTIONS.filter(
      (action) => action.group === 'constraints'
    )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((action) => action.commandId)

    expect(group?.kind === 'group' ? group.commandIds : []).toEqual(expected)
  })
})
