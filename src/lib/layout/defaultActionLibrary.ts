import { useSignals } from '@preact/signals-react/runtime'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendAddFileToProjectCommandForCurrentProject } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { commandKey, selectCommand } from '@src/lib/commandUtils'
import {
  EXPORT_MODEL_ICON,
  EXPORT_MODEL_LABEL,
  EXPORT_PROJECT_ARCHIVE_COMMAND,
  EXPORT_PROJECT_ARCHIVE_ICON,
  EXPORT_PROJECT_ARCHIVE_LABEL,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { isMobile } from '@src/lib/isMobile'
import { layoutActionLibraryFacet } from '@src/lib/layout/registry/contract'
import { ActionType, type ActionLibrary } from '@src/lib/layout/types'
import {
  findKeymapItemForCommand,
  keymapScopesFacet,
  keymapService,
} from '@src/registry/contracts/keymap'
import { useMemo } from 'react'

export const useDefaultActionLibrary = () => {
  useSignals()
  const { commands, settings, registry } = useApp()
  const { kclManager } = useSingletons()
  const machineApiEnabled = settings.useSettings().app.machineApi.current
  const registeredActionLibrary = registry.observe(
    layoutActionLibraryFacet
  ).value

  return useMemo(
    () =>
      Object.freeze({
        export: {
          label: EXPORT_MODEL_LABEL,
          icon: EXPORT_MODEL_ICON,
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
            selectCommand(commands, { name: 'Export', groupId: 'modeling' }),
        },
        [ActionType.ExportProjectArchive]: {
          label: EXPORT_PROJECT_ARCHIVE_LABEL,
          icon: EXPORT_PROJECT_ARCHIVE_ICON,
          get shortcutKeystrokes() {
            const keymap = registry.optional(keymapService)
            return (
              keymap &&
              findKeymapItemForCommand(
                keymap.keymap.value,
                commandKey(EXPORT_PROJECT_ARCHIVE_COMMAND),
                keymap.getCurrentScopes(),
                registry.observe(keymapScopesFacet).value
              )?.keystrokes
            )
          },
          execute: () =>
            selectCommand(commands, EXPORT_PROJECT_ARCHIVE_COMMAND),
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
            selectCommand(commands, { name: 'Make', groupId: 'modeling' }),
          useHidden: () => !isDesktop() || !machineApiEnabled,
        },
        ...registeredActionLibrary,
      } satisfies ActionLibrary),
    [
      commands,
      kclManager,
      machineApiEnabled,
      registeredActionLibrary,
      registry,
      settings.actor,
    ]
  )
}
