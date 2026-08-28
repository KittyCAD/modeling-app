import { describe, expect, it } from 'vitest'
import type { ToolbarGroupItem } from '@src/contracts/sceneModes'
import {
  MODELING_TOOLS,
  TOOL_GROUPS,
  modelingOperations,
  toolbarItemsFor,
} from '@src/features/modelingOperations/operations/catalog'
import type {
  ModelingTool,
  ToolGroup,
} from '@src/features/modelingOperations/operations/catalog'
import { operationIdFor } from '@src/features/modelingOperations/operations/derive'
import { stdLibCommand } from '@src/lib/kclStdlib/shapes'

const tool = (overrides: Partial<ModelingTool> = {}): ModelingTool => ({
  stdlib: 'extrude',
  title: 'Extrude',
  past: 'Extruded',
  mode: 'modeling',
  ...overrides,
})

describe('deriving the toolbar from the tools', () => {
  it('gives an ungrouped tool a button of its own', () => {
    const items = toolbarItemsFor([tool({ section: 'create', order: 10 })], [])

    expect(items).toEqual([
      {
        kind: 'command',
        id: 'modeling.tool.extrude',
        mode: 'modeling',
        section: 'create',
        order: 10,
        commandId: 'modeling.extrude',
      },
    ])
  })

  it('collects a group and keeps its members in order', () => {
    const groups: ToolGroup[] = [{ id: 'transform', title: 'Transform' }]
    const items = toolbarItemsFor(
      [
        tool({ stdlib: 'rotate', group: 'transform', order: 20 }),
        tool({ stdlib: 'translate', group: 'transform', order: 10 }),
      ],
      groups
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'group',
      id: 'modeling.group.transform',
      title: 'Transform',
      commandIds: ['modeling.translate', 'modeling.rotate'],
    })
  })

  /* One source of truth: a group is where its tools are. */
  it('takes a group mode, section and position from its first member', () => {
    const items = toolbarItemsFor(
      [
        tool({
          stdlib: 'translate',
          group: 'transform',
          mode: 'modeling',
          section: 'transform',
          order: 40,
        }),
        tool({ stdlib: 'rotate', group: 'transform', order: 50 }),
      ],
      [{ id: 'transform', title: 'Transform' }]
    )

    expect(items[0]).toMatchObject({
      mode: 'modeling',
      section: 'transform',
      order: 40,
    })
  })

  it('leaves out a group nobody joined', () => {
    const items = toolbarItemsFor([tool()], [{ id: 'ghosts', title: 'Ghosts' }])

    expect(items.some((item) => item.kind === 'group')).toBe(false)
  })
})

/*
 * The catalog is the one list every surface is built from, so the ways it can be
 * internally inconsistent are worth failing a build over rather than noticing in
 * the app.
 */
describe('the shipped catalog', () => {
  it('derives every tool from a stdlib function that exists', () => {
    const missing = MODELING_TOOLS.filter(
      (entry) => stdLibCommand(entry.stdlib) === undefined
    )

    expect(missing.map((entry) => entry.stdlib)).toEqual([])
  })

  it('only prompts for arguments its function actually has', () => {
    const unknown = MODELING_TOOLS.flatMap((entry) => {
      const command = stdLibCommand(entry.stdlib)
      const names = new Set(command?.args.map((arg) => arg.name) ?? [])
      return (entry.prompt ?? [])
        .filter((name) => !names.has(name))
        .map((name) => `${entry.stdlib}.${name}`)
    })

    expect(unknown).toEqual([])
  })

  it('labels only arguments its function actually has', () => {
    const unknown = MODELING_TOOLS.flatMap((entry) => {
      const command = stdLibCommand(entry.stdlib)
      const names = new Set(command?.args.map((arg) => arg.name) ?? [])
      return Object.keys(entry.labels ?? {})
        .filter((name) => !names.has(name))
        .map((name) => `${entry.stdlib}.${name}`)
    })

    expect(unknown).toEqual([])
  })

  it('ships one operation per tool, with unique ids', () => {
    const ids = modelingOperations.map((operation) => operation.id)

    expect(ids).toHaveLength(MODELING_TOOLS.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names a group that exists for every grouped tool', () => {
    const declared = new Set(TOOL_GROUPS.map((group) => group.id))
    const orphans = MODELING_TOOLS.filter(
      (entry) => entry.group && !declared.has(entry.group)
    )

    expect(orphans.map((entry) => entry.stdlib)).toEqual([])
  })

  it('puts every group member in the same mode and section', () => {
    const inconsistent = TOOL_GROUPS.filter((group) => {
      const members = MODELING_TOOLS.filter((entry) => entry.group === group.id)
      return members.some(
        (member) =>
          member.mode !== members[0].mode ||
          member.section !== members[0].section
      )
    })

    expect(inconsistent.map((group) => group.id)).toEqual([])
  })

  /* A key bound twice in one mode is a key whose meaning depends on load order. */
  it('binds each key at most once per mode', () => {
    const seen = new Set<string>()
    const clashes: string[] = []

    for (const entry of MODELING_TOOLS) {
      if (!entry.key) continue
      const slot = `${entry.mode}:${entry.key}`
      if (seen.has(slot)) clashes.push(slot)
      seen.add(slot)
    }

    expect(clashes).toEqual([])
  })

  it('builds a toolbar whose every command is one of the shipped operations', () => {
    const ids = new Set(modelingOperations.map((operation) => operation.id))
    const items = toolbarItemsFor(MODELING_TOOLS, TOOL_GROUPS)

    const referenced = items.flatMap((item) =>
      item.kind === 'group'
        ? (item as ToolbarGroupItem).commandIds
        : [item.commandId]
    )

    expect(referenced.filter((id) => !ids.has(id))).toEqual([])
    // Every tool reaches the toolbar exactly once, grouped or not.
    expect(referenced).toHaveLength(MODELING_TOOLS.length)
  })

  it('gives every tool a distinct toolbar item id', () => {
    const items = toolbarItemsFor(MODELING_TOOLS, TOOL_GROUPS)
    const ids = items.map((item) => item.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the operation id rule in one place', () => {
    expect(operationIdFor('gdt::flatness')).toBe('modeling.gdt.flatness')
  })
})
