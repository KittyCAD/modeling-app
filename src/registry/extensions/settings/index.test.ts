import { Registry } from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import { settingsService } from '@src/registry/contracts/settings'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import settingsRegistryItem from '.'

const desktopMocks = vi.hoisted(() => ({
  writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/desktop', () => ({
  writeProjectTitleToProjectToml: desktopMocks.writeProjectTitleToProjectToml,
}))

const project = {
  metadata: null,
  kcl_file_count: 1,
  directory_count: 0,
  title: 'Bracket',
  default_file: '/projects/bracket/main.kcl',
  path: '/projects/bracket',
  name: 'bracket',
  children: [],
  readWriteAccess: true,
} satisfies Project

describe('settings extension', () => {
  it('contributes the settings status bar item', () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])

    expect(registry.get(statusBarGlobalItemsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        label: 'Settings',
        'data-testid': 'settings-link',
      }),
    ])

    registry[Symbol.dispose]()
  })

  it('updates a writable project title', async () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])

    const service = registry.get(settingsService).projectTitle
    await service.updateTitle(project, 'Updated bracket')

    expect(desktopMocks.writeProjectTitleToProjectToml).toHaveBeenCalledWith(
      project.path,
      'Updated bracket'
    )
    expect(project.title).toBe('Updated bracket')
    expect(service.updates.value).toEqual({
      projectPath: project.path,
      title: 'Updated bracket',
    })

    registry[Symbol.dispose]()
  })
})
