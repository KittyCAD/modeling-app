import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { App } from '@src/lib/app'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
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
  appInstanceInThisFile = App.fromProvided({
    wasmPromise: Promise.resolve(instance),
  })
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
    describe('when duplicating projects', () => {
      it('copies the project to a deconflicted name and resets project metadata', async () => {
        await moduleFsViaModuleImport({
          type: StorageName.NodeFS,
          options: {},
        })
        const tempProjectDirectory = await mkdtemp(
          path.join(tmpdir(), 'zds-duplicate-project-')
        )
        const sourceProject = path.join(tempProjectDirectory, 'bracket')
        const existingDuplicate = path.join(tempProjectDirectory, 'bracket-1')
        const sourceLocalProjectId = '11111111-1111-4111-8111-111111111111'
        const sourceCloudProjectId = '22222222-2222-4222-8222-222222222222'
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
            `[settings.meta]
id = "${sourceLocalProjectId}"

[cloud."zoo.dev"]
project_id = "${sourceCloudProjectId}"
`
          )
          await mkdir(existingDuplicate, { recursive: true })
          await writeFile(path.join(existingDuplicate, 'main.kcl'), 'existing')

          actor.send({
            type: SystemIOMachineEvents.setProjectDirectoryPath,
            data: {
              requestedProjectDirectoryPath: tempProjectDirectory,
            },
          })
          await waitFor(actor, (state) =>
            Boolean(
              state.context.folders?.some((folder) => folder.name === 'bracket')
            )
          )

          actor.send({
            type: SystemIOMachineEvents.duplicateProject,
            data: {
              projectName: 'bracket',
              requestedProjectName: 'bracket',
            },
          })
          await waitFor(
            actor,
            (state) =>
              state.matches(SystemIOMachineStates.idle) &&
              state.context.requestedProjectName.name === 'bracket-2'
          )

          await expect(
            readFile(
              path.join(
                tempProjectDirectory,
                'bracket-2',
                'nested',
                'part.kcl'
              ),
              'utf-8'
            )
          ).resolves.toBe('nested')
          const duplicatedProjectToml = await readFile(
            path.join(tempProjectDirectory, 'bracket-2', 'project.toml'),
            'utf-8'
          )
          expect(duplicatedProjectToml).not.toContain(sourceLocalProjectId)
          expect(duplicatedProjectToml).not.toContain(sourceCloudProjectId)
          expect(duplicatedProjectToml).not.toContain('[cloud.')
        } finally {
          actor.stop()
          await rm(tempProjectDirectory, { recursive: true, force: true })
          await moduleFsViaModuleImport({
            type: StorageName.NoopFS,
            options: {},
          })
        }
      })
    })
  })
})
