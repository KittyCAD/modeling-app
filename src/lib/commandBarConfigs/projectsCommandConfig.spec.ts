import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { CommandArgumentOption } from '@src/lib/commandTypes'
import type { Project } from '@src/lib/project'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { describe, expect, it, vi } from 'vitest'
import type { ActorRefFrom, ContextFrom } from 'xstate'

function createProject({
  name,
  title,
}: {
  name: string
  title?: string
}): Project {
  return {
    name,
    title,
    path: `/projects/${name}`,
    children: [],
    readWriteAccess: true,
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: `/projects/${name}/main.kcl`,
  }
}

function createSystemIOActor(folders: Project[] = []) {
  return {
    getSnapshot: () => ({
      context: {
        defaultProjectFolderName: 'untitled',
        folders,
      },
    }),
    send: vi.fn(),
  } as unknown as ActorRefFrom<typeof systemIOMachine>
}

function createLibrary(id: string, title: string): ProjectLibrary {
  return {
    id,
    title,
    path: `/projects/${id}`,
    type: 'directory',
  }
}

function createHomeProject({
  id,
  title,
  localProjectName,
  localProjectPath,
  libraryIds,
}: {
  id: string
  title: string
  localProjectName: string
  localProjectPath: string
  libraryIds: readonly string[]
}): HomeProjectEntry {
  return {
    id,
    source: 'local',
    status: 'local',
    libraryIds,
    name: localProjectName,
    title,
    localProjectName,
    localProjectPath,
    defaultFile: `${localProjectPath}/main.kcl`,
    readWriteAccess: true,
  }
}

function createHomeProjectActions(
  overrides: Partial<HomeProjectActionsService> = {}
): HomeProjectActionsService {
  return {
    canOpen: vi.fn(() => true),
    canRename: vi.fn(() => true),
    canDelete: vi.fn(() => true),
    open: vi.fn(async (project) => ({ defaultFile: project.defaultFile! })),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  }
}

function projectOptions(
  command: ReturnType<typeof createProjectCommands>[number],
  argName: string
) {
  return (
    command.args?.[argName] as unknown as {
      options: () => CommandArgumentOption<string>[]
    }
  ).options()
}

describe('project command config', () => {
  it('keeps project directory mutation commands disabled by default on web', () => {
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
      enableProjectDirectoryCommands: false,
    })

    expect(commands.map((command) => command.name)).toEqual([
      'Import file from URL',
    ])
  })

  it('enables project directory mutation commands for supported runtimes', () => {
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
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

  it('creates project directories from project titles', () => {
    const systemIOActor = createSystemIOActor()
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    })
    const createCommand = commands.find(
      (command) => command.name === 'Create project'
    )

    createCommand?.onSubmit({
      name: ' My Cool Project! ',
    })

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.createProject,
      data: {
        requestedProjectName: 'my-cool-project',
        requestedProjectTitle: 'My Cool Project!',
      },
    })
  })

  it('creates projects through the selected library target', () => {
    const systemIOActor = createSystemIOActor()
    const library = createLibrary('client-projects', 'Client Projects')
    const createProject = {
      run: vi.fn(),
    }
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
      getCreateProjectLibraryTargets: () => [
        {
          library,
          createProject,
        },
      ],
    })
    const createCommand = commands.find(
      (command) => command.name === 'Create project'
    )

    createCommand?.onSubmit({
      name: ' Client Gear! ',
      libraryId: library.id,
    })

    expect(createProject.run).toHaveBeenCalledWith({
      library,
      requestedProjectName: 'client-gear',
      requestedProjectTitle: 'Client Gear!',
    })
    expect(systemIOActor.send).not.toHaveBeenCalled()
  })

  it('defaults create project to the current library route', () => {
    window.location.hash = '#/library/client-projects'
    try {
      const commands = createProjectCommands({
        systemIOActor: createSystemIOActor(),
        enableProjectDirectoryCommands: true,
        getCreateProjectLibraryTargets: () => [
          {
            library: createLibrary('default-projects', 'Default Projects'),
            createProject: {
              run: vi.fn(),
            },
          },
          {
            library: createLibrary('client-projects', 'Client Projects'),
            createProject: {
              run: vi.fn(),
            },
          },
        ],
      })
      const createCommand = commands.find(
        (command) => command.name === 'Create project'
      )
      const libraryArg = createCommand?.args?.libraryId as unknown as {
        defaultValue: () => string
        options: () => CommandArgumentOption<string>[]
      }

      expect(libraryArg.defaultValue()).toBe('client-projects')
      expect(libraryArg.options()).toEqual([
        {
          name: 'Default Projects',
          value: 'default-projects',
          isCurrent: false,
        },
        {
          name: 'Client Projects',
          value: 'client-projects',
          isCurrent: false,
        },
      ])
    } finally {
      window.location.hash = ''
    }
  })

  it('shows a prepopulated library picker when creating into multiple libraries', () => {
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
      enableProjectDirectoryCommands: true,
      getCreateProjectLibraryTargets: () => [
        {
          library: createLibrary('default-projects', 'Default Projects'),
          createProject: {
            run: vi.fn(),
          },
        },
        {
          library: createLibrary('client-projects', 'Client Projects'),
          createProject: {
            run: vi.fn(),
          },
        },
      ],
    })
    const createCommand = commands.find(
      (command) => command.name === 'Create project'
    )
    const libraryArg = createCommand?.args?.libraryId as unknown as {
      defaultValue: () => string
      hidden: () => boolean
      options: () => CommandArgumentOption<string>[]
      prepopulate: boolean
      required: () => boolean
    }

    expect(libraryArg.hidden()).toBe(false)
    expect(libraryArg.prepopulate).toBe(true)
    expect(libraryArg.required()).toBe(true)
    expect(libraryArg.defaultValue()).toBe('default-projects')
    expect(libraryArg.options()).toEqual([
      {
        name: 'Default Projects',
        value: 'default-projects',
        isCurrent: false,
      },
      {
        name: 'Client Projects',
        value: 'client-projects',
        isCurrent: false,
      },
    ])
  })

  it('labels existing project options by title while submitting directory names', () => {
    const systemIOActor = createSystemIOActor([
      createProject({
        name: 'bracket-directory',
        title: 'Display Bracket',
      }),
    ])
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    })

    const openCommand = commands.find(
      (command) => command.name === 'Open project'
    )
    const deleteCommand = commands.find(
      (command) => command.name === 'Delete project'
    )
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )

    expect(openCommand && projectOptions(openCommand, 'name')).toEqual([
      {
        name: 'Display Bracket',
        value: 'bracket-directory',
        isCurrent: false,
      },
    ])
    expect(deleteCommand && projectOptions(deleteCommand, 'name')).toEqual([
      {
        name: 'Display Bracket',
        value: 'bracket-directory',
        isCurrent: false,
      },
    ])
    expect(renameCommand && projectOptions(renameCommand, 'oldName')).toEqual([
      {
        name: 'Display Bracket',
        value: 'bracket-directory',
        isCurrent: false,
      },
    ])
  })

  it('renames project titles without replacing the project directory identifier', () => {
    const systemIOActor = createSystemIOActor([
      createProject({
        name: 'bracket-directory',
        title: 'Display Bracket',
      }),
    ])
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    })
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )
    expect(renameCommand).toBeDefined()
    const newTitleArg = renameCommand?.args?.newName as unknown as {
      defaultValue: (
        context: ContextFrom<typeof commandBarMachine>
      ) => string | undefined
    }

    expect(
      newTitleArg.defaultValue({
        argumentsToSubmit: {
          oldName: 'bracket-directory',
        },
      } as unknown as ContextFrom<typeof commandBarMachine>)
    ).toBe('Display Bracket')

    renameCommand?.onSubmit({
      oldName: 'bracket-directory',
      newName: 'Retitled Bracket',
    })

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.renameProject,
      data: {
        projectName: 'bracket-directory',
        requestedProjectName: 'Retitled Bracket',
        redirect: true,
      },
    })
  })

  it('uses home project entries for project command options', () => {
    const homeProject = createHomeProject({
      id: 'local:/client-projects/bracket',
      title: 'Client Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/client-projects/bracket',
      libraryIds: ['client-projects'],
    })
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor([
        createProject({
          name: 'default-project',
          title: 'Default Project',
        }),
      ]),
      enableProjectDirectoryCommands: true,
      getCurrentProjectDirectoryName: () => 'bracket',
      getHomeProjectActions: () => createHomeProjectActions(),
      getHomeProjectEntries: () => [homeProject],
    })
    const openCommand = commands.find(
      (command) => command.name === 'Open project'
    )
    const deleteCommand = commands.find(
      (command) => command.name === 'Delete project'
    )
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )

    expect(openCommand && projectOptions(openCommand, 'name')).toEqual([
      {
        name: 'Client Bracket',
        value: 'local:/client-projects/bracket',
        isCurrent: true,
      },
    ])
    expect(deleteCommand && projectOptions(deleteCommand, 'name')).toEqual([
      {
        name: 'Client Bracket',
        value: 'local:/client-projects/bracket',
        isCurrent: true,
      },
    ])
    expect(renameCommand && projectOptions(renameCommand, 'oldName')).toEqual([
      {
        name: 'Client Bracket',
        value: 'local:/client-projects/bracket',
        isCurrent: true,
      },
    ])
  })

  it('opens, renames, and deletes home project entries through project actions', async () => {
    const systemIOActor = createSystemIOActor()
    const homeProject = createHomeProject({
      id: 'local:/client-projects/bracket',
      title: 'Client Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/client-projects/bracket',
      libraryIds: ['client-projects'],
    })
    const homeProjectActions = createHomeProjectActions()
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
      getHomeProjectActions: () => homeProjectActions,
      getHomeProjectEntries: () => [homeProject],
    })
    const openCommand = commands.find(
      (command) => command.name === 'Open project'
    )
    const deleteCommand = commands.find(
      (command) => command.name === 'Delete project'
    )
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )

    window.location.hash = '#/home'
    try {
      await openCommand?.onSubmit({
        name: homeProject.id,
      })
      await renameCommand?.onSubmit({
        oldName: homeProject.id,
        newName: 'Updated Client Bracket',
      })
      await deleteCommand?.onSubmit({
        name: homeProject.id,
      })

      expect(homeProjectActions.open).toHaveBeenCalledWith(homeProject)
      expect(window.location.hash).toBe(
        '#/file/%2Fclient-projects%2Fbracket%2Fmain.kcl'
      )
      expect(homeProjectActions.rename).toHaveBeenCalledWith(
        homeProject,
        'Updated Client Bracket'
      )
      expect(homeProjectActions.delete).toHaveBeenCalledWith(homeProject)
      expect(systemIOActor.send).not.toHaveBeenCalled()
    } finally {
      window.location.hash = ''
    }
  })

  it('defaults home project rename titles from the selected entry', () => {
    const homeProject = createHomeProject({
      id: 'local:/client-projects/bracket',
      title: 'Client Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/client-projects/bracket',
      libraryIds: ['client-projects'],
    })
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
      enableProjectDirectoryCommands: true,
      getHomeProjectActions: () => createHomeProjectActions(),
      getHomeProjectEntries: () => [homeProject],
    })
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )
    const newTitleArg = renameCommand?.args?.newName as unknown as {
      defaultValue: (
        context: ContextFrom<typeof commandBarMachine>
      ) => string | undefined
    }

    expect(
      newTitleArg.defaultValue({
        argumentsToSubmit: {
          oldName: homeProject.id,
        },
      } as unknown as ContextFrom<typeof commandBarMachine>)
    ).toBe('Client Bracket')
  })

  it('marks the current project directory option as current', () => {
    const systemIOActor = createSystemIOActor([
      createProject({
        name: 'bracket-directory',
        title: 'Display Bracket',
      }),
      createProject({
        name: 'other-directory',
        title: 'Other Project',
      }),
    ])
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
      getCurrentProjectDirectoryName: () => 'bracket-directory',
    })
    const renameCommand = commands.find(
      (command) => command.name === 'Rename project'
    )

    expect(renameCommand && projectOptions(renameCommand, 'oldName')).toEqual([
      {
        name: 'Display Bracket',
        value: 'bracket-directory',
        isCurrent: true,
      },
      {
        name: 'Other Project',
        value: 'other-directory',
        isCurrent: false,
      },
    ])
  })
})
