import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { signal } from '@preact/signals-core'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import { describe, expect, it, vi } from 'vitest'

function createSystemIOService(): SystemIORegistryService {
  return {
    request: vi.fn(),
    stateSignal: signal({
      operations: [],
      runningCount: 0,
      localProjectsLoaded: true,
      localProjectIndexStatus: 'idle',
      canReadWriteProjectDirectory: { value: true, error: undefined },
      currentProjectTreeVersion: 0,
    }),
    localProjectEntriesSignal: signal([]),
    refreshLocalProjects: vi.fn(),
    markCurrentProjectTreeDirty: vi.fn(),
  }
}

describe('project command config', () => {
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
})
