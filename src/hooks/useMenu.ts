import { useEffect } from 'react'
import type { WebContentSendPayload, MenuLabels } from '../menu/channels'
import { isDesktop } from 'lib/isDesktop'
import { ToolbarModeName } from 'lib/toolbar'
import { reportRejection } from 'lib/trap'
import { useCommandBarState } from 'machines/commandBarMachine'
import { NetworkHealthState } from 'hooks/useNetworkStatus'

export function useMenuListener(
  callback: (data: WebContentSendPayload) => void
) {
  useEffect(() => {
    const onDesktop = isDesktop()
    if (!onDesktop) {
      // NO OP for web
      return
    }

    const removeListener = window.electron.menuOn(callback)
    return () => {
      if (!onDesktop) {
        // NO OP for web
        return
      }
      removeListener()
    }
  }, [])
}

// Enable disable menu actions specifically based on if you are in the modeling mode of sketching or modeling.
// This is a similar behavor of the command bar which disables action if you are in sketch mode
export function useSketchModeMenuEnableDisable(
  currentMode: ToolbarModeName,
  overallState: NetworkHealthState,
  isExecuting: boolean,
  isStreamReady: boolean,
  menus: { menuLabel: MenuLabels; commandName?: string; groupId?: string }[]
) {
  const commandBarState = useCommandBarState()
  const commands = commandBarState.context.commands

  useEffect(() => {
    const onDesktop = isDesktop()
    if (!onDesktop) {
      // NO OP for web
      return
    }

    // Same exact logic as the command bar
    const disableAllButtons =
      (overallState !== NetworkHealthState.Ok &&
        overallState !== NetworkHealthState.Weak) ||
      isExecuting ||
      !isStreamReady

    // Enable or disable each menu based on the state of the application.
    menus.forEach(({ menuLabel, commandName, groupId }) => {
      // If someone goes wrong, disable all the buttons! Engine cannot take this request
      if (disableAllButtons) {
        window.electron.disableMenu(menuLabel).catch(reportRejection)
        return
      }

      if (commandName && groupId) {
        // If your menu is tied to a command bar action, see if the command exists in the command bar
        const foundCommand = commands.find((command) => {
          return command.name === commandName && command.groupId === groupId
        })
        if (!foundCommand) {
          window.electron.disableMenu(menuLabel).catch(reportRejection)
        } else {
          if (currentMode === 'sketching') {
            window.electron.disableMenu(menuLabel).catch(reportRejection)
          } else if (currentMode === 'modeling') {
            window.electron.enableMenu(menuLabel).catch(reportRejection)
          }
        }
      } else {
        // menu is not tied to a command bar, do the sketch mode check
        if (currentMode === 'sketching') {
          window.electron.disableMenu(menuLabel).catch(reportRejection)
        } else if (currentMode === 'modeling') {
          window.electron.enableMenu(menuLabel).catch(reportRejection)
        }
      }
    })

    return () => {
      if (!onDesktop) {
        // NO OP for web
        return
      }
    }
  }, [currentMode, commands])
}
