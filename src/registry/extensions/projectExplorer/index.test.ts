import { Registry } from '@kittycad/registry'
import {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import projectExplorerExtension from '@src/registry/extensions/projectExplorer'
import { describe, expect, it } from 'vitest'

describe('project explorer extension', () => {
  it('contributes the reveal-in-file-explorer menu items', () => {
    const registry = new Registry()
    registry.configure([projectExplorerExtension])

    expect(
      registry
        .get(projectExplorerProjectMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual(['project-explorer.project-menu.reveal-in-file-explorer'])

    expect(
      registry
        .get(projectExplorerRowContextMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual(['project-explorer.reveal-in-file-explorer'])

    registry[Symbol.dispose]()
  })
})
