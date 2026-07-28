import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
} from '@src/registry/contracts/homeProjects'
import {
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

const library = {
  id: 'cloud-library',
  title: 'Cloud',
  path: '/cloud',
  type: 'cloud',
} satisfies ProjectLibrary

const project = {
  id: 'remote:remote-project-123',
  source: 'remote',
  status: 'cloud-only',
  libraryIds: [library.id],
  name: 'Bracket',
  title: 'Bracket',
  remoteProjectId: 'remote-project-123',
  readWriteAccess: true,
} satisfies HomeProjectEntry

describe('home project actions', () => {
  it('allows a project library to duplicate a remote-only project', () => {
    const registry = new Registry()
    registry.configure([
      homeProjectsExtension,
      defineRegistryItem({
        id: 'remote-duplicate-test-library',
        provides: [
          provide(projectLibrariesValueSpec, library),
          provide(projectLibraryTypesValueSpec, {
            type: library.type,
            title: library.title,
            operations: {
              duplicateProject: {
                run: async () => undefined,
              },
            },
          }),
        ],
      }),
    ])

    try {
      expect(
        registry.get(homeProjectActionsService).canDuplicate(project)
      ).toBe(true)
    } finally {
      registry[Symbol.dispose]()
    }
  })
})
