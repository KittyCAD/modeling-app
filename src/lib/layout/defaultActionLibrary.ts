import { useContext } from 'react'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import type { ActionType, ActionTypeDefinition } from '@src/lib/layout/types'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendAddFileToProjectCommandForCurrentProject } from '@src/lib/commandBarConfigs/applicationCommandConfig'

/**
 * For now we have strict action types but in future
 * we should make it possible to register your own in an extension.
 */
export const useDefaultActionLibrary = () => {
  const { commands } = useApp()
  const { kclManager, settingsActor } = useSingletons()

  return Object.freeze({
    export: {
      useHidden: () => false,
      useDisabled: () => {
        const engineIsReady = useReliesOnEngine(
          kclManager.isExecutingSignal.value ?? false
        )
        return engineIsReady ? 'Need engine connection to export' : undefined
      },
      shortcut: 'Ctrl + Shift + E',
      execute: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'Export', groupId: 'modeling' },
        }),
    },
    addFileToProject: {
      useHidden: () => false,
      useDisabled: () => undefined,
      shortcut: 'Mod + Alt + L',
      execute: () =>
        sendAddFileToProjectCommandForCurrentProject(
          settingsActor,
          commands.actor
        ),
    },
    make: {
      useDisabled: () => {
        const machineManager = useContext(MachineManagerContext)
        return machineManager.noMachinesReason()
      },
      shortcut: 'Ctrl + Shift + M',
      execute: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'Make', groupId: 'modeling' },
        }),
      useHidden: () => !isDesktop(),
    },
  } satisfies Record<ActionType, ActionTypeDefinition>)
}
