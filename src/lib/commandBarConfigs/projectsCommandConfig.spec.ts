import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { MachineManager } from '@src/lib/MachineManager'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { describe, expect, it, vi } from 'vitest'
import { type ActorRefFrom, createActor } from 'xstate'

function createSystemIOActor({
  folders = [],
  canWriteProjectDirectory = true,
}: {
  folders?: Project[]
  canWriteProjectDirectory?: boolean
} = {}) {
  return {
    getSnapshot: () => ({
      context: {
        defaultProjectFolderName: 'untitled',
        folders,
        requestedProjectName: { name: '' },
        canReadWriteProjectDirectory: {
          value: canWriteProjectDirectory,
          error: undefined,
        },
      },
    }),
    send: vi.fn(),
  } as unknown as ActorRefFrom<typeof systemIOMachine>
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
      'Duplicate project',
      'Delete project',
      'Rename project',
      'Import file from URL',
    ])
  })

  it('submits duplicate project requests through system IO', () => {
    const systemIOActor = createSystemIOActor()
    const duplicateCommand = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    }).find((command) => command.name === 'Duplicate project')

    duplicateCommand?.onSubmit({
      name: 'source-project',
      newName: 'Copied project',
    })

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: 'duplicate project',
      data: {
        projectName: 'source-project',
        requestedProjectName: 'Copied project',
      },
    })
  })

  it('shows the editable duplicate name instead of submitting defaults immediately', () => {
    const systemIOActor = createSystemIOActor()
    const duplicateCommand = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    }).find((command) => command.name === 'Duplicate project')
    expect(duplicateCommand).toBeDefined()
    if (!duplicateCommand) {
      return
    }
    const commandBarActor = createActor(commandBarMachine, {
      input: {
        commands: [duplicateCommand],
        wasmInstancePromise: Promise.resolve({} as ModuleType),
        machineManager: {} as MachineManager,
      },
    }).start()

    commandBarActor.send({ type: 'Open' })
    commandBarActor.send({
      type: 'Select command',
      data: {
        command: duplicateCommand,
        argDefaultValues: {
          name: 'source-project',
          newName: 'Copied project',
        },
      },
    })

    expect(commandBarActor.getSnapshot().value).toEqual({
      'Gathering arguments': 'Awaiting input',
    })
    expect(commandBarActor.getSnapshot().context.currentArgument?.name).toBe(
      'newName'
    )
    expect(systemIOActor.send).not.toHaveBeenCalled()
    commandBarActor.stop()
  })

  it('offers readable read-only sources but not unreadable projects', () => {
    const readableReadOnlyProject = {
      name: 'read-only',
      title: 'Readable project',
      path: '/projects/read-only',
      children: [],
      metadata: null,
      kcl_file_count: 1,
      directory_count: 0,
      default_file: '',
      readAccess: true,
      readWriteAccess: false,
    } satisfies Project
    const unreadableProject = {
      ...readableReadOnlyProject,
      name: 'unreadable',
      title: 'Unreadable project',
      path: '/projects/unreadable',
      readAccess: false,
    } satisfies Project
    const duplicateCommand = createProjectCommands({
      systemIOActor: createSystemIOActor({
        folders: [readableReadOnlyProject, unreadableProject],
      }),
      enableProjectDirectoryCommands: true,
    }).find((command) => command.name === 'Duplicate project')
    const nameArgument = duplicateCommand?.args?.name

    expect(nameArgument?.inputType).toBe('options')
    if (nameArgument?.inputType !== 'options') {
      throw new Error('Duplicate project source should be an options argument')
    }
    const options =
      typeof nameArgument.options === 'function'
        ? nameArgument.options({ argumentsToSubmit: {} })
        : nameArgument.options

    expect(options).toEqual([
      {
        name: 'Readable project (read-only)',
        value: 'read-only',
        isCurrent: false,
      },
    ])
  })

  it('subscribes duplicate options to system IO and uses its reactive context', () => {
    const readableProject = {
      name: 'readable',
      title: 'Readable project',
      path: '/projects/readable',
      children: [],
      metadata: null,
      kcl_file_count: 1,
      directory_count: 0,
      default_file: '',
      readAccess: true,
      readWriteAccess: false,
    } satisfies Project
    const systemIOActor = createSystemIOActor({ folders: [] })
    const duplicateCommand = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    }).find((command) => command.name === 'Duplicate project')
    const nameArgument = duplicateCommand?.args?.name

    expect(duplicateCommand?.machineActor).toBe(systemIOActor)
    expect(nameArgument?.inputType).toBe('options')
    if (nameArgument?.inputType !== 'options') {
      throw new Error('Duplicate project source should be an options argument')
    }
    expect(nameArgument.machineActor).toBe(systemIOActor)

    const options =
      typeof nameArgument.options === 'function'
        ? nameArgument.options(
            { argumentsToSubmit: {} },
            {
              ...systemIOActor.getSnapshot().context,
              folders: [readableProject],
            }
          )
        : nameArgument.options

    expect(options).toEqual([
      {
        name: 'Readable project (readable)',
        value: 'readable',
        isCurrent: false,
      },
    ])
  })

  it('offers no duplicate sources when the destination is not writable', () => {
    const duplicateCommand = createProjectCommands({
      systemIOActor: createSystemIOActor({
        canWriteProjectDirectory: false,
      }),
      enableProjectDirectoryCommands: true,
    }).find((command) => command.name === 'Duplicate project')
    const nameArgument = duplicateCommand?.args?.name

    expect(nameArgument?.inputType).toBe('options')
    if (nameArgument?.inputType !== 'options') {
      throw new Error('Duplicate project source should be an options argument')
    }
    const options =
      typeof nameArgument.options === 'function'
        ? nameArgument.options({ argumentsToSubmit: {} })
        : nameArgument.options

    expect(options).toEqual([])
  })
})
