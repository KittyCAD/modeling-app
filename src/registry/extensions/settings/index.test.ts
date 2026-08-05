import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { homeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { settingsService } from '@src/registry/contracts/settings'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import settingsRegistryItem from '.'

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

  it('updates a writable project title before Home has indexed it', async () => {
    const renameLocalProject = vi.fn().mockResolvedValue(undefined)
    const registry = new Registry()
    registry.configure([
      settingsRegistryItem,
      defineRegistryItem({
        id: 'test.home-project-actions',
        providesServices: [
          provideService(homeProjectActionsService, {
            renameLocalProject,
          } as unknown as HomeProjectActionsService),
        ],
      }),
    ])

    const service = registry.get(settingsService).projectTitle
    await service.updateTitle(project, 'Updated bracket')

    expect(renameLocalProject).toHaveBeenCalledWith(project, 'Updated bracket')

    registry[Symbol.dispose]()
  })
})
