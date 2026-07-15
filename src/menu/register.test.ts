import type { Project } from '@src/lib/project'
import { modelingMenuCallbackMostActions } from '@src/menu/register'
import toast from 'react-hot-toast'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}))

type MenuCallbackArguments = Parameters<
  typeof modelingMenuCallbackMostActions
>[0]

const currentProject = {
  name: 'project-folder',
  title: 'Human project title',
  path: '/projects/project-folder',
  children: [],
  metadata: null,
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/projects/project-folder/main.kcl',
  readAccess: true,
  readWriteAccess: false,
} satisfies Project

function createMenuCallback(
  project: Project | undefined,
  canWriteProjectDirectory = true
) {
  const send = vi.fn()
  const args = {
    settings: {},
    navigate: vi.fn(),
    filePath: undefined,
    authActor: { send: vi.fn() },
    commandBarActor: { send },
    kclManager: {},
    settingsActor: {
      getSnapshot: () => ({ context: { currentProject: project } }),
    },
    systemIOActor: {
      getSnapshot: () => ({
        context: {
          canReadWriteProjectDirectory: {
            value: canWriteProjectDirectory,
            error: undefined,
          },
        },
      }),
    },
  } as unknown as MenuCallbackArguments

  return {
    callback: modelingMenuCallbackMostActions(args),
    send,
  }
}

describe('native menu command routing', () => {
  it('opens Duplicate project with readable source and title defaults', () => {
    const { callback, send } = createMenuCallback(currentProject)

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Duplicate project',
        argDefaultValues: {
          name: currentProject.name,
          newName: currentProject.title,
        },
      },
    })
  })

  it('rejects a genuinely unreadable current project', () => {
    const { callback, send } = createMenuCallback({
      ...currentProject,
      readAccess: false,
    })

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'The current project cannot be read.'
    )
  })

  it('rejects duplication when the destination is unavailable', () => {
    const { callback, send } = createMenuCallback(currentProject, false)

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'The project directory cannot be written to.'
    )
  })

  it('rejects duplication when no project is open', () => {
    const { callback, send } = createMenuCallback(undefined)

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Open a project before duplicating it.'
    )
  })
})
