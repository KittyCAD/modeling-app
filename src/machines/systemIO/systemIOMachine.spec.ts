import path from 'node:path'
import type { App } from '@src/lib/app'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  shouldSendProjectFolderReadProgress,
  sortProjectDirectoryEntriesByModifiedDesc,
  systemIOMachineImpl,
} from '@src/machines/systemIO/systemIOMachineImpl'
import {
  NO_PROJECT_DIRECTORY,
  type SystemIOContext,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeEach, describe, expect, it } from 'vitest'
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
  appInstanceInThisFile = {
    wasmPromise: Promise.resolve(instance),
  } as App
  instanceInThisFile = instance
})

describe('systemIOMachine - XState', () => {
  describe('project folder loading', () => {
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
                  projectDirectoryPath: '/projects',
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
      it('should accept project imports while checking read/write access', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => new Promise(() => {})
              ),
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

          await waitFor(actor, (state) =>
            state.matches(
              SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile
            )
          )
        } finally {
          actor.stop()
        }
      })
      it('should accept project creation while checking read/write access', async () => {
        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.checkReadWrite]: fromPromise(
                async () => new Promise(() => {})
              ),
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

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.creatingProject)
          )
        } finally {
          actor.stop()
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
    describe('when creating projects', () => {
      it('should pass the requested parent directory to the create project actor', async () => {
        let capturedInput:
          | {
              context: SystemIOContext
              requestedProjectName: string
              requestedProjectDirectoryPath?: string
            }
          | undefined

        const actor = createActor(
          systemIOMachine.provide({
            actors: {
              [SystemIOMachineActors.createProject]: fromPromise(
                async ({ input }) => {
                  capturedInput = input
                  return {
                    message: 'Created',
                    name: 'demo-project',
                    path: '/projects/demo-project',
                    projectDirectoryPath: '/projects',
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

        try {
          actor.send({
            type: SystemIOMachineEvents.createProject,
            data: {
              requestedProjectName: 'demo-project',
              requestedProjectDirectoryPath: '/projects',
            },
          })

          await waitFor(actor, (state) =>
            state.matches(SystemIOMachineStates.idle)
          )

          expect(capturedInput?.requestedProjectName).toBe('demo-project')
          expect(capturedInput?.requestedProjectDirectoryPath).toBe('/projects')
          expect(
            actor.getSnapshot().context.requestedProjectName
          ).toStrictEqual({
            name: 'demo-project',
            path: '/projects/demo-project',
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
