import 'fake-indexeddb/auto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { App } from '@src/lib/app'
import { cloudSyncStatus } from '@src/lib/cloudSync'
import {
  deleteProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  getCloudProjectFolderRenameName,
  getDuplicateProjectBaseName,
  shouldSendProjectFolderReadProgress,
  sortProjectDirectoryEntriesByModifiedDesc,
  systemIOMachineImpl,
} from '@src/machines/systemIO/systemIOMachineImpl'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import {
  buildTheWorldAndNoEngineConnection,
  createTestWasmRegistryItem,
} from '@src/unitTestUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

let appInstanceInThisFile: App = null!
let instanceInThisFile: ModuleType = null!

function mockProject(name: string): Project {
  return {
    metadata: null,
    kcl_file_count: 0,
    directory_count: 0,
    default_file: `/${name}/main.kcl`,
    path: `/${name}`,
    name,
    children: [],
    readWriteAccess: true,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const fileTreeMutationCases = [
  {
    actorName: SystemIOMachineActors.renameFolder,
    expectedState: SystemIOMachineStates.renamingFolder,
    event: {
      type: SystemIOMachineEvents.renameFolder,
      data: {
        requestedFolderName: 'renamed-folder',
        folderName: 'folderToRename',
        absolutePathToParentDirectory: '/Test Project',
      },
    },
  },
  {
    actorName: SystemIOMachineActors.createBlankFile,
    expectedState: SystemIOMachineStates.creatingBlankFile,
    event: {
      type: SystemIOMachineEvents.createBlankFile,
      data: {
        requestedAbsolutePath: '/Test Project/new-file.kcl',
      },
    },
  },
  {
    actorName: SystemIOMachineActors.deleteFileOrFolder,
    expectedState: SystemIOMachineStates.deletingFileOrFolder,
    event: {
      type: SystemIOMachineEvents.deleteFileOrFolder,
      data: {
        requestedPath: '/Test Project/delete-me.kcl',
      },
    },
  },
  {
    actorName: SystemIOMachineActors.moveRecursive,
    expectedState: SystemIOMachineStates.movingRecursive,
    event: {
      type: SystemIOMachineEvents.moveRecursive,
      data: {
        src: '/Test Project/source.kcl',
        target: '/Test Project/target.kcl',
      },
    },
  },
] as const

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance } = await buildTheWorldAndNoEngineConnection()
  appInstanceInThisFile = App.fromProvided({
    registryOverrides: [createTestWasmRegistryItem(Promise.resolve(instance))],
  })
  instanceInThisFile = instance
})

describe('systemIOMachine - XState', () => {
  describe('cloud-backed project folder names', () => {
    it('uses a title-derived folder name when it is available', () => {
      expect(
        getCloudProjectFolderRenameName({
          title: 'Some demo',
          currentName: 'Some demo 2',
          folders: [mockProject('Some demo 2')],
        })
      ).toBe('Some demo')
    })

    it('adds numeric suffixes when title-derived folder names already exist', () => {
      expect(
        getCloudProjectFolderRenameName({
          title: 'Some demo',
          currentName: 'Some demo 2',
          folders: [
            mockProject('Some demo'),
            mockProject('Some demo-2'),
            mockProject('Some demo 2'),
          ],
        })
      ).toBe('Some demo-3')
    })

    it('only emits folder read progress for initial loads', () => {
      expect(shouldSendProjectFolderReadProgress(undefined)).toBe(true)
      expect(shouldSendProjectFolderReadProgress([])).toBe(true)
      expect(
        shouldSendProjectFolderReadProgress([mockProject('local-project')])
      ).toBe(false)
    })

    it('orders folder read progress by newest project directory first', () => {
      expect(
        sortProjectDirectoryEntriesByModifiedDesc([
          { name: 'alpha', path: '/projects/alpha', modified: 10 },
          { name: 'charlie', path: '/projects/charlie', modified: 30 },
          { name: 'bravo', path: '/projects/bravo', modified: 30 },
        ]).map((entry) => entry.name)
      ).toEqual(['bravo', 'charlie', 'alpha'])
    })
  })

  describe('duplicate project names', () => {
    it.each(['CON', 'nul', 'COM1', 'lpt9.txt'])(
      'avoids the Windows device name %s',
      (name) => {
        expect(getDuplicateProjectBaseName(name, 'fallback')).toContain(
          '-project'
        )
      }
    )
  })

  describe('desktop', () => {
    describe('when initialized', () => {
      it('should contain the default context values', () => {
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const context = actor.getSnapshot().context
        expect(context.folders).toStrictEqual(undefined)
        expect(context.defaultProjectFolderName).toStrictEqual(
          DEFAULT_PROJECT_NAME
        )
        expect(context.projectDirectoryPath).toBe(NO_PROJECT_DIRECTORY)
        expect(context.hasListedProjects).toBe(false)
        expect(context.requestedProjectName).toStrictEqual({
          name: NO_PROJECT_DIRECTORY,
        })
        expect(context.requestedFileName).toStrictEqual({
          project: NO_PROJECT_DIRECTORY,
          file: NO_PROJECT_DIRECTORY,
        })
      })
      it('should be in idle state', () => {
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const state = actor.getSnapshot().value
        expect(state).toBe(SystemIOMachineStates.idle)
      })
      it('defers bulk edit success until file navigation completes', async () => {
        const onSuccess = vi.fn()
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]:
                fromPromise(async ({ input }) => ({
                  message: 'done',
                  projectName: input.requestedProjectName,
                  fileName: input.requestedFileNameWithExtension,
                  subRoute: '',
                  shouldNavigate: true,
                  onProjectLoaderComplete: input.onSuccess,
                })),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => [] as Project[]),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        actor.send({
          type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
          data: {
            files: [],
            requestedProjectName: 'demo-project',
            requestedFileNameWithExtension: 'main.kcl',
            onSuccess,
          },
        })

        await waitFor(actor, (state) =>
          state.matches(
            SystemIOMachineStates.bulkCreateAndDeletingKCLFilesAndNavigateToFile
          )
        )
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.idle)
        )

        expect(onSuccess).not.toHaveBeenCalled()
        expect(
          actor.getSnapshot().context.requestedFileName.onProjectLoaderComplete
        ).toBe(onSuccess)
        actor.stop()
      })
      it('does not request navigation for an in-place bulk edit', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]:
                fromPromise(async ({ input }) => ({
                  message: 'done',
                  projectName: input.requestedProjectName,
                  fileName: input.requestedFileNameWithExtension,
                  subRoute: '',
                  shouldNavigate: false,
                })),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => [] as Project[]),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()
        const requestedFileNameBefore =
          actor.getSnapshot().context.requestedFileName

        actor.send({
          type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
          data: {
            files: [],
            requestedProjectName: 'demo-project',
            requestedFileNameWithExtension: 'main.kcl',
          },
        })
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.idle)
        )

        expect(actor.getSnapshot().context.requestedFileName).toBe(
          requestedFileNameBefore
        )
        actor.stop()
      })
    })
    describe('when reading projects', () => {
      it('should exit early when project directory is empty string', async () => {
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        actor.send({
          type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
        })
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.readingFolders)
        )
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.idle)
        )
        const context = actor.getSnapshot().context
        expect(context.folders).toStrictEqual([])
      })
      it('should accept project imports while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]:
                fromPromise(async () => new Promise(() => {})),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile,
            data: {
              files: [],
              requestedProjectName: 'shared-project',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(
              SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile
            )
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept project creation while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.createProject]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.createProject,
            data: {
              requestedProjectName: 'local-first-project',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.creatingProject)
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept project rename while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.renameProject]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.renameProject,
            data: {
              projectName: 'local-first-project',
              requestedProjectName: 'renamed-local-first-project',
              redirect: true,
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.renamingProject)
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept project deletion while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.deleteProject]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.deleteProject,
            data: {
              requestedProjectName: 'local-first-project',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.deletingProject)
          )
        } finally {
          actor.stop()
        }
      })
      it('should reject project deletion with an empty project name', async () => {
        const rmSpy = vi.spyOn(fsZds, 'rm').mockResolvedValue(undefined)
        const actor = createActor(
          systemIOMachineImpl.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        let sawDeletingProject = false
        const settled = new Promise<ReturnType<typeof actor.getSnapshot>>(
          (resolve) => {
            actor.subscribe((state) => {
              if (state.matches(SystemIOMachineStates.deletingProject)) {
                sawDeletingProject = true
              }
              if (
                sawDeletingProject &&
                (state.matches(SystemIOMachineStates.idle) ||
                  state.matches(SystemIOMachineStates.readingFolders))
              ) {
                resolve(state)
              }
            })
          }
        )

        try {
          actor.send({
            type: SystemIOMachineEvents.deleteProject,
            data: { requestedProjectName: '' },
          })

          const settledState = await settled
          expect(settledState).toMatchObject({
            value: SystemIOMachineStates.idle,
          })
          expect(rmSpy).not.toHaveBeenCalled()
        } finally {
          actor.stop()
          rmSpy.mockRestore()
        }
      })
      it('should accept file rename while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.renameFile]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.renameFile,
            data: {
              requestedFileNameWithExtension: 'newFileName.kcl',
              fileNameWithExtension: 'fileToRename.kcl',
              absolutePathToParentDirectory: '/Test Project',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.renamingFile)
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept file-tree mutations while reading folders', async () => {
        for (const testCase of fileTreeMutationCases) {
          const actor = createActor(
            systemIOMachine.provide({
              actors: {
                [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                  fromPromise(async () => new Promise(() => {})),
                [testCase.actorName]: fromPromise(
                  async () => new Promise(() => {})
                ),
              },
            }),
            {
              input: {
                wasmInstancePromise: Promise.resolve(instanceInThisFile),
                app: appInstanceInThisFile,
              },
            }
          ).start()

          try {
            actor.send({
              type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
            })
            await waitFor(actor, (state) =>
              state.matches(SystemIOMachineStates.readingFolders)
            )

            actor.send(testCase.event)

            await waitFor(actor, (state) =>
              state.matches(testCase.expectedState)
            )
          } finally {
            actor.stop()
          }
        }
      })
      it('should restart folder loading when project directory changes while reading folders', async () => {
        const readProjectDirectoryPaths: string[] = []
        const readSignals: AbortSignal[] = []
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async ({ input, signal }) => {
                  readProjectDirectoryPaths.push(input.projectDirectoryPath)
                  readSignals.push(signal)
                  return new Promise<Project[]>(() => {})
                }),
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async (): Promise<{ value: boolean; error: unknown }> => ({
                  value: true,
                  error: undefined,
                })
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: '/projects',
            },
          })

          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.readingFolders) &&
              state.context.projectDirectoryPath === '/projects' &&
              readProjectDirectoryPaths.length === 2
          )

          expect(readProjectDirectoryPaths).toStrictEqual([
            NO_PROJECT_DIRECTORY,
            '/projects',
          ])
          expect(readSignals[0].aborted).toBe(true)
        } finally {
          actor.stop()
        }
      })
      it('should restart read/write checks when project directory changes while checking read/write access', async () => {
        const checkProjectDirectoryPaths: string[] = []
        const checkSignals: AbortSignal[] = []
        const readProjectDirectoryPaths: string[] = []
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async ({ input, signal }) => {
                  checkProjectDirectoryPaths.push(
                    input.requestedProjectDirectoryPath
                  )
                  checkSignals.push(signal)
                  if (checkProjectDirectoryPaths.length === 1) {
                    return new Promise<{ value: boolean; error: unknown }>(
                      () => {}
                    )
                  }

                  return { value: true, error: undefined }
                }
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async ({ input }) => {
                  readProjectDirectoryPaths.push(input.projectDirectoryPath)
                  return new Promise<Project[]>(() => {})
                }),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: '/stale-projects',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: '/projects',
            },
          })

          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.readingFolders) &&
              state.context.projectDirectoryPath === '/projects' &&
              readProjectDirectoryPaths.includes('/projects')
          )

          expect(checkProjectDirectoryPaths).toStrictEqual([
            '/stale-projects',
            '/projects',
          ])
          expect(checkSignals[0].aborted).toBe(true)
        } finally {
          actor.stop()
        }
      })
      it('should leave a terminal folders value when reading folders fails', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async (): Promise<Project[]> => {
                  throw new Error('Failed to read projects')
                }),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })

          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.folders !== undefined
          )

          expect(actor.getSnapshot().context.folders).toStrictEqual([])
          expect(actor.getSnapshot().context.hasListedProjects).toBe(true)
        } finally {
          actor.stop()
        }
      })
      it('should update folders incrementally while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          const folders = [mockProject('bravo'), mockProject('alpha')]
          actor.send({
            type: SystemIOMachineEvents.setFolders,
            data: { folders },
          })

          await waitFor(
            actor,
            (state) => state.context.folders?.length === folders.length
          )

          expect(actor.getSnapshot().context.folders).toStrictEqual(folders)
          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.readingFolders,
          })
        } finally {
          actor.stop()
        }
      })
      it('should defer project duplication until folders are read', async () => {
        const readFolders = deferred<Project[]>()
        const folders = [mockProject('source')]
        const duplicateFolders: (Project[] | undefined)[] = []
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => readFolders.promise),
              [SystemIOMachineActors.duplicateProject]: fromPromise(
                async ({ input }) => {
                  duplicateFolders.push(input.context.folders)
                  return new Promise(() => {})
                }
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Source',
            },
          })

          expect(duplicateFolders).toHaveLength(0)
          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.readingFolders,
          })

          readFolders.resolve(folders)

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.duplicatingProject)
          )
          expect(duplicateFolders).toStrictEqual([folders])
        } finally {
          actor.stop()
        }
      })
      it('should discard deferred duplication when reading folders fails', async () => {
        let rejectFirstRead!: (error: Error) => void
        const firstRead = new Promise<Project[]>((_, reject) => {
          rejectFirstRead = reject
        })
        const folders = [mockProject('source')]
        let readCount = 0
        const duplicateProject = vi.fn(async () => ({ message: '', name: '' }))
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => {
                  readCount += 1
                  return readCount === 1 ? firstRead : folders
                }),
              [SystemIOMachineActors.duplicateProject]:
                fromPromise(duplicateProject),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )
          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Source',
            },
          })

          rejectFirstRead(new Error('folder read failed'))
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )
          expect(actor.getSnapshot().context.deferredSystemIOEvent).toBe(
            undefined
          )

          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.folders === folders
          )
          expect(duplicateProject).not.toHaveBeenCalled()
        } finally {
          actor.stop()
        }
      })
      it('should only apply the raw name length guard to create and rename', async () => {
        const createProject = vi.fn(async () => ({ message: '', name: '' }))
        const renameProject = vi.fn(async () => ({
          message: '',
          newName: '',
          oldName: '',
          redirect: false,
        }))
        const duplicateResult = deferred<{ message: string; name: string }>()
        const duplicateProject = vi.fn(async () => duplicateResult.promise)
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.createProject]: fromPromise(createProject),
              [SystemIOMachineActors.renameProject]: fromPromise(renameProject),
              [SystemIOMachineActors.duplicateProject]:
                fromPromise(duplicateProject),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()
        const longDisplayName = 'a'.repeat(241)

        try {
          actor.send({
            type: SystemIOMachineEvents.createProject,
            data: { requestedProjectName: longDisplayName },
          })
          actor.send({
            type: SystemIOMachineEvents.renameProject,
            data: {
              projectName: 'source',
              requestedProjectName: longDisplayName,
              redirect: false,
            },
          })
          expect(createProject).not.toHaveBeenCalled()
          expect(renameProject).not.toHaveBeenCalled()

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: longDisplayName,
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.duplicatingProject)
          )
          expect(duplicateProject).toHaveBeenCalledOnce()
        } finally {
          actor.stop()
        }
      })
      it('should accept file navigation while reading folders', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          actor.send({
            type: SystemIOMachineEvents.navigateToFile,
            data: {
              requestedProjectName: 'bracket',
              requestedFileName: 'empty.kcl',
            },
          })

          await waitFor(
            actor,
            (state) => state.context.requestedFileName.file === 'empty.kcl'
          )

          expect(actor.getSnapshot().context.requestedFileName).toStrictEqual({
            project: 'bracket',
            file: 'empty.kcl',
            subRoute: undefined,
          })
          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.readingFolders,
          })
        } finally {
          actor.stop()
        }
      })
      it('should prefer opening the imported entry file over navigating to the project', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => [] as Project[]),
              [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]:
                fromPromise(async () => ({
                  message: 'Imported',
                  projectName: 'demo-project',
                  fileName: 'shared-project/main.kcl',
                  subRoute: '',
                })),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.navigateToProject,
            data: {
              requestedProjectName: 'demo-project',
            },
          })

          actor.send({
            type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile,
            data: {
              files: [],
              requestedProjectName: 'demo-project',
              requestedFileNameWithExtension: 'shared-project/main.kcl',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          expect(actor.getSnapshot().context.requestedFileName).toStrictEqual({
            project: 'demo-project',
            file: 'shared-project/main.kcl',
            subRoute: '',
          })
          expect(
            actor.getSnapshot().context.requestedProjectName
          ).toStrictEqual({
            name: NO_PROJECT_DIRECTORY,
          })
        } finally {
          actor.stop()
        }
      })
    })
    describe('when setting project directory path', () => {
      it('should set new project directory path', async () => {
        const kclSamplesPath = path.join('public', 'kcl-samples')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        actor.send({
          type: SystemIOMachineEvents.setProjectDirectoryPath,
          data: {
            requestedProjectDirectoryPath: kclSamplesPath,
          },
        })
        let context = actor.getSnapshot().context
        expect(context.projectDirectoryPath).toBe(kclSamplesPath)
      })
      it('should defer project imports while checking read/write access', async () => {
        const checkReadWrite = deferred<{ value: boolean; error: unknown }>()
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => checkReadWrite.promise
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => [] as Project[]),
              [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]:
                fromPromise(async () => new Promise(() => {})),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: 'public/kcl-samples',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile,
            data: {
              files: [],
              requestedProjectName: 'shared-project',
            },
          })

          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.checkingReadWrite,
          })
          expect(
            actor.getSnapshot().context.deferredSystemIOEvent
          ).toMatchObject({
            type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile,
          })

          checkReadWrite.resolve({ value: true, error: undefined })

          await waitFor(actor, (state) =>
            state.matches(
              SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile
            )
          )
        } finally {
          actor.stop()
        }
      })
      it('should defer project creation while checking read/write access', async () => {
        const checkReadWrite = deferred<{ value: boolean; error: unknown }>()
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => checkReadWrite.promise
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => [] as Project[]),
              [SystemIOMachineActors.createProject]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: 'public/kcl-samples',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.createProject,
            data: {
              requestedProjectName: 'local-first-project',
            },
          })

          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.checkingReadWrite,
          })
          expect(
            actor.getSnapshot().context.deferredSystemIOEvent
          ).toMatchObject({
            type: SystemIOMachineEvents.createProject,
          })

          checkReadWrite.resolve({ value: true, error: undefined })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.creatingProject)
          )
        } finally {
          actor.stop()
        }
      })
      it('should defer project duplication while checking read/write access', async () => {
        const checkReadWrite = deferred<{ value: boolean; error: unknown }>()
        const readFolders = deferred<Project[]>()
        const folders = [mockProject('source')]
        const duplicateFolders: (Project[] | undefined)[] = []
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => checkReadWrite.promise
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => readFolders.promise),
              [SystemIOMachineActors.duplicateProject]: fromPromise(
                async ({ input }) => {
                  duplicateFolders.push(input.context.folders)
                  return new Promise(() => {})
                }
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: 'public/kcl-samples',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Source',
            },
          })

          expect(
            actor.getSnapshot().context.deferredSystemIOEvent
          ).toMatchObject({
            type: SystemIOMachineEvents.duplicateProject,
          })

          checkReadWrite.resolve({ value: true, error: undefined })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )
          expect(duplicateFolders).toHaveLength(0)
          expect(actor.getSnapshot().context.folders).toBeUndefined()

          readFolders.resolve(folders)

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.duplicatingProject)
          )
          expect(duplicateFolders).toStrictEqual([folders])
        } finally {
          actor.stop()
        }
      })
      it('should defer file imports while checking read/write access', async () => {
        const checkReadWrite = deferred<{ value: boolean; error: unknown }>()
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => checkReadWrite.promise
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise(() => {})),
              [SystemIOMachineActors.createKCLFile]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: 'public/kcl-samples',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.importFileFromURL,
            data: {
              requestedProjectName: 'bracket',
              requestedFileNameWithExtension: 'lego.kcl',
              requestedCode: 'circle',
            },
          })

          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.checkingReadWrite,
          })
          expect(
            actor.getSnapshot().context.deferredSystemIOEvent
          ).toMatchObject({
            type: SystemIOMachineEvents.importFileFromURL,
          })

          checkReadWrite.resolve({ value: true, error: undefined })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.importFileFromURL)
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept absolute-path file-tree mutations while checking read/write access', async () => {
        for (const testCase of fileTreeMutationCases) {
          const actor = createActor(
            systemIOMachine.provide({
              actors: {
                [SystemIOMachineActors.checkReadWrite]: fromPromise(
                  async () => new Promise(() => {})
                ),
                [testCase.actorName]: fromPromise(
                  async () => new Promise(() => {})
                ),
              },
            }),
            {
              input: {
                wasmInstancePromise: Promise.resolve(instanceInThisFile),
                app: appInstanceInThisFile,
              },
            }
          ).start()

          try {
            actor.send({
              type: SystemIOMachineEvents.setProjectDirectoryPath,
              data: {
                requestedProjectDirectoryPath: 'public/kcl-samples',
              },
            })
            await waitFor(actor, (state) =>
              state.matches(SystemIOMachineStates.checkingReadWrite)
            )

            actor.send(testCase.event)

            await waitFor(actor, (state) =>
              state.matches(testCase.expectedState)
            )
          } finally {
            actor.stop()
          }
        }
      })
      it('should accept file navigation while checking read/write access', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => new Promise(() => {})
              ),
            },
          }),
          {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }
        ).start()

        try {
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: 'public/kcl-samples',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.navigateToFile,
            data: {
              requestedProjectName: 'bracket',
              requestedFileName: 'empty.kcl',
            },
          })

          await waitFor(
            actor,
            (state) => state.context.requestedFileName.file === 'empty.kcl'
          )

          expect(actor.getSnapshot().context.requestedFileName).toStrictEqual({
            project: 'bracket',
            file: 'empty.kcl',
            subRoute: undefined,
          })
          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.checkingReadWrite,
          })
        } finally {
          actor.stop()
        }
      })
    })
    describe('when duplicating projects', () => {
      it('safely duplicates the current project while sync is disabled', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-project-')
        )
        const sourceFolderName = '550e8400-e29b-41d4-a716-446655440000'
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const reservedProjectPath = path.join(projectDirectory, 'Simple Box-1')
        const oldLocalProjectId = '11111111-1111-4111-8111-111111111111'
        const oldCloudProjectId = '22222222-2222-4222-8222-222222222222'
        const originalProject = appInstanceInThisFile.project
        const originalSettings = appInstanceInThisFile.settings
        const settingsWaitStarted = deferred<undefined>()
        let releaseSettingsWait = () => {}
        appInstanceInThisFile.settings = {
          ...originalSettings,
          actor: {
            getSnapshot: () => ({ matches: () => false }),
            subscribe: (observer: {
              next: (snapshot: { matches: (state: string) => boolean }) => void
            }) => {
              settingsWaitStarted.resolve(undefined)
              releaseSettingsWait = () => {
                observer.next({ matches: (state) => state === 'idle' })
              }
              return { unsubscribe: () => {} }
            },
          },
        } as any
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(path.join(sourceProject, 'nested'), { recursive: true })
          await writeFile(path.join(sourceProject, 'main.kcl'), 'main')
          await writeFile(
            path.join(sourceProject, 'nested', 'part.kcl'),
            'nested'
          )
          await chmod(path.join(sourceProject, 'nested', 'part.kcl'), 0o400)
          await writeFile(
            path.join(sourceProject, 'project.toml'),
            `title = "Simple Box"
default_file = "nested/part.kcl"

[settings.meta]
id = "${oldLocalProjectId}"

[settings.modeling]
base_unit = "mm"

[cloud."zoo.dev"]
project_id = "${oldCloudProjectId}"
`
          )
          expect(cloudSyncStatus.value.enabled).toBe(false)
          await putProjectMetadata({
            schemaVersion: 1,
            localProjectPath: reservedProjectPath,
            projectName: 'Simple Box-1',
            tombstone: true,
          })

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some(
                (folder) => folder.name === sourceFolderName
              )
            )
          )
          await chmod(sourceProject, 0o500)

          const flushPendingWriteToFile = vi.fn(async () => {
            await writeFile(
              path.join(sourceProject, 'main.kcl'),
              'pending edit'
            )
          })
          appInstanceInThisFile.project = {
            path: sourceProject,
            editors: new Map([['main.kcl', { flushPendingWriteToFile }]]),
          } as any

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: sourceFolderName,
              requestedProjectName: 'Simple Box',
            },
          })
          await settingsWaitStarted.promise
          expect(flushPendingWriteToFile).not.toHaveBeenCalled()
          releaseSettingsWait()
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.requestedProjectName.name === 'Simple Box-2'
          )

          await expect(
            readFile(
              path.join(projectDirectory, 'Simple Box-2', 'nested', 'part.kcl'),
              'utf-8'
            )
          ).resolves.toBe('nested')
          expect(
            (
              await stat(
                path.join(
                  projectDirectory,
                  'Simple Box-2',
                  'nested',
                  'part.kcl'
                )
              )
            ).mode & 0o200
          ).toBe(0o200)
          await expect(
            readFile(
              path.join(projectDirectory, 'Simple Box-2', 'main.kcl'),
              'utf-8'
            )
          ).resolves.toBe('pending edit')
          expect(flushPendingWriteToFile).toHaveBeenCalledOnce()
          const duplicatedProjectToml = await readFile(
            path.join(projectDirectory, 'Simple Box-2', 'project.toml'),
            'utf-8'
          )
          expect(duplicatedProjectToml).toContain('title = "Simple Box-2"')
          expect(duplicatedProjectToml).toContain(
            'default_file = "nested/part.kcl"'
          )
          expect(duplicatedProjectToml).toContain('base_unit = "mm"')
          expect(duplicatedProjectToml).not.toContain(oldLocalProjectId)
          expect(duplicatedProjectToml).not.toContain(oldCloudProjectId)
          expect(duplicatedProjectToml).not.toContain('[cloud.')
          expect(
            (await readdir(projectDirectory)).filter((name) =>
              name.startsWith('.zds-duplicate-')
            )
          ).toEqual([])
        } finally {
          appInstanceInThisFile.project = originalProject
          appInstanceInThisFile.settings = originalSettings
          actor.stop()
          await deleteProjectMetadata(reservedProjectPath)
          await chmod(sourceProject, 0o700).catch(() => undefined)
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('removes its hidden staging directory when copying fails', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-failure-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const copyStarted = deferred<undefined>()
        const copySpy = vi
          .spyOn(fsZds, 'cp')
          .mockImplementationOnce(async () => {
            copyStarted.resolve(undefined)
            return Promise.reject(new Error('copy failed'))
          })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await writeFile(
            path.join(sourceProject, 'project.toml'),
            'title = "Source"\ndefault_file = "main.kcl"\n'
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Source',
            },
          })
          await copyStarted.promise
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          expect(await readdir(projectDirectory)).toEqual(['source'])
        } finally {
          copySpy.mockRestore()
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('does not replace a target created while copying', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-collision-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const targetProject = path.join(projectDirectory, 'Source-1')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const copy = fsZds.cp.bind(fsZds)
        const copySpy = vi
          .spyOn(fsZds, 'cp')
          .mockImplementationOnce(async (...args) => {
            await copy(...args)
            await mkdir(targetProject)
            await writeFile(
              path.join(targetProject, 'concurrent.txt'),
              'keep me'
            )
          })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await writeFile(
            path.join(sourceProject, 'project.toml'),
            'title = "Source"\ndefault_file = "main.kcl"\n'
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Source',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          await expect(
            readFile(path.join(targetProject, 'concurrent.txt'), 'utf-8')
          ).resolves.toBe('keep me')
          expect(
            (await readdir(projectDirectory)).some((name) =>
              name.startsWith('.zds-duplicate-')
            )
          ).toBe(false)
        } finally {
          copySpy.mockRestore()
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })
    })
    describe('when setting default project folder name', () => {
      it('should set a new default project folder name', async () => {
        const expected = 'coolcoolcoolProjectName'
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        actor.send({
          type: SystemIOMachineEvents.setDefaultProjectFolderName,
          data: {
            requestedDefaultProjectFolderName: expected,
          },
        })
        let context = actor.getSnapshot().context
        expect(context.defaultProjectFolderName).toBe(expected)
      })
    })
  })
})
