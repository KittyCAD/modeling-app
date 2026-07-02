import { Registry } from '@kittycad/registry'
import { writeRecentProjectsForEnvironment } from '@src/lib/desktop'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import {
  combineProjectHandles,
  combineProjects,
  projectHandlesValueSpec,
  projectsValueSpec,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { listProjectHandlesFromRecentProjects, systemIOExtension } from '.'

vi.mock('@kittycad/lib', () => ({
  Client: vi.fn(),
  users: {},
}))

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: vi.fn(),
  kcCall: vi.fn(),
}))

const cleanup: Array<() => Promise<void> | void> = []

function createProject(path: string, name: string): Project {
  return {
    path,
    name,
    title: name,
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: fsZds.join(path, 'main.kcl'),
    children: [],
    readWriteAccess: true,
  }
}

describe('systemIO extension', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.()
    }
  })

  it('provides project handles without a settings service', async () => {
    const registry = new Registry()
    cleanup.push(() => registry[Symbol.dispose]())
    registry.configure([systemIOExtension])

    const systemIO = registry.get(systemIOService)

    expect(systemIO.projectHandles.value).toBeUndefined()
    expect(systemIO.projects.value).toBeUndefined()
    expect(registry.get(projectHandlesValueSpec)).toBeUndefined()
    expect(registry.get(projectsValueSpec)).toBeUndefined()

    const handles = await systemIO.refreshProjectHandles()
    expect(Array.isArray(handles)).toBe(true)
  })

  it('combines project handle contributions by path', () => {
    expect(
      combineProjectHandles([
        undefined,
        [{ path: '/projects/alpha' }, { path: '/projects/beta' }],
        [{ path: '/projects/beta' }, { path: '/projects/gamma' }],
      ])
    ).toEqual([
      { path: '/projects/alpha' },
      { path: '/projects/beta' },
      { path: '/projects/gamma' },
    ])
  })

  it('combines missing project handles as not loaded', () => {
    expect(combineProjectHandles([undefined])).toBeUndefined()
  })

  it('combines project contributions by path', () => {
    expect(
      combineProjects([
        undefined,
        [
          createProject('/projects/alpha', 'alpha'),
          createProject('/projects/beta', 'beta'),
        ],
        [
          createProject('/projects/beta', 'beta duplicate'),
          createProject('/projects/gamma', 'gamma'),
        ],
      ])?.map((project) => ({
        path: project.path,
        name: project.name,
      }))
    ).toEqual([
      { path: '/projects/alpha', name: 'alpha' },
      { path: '/projects/beta', name: 'beta' },
      { path: '/projects/gamma', name: 'gamma' },
    ])
  })

  it('lists recent project handles for an environment', async () => {
    const environmentName = `system-io-extension-${Date.now()}`
    const alphaProject = '/projects/alpha'
    const betaProject = '/projects/beta'

    cleanup.push(() => writeRecentProjectsForEnvironment([], environmentName))
    await writeRecentProjectsForEnvironment(
      [
        {
          path: alphaProject,
          name: 'alpha',
          default_file: fsZds.join(alphaProject, 'main.kcl'),
          kcl_file_count: 1,
          directory_count: 0,
          last_opened_at: 1,
        },
        {
          path: betaProject,
          name: 'beta',
          default_file: fsZds.join(betaProject, 'main.kcl'),
          kcl_file_count: 1,
          directory_count: 0,
          last_opened_at: 2,
        },
      ],
      environmentName
    )

    expect(await listProjectHandlesFromRecentProjects(environmentName)).toEqual(
      [{ path: betaProject }, { path: alphaProject }]
    )
  })
})
