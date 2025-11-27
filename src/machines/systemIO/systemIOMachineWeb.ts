import { newKclFile } from '@src/lang/project'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  LOCAL_STORAGE_ML_CONVERSATIONS,
} from '@src/lib/constants'
import { readLocalStorageProjectSettingsFile } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import type { AppMachineContext } from '@src/lib/types'
import { engineStreamZoomToFit } from '@src/lib/utils'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import {
  SystemIOMachineActors,
  jsonToMlConversations,
  mlConversationsToJson,
} from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'

export const systemIOMachineWeb = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.createKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileNameWithExtension: string
          requestedCode: string
          rootContext: AppMachineContext
          requestedSubRoute?: string
        }
      }) => {
        // Browser version doesn't navigate, just overwrites the current file
        // clearImportSearchParams()
        const projectSettings = readLocalStorageProjectSettingsFile()
        if (err(projectSettings)) {
          return Promise.reject(
            'Unable to read project settings from local storage'
          )
        }
        const codeToWrite = newKclFile(
          input.requestedCode,
          projectSettings?.settings?.modeling?.base_unit ||
            DEFAULT_DEFAULT_LENGTH_UNIT
        )
        if (err(codeToWrite)) return Promise.reject(codeToWrite)
        input.rootContext.kclManager.updateCodeStateEditor(codeToWrite)
        await input.rootContext.kclManager.writeToFile()
        await input.rootContext.kclManager.executeCode()

        // Needed for zoom_to_fit to work until #6545 is fixed:
        // https://github.com/KittyCAD/modeling-app/issues/6545
        await input.rootContext.kclManager.hidePlanes()

        // Alternatively, this makes it work too:
        // await engineViewIsometricWithGeometryPresent({
        //   engineCommandManager: input.rootContext.engineCommandManager,
        //   padding: 0.2,
        // })

        await engineStreamZoomToFit({
          engineCommandManager: input.rootContext.engineCommandManager,
          padding: 0.2,
        })

        return {
          message: 'File overwritten successfully',
          fileName: input.requestedFileNameWithExtension,
          projectName: '',
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.getMlEphantConversations]: fromPromise(async () => {
      const json = localStorage.getItem(LOCAL_STORAGE_ML_CONVERSATIONS)
      if (json === null) {
        return new Map()
      }
      return jsonToMlConversations(json)
    }),
    [SystemIOMachineActors.saveMlEphantConversations]: fromPromise(
      async (args: {
        input: {
          context: SystemIOContext
          event: { data: { projectId: string; conversationId: string } }
        }
      }) => {
        const next = new Map(args.input.context.mlEphantConversations)
        next.set(
          args.input.event.data.projectId,
          args.input.event.data.conversationId
        )
        const json = mlConversationsToJson(next)
        await localStorage.setItem(LOCAL_STORAGE_ML_CONVERSATIONS, json)
        return next
      }
    ),
  },
})
