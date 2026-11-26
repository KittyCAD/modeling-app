import { modelingMenuCallbackMostActions } from '@src/menu/register'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@src/lib/utils', () => ({ activeFocusIsInput: () => false }))

describe('native File menu project duplication', () => {
  test.each([
    ['/__zoo_cloud__/cloud-id', 'cloud:cloud-id'],
    ['/projects/bracket', 'local:/projects/bracket'],
  ])('opens the library picker for the project at %s', (path, id) => {
    const send = vi.fn()
    const duplicateProject = vi.fn(async () => ({ path: '/wrong-copy' }))
    const callback = modelingMenuCallbackMostActions({
      currentProject: { path, name: 'bracket', title: 'Bracket' },
      commandBarActor: { send },
      getHomeProjectEntries: () => [{ id, projectPath: path }],
      projectOperations: { duplicateProject },
      projectSession: { openFile: vi.fn() },
    } as unknown as Parameters<typeof modelingMenuCallbackMostActions>[0])

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Duplicate project',
        argDefaultValues: { project: id },
      },
    })
    expect(duplicateProject).not.toHaveBeenCalled()
  })

  test('opens the project picker while the current project is still being discovered', () => {
    const send = vi.fn()
    const callback = modelingMenuCallbackMostActions({
      currentProject: { path: '/projects/bracket', name: 'bracket' },
      commandBarActor: { send },
      getHomeProjectEntries: () => [],
    } as unknown as Parameters<typeof modelingMenuCallbackMostActions>[0])

    callback({ menuLabel: 'File.Duplicate project' })

    expect(send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Duplicate project',
        argDefaultValues: undefined,
      },
    })
  })
})
