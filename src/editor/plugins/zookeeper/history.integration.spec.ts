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
import { File, KclManager, type ZDSProject } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { loadWasm } from '@src/unitTestUtils'

const apps: App[] = []
const historyDisposers: Array<() => void> = []

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const disposeHistory of historyDisposers.splice(0)) {
    disposeHistory()
  }
  for (const app of apps.splice(0)) {
    await disposeApp(app)
  }
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

  it('keeps manual edits ahead of earlier Zookeeper edits when active-file history records after the file write', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\nwidth = 10\ndepth = 10\n',
    })

    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'height = 10\nwidth = 10\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 10\ndepth = 10\n',
      patch: {
        run_id: 'global-only-zk-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\nwidth = 10\ndepth = 10\n',
            'height = 20\nwidth = 10\ndepth = 10\n'
          ),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 10\n')
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 800\n')
    await applyDelayedActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 20\nwidth = 100\ndepth = 800\n',
      currentAfter: 'height = 6000\nwidth = 100\ndepth = 800\n',
      patch: {
        run_id: 'global-only-zk-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\nwidth = 100\ndepth = 800\n',
            'height = 6000\nwidth = 100\ndepth = 800\n'
          ),
        ],
      },
    })

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 100\ndepth = 800\n'
    )
    expect(harness.kclManager.undoDepth.value).toBeGreaterThan(0)
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 100\ndepth = 10\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 10\ndepth = 10\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 10\nwidth = 10\ndepth = 10\n'
    )
  })

  it('keeps manual edits undoable when active-file Zookeeper diffs are already applied locally', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\nwidth = 10\ndepth = 10\n',
    })

    await applyUnfilteredActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 10\nwidth = 10\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 10\ndepth = 10\n',
      patch: {
        run_id: 'unfiltered-zk-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\nwidth = 10\ndepth = 10\n',
            'height = 20\nwidth = 10\ndepth = 10\n'
          ),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 10\n')
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 800\n')
    await applyUnfilteredActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 20\nwidth = 100\ndepth = 800\n',
      currentAfter: 'height = 6000\nwidth = 100\ndepth = 800\n',
      patch: {
        run_id: 'unfiltered-zk-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\nwidth = 100\ndepth = 800\n',
            'height = 6000\nwidth = 100\ndepth = 800\n'
          ),
        ],
      },
    })

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 100\ndepth = 800\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 100\ndepth = 10\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 10\ndepth = 10\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 10\nwidth = 10\ndepth = 10\n'
    )
  })

  it('restores captured manual history if active-file Zookeeper recording follows an editor reload', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'boxLength = 20\nboxWidth = 30\nboxHeight = 40\n',
    })
    const currentBefore = 'boxLength = 200\nboxWidth = 300\nboxHeight = 40\n'
    const currentAfter = 'boxLength = 200\nboxWidth = 300\nboxHeight = 400\n'

    dispatchEditorEdit(
      harness.kclManager,
      'boxLength = 200\nboxWidth = 30\nboxHeight = 40\n'
    )
    dispatchEditorEdit(
      harness.kclManager,
      'boxLength = 200\nboxWidth = 300\nboxHeight = 40\n'
    )
    const capturedEditorState = harness.kclManager.captureEditorHistoryState()
    harness.kclManager.updateCodeEditor(currentAfter, {
      shouldAddToHistory: false,
      shouldClearHistory: true,
      shouldExecute: false,
      shouldResetCamera: false,
      shouldWriteToDisk: false,
    })
    expect(harness.kclManager.undoDepth.value).toBe(0)
    harness.kclManager.restoreEditorHistoryState(capturedEditorState)
    harness.kclManager.addGlobalHistoryEventWithCodeChange(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: harness.kclManager.path,
        patch: {
          run_id: 'restored-manual-history-before-zk',
          changed_files: [
            modifiedFile('main.kcl', currentBefore, currentAfter),
          ],
        },
      }),
      currentAfter,
      currentBefore
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'boxLength = 200\nboxWidth = 300\nboxHeight = 40\n'
    )
    expect(harness.kclManager.undoDepth.value).toBeGreaterThan(0)
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'boxLength = 200\nboxWidth = 30\nboxHeight = 40\n'
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'boxLength = 20\nboxWidth = 30\nboxHeight = 40\n'
    )
  })

  it('keeps earlier manual edits undoable after global-only active-file Zookeeper edits', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\nwidth = 10\ndepth = 10\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    addManualEdit(harness.kclManager, 'height = 10\nwidth = 100\ndepth = 10\n')
    await writeText(mainPath, 'height = 10\nwidth = 100\ndepth = 10\n')
    await applyGlobalOnlyActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 10\nwidth = 100\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 100\ndepth = 10\n',
      patch: {
        run_id: 'global-only-after-manual-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\nwidth = 100\ndepth = 10\n',
            'height = 20\nwidth = 100\ndepth = 10\n'
          ),
        ],
      },
    })
    await applyGlobalOnlyActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 20\nwidth = 100\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 100\ndepth = 800\n',
      patch: {
        run_id: 'global-only-after-manual-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\nwidth = 100\ndepth = 10\n',
            'height = 20\nwidth = 100\ndepth = 800\n'
          ),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 200\ndepth = 800\n')
    await writeText(mainPath, 'height = 20\nwidth = 200\ndepth = 800\n')
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 200\ndepth = 900\n')
    await writeText(mainPath, 'height = 20\nwidth = 200\ndepth = 900\n')

    const expectedStates = [
      'height = 20\nwidth = 200\ndepth = 800\n',
      'height = 20\nwidth = 100\ndepth = 800\n',
      'height = 20\nwidth = 100\ndepth = 10\n',
      'height = 10\nwidth = 100\ndepth = 10\n',
      'height = 10\nwidth = 10\ndepth = 10\n',
    ]
    for (const expectedState of expectedStates) {
      harness.kclManager.undo()
      await waitForHistoryIdle(harness.kclManager)
      expect(harness.kclManager.code).toBe(expectedState)
    }
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('changed since the edit was recorded'),
      })
    )
  })

  it('keeps manual edits undoable after local undo and redo before a later Zookeeper edit', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'height = 10\nwidth = 10\ndepth = 10\n',
    })

    await applyUnfilteredActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 10\nwidth = 10\ndepth = 10\n',
      currentAfter: 'height = 20\nwidth = 10\ndepth = 10\n',
      patch: {
        run_id: 'local-redo-before-zk-1',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 10\nwidth = 10\ndepth = 10\n',
            'height = 20\nwidth = 10\ndepth = 10\n'
          ),
        ],
      },
    })
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 10\n')
    addManualEdit(harness.kclManager, 'height = 20\nwidth = 100\ndepth = 800\n')

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe(
      'height = 20\nwidth = 100\ndepth = 800\n'
    )

    await applyUnfilteredActiveFileZookeeperAction(harness, {
      currentBefore: 'height = 20\nwidth = 100\ndepth = 800\n',
      currentAfter: 'height = 6000\nwidth = 100\ndepth = 800\n',
      patch: {
        run_id: 'local-redo-before-zk-2',
        changed_files: [
          modifiedFile(
            'main.kcl',
            'height = 20\nwidth = 100\ndepth = 800\n',
            'height = 6000\nwidth = 100\ndepth = 800\n'
          ),
        ],
      },
    })
    addManualEdit(
      harness.kclManager,
      'height = 6000\nwidth = 200\ndepth = 800\n'
    )
    addManualEdit(
      harness.kclManager,
      'height = 6000\nwidth = 200\ndepth = 900\n'
    )

    const expectedStates = [
      'height = 6000\nwidth = 200\ndepth = 800\n',
      'height = 6000\nwidth = 100\ndepth = 800\n',
      'height = 20\nwidth = 100\ndepth = 800\n',
      'height = 20\nwidth = 100\ndepth = 10\n',
      'height = 20\nwidth = 10\ndepth = 10\n',
      'height = 10\nwidth = 10\ndepth = 10\n',
    ]
    for (const expectedState of expectedStates) {
      harness.kclManager.undo()
      await waitForHistoryIdle(harness.kclManager)
      expect(harness.kclManager.code).toBe(expectedState)
    }
  })

  it('redoes the original active file after undoing a multi-file Zookeeper edit and switching files', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = 1\n',
      'second.kcl': 'second = 1\n',
      'third.kcl': 'third = 1\n',
    })
    const mainPath = fsZds.join(harness.projectPath, 'main.kcl')
    const secondPath = fsZds.join(harness.projectPath, 'second.kcl')
    const thirdPath = fsZds.join(harness.projectPath, 'third.kcl')

    await applyRecordedZookeeperAction(harness, {
      currentBefore: 'main = 1\n',
      currentAfter: 'main = 2\n',
      patch: {
        run_id: 'redo-after-switch',
        changed_files: [
          modifiedFile('main.kcl', 'main = 1\n', 'main = 2\n'),
          modifiedFile('second.kcl', 'second = 1\n', 'second = 2\n'),
          modifiedFile('third.kcl', 'third = 1\n', 'third = 2\n'),
        ],
      },
    })

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe('main = 1\n')
    await expect(fsZds.readFile(secondPath, 'utf8')).resolves.toBe(
      'second = 1\n'
    )
    await expect(fsZds.readFile(thirdPath, 'utf8')).resolves.toBe('third = 1\n')

    await KclManager.fromFile(
      new File(thirdPath),
      harness.kclManager.systemDeps,
      harness.kclManager
    )
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)

    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe('main = 2\n')
    await expect(fsZds.readFile(secondPath, 'utf8')).resolves.toBe(
      'second = 2\n'
    )
    expect(harness.kclManager.path).toBe(thirdPath)
    expect(harness.kclManager.code).toBe('third = 2\n')
  })

  it('keeps inactive file manual redo after switching files and replaying multi-file Zookeeper history', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'largeBox.kcl': 'large = 100\n',
      'mediumBox.kcl': 'medium = 50\n',
    })
    const largePath = fsZds.join(harness.projectPath, 'largeBox.kcl')
    const mediumPath = fsZds.join(harness.projectPath, 'mediumBox.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(largePath)
    await writeText(largePath, 'large = 120\n')
    await writeText(mediumPath, 'medium = 60\n')
    harness.kclManager.addGlobalHistoryEventWithCodeChange(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: largePath,
        patch: {
          run_id: 'inactive-manual-redo',
          changed_files: [
            modifiedFile('largeBox.kcl', 'large = 100\n', 'large = 120\n'),
            modifiedFile('mediumBox.kcl', 'medium = 50\n', 'medium = 60\n'),
          ],
        },
      }),
      'large = 120\n'
    )

    addManualEdit(harness.kclManager, 'large = 130\n')
    await writeText(largePath, 'large = 130\n')

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('large = 120\n')
    await writeText(largePath, 'large = 120\n')

    await switchToFile(mediumPath)
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(mediumPath)
    expect(harness.kclManager.code).toBe('medium = 50\n')
    await expect(fsZds.readFile(largePath, 'utf8')).resolves.toBe(
      'large = 100\n'
    )

    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(mediumPath)
    expect(harness.kclManager.code).toBe('medium = 60\n')
    await expect(fsZds.readFile(largePath, 'utf8')).resolves.toBe(
      'large = 120\n'
    )

    await switchToFile(largePath)
    expect(harness.kclManager.code).toBe('large = 120\n')
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('large = 130\n')
  })

  it('keeps active-file manual undo after replaying multi-file Zookeeper redo from another file', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'largeBox.kcl': 'large = 100\n',
      'mediumBox.kcl': 'medium = 50\n',
    })
    const largePath = fsZds.join(harness.projectPath, 'largeBox.kcl')
    const mediumPath = fsZds.join(harness.projectPath, 'mediumBox.kcl')
    const switchToFile = async (path: string) => {
      await KclManager.fromFile(
        new File(path),
        harness.kclManager.systemDeps,
        harness.kclManager
      )
    }

    await switchToFile(largePath)
    addManualEdit(harness.kclManager, 'large = 110\n')
    await writeText(largePath, 'large = 110\n')
    await writeText(largePath, 'large = 120\n')
    await writeText(mediumPath, 'medium = 60\n')
    harness.kclManager.addGlobalHistoryEventWithCodeChange(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: largePath,
        patch: {
          run_id: 'inactive-zookeeper-redo-after-manual',
          changed_files: [
            modifiedFile('largeBox.kcl', 'large = 110\n', 'large = 120\n'),
            modifiedFile('mediumBox.kcl', 'medium = 50\n', 'medium = 60\n'),
          ],
        },
      }),
      'large = 120\n'
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('large = 110\n')
    await expect(fsZds.readFile(largePath, 'utf8')).resolves.toBe(
      'large = 110\n'
    )

    await switchToFile(mediumPath)
    harness.kclManager.redo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(mediumPath)
    expect(harness.kclManager.code).toBe('medium = 60\n')
    await expect(fsZds.readFile(largePath, 'utf8')).resolves.toBe(
      'large = 120\n'
    )

    await switchToFile(largePath)
    expect(harness.kclManager.code).toBe('large = 120\n')
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('large = 110\n')
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.code).toBe('large = 100\n')
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
    expect(harness.kclManager.redoDepth.value).toBeGreaterThan(0)

    addManualEdit(harness.kclManager, 'value = 100\n')
    expect(harness.kclManager.redoDepth.value).toBe(0)
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

  it('keeps a restored deleted file when the post-replay execution refresh fails', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'part.kcl': 'part = true\n',
    })
    const partPath = fsZds.join(harness.projectPath, 'part.kcl')
    const disposeHistory = buildZookeeperHistoryExtension({
      kclManager: harness.kclManager,
      onCurrentFileDelete: async () => undefined,
      onActiveFileRestore: async (path, contents) => {
        await harness.app.project?.openEditor(
          path,
          harness.kclManager,
          contents
        )
      },
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })
    const executeCode = vi
      .spyOn(harness.kclManager, 'executeCode')
      .mockRejectedValue({ msg: 'No open project' })
    const read = File.ioImplementations.read
    vi.spyOn(File.ioImplementations, 'read').mockImplementation((path) => {
      if (path === partPath) {
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { cause: 'ENOENT' })
        )
      }
      return read(path)
    })

    await fsZds.rm(partPath)
    if (harness.app.project) {
      harness.app.project.files = harness.app.project.files.filter(
        (file) => file.path !== partPath
      )
    }
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: fsZds.join(harness.projectPath, 'main.kcl'),
        patch: {
          run_id: 'delete-non-active-file',
          changed_files: [
            {
              path: 'part.kcl',
              status: 'deleted',
              previous_contents: 'part = true\n',
            },
          ],
        },
      })
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(executeCode).toHaveBeenCalled()
    expect(harness.kclManager.path).toBe(
      fsZds.join(harness.projectPath, 'main.kcl')
    )
    await expect(fsZds.readFile(partPath, 'utf8')).resolves.toBe(
      'part = true\n'
    )

    disposeHistory()
  })

  it('does not skip the next Zookeeper replay after a failed replay restore', async () => {
    const harness = await createProjectHarness({
      'main.kcl': 'main = true\n',
      'side.kcl': 'side = 1\n',
    })
    const sidePath = fsZds.join(harness.projectPath, 'side.kcl')
    const restoreAfterFailedUndo = vi
      .spyOn(harness.kclManager.globalHistoryView, 'restoreAfterFailedUndo')
      .mockReturnValue(true)

    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: harness.kclManager.path,
        patch: {
          run_id: 'invalid-modified-patch',
          changed_files: [{ path: 'side.kcl', status: 'modified' }],
        },
      })
    )
    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(restoreAfterFailedUndo).toHaveBeenCalledOnce()

    restoreAfterFailedUndo.mockRestore()
    await writeText(sidePath, 'side = 2\n')
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: harness.kclManager.path,
        patch: {
          run_id: 'valid-next-patch',
          changed_files: [modifiedFile('side.kcl', 'side = 1\n', 'side = 2\n')],
        },
      })
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    await expect(fsZds.readFile(sidePath, 'utf8')).resolves.toBe('side = 1\n')
  })

  it('restores a streamed deleted imported file with later sibling updates', async () => {
    const mainBefore =
      'import "smallBox.kcl" as smallBox\n' +
      'import "mediumBox.kcl" as mediumBox\n' +
      'import "largeBox.kcl" as largeBox\n' +
      'stack = [smallBox, mediumBox, largeBox]\n'
    const mainAfter =
      'import "mediumBox.kcl" as mediumBox\n' +
      'import "largeBox.kcl" as largeBox\n' +
      'stack = [mediumBox, largeBox]\n'
    const smallBefore = 'export smallBoxSize = 30mm\nsmallBoxSize\n'
    const mediumBefore = 'export mediumBoxSize = 50mm\nmediumBoxSize\n'
    const mediumAfter = 'export mediumBoxSize = 60mm\nmediumBoxSize\n'
    const largeBefore = 'export largeBoxSize = 70mm\nlargeBoxSize\n'
    const largeAfter = 'export largeBoxSize = 80mm\nlargeBoxSize\n'
    const harness = await createProjectHarness({
      'main.kcl': mainBefore,
      'smallBox.kcl': smallBefore,
      'mediumBox.kcl': mediumBefore,
      'largeBox.kcl': largeBefore,
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
      onCurrentFileDelete: async () => {
        await harness.app.project?.openEditor(mainPath, harness.kclManager)
      },
      onActiveFileRestore: async (path, contents) => {
        await harness.app.project?.openEditor(
          path,
          harness.kclManager,
          contents
        )
      },
      onProjectFilesReplay: async (replayFiles) => {
        await harness.app.project?.syncReplayedFilesToRust(replayFiles)
      },
    })
    const streamedPatches: ZookeeperEditPatch[] = [
      {
        run_id: 'streamed-delete-sibling-updates',
        changed_files: [
          {
            path: 'smallBox.kcl',
            status: 'deleted' as const,
            previous_contents: smallBefore,
          },
        ],
      },
      {
        run_id: 'streamed-delete-sibling-updates',
        changed_files: [modifiedFile('main.kcl', mainBefore, mainAfter)],
      },
      {
        run_id: 'streamed-delete-sibling-updates',
        changed_files: [
          modifiedFile('mediumBox.kcl', mediumBefore, mediumAfter),
        ],
      },
      {
        run_id: 'streamed-delete-sibling-updates',
        changed_files: [modifiedFile('largeBox.kcl', largeBefore, largeAfter)],
      },
    ]
    const mergedPatch = streamedPatches.reduce(mergeZookeeperEditPatches)

    await writeText(mainPath, mainAfter)
    await writeText(
      fsZds.join(harness.projectPath, 'mediumBox.kcl'),
      mediumAfter
    )
    await writeText(fsZds.join(harness.projectPath, 'largeBox.kcl'), largeAfter)
    await fsZds.rm(smallBoxPath)
    await switchToFile(mainPath)
    harness.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: harness.projectPath,
        activeFilePath: smallBoxPath,
        patch: mergedPatch,
      })
    )
    vi.spyOn(fsZds, 'readFile').mockImplementationOnce(() =>
      Promise.reject('ENOENT')
    )

    harness.kclManager.undo()
    await waitForHistoryIdle(harness.kclManager)
    expect(harness.kclManager.path).toBe(smallBoxPath)
    expect(harness.kclManager.code).toBe(smallBefore)
    await expect(fsZds.readFile(smallBoxPath, 'utf8')).resolves.toBe(
      smallBefore
    )
    await expect(fsZds.readFile(mainPath, 'utf8')).resolves.toBe(mainBefore)
    await expect(
      fsZds.readFile(fsZds.join(harness.projectPath, 'mediumBox.kcl'), 'utf8')
    ).resolves.toBe(mediumBefore)
    await expect(
      fsZds.readFile(fsZds.join(harness.projectPath, 'largeBox.kcl'), 'utf8')
    ).resolves.toBe(largeBefore)

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
      onActiveFileRestore: async (path, contents) => {
        await harness.app.project?.openEditor(
          path,
          harness.kclManager,
          contents
        )
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
      onActiveFileRestore: async (path, contents) => {
        await harness.app.project?.openEditor(
          path,
          harness.kclManager,
          contents
        )
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
  historyDisposers.push(
    buildZookeeperHistoryExtension({
      kclManager,
      onCurrentFileDelete: async (deletedPaths) => {
        const fallbackPath = getZookeeperReplayFallbackFilePath(
          openedProject,
          deletedPaths
        )
        if (!fallbackPath) {
          return
        }

        await openedProject.openEditor(fallbackPath, kclManager)
      },
      onActiveFileRestore: async (path, contents) => {
        await openedProject.openEditor(path, kclManager, contents)
      },
      onProjectFilesReplay: async (replayFiles) => {
        await openedProject.syncReplayedFilesToRust(replayFiles)
      },
    })
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

  harness.kclManager.addGlobalHistoryEventWithCodeChange(
    zookeeperEditPatchHistoryEvent({
      projectPath: harness.projectPath,
      patch,
    }),
    currentAfter
  )
}

async function applyDelayedActiveFileZookeeperAction(
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
  await writeText(fsZds.join(harness.projectPath, 'main.kcl'), currentAfter)
  harness.kclManager.addGlobalHistoryEventWithCodeChange(
    zookeeperEditPatchHistoryEvent({
      projectPath: harness.projectPath,
      patch,
    }),
    currentAfter
  )
}

async function applyUnfilteredActiveFileZookeeperAction(
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
  await writeText(fsZds.join(harness.projectPath, 'main.kcl'), currentAfter)
  harness.kclManager.addGlobalHistoryEventWithCodeChange(
    zookeeperEditPatchHistoryEvent({
      projectPath: harness.projectPath,
      patch,
    }),
    currentAfter
  )
}

async function applyGlobalOnlyActiveFileZookeeperAction(
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
  harness.kclManager.updateCodeEditor(currentAfter, {
    shouldAddToHistory: false,
    shouldClearHistory: false,
    shouldExecute: true,
    shouldResetCamera: false,
    shouldWriteToDisk: true,
  })
  await writeText(fsZds.join(harness.projectPath, 'main.kcl'), currentAfter)
  harness.kclManager.addGlobalHistoryEventWithCodeChange(
    zookeeperEditPatchHistoryEvent({
      projectPath: harness.projectPath,
      activeFilePath: harness.kclManager.path,
      patch,
    }),
    currentAfter,
    currentBefore
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

function dispatchEditorEdit(kclManager: KclManager, code: string) {
  const currentCode = kclManager.code
  kclManager.editorView.dispatch({
    changes: {
      from: 0,
      to: currentCode.length,
      insert: code,
    },
    annotations: [isolateHistory.of('full')],
  })
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
    if (name === 'main') {
      continue
    }
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
    if (!kclManager.historyOperationInProgress.value) {
      return
    }
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

function getZookeeperReplayFallbackFilePath(
  project: ZDSProject,
  deletedPaths: Set<string>
) {
  const defaultFile = project.projectIORefSignal.value.default_file
  const candidates = [
    defaultFile,
    ...project.files.map((file) => file.path),
  ].filter((path, index, paths) => paths.indexOf(path) === index)

  return candidates.find((path) => path && !deletedPaths.has(path))
}
