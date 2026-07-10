import { signal } from '@preact/signals-core'
import { waitFor } from '@testing-library/react'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { PATHS, safeEncodeForRouterPaths } from '@src/lib/paths'
import type { Command } from '@src/lib/commandTypes'
import type { HomeProjectEntryContribution } from '@src/registry/contracts/homeProjects'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    error: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: mockToast,
}))

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

function createSystemIOService({
  localProjectEntries = [],
  request = vi.fn(),
}: {
  localProjectEntries?: HomeProjectEntryContribution[]
  request?: SystemIORegistryService['request']
} = {}): SystemIORegistryService {
  return {
    request,
    stateSignal: signal({
      operations: [],
      runningCount: 0,
      localProjectsLoaded: true,
      localProjectIndexStatus: 'idle',
      canReadWriteProjectDirectory: { value: true, error: undefined },
      currentProjectTreeVersion: 0,
    }),
    localProjectEntriesSignal: signal(localProjectEntries),
    refreshLocalProjects: vi.fn(),
    markCurrentProjectTreeDirty: vi.fn(),
  }
}

function findCommand(commands: Command[], name: string) {
  const command = commands.find((item) => item.name === name)
  if (!command) {
    throw new Error(`Missing command "${name}"`)
  }
  return command
}

describe('project command config', () => {
  beforeEach(() => {
    mockToast.error.mockClear()
    window.history.pushState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps project directory mutation commands disabled by default on web', () => {
    const commands = createProjectCommands({
      systemIO: createSystemIOService(),
      getDefaultProjectName: () => 'untitled',
      getProjectDirectoryPath: () => '/projects',
      enableProjectDirectoryCommands: false,
    })

    expect(commands.map((command) => command.name)).toEqual([
      'Import file from URL',
    ])
  })

  it('enables project directory mutation commands for supported runtimes', () => {
    const commands = createProjectCommands({
      systemIO: createSystemIOService(),
      getDefaultProjectName: () => 'untitled',
      getProjectDirectoryPath: () => '/projects',
      enableProjectDirectoryCommands: true,
    })

    expect(commands.map((command) => command.name)).toEqual([
      'Open project',
      'Create project',
      'Delete project',
      'Rename project',
      'Import file from URL',
    ])
  })

  it('navigates home before deleting the project from the current file route', () => {
    const request = vi.fn()
    const commands = createProjectCommands({
      systemIO: createSystemIOService({
        request,
        localProjectEntries: [
          {
            id: 'bracket',
            name: 'bracket',
            localProjectName: 'bracket',
            localProjectPath: '/projects/bracket',
            readWriteAccess: true,
            source: 'local',
            status: 'local',
          },
        ],
      }),
      getDefaultProjectName: () => 'untitled',
      getProjectDirectoryPath: () => '/projects',
      enableProjectDirectoryCommands: true,
    })
    window.history.pushState(
      null,
      '',
      `${PATHS.FILE}/${safeEncodeForRouterPaths('/projects/bracket/main.kcl')}`
    )

    findCommand(commands, 'Delete project').onSubmit?.({ name: 'bracket' })

    expect(window.location.pathname).toBe(PATHS.HOME)
    expect(request).toHaveBeenCalledWith({
      type: 'project.delete',
      projectName: 'bracket',
    })
  })

  it('shows a toast when project deletion fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const commands = createProjectCommands({
      systemIO: createSystemIOService({
        request: vi.fn(async () =>
          Promise.reject(new Error('permission denied'))
        ),
      }),
      getDefaultProjectName: () => 'untitled',
      getProjectDirectoryPath: () => '/projects',
      enableProjectDirectoryCommands: true,
    })

    findCommand(commands, 'Delete project').onSubmit?.({ name: 'bracket' })

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to delete project "bracket": permission denied'
      )
    )
  })
})
