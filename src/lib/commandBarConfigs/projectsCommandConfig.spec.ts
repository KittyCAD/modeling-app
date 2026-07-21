import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { CommandArgumentOption } from '@src/lib/commandTypes'
import type { Project } from '@src/lib/project'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
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
