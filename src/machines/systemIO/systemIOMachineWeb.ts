import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import { SystemIOMachineActors } from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'
import { newKclFile } from '@src/lang/project'
import { readLocalStorageProjectSettingsFile } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import type { AppMachineContext } from '@src/lib/types'

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
        input.rootContext.codeManager.updateCodeStateEditor(codeToWrite)
        await input.rootContext.codeManager.writeToFile()
        await input.rootContext.kclManager.executeCode()
        return {
          message: 'File overwritten successfully',
          fileName: input.requestedFileNameWithExtension,
          projectName: '',
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
  },
})
