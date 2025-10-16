import { refreshPage } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'
import { commandBarActor, settingsActor } from '@src/lib/singletons'
import { useContext } from 'react'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import type { ActionType, ActionTypeDefinition } from '@src/lib/layout/types'

/**
 * For now we have strict action types but in future
 * we should make it possible to register your own in an extension.
 */
export const defaultActionLibrary = Object.freeze({
  export: {
    useHidden: () => false,
    useDisabled: () => {
      const engineIsReady = useReliesOnEngine()
      return engineIsReady ? 'Need engine connection to export' : undefined
    },
    shortcut: 'Ctrl + Shift + E',
    execute: () =>
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Export', groupId: 'modeling' },
      }),
  },
  addFileToProject: {
    useHidden: () => false,
    useDisabled: () => undefined,
    shortcut: 'Mod + Alt + L',
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
    shortcut: undefined,
    useDisabled: () => undefined,
    useHidden: () => false,
  },
  make: {
    useDisabled: () => {
      const machineManager = useContext(MachineManagerContext)
      return machineManager.noMachinesReason()
    },
    shortcut: 'Ctrl + Shift + M',
    execute: () =>
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Make', groupId: 'modeling' },
      }),
    useHidden: () => !isDesktop(),
  },
} satisfies Record<ActionType, ActionTypeDefinition>)
