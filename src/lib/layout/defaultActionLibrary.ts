import { useSignals } from '@preact/signals-react/runtime'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendAddFileToProjectCommandForCurrentProject } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { isDesktop } from '@src/lib/isDesktop'
import { isMobile } from '@src/lib/isMobile'
import { layoutActionLibraryValueSpec } from '@src/lib/layout/registry/contract'
import type { ActionLibrary } from '@src/lib/layout/types'
import { useMemo } from 'react'

export const useDefaultActionLibrary = () => {
  useSignals()
  const { commands, settings, registry } = useApp()
  const { kclManager } = useSingletons()
  const machineApiEnabled = settings.useSettings().app.machineApi.current
  const registeredActionLibrary = registry.signal(
    layoutActionLibraryValueSpec
  ).value

  return useMemo(
    () =>
      Object.freeze({
        export: {
          useHidden: () => false,
          useDisabled: () => {
            const engineIsReady = useReliesOnEngine(
              kclManager.isExecutingSignal.value ?? false
            )
            return engineIsReady
              ? 'Need engine connection to export'
              : undefined
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
              settings.actor,
              commands.actor
            ),
        },
        openCommandBar: {
          useHidden: () => !isMobile(),
          useDisabled: () => undefined,
          shortcut: 'Mod + K',
          execute: () => commands.actor.send({ type: 'Open' }),
        },
        make: {
          useDisabled: () => {
            const { machineManager } = useApp()
            return machineManager.noMachinesReason()
          },
          shortcut: 'Ctrl + Shift + M',
          execute: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Make', groupId: 'modeling' },
            }),
          useHidden: () => !isDesktop() || !machineApiEnabled,
        },
        ...registeredActionLibrary,
      } satisfies ActionLibrary),
    [
      commands,
      kclManager,
      machineApiEnabled,
      registeredActionLibrary,
      settings.actor,
    ]
  )
}
