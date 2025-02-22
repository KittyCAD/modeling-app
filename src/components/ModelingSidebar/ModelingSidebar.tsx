import { Resizable } from 're-resizable'
import {
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useContext,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { SidebarAction, SidebarType, sidebarPanes } from './ModelingPanes'
import Tooltip from 'components/Tooltip'
import { ActionIcon } from 'components/ActionIcon'
import { ModelingPane } from './ModelingPane'
import { isDesktop } from 'lib/isDesktop'
import { useModelingContext } from 'hooks/useModelingContext'
import { CustomIconName } from 'components/CustomIcon'
import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { useKclContext } from 'lang/KclProvider'
import { MachineManagerContext } from 'components/MachineManagerProvider'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { SIDEBAR_BUTTON_SUFFIX } from 'lib/constants'
import { commandBarActor } from 'machines/commandBarMachine'
import { useSettings } from 'machines/appMachine'

interface ModelingSidebarProps {
  paneOpacity: '' | 'opacity-20' | 'opacity-40'
}

interface BadgeInfoComputed {
  value: number | boolean
  onClick?: MouseEventHandler<any>
}

function getPlatformString(): 'web' | 'desktop' {
  return isDesktop() ? 'desktop' : 'web'
}

export function ModelingSidebar({ paneOpacity }: ModelingSidebarProps) {
  const machineManager = useContext(MachineManagerContext)
  const kclContext = useKclContext()
  const settings = useSettings()
  const onboardingStatus = settings.app.onboardingStatus
  const { send, context } = useModelingContext()
  const pointerEventsCssClass =
    onboardingStatus.current === onboardingPaths.CAMERA ||
    context.store?.openPanes.length === 0
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  const showDebugPanel = settings.modeling.showDebugPanel

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
      id: 'export',
      title: 'Export part',
      sidebarName: 'Export part',
      icon: 'floppyDiskArrow',
      keybinding: 'Ctrl + Shift + E',
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
  const filteredActions: SidebarAction[] = sidebarActions.filter(
    (action) =>
      !action.hide ||
      (action.hide instanceof Function && !action.hide(paneCallbackProps))
  )

  //   // Filter out the debug panel if it's not supposed to be shown
  //   // TODO: abstract out for allowing user to configure which panes to show
  const filteredPanes = useMemo(
    () =>
      (showDebugPanel.current
        ? sidebarPanes
        : sidebarPanes.filter((pane) => pane.id !== 'debug')
      ).filter(
        (pane) =>
          !pane.hide ||
          (pane.hide instanceof Function && !pane.hide(paneCallbackProps))
      ),
    [sidebarPanes, paneCallbackProps]
  )

  const paneBadgeMap: Record<SidebarType, BadgeInfoComputed> = useMemo(() => {
    return filteredPanes.reduce((acc, pane) => {
      if (pane.showBadge) {
        acc[pane.id] = {
          value: pane.showBadge.value(paneCallbackProps),
          onClick: pane.showBadge.onClick,
        }
      }
      return acc
    }, {} as Record<SidebarType, BadgeInfoComputed>)
  }, [paneCallbackProps])

  // Clear any hidden panes from the `openPanes` array
  useEffect(() => {
    const panesToReset: SidebarType[] = []
    sidebarPanes.forEach((pane) => {
      if (
        pane.hide === true ||
        (pane.hide instanceof Function && pane.hide(paneCallbackProps))
      ) {
        panesToReset.push(pane.id)
      }
    })

    if (panesToReset.length > 0) {
      send({
        type: 'Set context',
        data: {
          openPanes: context.store?.openPanes.filter(
            (pane) => !panesToReset.includes(pane)
          ),
        },
      })
    }
  }, [settings.modeling.showDebugPanel])

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
      maxWidth={window.innerWidth - 10}
      handleWrapperClass="sidebar-resize-handles"
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
      <div id="app-sidebar" className="flex flex-row h-full">
        <ul
          className={
            (context.store?.openPanes.length === 0 ? 'rounded-r ' : '') +
            'relative z-[2] pointer-events-auto p-0 col-start-1 col-span-1 h-fit w-fit flex flex-col ' +
            'bg-chalkboard-10 border border-solid border-chalkboard-30 dark:bg-chalkboard-90 dark:border-chalkboard-80 group-focus-within:border-primary dark:group-focus-within:border-chalkboard-50 shadow-sm '
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
                aria-pressed={context.store?.openPanes.includes(pane.id)}
                showBadge={paneBadgeMap[pane.id]}
              />
            ))}
          </ul>
          {filteredActions.length > 0 && (
            <>
              <hr className="w-full border-chalkboard-30 dark:border-chalkboard-80" />
              <ul
                id="sidebar-actions"
                className="w-fit p-2 flex flex-col gap-2"
              >
                {filteredActions.map((action) => (
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
                  />
                ))}
              </ul>
            </>
          )}
        </ul>
        <ul
          id="pane-section"
          className={
            'ml-[-1px] col-start-2 col-span-1 flex flex-col items-stretch gap-2 ' +
            (context.store?.openPanes.length >= 1 ? `w-full` : `hidden`)
          }
        >
          {filteredPanes
            .filter((pane) => context?.store.openPanes.includes(pane.id))
            .map((pane) => (
              <ModelingPane
                key={pane.id}
                icon={pane.icon}
                title={pane.sidebarName}
                onClose={() => {}}
                id={`${pane.id}-pane`}
              >
                {pane.Content instanceof Function ? (
                  <pane.Content
                    id={pane.id}
                    onClose={() => togglePane(pane.id)}
                  />
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

interface ModelingPaneButtonProps
  extends React.HTMLAttributes<HTMLButtonElement> {
  paneConfig: {
    id: string
    sidebarName: string
    icon: CustomIconName | IconDefinition
    keybinding: string
    iconClassName?: string
    iconSize?: 'sm' | 'md' | 'lg'
  }
  onClick: () => void
  paneIsOpen?: boolean
  showBadge?: BadgeInfoComputed
  disabledText?: string
}

function ModelingPaneButton({
  paneConfig,
  onClick,
  paneIsOpen,
  showBadge,
  disabledText,
  ...props
}: ModelingPaneButtonProps) {
  useHotkeys(paneConfig.keybinding, onClick, {
    scopes: ['modeling'],
  })

  return (
    <div id={paneConfig.id + '-button-holder'} className="relative">
      <button
        className="group pointer-events-auto flex items-center justify-center border-transparent dark:border-transparent disabled:!border-transparent p-0 m-0 rounded-sm !outline-0 focus-visible:border-primary"
        onClick={onClick}
        name={paneConfig.sidebarName}
        data-testid={paneConfig.id + SIDEBAR_BUTTON_SUFFIX}
        disabled={disabledText !== undefined}
        aria-disabled={disabledText !== undefined}
        {...props}
      >
        <ActionIcon
          icon={paneConfig.icon}
          className={paneConfig.iconClassName || ''}
          size={paneConfig.iconSize || 'md'}
          iconClassName={paneIsOpen ? ' !text-chalkboard-10' : ''}
          bgClassName={
            'rounded-sm ' + (paneIsOpen ? '!bg-primary' : '!bg-transparent')
          }
        />
        <span className="sr-only">
          {paneConfig.sidebarName}
          {paneIsOpen !== undefined ? ` pane` : ''}
        </span>
        <Tooltip
          position="right"
          contentClassName="max-w-none flex items-center gap-4"
          hoverOnly
        >
          <span className="flex-1">
            {paneConfig.sidebarName}
            {disabledText !== undefined ? ` (${disabledText})` : ''}
            {paneIsOpen !== undefined ? ` pane` : ''}
          </span>
          <kbd className="hotkey text-xs capitalize">
            {paneConfig.keybinding}
          </kbd>
        </Tooltip>
      </button>
      {!!showBadge?.value && (
        <p
          id={`${paneConfig.id}-badge`}
          className={
            'absolute m-0 p-0 bottom-4 left-4 w-3 h-3 flex items-center justify-center text-[10px] font-semibold text-white bg-primary hue-rotate-90 rounded-full border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200'
          }
          onClick={showBadge.onClick}
          title={`Click to view ${showBadge.value} notification${
            Number(showBadge.value) > 1 ? 's' : ''
          }`}
        >
          <span className="sr-only">&nbsp;has&nbsp;</span>
          {typeof showBadge.value === 'number' ? (
            <span>{showBadge.value}</span>
          ) : (
            <span className="sr-only">a</span>
          )}
          <span className="sr-only">
            &nbsp;notification{Number(showBadge.value) > 1 ? 's' : ''}
          </span>
        </p>
      )}
    </div>
  )
}
