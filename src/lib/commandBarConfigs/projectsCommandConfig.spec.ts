import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { Project } from '@src/lib/project'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { describe, expect, it, vi } from 'vitest'
import type { ActorRefFrom } from 'xstate'

type CommandOptionArg = {
  options?: (
    commandContext: Record<string, never>,
    machineContext?: undefined
  ) => unknown
}

function createProject(path: string, name: string): Project {
  return {
    path,
    name,
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: `${path}/main.kcl`,
    children: [],
    readWriteAccess: true,
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

  it('submits project paths for delete and rename commands', () => {
    const folder = createProject('/tmp/projects/duplicate', 'duplicate')
    const systemIOActor = createSystemIOActor([folder])
    const commands = createProjectCommands({
      systemIOActor,
      enableProjectDirectoryCommands: true,
    })

    commands
      .find((command) => command.name === 'Delete project')
      ?.onSubmit({ name: folder.path })
    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.deleteProject,
      data: {
        requestedProjectName: folder.name,
        projectPath: folder.path,
      },
    })

    commands
      .find((command) => command.name === 'Rename project')
      ?.onSubmit({ oldName: folder.path, newName: 'renamed' })
    expect(systemIOActor.send).toHaveBeenLastCalledWith({
      type: SystemIOMachineEvents.renameProject,
      data: {
        requestedProjectName: 'renamed',
        projectName: folder.name,
        projectPath: folder.path,
        redirect: true,
      },
    })
  })

  it('uses paths as option values when recent projects share a name', () => {
    const first = createProject('/tmp/first/duplicate', 'duplicate')
    const second = createProject('/tmp/second/duplicate', 'duplicate')
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor([first, second]),
      enableProjectDirectoryCommands: true,
    })

    const deleteProjectCommand = commands.find(
      (command) => command.name === 'Delete project'
    )
    const options = (deleteProjectCommand?.args?.name as CommandOptionArg)
      ?.options
    expect(options?.({}, undefined)).toEqual([
      {
        name: `duplicate - ${first.path}`,
        value: first.path,
        isCurrent: false,
      },
      {
        name: `duplicate - ${second.path}`,
        value: second.path,
        isCurrent: false,
      },
    ])
  })
})
