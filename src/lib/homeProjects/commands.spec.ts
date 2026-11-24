import { signal } from '@preact/signals-core'
import { isCommandVisibleInSearch } from '@src/components/CommandBar/commandSearchVisibility'
import { createProjectCommands } from '@src/lib/homeProjects/commands'
import { commandKey } from '@src/lib/commandUtils'
import type { CommandArgumentOption } from '@src/lib/commandTypes'
import type { Project } from '@src/lib/project'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ContextFrom } from 'xstate'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).posix,
}))

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

function createCommandDependencies(folders: Project[] = []) {
  return {
    getDefaultProjectUnits: (): BaseUnit => 'mm',
    projectLibraries: {
      projectDirectoryPath: '/projects',
      defaultProjectName: 'untitled',
      refreshProjects: vi.fn(async () => {}),
    },
    projectOperations: {
      projects: signal(folders),
      createProject: vi.fn(async () => createProject({ name: 'created' })),
      renameProject: vi.fn(async (path: string, title: string) => ({
        path,
        title,
      })),
      deleteProject: vi.fn(async () => undefined),
      writeFiles: vi.fn(async () => ['/projects/demo/main.kcl']),
    },
    projectSession: { openFile: vi.fn(async () => {}) },
  }
}

function createLibrary(
  id: string,
  title: string,
  type = 'directory'
): ProjectLibrary {
  return {
    id,
    title,
    path: `/projects/${id}`,
    type,
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
    pendingActions: signal(new Map()),
    watchRemoteThumbnail: vi.fn(() => vi.fn()),
    canOpen: vi.fn(() => true),
    canDuplicate: vi.fn(() => true),
    canRename: vi.fn(() => true),
    canDelete: vi.fn(() => true),
    canDuplicateToLibrary: vi.fn(() => false),
    canReviewDuplicateRealizations: vi.fn(() => false),
    canSeparateProjectCopies: vi.fn(() => false),
    open: vi.fn(async (project) => ({
      defaultFile: project.defaultFile ?? '',
    })),
    duplicate: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    getDuplicateToLibraryTargets: vi.fn(() => []),
    duplicateToLibrary: vi.fn(async () => undefined),
    deleteDuplicateRealizations: vi.fn(async () => undefined),
    separateProjectCopies: vi.fn(async () => undefined),
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
  it('keeps URL import registered but hidden from search', () => {
    const commands = createProjectCommands({
      ...createCommandDependencies(),
    })
    const importCommand = commands.find(
      (command) => command.name === 'Import file from URL'
    )
    if (!importCommand) throw new Error('URL import command is missing')

    expect(isCommandVisibleInSearch(importCommand, false)).toBe(false)
    expect(isCommandVisibleInSearch(importCommand, true)).toBe(false)
  })

  it('creates project directories from project titles', () => {
    const dependencies = createCommandDependencies()
    const commands = createProjectCommands({
      ...dependencies,
      getDefaultProjectUnits: () => 'in',
    })
    const createCommand = commands.find(
      (command) => command.name === 'Create project'
    )

    createCommand?.onSubmit({
      name: ' My Cool Project! ',
    })

    expect(dependencies.projectOperations.createProject).toHaveBeenCalledWith({
      directory: '/projects',
      name: 'my-cool-project',
      title: 'My Cool Project!',
      initialProject: {
        entrypointFilePath: 'main.kcl',
        files: [
          {
            requestedFileName: 'main.kcl',
            requestedData: new TextEncoder().encode(
              '@settings(defaultLengthUnit = in, kclVersion = 3.0)\n'
            ),
          },
        ],
      },
    })
  })

  it('creates projects with explicit units through the selected library target', () => {
    const dependencies = createCommandDependencies()
    const library = createLibrary('client-projects', 'Client Projects')
    const createProject = {
      run: vi.fn(),
    }
    const commands = createProjectCommands({
      ...dependencies,
      getDefaultProjectUnits: () => 'in',
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
      units: 'mm',
    })

    expect(createProject.run).toHaveBeenCalledWith({
      library,
      requestedProjectName: 'client-gear',
      requestedProjectTitle: 'Client Gear!',
      initialProject: {
        entrypointFilePath: 'main.kcl',
        files: [
          {
            requestedFileName: 'main.kcl',
            requestedData: new TextEncoder().encode(
              '@settings(defaultLengthUnit = mm, kclVersion = 3.0)\n'
            ),
          },
        ],
      },
    })
    expect(dependencies.projectOperations.createProject).not.toHaveBeenCalled()
  })

  it('offers optional project units using the latest user default', () => {
    const getDefaultProjectUnits = vi.fn<() => BaseUnit>(() => 'cm')
    const commands = createProjectCommands({
      ...createCommandDependencies(),
      getDefaultProjectUnits,
    })
    const unitsArg = commands.find(
      (command) => command.name === 'Create project'
    )?.args?.units as unknown as {
      required: boolean
      defaultValue: () => BaseUnit
    }

    expect(unitsArg.required).toBe(false)
    expect(unitsArg.defaultValue()).toBe('cm')
    getDefaultProjectUnits.mockReturnValue('m')
    expect(unitsArg.defaultValue()).toBe('m')
  })

  it('creates projects through the only library target when the picker is hidden', async () => {
    const dependencies = createCommandDependencies()
    const library = createLibrary('client-projects', 'Client Projects')
    const createProjectOperation = {
      run: vi.fn(async () => createProject({ name: 'client-gear' })),
    }
    const commands = createProjectCommands({
      ...dependencies,
      getCreateProjectLibraryTargets: () => [
        {
          library,
          createProject: createProjectOperation,
        },
      ],
    })
    const createCommand = commands.find(
      (command) => command.name === 'Create project'
    )
    const libraryArg = createCommand?.args?.libraryId as unknown as {
      hidden: () => boolean
      required: () => boolean
    }

    expect(libraryArg.hidden()).toBe(true)
    expect(libraryArg.required()).toBe(false)

    await createCommand?.onSubmit({
      name: ' Client Gear! ',
    })

    expect(createProjectOperation.run).toHaveBeenCalledWith(
      expect.objectContaining({
        library,
        requestedProjectName: 'client-gear',
        requestedProjectTitle: 'Client Gear!',
      })
    )
    expect(dependencies.projectOperations.createProject).not.toHaveBeenCalled()
  })

  it('defaults create project to the current library context', () => {
    const commands = createProjectCommands({
      ...createCommandDependencies(),
      getCurrentProjectLibraryId: () => 'client-projects',
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
  })

  it('shows a prepopulated library picker when creating into multiple libraries', () => {
    const commands = createProjectCommands({
      ...createCommandDependencies(),
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
    const dependencies = createCommandDependencies([
      createProject({
        name: 'bracket-directory',
        title: 'Display Bracket',
      }),
    ])
    const commands = createProjectCommands({
      ...dependencies,
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
    const dependencies = createCommandDependencies([
      createProject({
        name: 'bracket-directory',
        title: 'Display Bracket',
      }),
    ])
    const commands = createProjectCommands({
      ...dependencies,
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

    expect(dependencies.projectOperations.renameProject).toHaveBeenCalledWith(
      '/projects/bracket-directory',
      'Retitled Bracket'
    )
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
      ...createCommandDependencies([
        createProject({
          name: 'default-project',
          title: 'Default Project',
        }),
      ]),
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

  it.each([
    { commandName: 'Open project', argName: 'name' },
    { commandName: 'Rename project', argName: 'oldName' },
    { commandName: 'Delete project', argName: 'name' },
    { commandName: 'Duplicate project', argName: 'project' },
  ])(
    'disambiguates projects across libraries in $commandName',
    ({ commandName, argName }) => {
      const libraries = [
        createLibrary('local', 'Local Projects'),
        createLibrary('client', 'Client Projects'),
        createLibrary('shared', 'Shared Projects'),
        createLibrary('cloud', 'Personal Cloud', 'cloud'),
      ]
      const localProject = createHomeProject({
        id: 'local:/projects/bracket',
        title: 'Bracket',
        localProjectName: 'bracket',
        localProjectPath: '/projects/bracket',
        libraryIds: ['local'],
      })
      const clientProject = createHomeProject({
        id: 'local:/client-projects/bracket',
        title: 'Bracket',
        localProjectName: 'bracket',
        localProjectPath: '/client-projects/bracket',
        libraryIds: ['client', 'shared'],
      })
      const cloudProject: HomeProjectEntry = {
        id: 'remote:bracket',
        name: 'bracket',
        title: 'Bracket',
        source: 'remote',
        status: 'cloud-only',
        remoteProjectId: 'bracket',
        libraryIds: ['cloud'],
        readWriteAccess: true,
      }
      const commands = createProjectCommands({
        ...createCommandDependencies(),
        getCurrentProjectDirectoryName: () => 'bracket',
        getCurrentProjectPath: () => clientProject.localProjectPath,
        getProjectLibraries: () => libraries,
        getHomeProjectActions: () =>
          createHomeProjectActions({
            canDuplicateToLibrary: () => true,
          }),
        getHomeProjectEntries: () => [
          localProject,
          clientProject,
          cloudProject,
        ],
      })
      const command = commands.find((command) => command.name === commandName)
      if (!command) throw new Error(`${commandName} is missing`)

      expect(projectOptions(command, argName)).toEqual([
        {
          name: 'Bracket',
          description: 'Local Projects',
          value: localProject.id,
          isCurrent: false,
        },
        {
          name: 'Bracket',
          description: 'Client Projects, Shared Projects',
          value: clientProject.id,
          isCurrent: true,
        },
        {
          name: 'Bracket',
          description: 'Personal Cloud',
          value: cloudProject.id,
          isCurrent: false,
        },
      ])

      libraries[0].title = 'Renamed Library'
      expect(projectOptions(command, argName)[0].description).toBe(
        'Renamed Library'
      )
    }
  )

  it('opens, renames, and deletes home project entries through project actions', async () => {
    const dependencies = createCommandDependencies()
    const homeProject = createHomeProject({
      id: 'local:/client-projects/bracket',
      title: 'Client Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/client-projects/bracket',
      libraryIds: ['client-projects'],
    })
    const homeProjectActions = createHomeProjectActions()
    const commands = createProjectCommands({
      ...dependencies,
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
      expect(
        dependencies.projectOperations.createProject
      ).not.toHaveBeenCalled()
    } finally {
      window.location.hash = ''
    }
  })

  it('clarifies command-bar deletion for cloud-backed non-cloud library projects', () => {
    const homeProject = {
      ...createHomeProject({
        id: 'remote:remote-123',
        title: 'Client Bracket',
        localProjectName: 'bracket',
        localProjectPath: '/client-projects/bracket',
        libraryIds: ['client-projects'],
      }),
      source: 'local',
      status: 'synced',
      remoteProjectId: 'remote-123',
      deleteRemoteOnDelete: false,
    } satisfies HomeProjectEntry
    const commands = createProjectCommands({
      ...createCommandDependencies(),
      getHomeProjectActions: () => createHomeProjectActions(),
      getHomeProjectEntries: () => [homeProject],
    })
    const deleteCommand = commands.find(
      (command) => command.name === 'Delete project'
    )
    const reviewMessage = deleteCommand?.reviewMessage
    expect(typeof reviewMessage).toBe('function')
    if (typeof reviewMessage !== 'function') {
      return
    }

    render(
      reviewMessage({
        argumentsToSubmit: {
          name: homeProject.id,
        },
      } as unknown as ContextFrom<typeof commandBarMachine>)
    )

    expect(
      screen.getByText(
        'This will delete the local copy of "Client Bracket". The cloud version will not be deleted.'
      )
    ).toBeInTheDocument()
  })

  it('duplicates home project entries to a selected library through project actions', async () => {
    const dependencies = createCommandDependencies()
    const sourceLibrary = createLibrary('client-projects', 'Client Projects')
    const targetLibrary = createLibrary(
      'cloud-personal',
      'Personal Cloud',
      'cloud'
    )
    const homeProject = createHomeProject({
      id: 'local:/client-projects/bracket',
      title: 'Client Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/client-projects/bracket',
      libraryIds: [sourceLibrary.id],
    })
    const homeProjectActions = createHomeProjectActions({
      canDuplicateToLibrary: vi.fn(() => true),
      getDuplicateToLibraryTargets: vi.fn(() => [
        {
          sourceLibrary,
          library: targetLibrary,
        },
      ]),
      duplicateToLibrary: vi.fn(async () => ({
        defaultFile: '/cloud/bracket/main.kcl',
      })),
    })
    const commands = createProjectCommands({
      ...dependencies,
      getProjectLibraries: () => [sourceLibrary, targetLibrary],
      getHomeProjectActions: () => homeProjectActions,
      getHomeProjectEntries: () => [homeProject],
    })
    const duplicateCommand = commands.find(
      (command) => command.name === 'Duplicate project'
    )
    expect(duplicateCommand?.displayName).toBe('Duplicate project')
    expect(duplicateCommand && commandKey(duplicateCommand)).toBe(
      'projects:Duplicate project'
    )
    const projectArg = duplicateCommand?.args?.project as unknown as {
      hidden: (context: {
        argumentsToSubmit: Record<string, unknown>
      }) => boolean
    }
    const libraryArg = duplicateCommand?.args?.library as unknown as {
      defaultValue: (
        context: ContextFrom<typeof commandBarMachine>
      ) => string | undefined
      hidden: (context: {
        argumentsToSubmit: Record<string, unknown>
      }) => boolean
      options: (context: {
        argumentsToSubmit: Record<string, unknown>
      }) => CommandArgumentOption<string>[]
    }

    expect(
      duplicateCommand && projectOptions(duplicateCommand, 'project')
    ).toEqual([
      {
        name: 'Client Bracket',
        description: 'Client Projects',
        value: 'local:/client-projects/bracket',
        isCurrent: false,
      },
    ])
    expect(
      libraryArg.options({
        argumentsToSubmit: {
          project: homeProject.id,
        },
      })
    ).toEqual([
      {
        name: 'Personal Cloud',
        value: 'cloud-personal',
        isCurrent: false,
      },
    ])
    expect(
      libraryArg.defaultValue({
        argumentsToSubmit: {
          project: homeProject.id,
        },
      } as unknown as ContextFrom<typeof commandBarMachine>)
    ).toBe('cloud-personal')
    // Arguments remain editable on review; Step back can return to the library.
    expect(projectArg.hidden).toBeUndefined()
    expect(libraryArg.hidden).toBeUndefined()
    const summaries = duplicateCommand!.args!
    expect(summaries.project.valueSummary!(homeProject.id)).toBe(
      'Client Bracket'
    )
    expect(summaries.library.valueSummary!(targetLibrary.id)).toBe(
      'Personal Cloud'
    )

    await duplicateCommand?.onSubmit({
      project: homeProject.id,
      library: targetLibrary.id,
    })

    expect(homeProjectActions.duplicateToLibrary).toHaveBeenCalledWith(
      homeProject,
      targetLibrary.id
    )
    expect(dependencies.projectOperations.createProject).not.toHaveBeenCalled()
  })

  it('defaults duplication to the source library even when another destination is listed first', () => {
    const sourceLibrary = createLibrary('source', 'Source')
    const otherLibrary = createLibrary('other', 'Other')
    const project = createHomeProject({
      id: 'project',
      title: 'Bracket',
      localProjectName: 'bracket',
      localProjectPath: '/source/bracket',
      libraryIds: [sourceLibrary.id],
    })
    const actions = createHomeProjectActions({
      canDuplicateToLibrary: () => true,
      getDuplicateToLibraryTargets: () => [
        { sourceLibrary, library: otherLibrary },
        { sourceLibrary, library: sourceLibrary },
      ],
    })
    const command = createProjectCommands({
      ...createCommandDependencies(),
      getHomeProjectActions: () => actions,
      getHomeProjectEntries: () => [project],
    }).find((command) => command.name === 'Duplicate project')!
    const libraryArg = command.args!.library
    if (libraryArg.inputType !== 'options')
      throw new Error('Expected a library picker')
    const context = {
      argumentsToSubmit: { project: project.id },
    } as unknown as ContextFrom<typeof commandBarMachine>
    expect(libraryArg.prepopulate).not.toBe(true)
    expect(typeof libraryArg.defaultValue).toBe('function')
    if (typeof libraryArg.defaultValue !== 'function')
      throw new Error('Missing default destination')
    expect(libraryArg.defaultValue(context)).toBe(sourceLibrary.id)
  })

  it('opens the editable copy when duplicating the current read-only cloud project', async () => {
    const sourceLibrary = createLibrary('dataset', 'Dataset', 'cloud')
    const targetLibrary = createLibrary(
      'cloud-personal',
      'Personal Cloud',
      'cloud'
    )
    const project: HomeProjectEntry = {
      id: 'remote:model',
      name: 'model',
      title: 'Model',
      source: 'remote',
      status: 'cloud-only',
      libraryIds: [sourceLibrary.id],
      remoteProjectId: 'model',
      projectPath: '/__zoo_cloud__/model',
      readWriteAccess: false,
    }
    const actions = createHomeProjectActions({
      canDuplicateToLibrary: () => true,
      getDuplicateToLibraryTargets: () => [
        { sourceLibrary, library: targetLibrary },
      ],
      duplicateToLibrary: async () => ({
        defaultFile: '/__zoo_cloud__/copy/main.kcl',
      }),
    })
    const commands = createProjectCommands({
      ...createCommandDependencies(),
      getCurrentProjectPath: () => project.projectPath,
      getProjectLibraries: () => [sourceLibrary, targetLibrary],
      getHomeProjectActions: () => actions,
      getHomeProjectEntries: () => [project],
    })
    const duplicate = commands.find(
      (command) => command.name === 'Duplicate project'
    )
    if (!duplicate) throw new Error('Duplicate project command is missing')
    const previousHash = window.location.hash
    window.location.hash =
      '#/file/' + encodeURIComponent(`${project.projectPath}/main.kcl`)
    try {
      await duplicate.onSubmit({
        project: project.id,
        library: targetLibrary.id,
      })
      expect(window.location.hash).toBe(
        '#/file/%2F__zoo_cloud__%2Fcopy%2Fmain.kcl'
      )
    } finally {
      window.location.hash = previousHash
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
      ...createCommandDependencies(),
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
    const dependencies = createCommandDependencies([
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
      ...dependencies,
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
