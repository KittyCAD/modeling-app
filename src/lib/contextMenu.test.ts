import { signal } from '@preact/signals'
import type { Command, CommandService } from '@src/contracts/commands'
import type { ContextMenuContribution } from '@src/contracts/contextMenu'
import { resolveContextMenu } from '@src/lib/contextMenu'
import { describe, expect, it, vi } from 'vitest'

function commandService(items: Command[]): CommandService {
  const run = vi.fn()
  return {
    all: signal(items),
    get: (id) => items.find((item) => item.id === id),
    run,
  }
}

describe('resolveContextMenu', () => {
  it('resolves command presentation and availability', () => {
    const commands = commandService([
      {
        id: 'camera.fit',
        title: 'Zoom to fit',
        icon: 'cube',
        shortcut: 'V F',
        enabled: signal(false),
        run: () => {},
      },
    ])

    const sections = resolveContextMenu(
      [{ id: 'fit', commandId: 'camera.fit' }],
      {},
      commands
    )

    expect(sections[0].items?.[0]).toMatchObject({
      label: 'Zoom to fit',
      icon: 'cube',
      shortcut: 'V F',
      disabled: true,
    })
  })

  it('filters against the clicked context and keeps direct handlers contextual', () => {
    const selected: string[] = []
    const contributions: ContextMenuContribution<{
      kind: 'file' | 'directory'
      path: string
    }>[] = [
      {
        id: 'new',
        label: 'New file',
        visible: ({ kind }) => kind === 'directory',
        onSelect: ({ path }) => selected.push(path),
      },
    ]
    const commands = commandService([])

    expect(
      resolveContextMenu(
        contributions,
        { kind: 'file', path: 'main.kcl' },
        commands
      )
    ).toEqual([])

    const sections = resolveContextMenu(
      contributions,
      { kind: 'directory', path: 'parts' },
      commands
    )
    sections[0].items?.[0].onSelect?.()
    expect(selected).toEqual(['parts'])
  })

  it('orders sections and their actions deterministically', () => {
    const commands = commandService([])
    const sections = resolveContextMenu(
      [
        {
          id: 'delete',
          order: 20,
          section: { id: 'manage', order: 100 },
          label: 'Delete',
          onSelect: () => {},
        },
        {
          id: 'rename',
          order: 10,
          section: { id: 'manage', order: 100 },
          label: 'Rename',
          onSelect: () => {},
        },
        {
          id: 'new',
          section: { id: 'create', order: 0 },
          label: 'New file',
          onSelect: () => {},
        },
      ],
      {},
      commands
    )

    expect(sections.map((section) => section.id)).toEqual(['create', 'manage'])
    expect(sections[1].items?.map((item) => item.id)).toEqual([
      'rename',
      'delete',
    ])
  })

  it('lets a later contribution complete shared section metadata', () => {
    const sections = resolveContextMenu(
      [
        {
          id: 'extension',
          order: -10,
          section: { id: 'manage' },
          label: 'Extension action',
          onSelect: () => {},
        },
        {
          id: 'built-in',
          section: { id: 'manage', order: 100, label: 'Manage' },
          label: 'Built-in action',
          onSelect: () => {},
        },
      ],
      {},
      commandService([])
    )

    expect(sections[0].label).toBe('Manage')
  })
})
