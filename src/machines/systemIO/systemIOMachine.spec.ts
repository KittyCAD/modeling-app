import path from 'node:path'
import type { App } from '@src/lib/app'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

let appInstanceInThisFile: App = null!
let instanceInThisFile: ModuleType = null!

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
