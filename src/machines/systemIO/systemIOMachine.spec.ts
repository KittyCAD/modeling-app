import path from 'node:path'
import { App } from '@src/lib/app'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  getCloudProjectFolderRenameName,
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
