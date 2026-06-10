import { isolateHistory } from '@codemirror/commands'
import { createTwoFilesPatch } from 'diff'
import { applyPatch, parsePatch } from 'diff'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  type ZookeeperEditPatch,
  buildZookeeperHistoryExtension,
  mergeZookeeperEditPatches,
  zookeeperEditPatchHistoryEvent,
} from '@src/editor/plugins/zookeeper'
import { File, KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { loadWasm } from '@src/unitTestUtils'

const apps: App[] = []

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const app of apps.splice(0)) await disposeApp(app)
})

describe('Zookeeper project history integration', () => {
  it('cycles multiple manual edits without changing sibling files', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'value = 0\n',
      'sibling.kcl': 'sibling = true\n',
    })
    const siblingPath = fsZds.join(harness.projectPath, 'sibling.kcl')

    addManualEdit(harness.kclManager, 'value = 1\n')
    addManualEdit(harness.kclManager, 'value = 2\n')
    addManualEdit(harness.kclManager, 'value = 3\n')

    for (const expected of ['value = 2\n', 'value = 1\n', 'value = 0\n']) {
      harness.kclManager.undo()
      expect(harness.kclManager.code).toBe(expected)
      await expect(fsZds.readFile(siblingPath, 'utf8')).resolves.toBe(
        'sibling = true\n'
      )
    }
    for (const expected of ['value = 1\n', 'value = 2\n', 'value = 3\n']) {
      harness.kclManager.redo()
      expect(harness.kclManager.code).toBe(expected)
      await expect(fsZds.readFile(siblingPath, 'utf8')).resolves.toBe(
        'sibling = true\n'
      )
    }
  })

  it('cycles multiple multi-file Zookeeper edits in exact order', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\ndepth = 10\n',
      'shared.kcl': 'color = "red"\n',
      'old.kcl': 'old = true\n',
    })

    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'height = 10\ndepth = 10\n',
      currentAfter: 'height = 20\ndepth = 10\n',
      patch: {
        run_id: 'zk-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\ndepth = 10\n',
            'height = 20\ndepth = 10\n'
          ),
          modifiedFile('shared.kcl', 'color = "red"\n', 'color = "blue"\n'),
        ],
      },
    })
    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'height = 20\ndepth = 10\n',
      currentAfter: 'height = 20\ndepth = 30\n',
      patch: {
        run_id: 'zk-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\ndepth = 10\n',
            'height = 20\ndepth = 30\n'
          ),
          {
            path: 'created.kcl',
            status: 'created',
            contents: 'created = true\n',
          },
          {
            path: 'old.kcl',
            status: 'deleted',
            previous_contents: 'old = true\n',
          },
        ],
      },
    })

    await assertProjectState(harness, {
      main: 'height = 20\ndepth = 30\n',
      shared: 'color = "blue"\n',
      created: 'created = true\n',
      old: null,
    })

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'height = 20\ndepth = 10\n',
      shared: 'color = "blue"\n',
      created: null,
      old: 'old = true\n',
    })
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'height = 10\ndepth = 10\n',
      shared: 'color = "red"\n',
      created: null,
      old: 'old = true\n',
    })

    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'height = 20\ndepth = 10\n',
      shared: 'color = "blue"\n',
      created: null,
      old: 'old = true\n',
    })
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'height = 20\ndepth = 30\n',
      shared: 'color = "blue"\n',
      created: 'created = true\n',
      old: null,
    })
  })

  it('cycles alternating multi-file Zookeeper and manual edits repeatedly', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\nwidth = 10\ndepth = 10\n',
      'shared.kcl': 'material = "steel"\n',
      'obsolete.kcl': 'obsolete = true\n',
    })

    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'height = 10\nwidth = 10\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 10\ndepth = 10\n',
      patch: {
        run_id: 'mixed-zk-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\nwidth = 10\ndepth = 10\n',
            'height = 20\nwidth = 10\ndepth = 10\n'
          ),
          modifiedFile(
            'shared.kcl',
            'material = "steel"\n',
            'material = "aluminum"\n'
          ),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 25\ndepth = 10\n')
    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'height = 20\nwidth = 25\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 25\ndepth = 40\n',
      patch: {
        run_id: 'mixed-zk-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\nwidth = 25\ndepth = 10\n',
            'height = 20\nwidth = 25\ndepth = 40\n'
          ),
          { path: 'part.kcl', status: 'created', contents: 'part = true\n' },
          {
            path: 'obsolete.kcl',
            status: 'deleted',
            previous_contents: 'obsolete = true\n',
          },
        ],
      },
    })
    addManualEdit(
      harness.kclManager,
      'height = 20\nwidth = 25\ndepth = 40\nmanual = true\n'
    )

    const expectedStates = [
      {
        main: 'height = 10\nwidth = 10\ndepth = 10\n',
        shared: 'material = "steel"\n',
        part: null,
        obsolete: 'obsolete = true\n',
      },
      {
        main: 'height = 20\nwidth = 10\ndepth = 10\n',
        shared: 'material = "aluminum"\n',
        part: null,
        obsolete: 'obsolete = true\n',
      },
      {
        main: 'height = 20\nwidth = 25\ndepth = 10\n',
        shared: 'material = "aluminum"\n',
        part: null,
        obsolete: 'obsolete = true\n',
      },
      {
        main: 'height = 20\nwidth = 25\ndepth = 40\n',
        shared: 'material = "aluminum"\n',
        part: 'part = true\n',
        obsolete: null,
      },
      {
        main: 'height = 20\nwidth = 25\ndepth = 40\nmanual = true\n',
        shared: 'material = "aluminum"\n',
        part: 'part = true\n',
        obsolete: null,
      },
    ]

    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let index = expectedStates.length - 2; index >= 0; index -= 1) {
        harness.kclManager.undo()
        await waitForHistoryIdle(harness.kclManager)
        await assertProjectState(harness, expectedStates[index])
      }
      for (let index = 1; index < expectedStates.length; index += 1) {
        harness.kclManager.redo()
        await waitForHistoryIdle(harness.kclManager)
        await assertProjectState(harness, expectedStates[index])
      }
    }
  })

  it('abandons undone multi-file Zookeeper redo after a new manual edit', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'value = 0\n',
      'shared.kcl': 'shared = 0\n',
    })

    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'value = 0\n',
      currentAfter: 'value = 1\n',
      patch: {
        run_id: 'branch-zk-1',
        changed_files: [
          modifiedFile('main.kcl', 'value = 0\n', 'value = 1\n'),
          modifiedFile('shared.kcl', 'shared = 0\n', 'shared = 1\n'),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'value = 2\n')
    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'value = 2\n',
      currentAfter: 'value = 3\n',
      patch: {
        run_id: 'branch-zk-2',
        changed_files: [
          modifiedFile('main.kcl', 'value = 2\n', 'value = 3\n'),
          {
            path: 'abandoned.kcl',
            status: 'created',
            contents: 'abandoned = true\n',
          },
        ],
      },
    })

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'value = 1\n',
      shared: 'shared = 1\n',
      abandoned: null,
    })

    addManualEdit(harness.kclManager, 'value = 100\n')
    expect(harness.kclManager.redo()).toBeUndefined()
    await assertProjectState(harness, {
      main: 'value = 100\n',
      shared: 'shared = 1\n',
      abandoned: null,
    })

    harness.kclManager.undo()
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await assertProjectState(harness, {
      main: 'value = 0\n',
      shared: 'shared = 0\n',
      abandoned: null,
    })
  })

  it('restores created-file manual and Zookeeper redo history after navigation', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'created.kcl': 'size = 10\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const createdPath = fsZds.join(harness.projectPath, 'created.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(createdPath)
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => switchToFile(mainPath),
      onActiveFileRestore: switchToFile,
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })

    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: createdPath,
        patch: {
          run_id: 'create-file',
          changed_files: [
            {
              path: 'created.kcl',
              status: 'created',
              contents: 'size = 10\n',
            },
          ],
        },
      })
    )
    addManualEdit(harness.kclManager, 'size = 20\n')
    await writeText(createdPath, 'size = 20\n')
    harness.kclManager.addGlobalHistoryEventWithCodeChange(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: createdPath,
        patch: { run_id: 'edit-created-file', changed_files: [] },
      }),
      'size = 30\n'
    )
    await writeText(createdPath, 'size = 30\n')

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('size = 20\n')
    harness.kclManager.undo()
    expect(harness.kclManager.code).toBe('size = 10\n')
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(mainPath)
    await expect(fsZds.readFile(createdPath, 'utf8')).rejects.toThrow()

    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(createdPath)
    expect(harness.kclManager.code).toBe('size = 10\n')
    harness.kclManager.redo()
    expect(harness.kclManager.code).toBe('size = 20\n')
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('size = 30\n')

    disposeHistory()
  })

  it('keeps active-file delete history attached to the deleted file across navigation', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'part.kcl': 'part = 1\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const partPath = fsZds.join(harness.projectPath, 'part.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(partPath)
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => switchToFile(mainPath),
      onActiveFileRestore: switchToFile,
    })

    addManualEdit(harness.kclManager, 'part = 2\n')
    await writeText(partPath, 'part = 2\n')
    await fsZds.rm(partPath)
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: partPath,
        patch: {
          run_id: 'delete-active-file',
          changed_files: [
            {
              path: 'part.kcl',
              status: 'deleted',
              previous_contents: 'part = 2\n',
            },
          ],
        },
      })
    )
    await switchToFile(mainPath)

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(partPath)
    expect(harness.kclManager.code).toBe('part = 2\n')
    await expect(fsZds.readFile(partPath, 'utf8')).resolves.toBe('part = 2\n')

    harness.kclManager.undo()
    expect(harness.kclManager.code).toBe('part = 1\n')
    harness.kclManager.redo()
    expect(harness.kclManager.code).toBe('part = 2\n')
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(mainPath)
    await expect(fsZds.readFile(partPath, 'utf8')).rejects.toThrow()

    disposeHistory()
  })

  it('restores a streamed deleted file when the aggregate patch omits previous contents', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'part.kcl': 'part = 1\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const partPath = fsZds.join(harness.projectPath, 'part.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(partPath)
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => switchToFile(mainPath),
      onActiveFileRestore: switchToFile,
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })
    const mergedPatch = mergeZookeeperEditPatches(
      {
        run_id: 'streamed-delete',
        changed_files: [
          {
            path: 'part.kcl',
            status: 'deleted',
            previous_contents: 'part = 1\n',
          },
        ],
      },
      {
        run_id: 'streamed-delete',
        changed_files: [
          {
            path: './part.kcl',
            status: 'deleted',
          },
        ],
      }
    )

    await fsZds.rm(partPath)
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: partPath,
        patch: mergedPatch,
      })
    )
    await switchToFile(mainPath)

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(partPath)
    expect(harness.kclManager.code).toBe('part = 1\n')
    await expect(fsZds.readFile(partPath, 'utf8')).resolves.toBe('part = 1\n')

    disposeHistory()
  })

  it('restores a streamed deleted file when a later output modifies the navigated file', async () => {
    const mainBefore = 'import "smallBox.kcl" as smallBox\nsmallBox\n'
    const mainAfter = 'largeBox\n'
    const smallBefore = 'small = true\n'
    const harness = await createProjectHarness({
      'main.kcl': mainBefore,
      'smallBox.kcl': smallBefore,
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const smallBoxPath = fsZds.join(harness.projectPath, 'smallBox.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(smallBoxPath)
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => switchToFile(mainPath),
      onActiveFileRestore: switchToFile,
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })
    const mergedPatch = mergeZookeeperEditPatches(
      {
        run_id: 'streamed-delete-modify',
        changed_files: [
          {
            path: 'smallBox.kcl',
            status: 'deleted',
            previous_contents: smallBefore,
          },
        ],
      },
      {
        run_id: 'streamed-delete-modify',
        changed_files: [modifiedFile('main.kcl', mainBefore, mainAfter)],
      }
    )

    await fsZds.rm(smallBoxPath)
    await switchToFile(mainPath)
    expect(harness.kclManager.code).toBe(mainBefore)
    await writeText(mainPath, mainAfter)
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: smallBoxPath,
        patch: mergedPatch,
      })
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(smallBoxPath)
    expect(harness.kclManager.code).toBe(smallBefore)
    await expect(fsZds.readFile(smallBoxPath, 'utf8')).resolves.toBe(
      smallBefore
    )
    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(mainBefore)

    disposeHistory()
  })

  it('removes a streamed created file when the aggregate patch omits contents', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
    })
    const createdPath = fsZds.join(harness.projectPath, 'created.kcl')
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => undefined,
      onActiveFileRestore: async (path) => {
        await harness.app.project?.openEditor(path, harness.kclManager)
      },
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })
    const mergedPatch = mergeZookeeperEditPatches(
      {
        run_id: 'streamed-create',
        changed_files: [
          {
            path: 'created.kcl',
            status: 'created',
            contents: 'created = true\n',
          },
        ],
      },
      {
        run_id: 'streamed-create',
        changed_files: [
          {
            path: './created.kcl',
            status: 'created',
          },
        ],
      }
    )

    await writeText(createdPath, 'created = true\n')
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: harness.kclManager.path,
        patch: mergedPatch,
      })
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await expect(fsZds.readFile(createdPath, 'utf8')).rejects.toThrow()

    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    await expect(fsZds.readFile(createdPath, 'utf8')).resolves.toBe(
      'created = true\n'
    )

    disposeHistory()
  })

  it('undoes a multi-file Zookeeper edit from a non-entrypoint active file', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'big = 1\n',
      'smallBox.kcl': 'small = 1\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const smallBoxPath = fsZds.join(harness.projectPath, 'smallBox.kcl')
    const mainFile = harness.app.project?.files.find(
      (file) => file.path === mainPath
    )
    const smallBoxFile = harness.app.project?.files.find(
      (file) => file.path === smallBoxPath
    )
    expect(mainFile).toBeDefined()
    expect(smallBoxFile).toBeDefined()
    const mainFileId = mainFile?.id
    await harness.app.project?.openEditor(smallBoxPath, harness.kclManager)
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => undefined,
      onActiveFileRestore: async (path) => {
        await harness.app.project?.openEditor(path, harness.kclManager)
      },
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })

    harness.kclManager.addGlobalHistoryEventWithCodeChange(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: smallBoxPath,
        patch: {
          run_id: 'active-imported-file-edit',
          changed_files: [modifiedFile('main.kcl', 'big = 1\n', 'big = 2\n')],
        },
      }),
      'small = 2\n'
    )
    await writeText(mainPath, 'big = 2\n')
    await writeText(smallBoxPath, 'small = 2\n')
    const sendUpdateFile = vi.spyOn(
      harness.kclManager.rustContext,
      'sendUpdateFile'
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(smallBoxPath)
    expect(harness.kclManager.code).toBe('small = 1\n')
    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe('big = 1\n')
    expect(sendUpdateFile).toHaveBeenCalledWith(mainFileId, 'big = 1\n')

    sendUpdateFile.mockClear()
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(smallBoxPath)
    expect(harness.kclManager.code).toBe('small = 2\n')
    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe('big = 2\n')
    expect(sendUpdateFile).toHaveBeenCalledWith(mainFileId, 'big = 2\n')

    disposeHistory()
  })
})

async function createProjectHarness(files: Record<string, string>) {
  const projectPath = `/tmp/zookeeper-project-history-${crypto.randomUUID()}`
  await fsZds.mkdir(projectPath, { recursive: true })
  for (const [relativePath, contents] of Object.entries(files)) {
    await writeText(fsZds.join(projectPath, relativePath), contents)
  }

  const project: Project = {
    name: fsZds.basename(projectPath),
    path: projectPath,
    default_file: fsZds.join(projectPath, 'main.kcl'),
    directory_count: 0,
    kcl_file_count: Object.keys(files).length,
    metadata: null,
    readWriteAccess: true,
    children: Object.keys(files).map((relativePath) => ({
      name: relativePath,
      path: fsZds.join(projectPath, relativePath),
      children: null,
    })),
  }
  const app = App.fromProvided({ wasmPromise: loadWasm() })
  apps.push(app)
  const openedProject = await app.openProject(project)
  const kclManager = await openedProject.openEditor(
    fsZds.join(projectPath, 'main.kcl')
  )
  await Promise.resolve()
  return { app, projectPath, kclManager }
}

async function applyRecordedZookeeperAction(
  harness: Awaited<ReturnType<typeof createProjectHarness>>,
  {
    currentBefore,
    currentAfter,
    patch,
  }: {
    currentBefore: string
    currentAfter: string
    patch: ZookeeperEditPatch
  }
) {
  expect(harness.kclManager.code).toBe(currentBefore)
  for (const file of patch.changed_files ?? []) {
    const absolutePath = fsZds.join(harness.projectPath, file.path)
    if (file.status === 'created') {
      await writeText(absolutePath, file.contents ?? '')
    } else if (file.status === 'modified') {
      if (file.path === 'main.kcl') {
        await writeText(absolutePath, currentAfter)
      } else {
        const before = await fsZds.readFile(absolutePath, 'utf8')
        const parsedPatch = parsePatch(file.diff ?? '')[0]
        const after = parsedPatch ? applyPatch(before, parsedPatch) : false
        if (after === false) {
          throw new Error(`Test patch missing after content: ${file.path}`)
        }
        await writeText(absolutePath, after)
      }
    } else {
      await fsZds.rm(absolutePath)
    }
  }

  const patchWithoutCurrentFile: ZookeeperEditPatch = {
    ...patch,
    changed_files: patch.changed_files?.filter(
      (file) => file.path !== 'main.kcl'
    ),
  }
  harness.kclManager.addGlobalHistoryEventWithCodeChange(
    zookeeperEditPatchHistoryEvent({
      projectPath: harness.projectPath,
      patch: patchWithoutCurrentFile,
    }),
    currentAfter
  )
}

function addManualEdit(kclManager: KclManager, code: string) {
  kclManager.updateCodeEditor(
    code,
    {
      shouldAddToHistory: true,
      shouldClearHistory: false,
      shouldExecute: false,
      shouldResetCamera: false,
      shouldWriteToDisk: false,
    },
    { annotations: [isolateHistory.of('full')] }
  )
}

function modifiedFile(path: string, before: string, after: string) {
  return {
    path,
    status: 'modified' as const,
    diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after),
  }
}

async function assertProjectState(
  harness: Awaited<ReturnType<typeof createProjectHarness>>,
  expected: Record<string, string | null>
) {
  expect(harness.kclManager.code).toBe(expected.main)
  for (const [name, contents] of Object.entries(expected)) {
    if (name === 'main') continue
    const path = fsZds.join(harness.projectPath, `${name}.kcl`)
    if (contents === null) {
      await expect(fsZds.readFile(path, 'utf8')).rejects.toThrow()
    } else {
      await expect(fsZds.readFile(path, 'utf8')).resolves.toBe(contents)
    }
  }
}

async function writeText(path: string, contents: string) {
  await fsZds.mkdir(fsZds.dirname(path), { recursive: true })
  await fsZds.writeFile(path, new TextEncoder().encode(contents))
}

async function waitForHistoryIdle(kclManager: KclManager) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!kclManager.historyOperationInProgress.value) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('History operation did not settle')
}

async function disposeApp(app: App) {
  const projectPath = app.project?.path
  app.closeProject()
  app.systemIOActor.stop()
  app.settings.actor.stop()
  app.commands.actor.stop()
  app.auth.actor.stop()
  app.billing.actor.stop()
  app.userFeatures.actor.stop()
  if (projectPath) {
    await fsZds.rm(projectPath, { recursive: true, force: true })
  }
}
