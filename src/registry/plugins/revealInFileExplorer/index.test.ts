import { Registry, pluginsValueSpec } from '@kittycad/registry'
import {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { describe, expect, it } from 'vitest'
import revealInFileExplorer from '.'

describe('revealInFileExplorer plugin', () => {
  it('contributes the reveal-in-file-explorer menu items by default', () => {
    const registry = new Registry()
    registry.configure([revealInFileExplorer])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(plugin.id).toBe('reveal-in-file-explorer')
    expect(registry.get(plugin.service).active.value).toBe(true)
    expect(
      registry
        .get(settingsValueSpec)
        .plugins['reveal-in-file-explorer'].createSetting().default
    ).toBe(true)

    expect(
      registry
        .get(projectExplorerProjectMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual(['reveal-in-file-explorer.project-menu'])

    expect(
      registry
        .get(projectExplorerRowContextMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual(['reveal-in-file-explorer.row-context-menu'])

    registry[Symbol.dispose]()
  })

  it('removes the reveal-in-file-explorer menu items when disabled', () => {
    const registry = new Registry()
    registry.configure([revealInFileExplorer])

    const [plugin] = registry.get(pluginsValueSpec)
    const toggle = registry.get(plugin.service)
    toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(projectExplorerProjectMenuItemsValueSpec)).toEqual([])
    expect(registry.get(projectExplorerRowContextMenuItemsValueSpec)).toEqual(
      []
    )

    registry[Symbol.dispose]()
  })
})
