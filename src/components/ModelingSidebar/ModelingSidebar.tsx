import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Resizable } from 're-resizable'
import { useCallback, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { SidebarType, sidebarPanes } from './ModelingPanes'
import Tooltip from 'components/Tooltip'
import { ActionIcon } from 'components/ActionIcon'
import styles from './ModelingSidebar.module.css'
import { ModelingPane } from './ModelingPane'
import { isTauri } from 'lib/isTauri'
import { useModelingContext } from 'hooks/useModelingContext'
import { CustomIconName } from 'components/CustomIcon'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { IconDefinition } from '@fortawesome/free-solid-svg-icons'

interface ModelingSidebarProps {
  paneOpacity: '' | 'opacity-20' | 'opacity-40'
}

export function ModelingSidebar({ paneOpacity }: ModelingSidebarProps) {
  const { commandBarSend } = useCommandsContext()
  const { settings } = useSettingsAuthContext()
  const onboardingStatus = settings.context.app.onboardingStatus
  const { send, context } = useModelingContext()
  const pointerEventsCssClass =
    context.store?.buttonDownInStream ||
    onboardingStatus.current === 'camera' ||
    context.store?.openPanes.length === 0
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  const showDebugPanel = settings.context.modeling.showDebugPanel

  const sidebarActions: SidebarAction[] = [
    {
      id: 'export',
      title: 'Export part',
      icon: 'exportFile',
      keybinding: 'Ctrl + Shift + E',
      action: () =>
        commandBarSend({
          type: 'Find and select command',
          data: { name: 'Export', groupId: 'modeling' },
        }),
    },
  ]

  //   // Filter out the debug panel if it's not supposed to be shown
  //   // TODO: abstract out for allowing user to configure which panes to show
  const filteredPanes = useMemo(
    () =>
      (showDebugPanel.current
        ? sidebarPanes
        : sidebarPanes.filter((pane) => pane.id !== 'debug')
      ).filter(
        (pane) =>
          !pane.hideOnPlatform ||
          (isTauri()
            ? pane.hideOnPlatform === 'web'
            : pane.hideOnPlatform === 'desktop')
      ),
    [sidebarPanes, showDebugPanel.current]
  )

  const togglePane = useCallback(
    (newPane: SidebarType) => {
      send({
        type: 'Set context',
        data: {
          openPanes: context.store?.openPanes.includes(newPane)
            ? context.store?.openPanes.filter((pane) => pane !== newPane)
            : [...context.store?.openPanes, newPane],
        },
      })
    },
    [context.store?.openPanes, send]
  )

  return (
    <Resizable
      className={`group flex-1 flex flex-col z-10 my-2 pr-1 ${paneOpacity} ${pointerEventsCssClass}`}
      defaultSize={{
        width: '550px',
        height: 'auto',
      }}
      minWidth={200}
      maxWidth={800}
      handleClasses={{
        right:
          (context.store?.openPanes.length === 0 ? 'hidden ' : 'block ') +
          'translate-x-1/2 hover:bg-chalkboard-10 hover:dark:bg-chalkboard-110 bg-transparent transition-colors duration-75 transition-ease-out delay-100 ',
        left: 'hidden',
        top: 'hidden',
        topLeft: 'hidden',
        topRight: 'hidden',
        bottom: 'hidden',
        bottomLeft: 'hidden',
        bottomRight: 'hidden',
      }}
    >
      <div id="app-sidebar" className={styles.grid + ' flex-1'}>
        <ul
          className={
            (context.store?.openPanes.length === 0
              ? 'rounded-r '
              : '!border-r-transparent ') +
            'pointer-events-auto p-0 col-start-1 col-span-1 h-fit w-fit flex flex-col ' +
            'bg-chalkboard-10 border border-solid border-chalkboard-20 dark:bg-chalkboard-90 dark:border-chalkboard-80 group-focus-within:border-primary dark:group-focus-within:border-chalkboard-50 '
          }
        >
          <ul
            id="pane-buttons-section"
            className={
              'w-fit p-2 flex flex-col gap-2 ' +
              (context.store?.openPanes.length >= 1 ? 'pr-0.5' : '')
            }
          >
            {filteredPanes.map((pane) => (
              <ModelingPaneButton
                key={pane.id}
                paneConfig={pane}
                paneIsOpen={context.store?.openPanes.includes(pane.id)}
                onClick={() => togglePane(pane.id)}
              />
            ))}
          </ul>
          <hr className="w-full border-chalkboard-20 dark:border-chalkboard-80" />
          <ul id="sidebar-actions" className="w-fit p-2 flex flex-col gap-2">
            {sidebarActions.map((action) => (
              <ModelingPaneButton
                key={action.id}
                paneConfig={{
                  id: action.id,
                  title: action.title,
                  icon: action.icon,
                  keybinding: action.keybinding,
                }}
                paneIsOpen={false}
                onClick={action.action}
              />
            ))}
          </ul>
        </ul>
        <ul
          id="pane-section"
          className={
            'col-start-2 col-span-1 flex flex-col gap-2 ' +
            (context.store?.openPanes.length >= 1
              ? `row-start-1 row-end-3`
              : `hidden`)
          }
        >
          {filteredPanes
            .filter((pane) => context?.store.openPanes.includes(pane.id))
            .map((pane) => (
              <ModelingPane
                key={pane.id}
                icon={pane.icon}
                id={`${pane.id}-pane`}
                title={pane.title}
                Menu={pane.Menu}
                onClose={() => togglePane(pane.id)}
              >
                {pane.Content instanceof Function ? (
                  <pane.Content />
                ) : (
                  pane.Content
                )}
              </ModelingPane>
            ))}
        </ul>
      </div>
    </Resizable>
  )
}

interface ModelingPaneButtonProps {
  paneConfig: {
    id: string
    title: string
    icon: CustomIconName | IconDefinition
    keybinding: string
  }
  onClick: () => void
  paneIsOpen: boolean
}

function ModelingPaneButton({
  paneConfig,
  onClick,
  paneIsOpen,
}: ModelingPaneButtonProps) {
  useHotkeys(paneConfig.keybinding, onClick, {
    scopes: ['modeling'],
  })

  return (
    <button
      className="pointer-events-auto flex items-center justify-center border-transparent dark:border-transparent p-0 m-0 rounded-sm !outline-0 focus-visible:border-primary"
      onClick={onClick}
      data-testid={paneConfig.title}
    >
      <ActionIcon
        icon={paneConfig.icon}
        className="p-1"
        size="sm"
        iconClassName={
          paneIsOpen
            ? ' !text-chalkboard-10'
            : '!text-chalkboard-80 dark:!text-chalkboard-30'
        }
        bgClassName={
          'rounded-sm ' + (paneIsOpen ? '!bg-primary' : '!bg-transparent')
        }
      />
      <Tooltip
        position="right"
        className="!max-w-none flex gap-4 items-center justify-between"
        hoverOnly
        delay={800}
      >
        <span className="flex-none">{paneConfig.title}</span>
        <kbd className="hotkey">{paneConfig.keybinding}</kbd>
      </Tooltip>
    </button>
  )
}

export type SidebarAction = {
  id: string
  title: string
  icon: CustomIconName
  keybinding: string
  action: () => void
  hideOnPlatform?: 'desktop' | 'web'
}
