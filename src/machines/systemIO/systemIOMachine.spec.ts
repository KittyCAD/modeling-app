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
import { getProjectInfo } from '@src/lib/desktop'
import {
  DEFAULT_PROJECT_NAME,
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  MAX_PROJECT_NAME_LENGTH,
} from '@src/lib/constants'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { isProjectDirectoryQuarantined } from '@src/lib/fs-zds/duplicateQuarantine'
import {
  createDuplicatePublicationEvidence,
  DUPLICATE_ARTIFACT_STALE_MS,
  DUPLICATE_OWNERSHIP_VERSION,
  serializeDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  getCloudProjectFolderRenameName,
  normalizeProjectNameCollisionKey,
  shouldSendProjectFolderReadProgress,
  sortProjectDirectoryEntriesByModifiedDesc,
  systemIOMachineImpl,
  truncateProjectNameWithoutSplittingCodePoint,
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

describe('duplicate project name normalization', () => {
  it('treats NFC and NFD spellings as the same collision key', () => {
    expect(normalizeProjectNameCollisionKey('Caf\u00e9')).toBe(
      normalizeProjectNameCollisionKey('Cafe\u0301')
    )
  })

  it('never truncates in the middle of a surrogate pair', () => {
    const truncated = truncateProjectNameWithoutSplittingCodePoint(
      `${'a'.repeat(MAX_PROJECT_NAME_LENGTH - 1)}\ud83d\ude00`,
      MAX_PROJECT_NAME_LENGTH
    )
    expect(truncated).toBe('a'.repeat(MAX_PROJECT_NAME_LENGTH - 1))
    expect(truncated).not.toMatch(/[\ud800-\udbff]$/)
  })
})

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
      it('replays one duplicate request with its own data after the active duplicate', async () => {
        const releaseFirstDuplicate = deferred()
        const duplicateInputs: {
          projectName: string
          requestedProjectName: string
        }[] = []
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.duplicateProject]: fromPromise(
                async ({ input }) => {
                  duplicateInputs.push({
                    projectName: input.projectName,
                    requestedProjectName: input.requestedProjectName,
                  })
                  if (duplicateInputs.length === 1) {
                    await releaseFirstDuplicate.promise
                  }
                  return {
                    message: 'done',
                    name: input.requestedProjectName,
                  }
                }
              ),
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
          type: SystemIOMachineEvents.duplicateProject,
          data: {
            projectName: 'first-source',
            requestedProjectName: 'first-copy',
          },
        })
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.duplicatingProject)
        )
        actor.send({
          type: SystemIOMachineEvents.duplicateProject,
          data: {
            projectName: 'queued-source',
            requestedProjectName: 'queued-copy',
          },
        })
        expect(duplicateInputs).toHaveLength(1)

        releaseFirstDuplicate.resolve(undefined)
        await vi.waitFor(() => expect(duplicateInputs).toHaveLength(2))
        await waitFor(actor, (state) =>
          state.matches(SystemIOMachineStates.idle)
        )

        expect(duplicateInputs).toEqual([
          {
            projectName: 'first-source',
            requestedProjectName: 'first-copy',
          },
          {
            projectName: 'queued-source',
            requestedProjectName: 'queued-copy',
          },
        ])
        actor.stop()
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
      it('defers an initial duplicate until folders are loaded', async () => {
        const initialRead = deferred<Project[]>()
        const projects = [mockProject('source')]
        const duplicateFolders: (Project[] | undefined)[] = []
        let readCount = 0
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => {
                  readCount += 1
                  return readCount === 1 ? initialRead.promise : projects
                }),
              [SystemIOMachineActors.duplicateProject]: fromPromise(
                async ({ input }) => {
                  duplicateFolders.push(input.context.folders)
                  return {
                    message: 'done',
                    name: input.requestedProjectName,
                  }
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
              requestedProjectName: 'source-copy',
            },
          })

          expect(duplicateFolders).toHaveLength(0)
          expect(actor.getSnapshot()).toMatchObject({
            value: SystemIOMachineStates.readingFolders,
          })

          initialRead.resolve(projects)

          await vi.waitFor(() => expect(duplicateFolders).toHaveLength(1))
          expect(duplicateFolders[0]).toStrictEqual(projects)
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )
        } finally {
          actor.stop()
        }
      })
      it('keeps a duplicate deferred through a path permission check and folder read', async () => {
        const checkReadWrite = deferred<{
          value: boolean
          error: unknown
        }>()
        const initialRead = deferred<Project[]>()
        const projects = [mockProject('source')]
        const duplicateFolders: (Project[] | undefined)[] = []
        let readCount = 0
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => checkReadWrite.promise
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => {
                  readCount += 1
                  return readCount === 1 ? initialRead.promise : projects
                }),
              [SystemIOMachineActors.duplicateProject]: fromPromise(
                async ({ input }) => {
                  duplicateFolders.push(input.context.folders)
                  return {
                    message: 'done',
                    name: input.requestedProjectName,
                  }
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
            data: { requestedProjectDirectoryPath: '/projects' },
          })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.checkingReadWrite)
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'source-copy',
            },
          })
          expect(duplicateFolders).toHaveLength(0)

          checkReadWrite.resolve({ value: true, error: undefined })
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          expect(duplicateFolders).toHaveLength(0)
          expect(actor.getSnapshot().context.folders).toBeUndefined()

          initialRead.resolve(projects)

          await vi.waitFor(() => expect(duplicateFolders).toHaveLength(1))
          expect(duplicateFolders[0]).toStrictEqual(projects)
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )
        } finally {
          actor.stop()
        }
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
      it('stores the project-directory permission check result', async () => {
        const permissionResult: { value: boolean; error: unknown } = {
          value: false,
          error: new Error('read-only project directory'),
        }
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => permissionResult
              ),
              [SystemIOMachineActors.readFoldersFromProjectDirectory]:
                fromPromise(async () => new Promise<Project[]>(() => {})),
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
              requestedProjectDirectoryPath: '/read-only-projects',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.readingFolders)
          )

          expect(actor.getSnapshot().context.canReadWriteProjectDirectory).toBe(
            permissionResult
          )
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
    describe('when bulk creating and deleting files', () => {
      it('holds one shared filesystem mutation lease through both phases', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-bulk-create-delete-lock-')
        )
        const projectName = 'project'
        const projectPath = path.join(projectDirectory, projectName)
        const deleteTraversalStarted = deferred<undefined>()
        const continueDeleteTraversal = deferred<undefined>()
        const originalLocksDescriptor = Object.getOwnPropertyDescriptor(
          globalThis.navigator,
          'locks'
        )
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        let readdirSpy: { mockRestore: () => void } | undefined

        try {
          await mkdir(projectPath)
          await writeFile(path.join(projectPath, 'main.kcl'), 'old = 1')
          await writeFile(
            path.join(projectPath, 'obsolete.kcl'),
            'obsolete = 1'
          )
          await writeFile(
            path.join(projectPath, 'project.toml'),
            'title = "project"\ndefault_file = "main.kcl"\n'
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              Boolean(
                state.context.folders?.some(
                  (folder) => folder.name === projectName
                )
              )
          )

          const originalReaddir = fsZds.readdir.bind(fsZds)
          let pausedDeleteTraversal = false
          readdirSpy = vi
            .spyOn(fsZds, 'readdir')
            .mockImplementation(async (requestedPath, options) => {
              if (
                !pausedDeleteTraversal &&
                fsZds.resolve(requestedPath) === fsZds.resolve(projectPath)
              ) {
                pausedDeleteTraversal = true
                deleteTraversalStarted.resolve(undefined)
                await continueDeleteTraversal.promise
              }
              return originalReaddir(requestedPath, options)
            })

          const mutationLockName = 'zds:project-filesystem-mutation'
          const exclusiveWaiters: (() => void)[] = []
          let sharedMutationActive = false
          const lockRequest = vi.fn(async (...args: unknown[]) => {
            const lockName = args[0] as string
            const options =
              typeof args[1] === 'function'
                ? {}
                : (args[1] as { mode?: LockMode })
            const callback = args.at(-1) as (
              lock: Lock | null
            ) => Promise<unknown>
            const mode = options.mode ?? 'exclusive'

            if (
              lockName === mutationLockName &&
              mode === 'exclusive' &&
              sharedMutationActive
            ) {
              await new Promise<void>((resolve) => {
                exclusiveWaiters.push(resolve)
              })
            }
            if (lockName === mutationLockName && mode === 'shared') {
              sharedMutationActive = true
            }

            try {
              return await callback({ name: lockName, mode })
            } finally {
              if (lockName === mutationLockName && mode === 'shared') {
                sharedMutationActive = false
                exclusiveWaiters.splice(0).forEach((resolve) => {
                  resolve()
                })
              }
            }
          })
          Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { request: lockRequest },
          })

          actor.send({
            type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
            data: {
              files: [
                {
                  requestedProjectName: projectName,
                  requestedFileName: 'main.kcl',
                  requestedCode: 'updated = 1',
                },
              ],
              filesToDelete: [{ requestedFileName: 'obsolete.kcl' }],
              requestedProjectName: projectName,
              requestedFileNameWithExtension: 'main.kcl',
              override: true,
            },
          })

          await deleteTraversalStarted.promise
          expect(sharedMutationActive).toBe(true)
          const sharedMutationRequests = lockRequest.mock.calls.filter(
            (args) =>
              args[0] === mutationLockName &&
              typeof args[1] !== 'function' &&
              (args[1] as { mode?: LockMode }).mode === 'shared'
          )
          expect(sharedMutationRequests).toHaveLength(1)

          let exclusiveEntered = false
          const exclusiveRequest = globalThis.navigator.locks.request(
            mutationLockName,
            async () => {
              exclusiveEntered = true
            }
          )
          await Promise.resolve()
          expect(exclusiveEntered).toBe(false)

          continueDeleteTraversal.resolve(undefined)
          await exclusiveRequest
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          await expect(
            readFile(path.join(projectPath, 'main.kcl'), 'utf-8')
          ).resolves.toContain('updated = 1')
          await expect(
            readFile(path.join(projectPath, 'obsolete.kcl'), 'utf-8')
          ).rejects.toThrow()
        } finally {
          continueDeleteTraversal.resolve(undefined)
          readdirSpy?.mockRestore()
          if (originalLocksDescriptor) {
            Object.defineProperty(
              globalThis.navigator,
              'locks',
              originalLocksDescriptor
            )
          } else {
            Reflect.deleteProperty(globalThis.navigator, 'locks')
          }
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
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
        const actualSourceProject = path.join(
          projectDirectory,
          '.actual-source'
        )
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
              await writeFile(
                path.join(targetProject, 'competitor.txt'),
                'preserve me'
              )
            }
            return originalPublishDirectory(source, target, markerName)
          })

        try {
          await mkdir(actualSourceProject)
          await symlink(actualSourceProject, sourceProject, 'dir')
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

          await expect(
            readFile(path.join(targetProject, 'competitor.txt'), 'utf-8')
          ).resolves.toBe('preserve me')
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
          .mockImplementationOnce(async (_source, target, evidence) => {
            await mkdir(target)
            await writeFile(
              path.join(target, evidence.markerName),
              evidence.targetPublishing
            )
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
              state.matches(SystemIOMachineStates.idle) &&
                state.context.folders?.some(
                  (folder) => folder.name === 'source'
                )
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
          ).resolves.toContain('"phase":"publishing"')

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
          Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { request: lockRequest },
          })

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
          await writeFile(
            path.join(staleStaging, DUPLICATE_IN_PROGRESS_FILE_NAME),
            serializeDuplicateOwnershipEvidence({
              version: DUPLICATE_OWNERSHIP_VERSION,
              kind: 'stage',
              phase: 'copying',
              token: '11111111-1111-4111-8111-111111111111',
              createdAt: Date.now() - DUPLICATE_ARTIFACT_STALE_MS - 1,
            })
          )
          await mkdir(activeStaging)
          await writeFile(path.join(activeStaging, 'partial.kcl'), 'partial')
          await utimes(activeStaging, staleTime, staleTime)
          await writeFile(
            path.join(activeStaging, DUPLICATE_IN_PROGRESS_FILE_NAME),
            serializeDuplicateOwnershipEvidence({
              version: DUPLICATE_OWNERSHIP_VERSION,
              kind: 'stage',
              phase: 'copying',
              token: '22222222-2222-4222-8222-222222222222',
              createdAt: Date.now() - DUPLICATE_ARTIFACT_STALE_MS - 1,
            })
          )
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
              state.matches(SystemIOMachineStates.idle) &&
                state.context.folders?.some(
                  (folder) => folder.name === 'source'
                )
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

      it('hides a partial duplicate with valid target ownership evidence', async () => {
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
            createDuplicatePublicationEvidence({
              token: '44444444-4444-4444-8444-444444444444',
              targetName: 'partial-copy',
            }).targetPublishing
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.matches(SystemIOMachineStates.idle) &&
                state.context.folders?.some(
                  (folder) => folder.name === 'source'
                )
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

      it('hides a markerless target with a valid sibling reservation', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-reserved-partial-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const partialProject = path.join(projectDirectory, 'partial-copy')
        const evidence = createDuplicatePublicationEvidence({
          token: '55555555-5555-4555-8555-555555555555',
          targetName: 'partial-copy',
        })
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
            path.join(projectDirectory, evidence.reservationFileName),
            evidence.reservationReserved
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.matches(SystemIOMachineStates.idle) &&
                state.context.folders?.some(
                  (folder) => folder.name === 'source'
                )
            )
          )

          expect(
            actor
              .getSnapshot()
              .context.folders?.some((folder) => folder.name === 'partial-copy')
          ).toBe(false)
          await expect(
            readFile(path.join(partialProject, 'main.kcl'), 'utf-8')
          ).resolves.toBe('partial')
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('keeps a markerless reserved target unavailable to rename and import', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-reserved-writer-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const targetProject = path.join(projectDirectory, 'reserved-copy')
        const evidence = createDuplicatePublicationEvidence({
          token: '56565656-5656-4565-8565-565656565656',
          targetName: 'reserved-copy',
        })
        const reservationPath = path.join(
          projectDirectory,
          evidence.reservationFileName
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
          await writeFile(reservationPath, evidence.reservationPrepared)

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.matches(SystemIOMachineStates.idle) &&
                state.context.folders?.some(
                  (folder) => folder.name === 'source'
                )
            )
          )

          const renameStarted = waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.renamingProject)
          )
          actor.send({
            type: SystemIOMachineEvents.renameProject,
            data: {
              projectName: 'source',
              requestedProjectName: 'reserved-copy',
              redirect: false,
            },
          })
          await renameStarted
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          const importStarted = waitFor(actor, (state) =>
            state.matches(
              SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile
            )
          )
          actor.send({
            type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile,
            data: {
              requestedProjectName: 'reserved-copy',
              requestedFileNameWithExtension: 'main.kcl',
              files: [
                {
                  requestedProjectName: 'reserved-copy',
                  requestedFileName: 'main.kcl',
                  requestedData: new TextEncoder().encode('imported'),
                },
              ],
            },
          })
          await importStarted
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          await expect(
            readFile(path.join(sourceProject, 'main.kcl'), 'utf-8')
          ).resolves.toBe('source')
          await expect(lstat(targetProject)).rejects.toMatchObject({
            code: 'ENOENT',
          })
          await expect(readFile(reservationPath)).resolves.toBeInstanceOf(
            Buffer
          )
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('keeps a stale owned mid-copy target quarantined', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-stale-partial-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const partialProject = path.join(projectDirectory, 'partial-copy')
        const evidence = createDuplicatePublicationEvidence({
          token: '66666666-6666-4666-8666-666666666666',
          targetName: 'partial-copy',
          createdAt: Date.now() - DUPLICATE_ARTIFACT_STALE_MS - 1,
        })
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        Object.defineProperty(globalThis.navigator, 'locks', {
          configurable: true,
          value: {
            request: vi.fn(async (...args: unknown[]) => {
              const lockName = args[0] as string
              const callback = args.at(-1) as (
                lock: Lock | null
              ) => Promise<unknown>
              return callback({ name: lockName, mode: 'exclusive' })
            }),
          },
        })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(partialProject)
          await writeFile(path.join(partialProject, 'main.kcl'), 'partial')
          await writeFile(
            path.join(partialProject, evidence.markerName),
            evidence.targetPublishing
          )
          await writeFile(
            path.join(projectDirectory, evidence.reservationFileName),
            evidence.reservationReserved
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

          await expect(readdir(partialProject)).resolves.toEqual(
            expect.arrayContaining([
              'main.kcl',
              DUPLICATE_IN_PROGRESS_FILE_NAME,
            ])
          )
          await expect(
            readFile(
              path.join(projectDirectory, evidence.reservationFileName),
              'utf-8'
            )
          ).resolves.toContain('"phase":"reserved"')
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

      it('finalizes a stale published duplicate and its reservation', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-stale-published-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const publishedProject = path.join(projectDirectory, 'published-copy')
        const evidence = createDuplicatePublicationEvidence({
          token: '77777777-7777-4777-8777-777777777777',
          targetName: 'published-copy',
          createdAt: Date.now() - DUPLICATE_ARTIFACT_STALE_MS - 1,
        })
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        Object.defineProperty(globalThis.navigator, 'locks', {
          configurable: true,
          value: {
            request: vi.fn(async (...args: unknown[]) => {
              const lockName = args[0] as string
              const callback = args.at(-1) as (
                lock: Lock | null
              ) => Promise<unknown>
              return callback({ name: lockName, mode: 'exclusive' })
            }),
          },
        })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(publishedProject)
          await writeFile(path.join(publishedProject, 'main.kcl'), 'complete')
          await writeFile(
            path.join(publishedProject, evidence.markerName),
            evidence.targetPublished
          )
          // This is the crash window between the target and reservation phase
          // updates; recovery must accept the still-reserved sibling evidence.
          await writeFile(
            path.join(projectDirectory, evidence.reservationFileName),
            evidence.reservationReserved
          )

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some(
                (folder) => folder.name === 'published-copy'
              )
            )
          )

          await expect(
            readFile(path.join(publishedProject, 'main.kcl'), 'utf-8')
          ).resolves.toBe('complete')
          await expect(
            readFile(path.join(publishedProject, evidence.markerName), 'utf-8')
          ).rejects.toMatchObject({ code: 'ENOENT' })
          await expect(
            readFile(
              path.join(projectDirectory, evidence.reservationFileName),
              'utf-8'
            )
          ).rejects.toMatchObject({ code: 'ENOENT' })
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

      it('keeps torn marker evidence quarantined instead of exposing content', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-torn-marker-')
        )
        const sourceProject = path.join(projectDirectory, 'source')
        const partialProject = path.join(projectDirectory, 'partial-copy')
        const evidence = createDuplicatePublicationEvidence({
          token: '88888888-8888-4888-8888-888888888888',
          targetName: 'partial-copy',
          createdAt: Date.now() - DUPLICATE_ARTIFACT_STALE_MS - 1,
        })
        const reservationPath = path.join(
          projectDirectory,
          evidence.reservationFileName
        )
        const actor = createActor(systemIOMachineImpl, {
          input: {
            wasmInstancePromise: Promise.resolve(instanceInThisFile),
            app: appInstanceInThisFile,
          },
        }).start()
        Object.defineProperty(globalThis.navigator, 'locks', {
          configurable: true,
          value: {
            request: vi.fn(async (...args: unknown[]) => {
              const lockName = args[0] as string
              const callback = args.at(-1) as (
                lock: Lock | null
              ) => Promise<unknown>
              return callback({ name: lockName, mode: 'exclusive' })
            }),
          },
        })

        try {
          await mkdir(sourceProject)
          await writeFile(path.join(sourceProject, 'main.kcl'), 'source')
          await mkdir(partialProject)
          await writeFile(path.join(partialProject, 'main.kcl'), 'partial')
          await writeFile(
            path.join(partialProject, evidence.markerName),
            '{"version":1,"kind":"target"'
          )
          await writeFile(reservationPath, evidence.reservationReserved)

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
          await expect(
            readFile(path.join(partialProject, 'main.kcl'), 'utf-8')
          ).resolves.toBe('partial')
          await expect(readFile(reservationPath, 'utf-8')).resolves.toContain(
            '"phase":"reserved"'
          )
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

      it('does not silently drop an invalid marker file from a duplicate', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const projectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-marker-race-')
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
          await writeFile(path.join(partialProject, 'notes.txt'), 'keep')
          await writeFile(
            path.join(partialProject, DUPLICATE_IN_PROGRESS_FILE_NAME),
            'not valid duplicate evidence'
          )
          await writeFile(
            path.join(partialProject, 'project.toml'),
            'title = "Partial copy"\ndefault_file = "main.kcl"\n'
          )
          await expect(
            isProjectDirectoryQuarantined(partialProject)
          ).resolves.toBe(false)
          await expect(
            getProjectInfo(partialProject, instanceInThisFile)
          ).resolves.toMatchObject({ name: 'partial-copy' })
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.matches(SystemIOMachineStates.idle) &&
                state.context.hasListedProjects
            )
          )
          expect(
            actor.getSnapshot().context.folders?.map((folder) => folder.name)
          ).toContain('partial-copy')
          const duplicationStarted = waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.duplicatingProject)
          )
          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'partial-copy',
              requestedProjectName: 'partial-copy clone',
            },
          })
          await duplicationStarted
          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )
          await expect(
            lstat(path.join(projectDirectory, 'partial-copy clone'))
          ).rejects.toMatchObject({ code: 'ENOENT' })
          await expect(readdir(partialProject)).resolves.toEqual(
            expect.arrayContaining([
              'notes.txt',
              DUPLICATE_IN_PROGRESS_FILE_NAME,
              'main.kcl',
            ])
          )
        } finally {
          actor.stop()
          await rm(projectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })

      it('initializes and exposes a legitimate empty project directory', async () => {
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
          await getProjectInfo(emptyReservation, instanceInThisFile)
          await expect(
            getProjectInfo(emptyReservation, instanceInThisFile)
          ).resolves.toMatchObject({
            name: 'empty-reservation',
            kcl_file_count: 1,
          })
          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: { requestedProjectDirectoryPath: projectDirectory },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.matches(SystemIOMachineStates.idle) &&
                state.context.hasListedProjects
            )
          )
          expect(
            actor
              .getSnapshot()
              .context.folders?.some(
                (folder) => folder.name === 'empty-reservation'
              )
          ).toBe(true)
          await expect(readdir(emptyReservation)).resolves.toContain('main.kcl')
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
        {
          caseName: 'suffixes a canonically equivalent Unicode name',
          sourceFolderName: 'Cafe\u0301',
          expectedDuplicateName: 'Cafe\u0301-1',
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
