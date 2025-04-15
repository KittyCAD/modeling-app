import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import path from 'node:path'
import { createActor, waitFor } from 'xstate'

describe('systemIOMachine - XState', () => {
  describe('desktop', () => {
    describe('when initializied', () => {
      it('should contain the default context values', () => {
        const actor = createActor(systemIOMachineDesktop).start()
        const context = actor.getSnapshot().context
        expect(context.folders).toStrictEqual([])
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
        const actor = createActor(systemIOMachineDesktop).start()
        const state = actor.getSnapshot().value
        expect(state).toBe(SystemIOMachineStates.idle)
      })
    })
    describe('when reading projects', () => {
      it('should exit early when project directory is empty string', async () => {
        const actor = createActor(systemIOMachineDesktop).start()
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
    })
    describe('when setting project directory path', () => {
      it('should set new project directory path', async () => {
        const kclSamplesPath = path.join('public', 'kcl-samples')
        const actor = createActor(systemIOMachineDesktop).start()
        actor.send({
          type: SystemIOMachineEvents.setProjectDirectoryPath,
          data: { requestedProjectDirectoryPath: kclSamplesPath },
        })
        let context = actor.getSnapshot().context
        expect(context.projectDirectoryPath).toBe(kclSamplesPath)
      })
    })
  })
})
