import { Registry } from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import { settingsService } from '@src/registry/contracts/settings'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import settingsRegistryItem from '.'

const mocks = vi.hoisted(() => ({
  writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/desktop', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    writeProjectTitleToProjectToml: mocks.writeProjectTitleToProjectToml,
  }
})

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
    const registry = new Registry()
    registry.configure([settingsRegistryItem])

    const service = registry.get(settingsService).projectTitle
    await service.updateTitle(project, 'Updated bracket')

    expect(mocks.writeProjectTitleToProjectToml).toHaveBeenCalledWith(
      project.path,
      'Updated bracket'
    )
    expect(project.title).toBe('Updated bracket')

    registry[Symbol.dispose]()
  })
})
