import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import {
  layoutActionLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { describe, expect, it } from 'vitest'
import prusaSlicer from '.'

describe('prusaSlicer plugin', () => {
  it('registers a toggleable PrusaSlicer toolbar action', () => {
    const registry = new Registry()
    registry.configure([prusaSlicer])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(plugin).toMatchObject({
      id: 'prusa-slicer',
      title: 'PrusaSlicer export',
    })

    const toggle = registry.get(plugin.service)
    expect(toggle.active.value).toBe(false)
    expect(
      registry.get(settingsValueSpec).plugins['prusa-slicer'].createSetting()
        .default
    ).toBe(false)

    expect(registry.get(layoutActionLibraryValueSpec)).toEqual({})
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])

    toggle.enable()

    expect(registry.get(layoutActionLibraryValueSpec)).toHaveProperty(
      'exportToPrusaSlicer'
    )
    expect(registry.get(layoutContributionsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'prusa-slicer.left-toolbar.action',
        kind: 'action',
        action: expect.objectContaining({
          id: 'export-to-prusaslicer',
          label: 'Export to PrusaSlicer',
          icon: 'printer3d',
          actionType: 'exportToPrusaSlicer',
        }),
        placement: {
          targetPaneId: DefaultLayoutToolbarID.Left,
          position: 'end',
        },
      }),
    ])

    toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(layoutActionLibraryValueSpec)).toEqual({})
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])
  })
})
