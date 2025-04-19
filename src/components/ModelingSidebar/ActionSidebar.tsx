import { isDesktop } from '@src/lib/isDesktop'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { SidebarAction } from './ModelingPanes'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useKclContext } from '@src/lang/KclProvider'
import { EngineConnectionStateType } from '@src/lang/std/engineConnection'
import { useContext, useMemo } from 'react'
import { MachineManagerContext } from '../MachineManagerProvider'
import { useSettings } from '@src/machines/appMachine'
import { getPlatformString } from '@src/lib/utils'
import { ModelingPaneButton } from './ModelingSidebarButton'

export function ActionSidebar() {
  const machineManager = useContext(MachineManagerContext)
  const kclContext = useKclContext()
  const settings = useSettings()
  const { overallState, immediateState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady
  const paneCallbackProps = useMemo(
    () => ({
      kclContext,
      settings,
      platform: getPlatformString(),
    }),
    [kclContext.diagnostics, settings]
  )

  const sidebarActions: SidebarAction[] = [
    {
      id: 'load-external-model',
      title: 'Load external model',
      sidebarName: 'Load external model',
      icon: 'importFile',
      keybinding: 'Ctrl + Shift + I',
      action: () =>
        commandBarActor.send({
          type: 'Find and select command',
          data: { name: 'load-external-model', groupId: 'code' },
        }),
    },
    {
      id: 'share-link',
      title: 'Create share link',
      sidebarName: 'Create share link',
      icon: 'link',
      keybinding: 'Mod + Alt + S',
      action: () =>
        commandBarActor.send({
          type: 'Find and select command',
          data: { name: 'share-file-link', groupId: 'code' },
        }),
    },
    {
      id: 'export',
      title: 'Export part',
      sidebarName: 'Export part',
      icon: 'floppyDiskArrow',
      keybinding: 'Ctrl + Shift + E',
      disable: () =>
        reliesOnEngine ? 'Need engine connection to export' : undefined,
      action: () =>
        commandBarActor.send({
          type: 'Find and select command',
          data: { name: 'Export', groupId: 'modeling' },
        }),
    },
    {
      id: 'make',
      title: 'Make part',
      sidebarName: 'Make part',
      icon: 'printer3d',
      keybinding: 'Ctrl + Shift + M',
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      action: async () => {
        commandBarActor.send({
          type: 'Find and select command',
          data: { name: 'Make', groupId: 'modeling' },
        })
      },
      hide: () => !isDesktop(),
      disable: () => {
        return machineManager.noMachinesReason()
      },
    },
  ]

  const filteredActions = sidebarActions.filter(
    (action) =>
      !action.hide ||
      (action.hide instanceof Function && !action.hide(paneCallbackProps))
  )

  return (
    <aside
      id="action-sidebar"
      className="absolute right-0 top-0 bottom-0 flex flex-col z-10 my-2"
    >
      <ul
        className={
          'relative rounded-l z-[2] pointer-events-auto p-0 col-start-1 col-span-1 h-fit w-fit flex flex-col ' +
          'bg-chalkboard-10 border border-solid border-chalkboard-30 dark:bg-chalkboard-90 dark:border-chalkboard-80 group-focus-within:border-primary dark:group-focus-within:border-chalkboard-50 shadow-sm '
        }
      >
        {filteredActions.length > 0 && (
          <>
            <ul id="sidebar-actions" className="w-fit p-2 flex flex-col gap-2">
              {filteredActions.map((action) => (
                <li className="contents">
                  <ModelingPaneButton
                    key={action.id}
                    paneConfig={{
                      id: action.id,
                      sidebarName: action.sidebarName,
                      icon: action.icon,
                      keybinding: action.keybinding,
                      iconClassName: action.iconClassName,
                      iconSize: 'md',
                    }}
                    onClick={action.action}
                    disabledText={action.disable?.()}
                    tooltipPosition="left"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </ul>
    </aside>
  )
}
