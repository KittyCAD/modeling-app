import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { type settings } from '@src/lib/settings/initialSettings'
import { useSelector } from '@xstate/react'
import { Resizable } from 're-resizable'
import type { HTMLProps, MouseEventHandler, ComponentProps, Ref } from 'react'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useAppState } from '@src/AppState'
import { ActionIcon } from '@src/components/ActionIcon'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import { ModelingPane } from '@src/components/ModelingSidebar/ModelingPane'
import type {
  SidebarAction,
  SidebarCssOverrides,
  SidebarPane,
  SidebarId,
} from '@src/components/ModelingSidebar/ModelingPanes'
import {
  sidebarPanesLeft,
  sidebarPanesRight,
  validPaneIds,
} from '@src/components/ModelingSidebar/ModelingPanes'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import usePlatform from '@src/hooks/usePlatform'
import { useKclContext } from '@src/lang/KclProvider'
import { SIDEBAR_BUTTON_SUFFIX } from '@src/lib/constants'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import { mlEphantManagerActor, useSettings } from '@src/lib/singletons'
import { commandBarActor } from '@src/lib/singletons'
import { settingsActor } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'
import { EngineConnectionStateType } from '@src/network/utils'
import type { ResizeHandle } from '@src/components/ResizeHandle'
import {
  Alignment,
  type BadgeInfoComputed,
} from '@src/components/ModelingSidebar/types'

function getPlatformString(): 'web' | 'desktop' {
  return isDesktop() ? 'desktop' : 'web'
}

export function ModelingSidebarLeft() {
  const machineManager = useContext(MachineManagerContext)
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

  const sidebarActions: SidebarAction[] = [
    {
      id: 'add-file-to-project',
      title: 'Add file to project',
      sidebarName: 'Add file to project',
      icon: 'importFile',
      keybinding: 'Mod + Alt + L',
      action: () => {
        const currentProject =
          settingsActor.getSnapshot().context.currentProject
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
    {
      id: 'refresh',
      title: 'Refresh app',
      sidebarName: 'Refresh app',
      icon: 'exclamationMark',
      keybinding: '', // as a last resort, this action shouldn't have a shortcut
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      action: async () => {
        refreshPage('Sidebar button').catch(reportRejection)
      },
    },
  ]

  return (
    <ModelingSidebar
      id="app-sidebar"
      sidebarPanes={sidebarPanesLeft}
      sidebarActions={sidebarActions}
      settings={settings}
      align={Alignment.Left}
    />
  )
}

export function ModelingSidebarRight() {
  const settings = useSettings()
  const { send: modelingContextSend, context: modelingContext } =
    useModelingContext()
  const promptsBelongingToConversation = useSelector(
    mlEphantManagerActor,
    (actor) => {
      return actor.context.promptsBelongingToConversation
    }
  )
  const [actuallyNew, setActuallyNew] = useState<boolean>(false)

  useEffect(() => {
    if (promptsBelongingToConversation === undefined) {
      return
    }
    if (promptsBelongingToConversation.length === 0) {
      return
    }
    if (!actuallyNew) {
      setActuallyNew(true)
      return
    }

    const newPanes = new Set(
      modelingContext.store.openPanes.concat('text-to-cad')
    )

    modelingContextSend({
      type: 'Set context',
      data: {
        openPanes: Array.from(newPanes),
      },
    })
    // React doesn't realize that we are updating `modelingContext.store.openPanes` here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptsBelongingToConversation, actuallyNew])

  // Prevents rerenders because new array is a new ref.
  const sidebarActions: Ref<SidebarAction[]> = useRef([])
  return (
    <ModelingSidebar
      id="right-sidebar"
      sidebarPanes={sidebarPanesRight || []}
      sidebarActions={sidebarActions.current || []}
      settings={settings}
      align={Alignment.Right}
      elementProps={{ defaultSize: { width: '25%' } }}
    />
  )
}

interface ModelingSidebarProps {
  id: string
  sidebarActions: SidebarAction[]
  sidebarPanes: SidebarPane[]
  settings: typeof settings
  align: Alignment
  elementProps?: Pick<ComponentProps<typeof Resizable>, 'defaultSize'>
}

export function ModelingSidebar(props: ModelingSidebarProps) {
  const { send, context } = useModelingContext()

  const kclContext = useKclContext()
  const showDebugPanel = props.settings.app.showDebugPanel

  const paneCallbackProps = useMemo(
    () => ({
      kclContext,
      settings: props.settings,
      platform: getPlatformString(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [kclContext.diagnostics, props.settings]
  )

  const filteredActions: SidebarAction[] = props.sidebarActions.filter(
    (action) =>
      !action.hide ||
      (action.hide instanceof Function && !action.hide(paneCallbackProps))
  )

  //   // Filter out the debug panel if it's not supposed to be shown
  //   // TODO: abstract out for allowing user to configure which panes to show
  const filteredPanes = useMemo(
    () =>
      (showDebugPanel.current
        ? props.sidebarPanes
        : props.sidebarPanes.filter((pane) => pane.id !== 'debug')
      ).filter(
        (pane) =>
          validPaneIds.includes(pane.id) &&
          (!pane.hide ||
            (pane.hide instanceof Function && !pane.hide(paneCallbackProps)))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [props.sidebarPanes, paneCallbackProps, validPaneIds]
  )
  // Since we store one persisted list of `openPanes`, we should first filter it to ones that have
  // been passed into this instance as props
  const openPanesForThisSide = context.store?.openPanes.filter((openPaneId) =>
    filteredPanes.some((thisSidePane) => thisSidePane.id === openPaneId)
  )
  const pointerEventsCssClass =
    openPanesForThisSide.length === 0
      ? 'pointer-events-none '
      : 'pointer-events-auto '

  const paneBadgeMap: Record<SidebarId, BadgeInfoComputed> = useMemo(() => {
    return filteredPanes.reduce(
      (acc, pane) => {
        if (pane.showBadge) {
          acc[pane.id] = {
            value: pane.showBadge.value(paneCallbackProps),
            onClick: pane.showBadge.onClick,
            className: pane.showBadge.className,
            title: pane.showBadge.title,
          }
        }
        return acc
      },
      {} as Record<SidebarId, BadgeInfoComputed>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [paneCallbackProps])

  // Clear any hidden panes from the `openPanes` array
  useEffect(() => {
    const panesToReset: SidebarId[] = []

    props.sidebarPanes.forEach((pane) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.app.showDebugPanel])

  const togglePane = useCallback(
    (newPane: SidebarId) => {
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

  const css = {
    handle:
      (openPanesForThisSide.length === 0 ? 'hidden ' : 'block ') +
      'translate-x-1/2 hover:bg-chalkboard-10 hover:dark:bg-chalkboard-110 bg-transparent transition-colors duration-75 transition-ease-out delay-100 ',
    paneAlign: {
      [Alignment.Left]: 'flex-row',
      [Alignment.Right]: 'flex-row-reverse',
    },
    tailwindDir: {
      [Alignment.Left]: 'r',
      [Alignment.Right]: 'l',
    },
  }

  return filteredPanes.length === 0 ? null : (
    <Resizable
      className={`group z-10 flex flex-col ${pointerEventsCssClass} ${openPanesForThisSide.length ? undefined : '!w-auto'}`}
      defaultSize={
        props.elementProps?.defaultSize || {
          width: '550px',
          height: 'auto',
        }
      }
      minWidth={openPanesForThisSide.length ? 200 : undefined}
      maxWidth="50%"
      handleWrapperClass="sidebar-resize-handles"
      enable={{
        right: props.align === Alignment.Left,
        left: props.align === Alignment.Right,
        top: false,
        topLeft: false,
        topRight: false,
        bottom: false,
        bottomLeft: false,
        bottomRight: false,
      }}
      handleComponent={{
        [props.align === Alignment.Left ? Alignment.Right : Alignment.Left]: (
          <ResizeHandle
            alignment={props.align}
            className={openPanesForThisSide.length ? 'block ' : 'hidden '}
          />
        ),
      }}
    >
      <div
        id={props.id}
        className={`flex h-full ${css.paneAlign[props.align]}`}
      >
        <ul
          className={`relative pointer-events-auto p-0 col-start-1 col-span-1 flex flex-col items-stretch bg-chalkboard-10 border-${css.tailwindDir[props.align]} border-chalkboard-30 dark:bg-chalkboard-90 dark:border-chalkboard-80`}
        >
          <ul id="pane-buttons-section" className="flex flex-col items-stretch">
            {filteredPanes.map((pane) => (
              <ModelingPaneButton
                key={pane.id}
                align={
                  props.align === Alignment.Right
                    ? Alignment.Left
                    : Alignment.Right
                }
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
              <ul id="sidebar-actions" className="flex flex-col">
                {filteredActions.map((action) => (
                  <ModelingPaneButton
                    align={
                      props.align === Alignment.Right
                        ? Alignment.Left
                        : Alignment.Right
                    }
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
            'ml-[-1px] col-start-2 col-span-1 flex flex-col items-stretch border-x border-chalkboard-30 dark:border-chalkboard-80 ' +
            (openPanesForThisSide.length >= 1 ? `w-full` : `hidden`)
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
    cssClassOverrides?: SidebarCssOverrides
  }
  align: Alignment
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
  const platform = usePlatform()
  useHotkeys(paneConfig.keybinding, onClick, {
    scopes: ['modeling'],
  })

  const tooltipPosition = props.align === Alignment.Left ? 'left' : 'right'

  return (
    <div
      id={paneConfig.id + '-button-holder'}
      className="relative"
      data-onboarding-id={`${paneConfig.id}-pane-button`}
    >
      <button
        className={`group pointer-events-auto flex items-center justify-center border-0 rounded-none border-transparent dark:border-transparent p-[8px] ${tooltipPosition === 'right' ? 'pl-[9px] pr-[7px]' : 'pl-[7px] pr-[9px]'} m-0 !outline-0 ${paneIsOpen ? ' !border-primary' : ''} ${paneConfig.cssClassOverrides?.button ?? ''}`}
        aria-pressed={paneIsOpen}
        style={{
          [tooltipPosition === 'left' ? 'borderLeft' : 'borderRight']:
            'solid 2px transparent',
        }}
        onClick={onClick}
        name={paneConfig.sidebarName}
        data-testid={paneConfig.id + SIDEBAR_BUTTON_SUFFIX}
        disabled={disabledText !== undefined}
        aria-disabled={disabledText !== undefined}
        {...props}
      >
        <ActionIcon
          icon={paneConfig.icon}
          size={paneConfig.iconSize || 'md'}
          bgClassName="rounded-sm !bg-transparent"
        />
        <span className="sr-only">
          {paneConfig.sidebarName}
          {paneIsOpen !== undefined ? ` pane` : ''}
        </span>
        <Tooltip
          position={tooltipPosition}
          contentClassName="max-w-none flex items-center gap-4"
          hoverOnly
        >
          <span className="flex-1">
            {paneConfig.sidebarName}
            {disabledText !== undefined ? ` (${disabledText})` : ''}
            {paneIsOpen !== undefined ? ` pane` : ''}
          </span>
          {paneConfig.keybinding && (
            <kbd className="hotkey text-xs capitalize">
              {hotkeyDisplay(paneConfig.keybinding, platform)}
            </kbd>
          )}
        </Tooltip>
      </button>
      {!!showBadge?.value && (
        <p
          id={`${paneConfig.id}-badge`}
          className={
            showBadge.className
              ? showBadge.className
              : 'absolute m-0 p-0 top-0 right-0 min-w-3 h-3 flex items-center justify-center text-[10px] font-semibold text-white bg-primary hue-rotate-90 rounded-bl border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200'
          }
          onClick={showBadge.onClick}
          title={
            showBadge.title
              ? showBadge.title
              : `Click to view ${showBadge.value} notification{Number(showBadge.value) > 1 ? 's' : ''
              }`
          }
        >
          <span className="sr-only">&nbsp;has&nbsp;</span>
          {typeof showBadge.value === 'number' ||
          typeof showBadge.value === 'string' ? (
            <span>{showBadge.value}</span>
          ) : (
            <span className="sr-only">a</span>
          )}
          {typeof showBadge.value === 'number' && (
            <span className="sr-only">
              &nbsp;notification{Number(showBadge.value) > 1 ? 's' : ''}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
