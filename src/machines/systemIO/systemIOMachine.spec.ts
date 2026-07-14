import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { App } from '@src/lib/app'
import {
  DEFAULT_PROJECT_NAME,
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  MAX_PROJECT_NAME_LENGTH,
} from '@src/lib/constants'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
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
    describe('when duplicating projects', () => {
      it('copies project files under a unique title and resets project metadata', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-project-')
        )
        const sourceFolderName = '550e8400-e29b-41d4-a716-446655440000'
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const oldLocalProjectId = '11111111-1111-4111-8111-111111111111'
        const oldCloudProjectId = '22222222-2222-4222-8222-222222222222'
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
          await mkdir(path.join(projectDirectory, 'Simple Box-1'))
          await writeFile(
            path.join(projectDirectory, 'Simple Box-1', 'main.kcl'),
            'existing'
          )

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

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: sourceFolderName,
              requestedProjectName: 'Simple Box',
            },
          })
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
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('preserves a destination created during publication and retries with a new name', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-collision-')
        )
        const sourceFolderName = 'source'
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const targetProject = path.join(projectDirectory, 'Copy')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const originalPublishDirectory = fsZds.publishDirectory.bind(fsZds)
        let insertedCompetingProject = false
        const publishDirectorySpy = vi
          .spyOn(fsZds, 'publishDirectory')
          .mockImplementation(async (source, target, markerName) => {
            if (target === targetProject && !insertedCompetingProject) {
              insertedCompetingProject = true
              // Node's rename replaces an existing empty directory on macOS.
              // Insert one at the last possible moment to prove publication
              // uses an exclusive destination reservation instead.
              await mkdir(targetProject)
            }
            return originalPublishDirectory(source, target, markerName)
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
              state.context.folders?.some(
                (folder) => folder.name === sourceFolderName
              )
            )
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: sourceFolderName,
              requestedProjectName: 'Copy',
            },
          })
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.requestedProjectName.name === 'Copy-1'
          )

          await expect(readdir(targetProject)).resolves.toEqual([])
          await expect(
            readFile(path.join(projectDirectory, 'Copy-1', 'main.kcl'), 'utf-8')
          ).resolves.toBe('source')
          expect(
            (await readdir(projectDirectory)).filter((name) =>
              name.startsWith('.zds-duplicate-')
            )
          ).toEqual([])
        } finally {
          publishDirectorySpy.mockRestore()
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('keeps a failed mid-copy target quarantined and never deletes it', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-copy-failure-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const targetProject = path.join(projectDirectory, 'Copy')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        let reader: typeof actor | undefined
        let publicationFailed = false
        const publishDirectorySpy = vi
          .spyOn(fsZds, 'publishDirectory')
          .mockImplementationOnce(async (_source, target, markerName) => {
            await mkdir(target)
            await writeFile(path.join(target, markerName), '')
            await writeFile(path.join(target, 'competitor.kcl'), 'preserve me')
            publicationFailed = true
            return Promise.reject(
              Object.assign(new Error('simulated copy failure'), {
                code: 'EPERM',
              })
            )
          })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          const failureSettled = waitFor(
            actor,
            (state) =>
              publicationFailed && state.matches(SystemIOMachineStates.idle)
          )
          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'Copy',
            },
          })
          await failureSettled

          expect(publishDirectorySpy).toHaveBeenCalledTimes(1)
          await expect(
            readFile(path.join(sourceProject, 'main.kcl'), 'utf-8')
          ).resolves.toBe('source')
          await expect(
            readFile(path.join(targetProject, 'competitor.kcl'), 'utf-8')
          ).resolves.toBe('preserve me')
          await expect(
            readFile(
              path.join(targetProject, DUPLICATE_IN_PROGRESS_FILE_NAME),
              'utf-8'
            )
          ).resolves.toBe('')

          reader = createActor(systemIOMachineImpl, {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }).start()
          reader.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(reader, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )
          expect(
            reader
              .getSnapshot()
              .context.folders?.some((folder) => folder.name === 'Copy')
          ).toBe(false)
        } finally {
          publishDirectorySpy.mockRestore()
          reader?.stop()
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('serializes simultaneous duplicates into two complete projects', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-simultaneous-')
        )
        const sourceFolderName = 'source'
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const actors = [
          createActor(systemIOMachineImpl, {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }).start(),
          createActor(systemIOMachineImpl, {
            input: {
              wasmInstancePromise: Promise.resolve(instanceInThisFile),
              app: appInstanceInThisFile,
            },
          }).start(),
        ]
        const lockTails = new Map<string, Promise<unknown>>()
        const lockRequest = vi.fn(async (...args: unknown[]) => {
          const lockName = args[0] as string
          const options =
            typeof args[1] === 'function'
              ? undefined
              : (args[1] as { ifAvailable?: boolean })
          const callback = args.at(-1) as (
            lock: Lock | null
          ) => Promise<unknown>
          if (options?.ifAvailable && lockTails.has(lockName)) {
            return callback(null)
          }

          const previous = lockTails.get(lockName) ?? Promise.resolve()
          const current = previous
            .catch(() => undefined)
            .then(() => callback({ name: lockName, mode: 'exclusive' }))
          lockTails.set(lockName, current)
          try {
            return await current
          } finally {
            if (lockTails.get(lockName) === current) {
              lockTails.delete(lockName)
            }
          }
        })
        Object.defineProperty(globalThis.navigator, 'locks', {
          configurable: true,
          value: { request: lockRequest },
        })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await writeFile(
            path.join(sourceProject, 'project.toml'),
            'title = "Source"\ndefault_file = "main.kcl"\n'
          )

          for (const actor of actors) {
            actor.send({
              type: SystemIOMachineEvents.setProjectDirectoryPath,
              data: { requestedProjectDirectoryPath: projectDirectory },
            })
          }
          await Promise.all(
            actors.map((actor) =>
              waitFor(actor, (state) =>
                Boolean(
                  state.context.folders?.some(
                    (folder) => folder.name === sourceFolderName
                  )
                )
              )
            )
          )

          for (const actor of actors) {
            actor.send({
              type: SystemIOMachineEvents.duplicateProject,
              data: {
                projectName: sourceFolderName,
                requestedProjectName: 'Copy',
              },
            })
          }
          await Promise.all(
            actors.map((actor) =>
              waitFor(
                actor,
                (state) =>
                  state.matches(SystemIOMachineStates.idle) &&
                  state.context.requestedProjectName.name.startsWith('Copy')
              )
            )
          )

          expect(
            new Set(
              actors.map(
                (actor) => actor.getSnapshot().context.requestedProjectName.name
              )
            )
          ).toEqual(new Set(['Copy', 'Copy-1']))
          await expect(
            readFile(path.join(projectDirectory, 'Copy', 'main.kcl'), 'utf-8')
          ).resolves.toBe('source')
          await expect(
            readFile(path.join(projectDirectory, 'Copy-1', 'main.kcl'), 'utf-8')
          ).resolves.toBe('source')
        } finally {
          Reflect.deleteProperty(globalThis.navigator, 'locks')
          for (const actor of actors) {
            actor.stop()
          }
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('never follows a copied project.toml symlink when resetting metadata', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-symlink-')
        )
        const sourceFolderName = 'source'
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const externalProjectToml = path.join(
          projectDirectory,
          '.external-project.toml'
        )
        const originalProjectToml =
          'title = "Linked Source"\ndefault_file = "main.kcl"\n'
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await writeFile(path.join(sourceProject, 'real.kcl'), 'original')
          await symlink('real.kcl', path.join(sourceProject, 'linked.kcl'))
          await writeFile(externalProjectToml, originalProjectToml)
          await symlink(
            externalProjectToml,
            path.join(sourceProject, 'project.toml')
          )

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

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: sourceFolderName,
              requestedProjectName: 'Independent Copy',
            },
          })
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.requestedProjectName.name === 'Independent Copy'
          )

          await expect(readFile(externalProjectToml, 'utf-8')).resolves.toBe(
            originalProjectToml
          )
          expect(
            (
              await lstat(
                path.join(projectDirectory, 'Independent Copy', 'project.toml')
              )
            ).isSymbolicLink()
          ).toBe(false)
          expect(
            (
              await lstat(path.join(sourceProject, 'project.toml'))
            ).isSymbolicLink()
          ).toBe(true)
          const duplicateProject = path.join(
            projectDirectory,
            'Independent Copy'
          )
          await expect(
            readlink(path.join(duplicateProject, 'linked.kcl'))
          ).resolves.toBe('real.kcl')
          await writeFile(
            path.join(duplicateProject, 'linked.kcl'),
            'duplicate edit'
          )
          await expect(
            readFile(path.join(sourceProject, 'real.kcl'), 'utf-8')
          ).resolves.toBe('original')
          await expect(
            readFile(path.join(duplicateProject, 'real.kcl'), 'utf-8')
          ).resolves.toBe('duplicate edit')
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('cleans stale staging directories while preserving leased work', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-stale-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const staleStaging = path.join(
          projectDirectory,
          '.zds-duplicate-11111111-1111-4111-8111-111111111111'
        )
        const activeStaging = path.join(
          projectDirectory,
          '.zds-duplicate-22222222-2222-4222-8222-222222222222'
        )
        const unrelatedHiddenDirectory = path.join(
          projectDirectory,
          '.zds-duplicate-user-backup'
        )
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(staleStaging)
          await writeFile(path.join(staleStaging, 'partial.kcl'), 'partial')
          const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000)
          await utimes(staleStaging, staleTime, staleTime)
          await mkdir(activeStaging)
          await writeFile(path.join(activeStaging, 'partial.kcl'), 'partial')
          await utimes(activeStaging, staleTime, staleTime)
          await mkdir(unrelatedHiddenDirectory)
          await writeFile(
            path.join(unrelatedHiddenDirectory, 'keep.kcl'),
            'keep'
          )
          const lockRequest = vi.fn(async (...args: unknown[]) => {
            const lockName = args[0] as string
            const callback = args.at(-1) as (lock: Lock | null) => Promise<void>
            return callback(
              lockName.includes('22222222-2222-4222-8222-222222222222')
                ? null
                : { name: lockName, mode: 'exclusive' }
            )
          })
          Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { request: lockRequest },
          })

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          const entries = await readdir(projectDirectory)
          expect(entries).not.toContain(
            '.zds-duplicate-11111111-1111-4111-8111-111111111111'
          )
          expect(entries).toContain(
            '.zds-duplicate-22222222-2222-4222-8222-222222222222'
          )
          expect(entries).toContain('.zds-duplicate-user-backup')
        } finally {
          Reflect.deleteProperty(globalThis.navigator, 'locks')
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('does not expose a marker-bearing partial duplicate', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-hidden-partial-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const partialProject = path.join(projectDirectory, 'partial-copy')
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(partialProject)
          await writeFile(path.join(partialProject, 'main.kcl'), 'partial')
          await writeFile(
            path.join(partialProject, DUPLICATE_IN_PROGRESS_FILE_NAME),
            ''
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

          expect(
            actor
              .getSnapshot()
              .context.folders?.some((folder) => folder.name === 'partial-copy')
          ).toBe(false)
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('does not initialize a project when its marker appears between stat and readdir', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-marker-race-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const partialProject = path.join(projectDirectory, 'partial-copy')
        const markerPath = path.join(
          partialProject,
          DUPLICATE_IN_PROGRESS_FILE_NAME
        )
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        const stat = fsZds.stat.bind(fsZds)
        let markerStatCount = 0
        const statSpy = vi
          .spyOn(fsZds, 'stat')
          .mockImplementation(async (targetPath, options) => {
            if (targetPath === markerPath) {
              markerStatCount += 1
              if (markerStatCount === 2) {
                await writeFile(markerPath, '')
                return Promise.reject(
                  Object.assign(new Error('not found before marker write'), {
                    code: 'ENOENT',
                  })
                )
              }
            }
            return stat(targetPath, options)
          })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(partialProject)
          await writeFile(path.join(partialProject, 'notes.txt'), 'keep')

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          expect(markerStatCount).toBeGreaterThanOrEqual(2)
          expect(
            actor
              .getSnapshot()
              .context.folders?.some((folder) => folder.name === 'partial-copy')
          ).toBe(false)
          await expect(readdir(partialProject)).resolves.toEqual(
            expect.arrayContaining([
              'notes.txt',
              DUPLICATE_IN_PROGRESS_FILE_NAME,
            ])
          )
          await expect(
            readFile(path.join(partialProject, 'main.kcl'), 'utf-8')
          ).rejects.toMatchObject({ code: 'ENOENT' })
        } finally {
          statSpy.mockRestore()
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('does not expose or initialize a markerless empty reservation', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-empty-reservation-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const emptyReservation = path.join(
          projectDirectory,
          'empty-reservation'
        )
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(emptyReservation)

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          expect(
            actor
              .getSnapshot()
              .context.folders?.some(
                (folder) => folder.name === 'empty-reservation'
              )
          ).toBe(false)
          await expect(readdir(emptyReservation)).resolves.toEqual([])
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('preserves staging directories when Web Locks are unavailable', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        Reflect.deleteProperty(globalThis.navigator, 'locks')
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-no-lock-cleanup-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const stagingName =
          '.zds-duplicate-33333333-3333-4333-8333-333333333333'
        const stagingPath = path.join(projectDirectory, stagingName)
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(stagingPath)
          await writeFile(path.join(stagingPath, 'partial.kcl'), 'partial')
          const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000)
          await utimes(stagingPath, staleTime, staleTime)

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'source')
            )
          )

          expect(await readdir(projectDirectory)).toContain(stagingName)
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it.each([
        {
          caseName: 'bounds a growing suffix to the project name limit',
          sourceFolderName: `${'a'.repeat(MAX_PROJECT_NAME_LENGTH - 2)}-9`,
          expectedDuplicateName: `${'a'.repeat(
            MAX_PROJECT_NAME_LENGTH - 3
          )}-10`,
        },
        {
          caseName: 'increments suffixes beyond Number safe integer precision',
          sourceFolderName: 'part-9007199254740992',
          expectedDuplicateName: 'part-9007199254740993',
        },
        {
          caseName: 'falls back when an all-9 successor exceeds the limit',
          sourceFolderName: '9'.repeat(MAX_PROJECT_NAME_LENGTH),
          expectedDuplicateName: `${'9'.repeat(MAX_PROJECT_NAME_LENGTH - 2)}-1`,
        },
      ])('$caseName', async ({ sourceFolderName, expectedDuplicateName }) => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-max-name-')
        )
        const sourceProject = path.join(projectDirectory, sourceFolderName)
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await writeFile(
            path.join(sourceProject, 'project.toml'),
            `title = "${sourceFolderName}"\ndefault_file = "main.kcl"\n`
          )

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

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: sourceFolderName,
              requestedProjectName: '',
            },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          expect(actor.getSnapshot().context.requestedProjectName.name).toBe(
            expectedDuplicateName
          )
          expect(expectedDuplicateName.length).toBeLessThanOrEqual(
            MAX_PROJECT_NAME_LENGTH
          )
          await expect(
            readFile(
              path.join(projectDirectory, expectedDuplicateName, 'main.kcl'),
              'utf-8'
            )
          ).resolves.toBe('source')
        } finally {
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
