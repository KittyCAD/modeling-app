import { refreshPage } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'
import { commandBarActor, settingsActor } from '@src/lib/singletons'
import { useContext } from 'react'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'

type Action = {
  execute: () => void | (() => Promise<void>)
  /** A custom hook for the Action to detect if it should be enabled */
  useDisabled: () => string | undefined
  useHidden: () => boolean
}
/**
 * For now we have strict action types but in future
 * we should make it possible to register your own in an extension.
 */
export const actionTypeRegistry = Object.freeze({
  export: {
    useHidden: () => false,
    useDisabled: () => {
      const engineIsReady = useReliesOnEngine()
      return engineIsReady ? 'Need engine connection to export' : undefined
    },
    execute: () =>
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Export', groupId: 'modeling' },
      }),
  },
  addFileToProject: {
    useHidden: () => false,
    useDisabled: () => undefined,
    execute: () => {
      const currentProject = settingsActor.getSnapshot().context.currentProject
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          name: 'add-kcl-file-to-project',
          groupId: 'application',
          argDefaultValues: {
            method: 'existingProject',
            projectName: currentProject?.name,
            ...(!isDesktop() ? { source: 'kcl-samples' } : {}),
          },
        },
      })
    },
  },
  refreshApp: {
    execute: () => {
      refreshPage('Sidebar button').catch(reportRejection)
    },
    useDisabled: () => undefined,
    useHidden: () => false,
  },
  make: {
    useDisabled: () => {
      const machineManager = useContext(MachineManagerContext)
      return machineManager.noMachinesReason()
    },
    execute: () =>
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Make', groupId: 'modeling' },
      }),
    useHidden: () => !isDesktop(),
  },
} satisfies Record<string, Action>)
