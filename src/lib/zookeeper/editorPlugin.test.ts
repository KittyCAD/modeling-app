import {
  type ZookeeperEditPatch,
  applyZookeeperEditPatch,
  mergeZookeeperEditPatches,
} from '@src/lib/zookeeper/editorPlugin'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import { createTwoFilesPatch } from 'diff'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const clientErrorMocks = vi.hoisted(() => ({
  reportSystemIOError: vi.fn(),
}))

vi.mock('@src/lib/systemIOErrorReporting', () => ({
  reportSystemIOError: clientErrorMocks.reportSystemIOError,
}))

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  clientErrorMocks.reportSystemIOError.mockClear()
})

describe('Zookeeper history patch replay', () => {
  it('merges streamed edit patches by latest file path', () => {
    const firstPatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'mainBox.kcl',
          status: 'modified',
          diff: unifiedDiff('mainBox.kcl', 'size = 1\n', 'size = 2\n'),
        },
      ],
    }
    const nextPatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: './smallBox.kcl',
          status: 'modified',
          diff: unifiedDiff('smallBox.kcl', 'size = 1\n', 'size = 2\n'),
        },
        {
          path: 'mainBox.kcl',
          status: 'modified',
          diff: unifiedDiff('mainBox.kcl', 'size = 1\n', 'size = 3\n'),
        },
      ],
    }

    expect(mergeZookeeperEditPatches(firstPatch, nextPatch)).toEqual({
      run_id: 'run-1',
      changed_files: [
        {
          path: 'mainBox.kcl',
          status: 'modified',
          diff: unifiedDiff('mainBox.kcl', 'size = 1\n', 'size = 3\n'),
        },
        {
          path: './smallBox.kcl',
          status: 'modified',
          diff: unifiedDiff('smallBox.kcl', 'size = 1\n', 'size = 2\n'),
        },
      ],
    })
  })

  it('preserves streamed create and delete contents when aggregate patches omit them', () => {
    const createdFirst: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'newBox.kcl',
          status: 'created',
          contents: 'size = 1\n',
        },
        {
          path: 'oldBox.kcl',
          status: 'deleted',
          previous_contents: 'size = 2\n',
        },
      ],
    }
    const aggregatePatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: './newBox.kcl',
          status: 'created',
        },
        {
          path: './oldBox.kcl',
          status: 'deleted',
        },
      ],
    }

    expect(mergeZookeeperEditPatches(createdFirst, aggregatePatch)).toEqual({
      run_id: 'run-1',
      changed_files: [
        {
          path: './newBox.kcl',
          status: 'created',
          contents: 'size = 1\n',
        },
        {
          path: './oldBox.kcl',
          status: 'deleted',
          previous_contents: 'size = 2\n',
        },
      ],
    })
  })

  it('keeps streamed create edits undoable as file creation', () => {
    const createdPatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'newBox.kcl',
          status: 'created',
          contents: 'size = 1\n',
        },
      ],
    }
    const modifiedPatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'newBox.kcl',
          status: 'modified',
          diff: unifiedDiff('newBox.kcl', 'size = 1\n', 'size = 2\n'),
        },
      ],
    }

    expect(mergeZookeeperEditPatches(createdPatch, modifiedPatch)).toEqual({
      run_id: 'run-1',
      changed_files: [
        {
          path: 'newBox.kcl',
          status: 'created',
          contents: 'size = 2\n',
        },
      ],
    })
  })

  it('replays create, modify, and delete changes locally', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const modifiedBefore = 'length = 10\n'
    const modifiedAfter = 'length = 20\n'
    const patch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'created.kcl',
          status: 'created',
          contents: 'created = true',
        },
        {
          path: 'parts/modified.kcl',
          status: 'modified',
          diff: unifiedDiff(
            'parts/modified.kcl',
            modifiedBefore,
            modifiedAfter
          ),
        },
        {
          path: 'deleted.kcl',
          status: 'deleted',
          previous_contents: 'deleted = false',
        },
      ],
    }

    await fsZds.mkdir(fsZds.join(projectPath, 'parts'), { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'created.kcl'),
      new TextEncoder().encode('created = true')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'parts', 'modified.kcl'),
      new TextEncoder().encode(modifiedAfter)
    )

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch,
        direction: 'undo',
      })

      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'created.kcl'), 'utf8')
      ).rejects.toThrow()
      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'parts', 'modified.kcl'), 'utf8')
      ).resolves.toBe(modifiedBefore)
      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'deleted.kcl'), 'utf8')
      ).resolves.toBe('deleted = false')

      await applyZookeeperEditPatch({
        projectPath,
        patch,
        direction: 'redo',
      })

      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'created.kcl'), 'utf8')
      ).resolves.toBe('created = true')
      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'parts', 'modified.kcl'), 'utf8')
      ).resolves.toBe(modifiedAfter)
      await expect(
        fsZds.readFile(fsZds.join(projectPath, 'deleted.kcl'), 'utf8')
      ).rejects.toThrow()
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('refuses to replay when a file changed after the Zookeeper edit', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const untouchedPath = fsZds.join(projectPath, 'untouched.kcl')
    const patch: ZookeeperEditPatch = {
      run_id: 'run-2',
      changed_files: [
        {
          path: 'changed.kcl',
          status: 'modified',
          diff: unifiedDiff('changed.kcl', 'length = 10\n', 'length = 20\n'),
        },
        {
          path: 'untouched.kcl',
          status: 'modified',
          diff: unifiedDiff('untouched.kcl', 'width = 10\n', 'width = 20\n'),
        },
      ],
    }

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'changed.kcl'),
      new TextEncoder().encode('length = 30\n')
    )
    await fsZds.writeFile(
      untouchedPath,
      new TextEncoder().encode('width = 20\n')
    )

    try {
      await expect(
        applyZookeeperEditPatch({
          projectPath,
          patch,
          direction: 'undo',
        })
      ).rejects.toThrow('changed since the edit was recorded')

      await expect(fsZds.readFile(untouchedPath, 'utf8')).resolves.toBe(
        'width = 20\n'
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('uses current editor contents when replaying the open file', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const beforeZookeeperEdit = 'length = 10\n'
    const afterZookeeperEdit = 'length = 20\n'
    const staleDiskContent = `${afterZookeeperEdit}manual = true\n`

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(mainPath, new TextEncoder().encode(staleDiskContent))

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: {
          run_id: 'run-current-editor',
          changed_files: [
            {
              path: 'main.kcl',
              status: 'modified',
              diff: unifiedDiff(
                'main.kcl',
                beforeZookeeperEdit,
                afterZookeeperEdit
              ),
            },
          ],
        },
        direction: 'undo',
        fileContentOverrides: new Map([[mainPath, afterZookeeperEdit]]),
      })

      await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(
        beforeZookeeperEdit
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats an active-file patch as already replayed when only context lines drifted', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const beforeZookeeperEdit = 'height = 10\nwidth = 10\ndepth = 10\n'
    const afterZookeeperEdit = 'height = 20\nwidth = 10\ndepth = 10\n'
    const currentEditorContent = 'height = 10\nwidth = 100\ndepth = 10\n'

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      mainPath,
      new TextEncoder().encode(currentEditorContent)
    )

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: {
          run_id: 'run-active-context-drift',
          changed_files: [
            {
              path: 'main.kcl',
              status: 'modified',
              diff: unifiedDiff(
                'main.kcl',
                beforeZookeeperEdit,
                afterZookeeperEdit
              ),
            },
          ],
        },
        direction: 'undo',
        fileContentOverrides: new Map([[mainPath, currentEditorContent]]),
      })

      await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(
        currentEditorContent
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats an active-file patch as already replayed when removed lines still exist elsewhere', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const beforeZookeeperEdit =
      'boxHeight = 60mm\nboxHeight = 600mm\nboxWidth = 100mm\n'
    const afterZookeeperEdit =
      'boxHeight = 600mm\nboxHeight = 600mm\nboxWidth = 100mm\n'
    const currentEditorContent =
      'boxHeight = 60mm\nboxHeight = 600mm\nboxWidth = 1000mm\n'

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      mainPath,
      new TextEncoder().encode(currentEditorContent)
    )

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: {
          run_id: 'run-active-duplicate-lines',
          changed_files: [
            {
              path: 'main.kcl',
              status: 'modified',
              diff: unifiedDiff(
                'main.kcl',
                beforeZookeeperEdit,
                afterZookeeperEdit
              ),
            },
          ],
        },
        direction: 'undo',
        alreadyReplayedFilePaths: new Set([mainPath]),
        fileContentOverrides: new Map([[mainPath, currentEditorContent]]),
      })

      await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(
        currentEditorContent
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('falls back to disk when the open editor buffer is stale for a modified file', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const beforeZookeeperEdit = 'length = 10\n'
    const afterZookeeperEdit = 'length = 20\n'

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      mainPath,
      new TextEncoder().encode(afterZookeeperEdit)
    )

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: {
          run_id: 'run-stale-editor',
          changed_files: [
            {
              path: 'main.kcl',
              status: 'modified',
              diff: unifiedDiff(
                'main.kcl',
                beforeZookeeperEdit,
                afterZookeeperEdit
              ),
            },
          ],
        },
        direction: 'undo',
        fileContentOverrides: new Map([[mainPath, beforeZookeeperEdit]]),
      })

      await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(
        beforeZookeeperEdit
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('ignores a stale editor buffer when recreating a deleted active file', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const createdPath = fsZds.join(projectPath, 'created.kcl')

    await fsZds.mkdir(projectPath, { recursive: true })

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: {
          run_id: 'run-recreate-active-file',
          changed_files: [
            {
              path: 'created.kcl',
              status: 'created',
              contents: 'created = true\n',
            },
          ],
        },
        direction: 'redo',
        fileContentOverrides: new Map([
          [createdPath, 'created = true\nmanual = true\n'],
        ]),
      })

      await expect(fsZds.readFile(createdPath, 'utf8')).resolves.toBe(
        'created = true\n'
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('recreates an active file after undoing its edit and creation', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const createdPath = fsZds.join(projectPath, 'created.kcl')
    const createdContents = 'height = 10\n'
    const editedContents = 'height = 20\n'
    const createPatch: ZookeeperEditPatch = {
      run_id: 'run-create-active-file',
      changed_files: [
        {
          path: 'created.kcl',
          status: 'created',
          contents: createdContents,
        },
      ],
    }
    const editPatch: ZookeeperEditPatch = {
      run_id: 'run-edit-active-file',
      changed_files: [
        {
          path: 'created.kcl',
          status: 'modified',
          diff: unifiedDiff('created.kcl', createdContents, editedContents),
        },
      ],
    }

    await fsZds.mkdir(projectPath, { recursive: true })

    try {
      await applyZookeeperEditPatch({
        projectPath,
        patch: createPatch,
        direction: 'redo',
      })
      await applyZookeeperEditPatch({
        projectPath,
        patch: editPatch,
        direction: 'redo',
        fileContentOverrides: new Map([[createdPath, createdContents]]),
      })
      await expect(fsZds.readFile(createdPath, 'utf8')).resolves.toBe(
        editedContents
      )

      await applyZookeeperEditPatch({
        projectPath,
        patch: editPatch,
        direction: 'undo',
        fileContentOverrides: new Map([[createdPath, editedContents]]),
      })
      await applyZookeeperEditPatch({
        projectPath,
        patch: createPatch,
        direction: 'undo',
        fileContentOverrides: new Map([[createdPath, createdContents]]),
      })
      await expect(fsZds.readFile(createdPath, 'utf8')).rejects.toThrow()

      await applyZookeeperEditPatch({
        projectPath,
        patch: createPatch,
        direction: 'redo',
        fileContentOverrides: new Map([[createdPath, createdContents]]),
      })
      await expect(fsZds.readFile(createdPath, 'utf8')).resolves.toBe(
        createdContents
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('rejects unsafe patch paths before writing files', async () => {
    await expect(
      applyZookeeperEditPatch({
        projectPath: `/tmp/zookeeper-history-${crypto.randomUUID()}`,
        patch: {
          run_id: 'run-3',
          changed_files: [
            {
              path: '../outside.kcl',
              status: 'created',
              contents: 'outside = true',
            },
          ],
        },
        direction: 'redo',
      })
    ).rejects.toThrow('unsafe path')
  })

  it('rejects patches that delete the project entrypoint', async () => {
    await expect(
      applyZookeeperEditPatch({
        projectPath: `/tmp/zookeeper-history-${crypto.randomUUID()}`,
        patch: {
          run_id: 'run-main-delete',
          changed_files: [
            {
              path: './main.kcl',
              status: 'deleted',
              previous_contents: 'main = true',
            },
          ],
        },
        direction: 'redo',
      })
    ).rejects.toThrow('project entrypoint')
  })

  it('rolls back earlier files when a later write fails', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const modifiedPath = fsZds.join(projectPath, 'modified.kcl')
    const createdPath = fsZds.join(projectPath, 'created.kcl')
    const originalWriteFile = fsZds.writeFile.bind(fsZds)
    let shouldFailModifiedWrite = true

    await fsZds.mkdir(projectPath, { recursive: true })
    await originalWriteFile(
      modifiedPath,
      new TextEncoder().encode('length = 10\n')
    )

    vi.spyOn(fsZds, 'writeFile').mockImplementation(async (path, data) => {
      if (path === modifiedPath && shouldFailModifiedWrite) {
        shouldFailModifiedWrite = false
        await originalWriteFile(path, new Uint8Array())
        throw new Error('disk write failed')
      }
      return originalWriteFile(path, data)
    })

    try {
      await expect(
        applyZookeeperEditPatch({
          projectPath,
          patch: {
            run_id: 'run-4',
            changed_files: [
              {
                path: 'created.kcl',
                status: 'created',
                contents: 'created = true\n',
              },
              {
                path: 'modified.kcl',
                status: 'modified',
                diff: unifiedDiff(
                  'modified.kcl',
                  'length = 10\n',
                  'length = 20\n'
                ),
              },
            ],
          },
          direction: 'redo',
        })
      ).rejects.toThrow('disk write failed')

      await expect(fsZds.readFile(createdPath, 'utf8')).rejects.toThrow()
      await expect(fsZds.readFile(modifiedPath, 'utf8')).resolves.toBe(
        'length = 10\n'
      )
      expect(clientErrorMocks.reportSystemIOError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'zookeeper_history_replay',
          risk: 'write',
          source: 'ZookeeperEditor',
          extra: expect.objectContaining({
            phase: 'write',
            totalCount: 2,
            completedCount: 1,
            rollbackAttempted: true,
            rollbackAttemptedCount: 2,
            rollbackFailureCount: 0,
            partialMutationPossible: false,
            dataLossPossible: false,
          }),
        })
      )
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('reports an incomplete rollback as a destructive failure', async () => {
    const projectPath = `/tmp/zookeeper-history-${crypto.randomUUID()}`
    const modifiedPath = fsZds.join(projectPath, 'modified.kcl')
    const createdPath = fsZds.join(projectPath, 'created.kcl')
    const originalWriteFile = fsZds.writeFile.bind(fsZds)
    const originalRm = fsZds.rm.bind(fsZds)
    let shouldFailModifiedWrite = true

    await fsZds.mkdir(projectPath, { recursive: true })
    await originalWriteFile(
      modifiedPath,
      new TextEncoder().encode('length = 10\n')
    )

    vi.spyOn(fsZds, 'writeFile').mockImplementation(async (path, data) => {
      if (path === modifiedPath && shouldFailModifiedWrite) {
        shouldFailModifiedWrite = false
        await originalWriteFile(path, new Uint8Array())
        throw new Error('disk write failed')
      }
      return originalWriteFile(path, data)
    })
    vi.spyOn(fsZds, 'rm').mockImplementation(async (path, options) => {
      if (path === createdPath) {
        throw new Error('rollback remove failed')
      }
      return originalRm(path, options)
    })

    try {
      await expect(
        applyZookeeperEditPatch({
          projectPath,
          patch: {
            run_id: 'run-rollback-failure',
            changed_files: [
              {
                path: 'created.kcl',
                status: 'created',
                contents: 'created = true\n',
              },
              {
                path: 'modified.kcl',
                status: 'modified',
                diff: unifiedDiff(
                  'modified.kcl',
                  'length = 10\n',
                  'length = 20\n'
                ),
              },
            ],
          },
          direction: 'redo',
        })
      ).rejects.toThrow(
        'Zookeeper edit replay failed and could not be fully rolled back.'
      )

      expect(clientErrorMocks.reportSystemIOError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(AggregateError),
          operation: 'zookeeper_history_replay',
          risk: 'destructive',
          source: 'ZookeeperEditor',
          extra: expect.objectContaining({
            phase: 'rollback',
            totalCount: 2,
            completedCount: 1,
            rollbackAttempted: true,
            rollbackAttemptedCount: 2,
            rollbackFailureCount: 1,
            partialMutationPossible: true,
            dataLossPossible: true,
          }),
        })
      )
    } finally {
      await originalRm(projectPath, { recursive: true, force: true })
    }
  })
})

function unifiedDiff(path: string, before: string, after: string) {
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after)
}
