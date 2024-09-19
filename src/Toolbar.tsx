import { useRef, useMemo, memo } from 'react'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { useModelingContext } from 'hooks/useModelingContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ActionButton } from 'components/ActionButton'
import { isSingleCursorInPipe } from 'lang/queryAst'
import { useKclContext } from 'lang/KclProvider'
import { ActionButtonDropdown } from 'components/ActionButtonDropdown'
import { useHotkeys } from 'react-hotkeys-hook'
import Tooltip from 'components/Tooltip'
import { useAppState } from 'AppState'
import { CustomIcon } from 'components/CustomIcon'
import {
  toolbarConfig,
  ToolbarItem,
  ToolbarItemCallbackProps,
  ToolbarItemResolved,
  ToolbarModeName,
} from 'lib/toolbar'
import { isDesktop } from 'lib/isDesktop'
import { openExternalBrowserIfDesktop } from 'lib/openWindow'
import { EngineConnectionStateType } from 'lang/std/engineConnection'
import useEngineStreamContext, {
  EngineStreamState,
  EngineStreamTransition,
} from 'hooks/useEngineStreamContext'

export function Toolbar({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { state, send, context } = useModelingContext()
  const { commandBarSend } = useCommandsContext()
  const iconClassName =
    'group-disabled:text-chalkboard-50 !text-inherit dark:group-enabled:group-hover:!text-inherit'
  const bgClassName = '!bg-transparent'
  const buttonBgClassName =
    'bg-chalkboard-transparent dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 pressed:!bg-primary pressed:enabled:hover:!text-chalkboard-10'
  const buttonBorderClassName =
    '!border-transparent hover:!border-chalkboard-20 dark:enabled:hover:!border-primary pressed:!border-primary ui-open:!border-primary'

  const sketchPathId = useMemo(() => {
    if (!isSingleCursorInPipe(context.selectionRanges, kclManager.ast)) {
      return false
    }
    return isCursorInSketchCommandRange(
      engineCommandManager.artifactGraph,
      context.selectionRanges
    )
  }, [engineCommandManager.artifactGraph, context.selectionRanges])

  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const { overallState, immediateState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  const disableAllButtons =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  const currentMode =
    (Object.entries(toolbarConfig).find(([_, mode]) =>
      mode.check(state)
    )?.[0] as ToolbarModeName) || 'modeling'

  /** These are the props that will be passed to the callbacks in the toolbar config
   * They are memoized to prevent unnecessary re-renders,
   * but they still get a lot of churn from the state machine
   * so I think there's a lot of room for improvement here
   */
  const configCallbackProps: ToolbarItemCallbackProps = useMemo(
    () => ({
      modelingState: state,
      modelingSend: send,
      commandBarSend,
      sketchPathId,
    }),
    [state, send, commandBarSend, sketchPathId]
  )

  /**
   * Resolve all the callbacks and values for the current mode,
   * so we don't need to worry about the other modes
   */
  const currentModeItems: (
    | ToolbarItemResolved
    | ToolbarItemResolved[]
    | 'break'
  )[] = useMemo(() => {
    return toolbarConfig[currentMode].items.map((maybeIconConfig) => {
      if (maybeIconConfig === 'break') {
        return 'break'
      } else if (Array.isArray(maybeIconConfig)) {
        return maybeIconConfig.map(resolveItemConfig)
      } else {
        return resolveItemConfig(maybeIconConfig)
      }
    })

    function resolveItemConfig(
      maybeIconConfig: ToolbarItem
    ): ToolbarItemResolved {
      const isDisabled =
        disableAllButtons ||
        maybeIconConfig.status !== 'available' ||
        maybeIconConfig.disabled?.(state) === true

      return {
        ...maybeIconConfig,
        title:
          typeof maybeIconConfig.title === 'string'
            ? maybeIconConfig.title
            : maybeIconConfig.title(configCallbackProps),
        description: maybeIconConfig.description,
        links: maybeIconConfig.links || [],
        isActive: maybeIconConfig.isActive?.(state),
        hotkey:
          typeof maybeIconConfig.hotkey === 'string'
            ? maybeIconConfig.hotkey
            : maybeIconConfig.hotkey?.(state),
        disabled: isDisabled,
        disabledReason:
          typeof maybeIconConfig.disabledReason === 'function'
            ? maybeIconConfig.disabledReason(state)
            : maybeIconConfig.disabledReason,
        disableHotkey: maybeIconConfig.disableHotkey?.(state),
        status: maybeIconConfig.status,
      }
    }
  }, [currentMode, disableAllButtons, configCallbackProps])

  return (
    <menu className="max-w-full whitespace-nowrap rounded-b px-2 py-1 bg-chalkboard-10 dark:bg-chalkboard-90 relative border border-chalkboard-30 dark:border-chalkboard-80 border-t-0 shadow-sm">
      <ul
        {...props}
        ref={toolbarButtonsRef}
        className={
          'has-[[aria-expanded=true]]:!pointer-events-none m-0 py-1 rounded-l-sm flex gap-1.5 items-center ' +
          className
        }
      >
        {/* A menu item will either be a vertical line break, a button with a dropdown, or a single button */}
        {currentModeItems.map((maybeIconConfig, i) => {
          if (maybeIconConfig === 'break') {
            return (
              <div
                key={'break-' + i}
                className="h-5 w-[1px] block bg-chalkboard-30 dark:bg-chalkboard-80"
              />
            )
          } else if (Array.isArray(maybeIconConfig)) {
            return (
              <ActionButtonDropdown
                Element="button"
                key={maybeIconConfig[0].id}
                data-testid={maybeIconConfig[0].id + '-dropdown'}
                id={maybeIconConfig[0].id + '-dropdown'}
                name={maybeIconConfig[0].title}
                className={
                  'group/wrapper ' +
                  buttonBorderClassName +
                  ' !bg-transparent relative group !gap-0'
                }
                splitMenuItems={maybeIconConfig.map((itemConfig) => ({
                  id: itemConfig.id,
                  label: itemConfig.title,
                  hotkey: itemConfig.hotkey,
                  onClick: () => itemConfig.onClick(configCallbackProps),
                  disabled:
                    disableAllButtons ||
                    itemConfig.status !== 'available' ||
                    itemConfig.disabled === true,
                  status: itemConfig.status,
                }))}
              >
                <ActionButton
                  Element="button"
                  id={maybeIconConfig[0].id}
                  data-testid={maybeIconConfig[0].id}
                  iconStart={{
                    icon: maybeIconConfig[0].icon,
                    className: iconClassName,
                    bgClassName: bgClassName,
                  }}
                  className={
                    '!border-transparent !px-0 pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 ' +
                    buttonBgClassName
                  }
                  aria-pressed={maybeIconConfig[0].isActive}
                  disabled={
                    disableAllButtons ||
                    maybeIconConfig[0].status !== 'available' ||
                    maybeIconConfig[0].disabled
                  }
                  name={maybeIconConfig[0].title}
                  // aria-description is still in ARIA 1.3 draft.
                  // eslint-disable-next-line jsx-a11y/aria-props
                  aria-description={maybeIconConfig[0].description}
                  onClick={() =>
                    maybeIconConfig[0].onClick(configCallbackProps)
                  }
                >
                  <span
                    className={!maybeIconConfig[0].showTitle ? 'sr-only' : ''}
                  >
                    {maybeIconConfig[0].title}
                  </span>
                </ActionButton>
                <ToolbarItemTooltip
                  itemConfig={maybeIconConfig[0]}
                  configCallbackProps={configCallbackProps}
                />
              </ActionButtonDropdown>
            )
          }
          const itemConfig = maybeIconConfig

          return (
            <div className="relative" key={itemConfig.id}>
              <ActionButton
                Element="button"
                key={itemConfig.id}
                id={itemConfig.id}
                data-testid={itemConfig.id}
                iconStart={{
                  icon: itemConfig.icon,
                  className: iconClassName,
                  bgClassName: bgClassName,
                }}
                className={
                  'pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 ' +
                  buttonBorderClassName +
                  ' ' +
                  buttonBgClassName +
                  (!itemConfig.showTitle ? ' !px-0' : '')
                }
                name={itemConfig.title}
                // aria-description is still in ARIA 1.3 draft.
                // eslint-disable-next-line jsx-a11y/aria-props
                aria-description={itemConfig.description}
                aria-pressed={itemConfig.isActive}
                disabled={
                  disableAllButtons ||
                  itemConfig.status !== 'available' ||
                  itemConfig.disabled
                }
                onClick={() => itemConfig.onClick(configCallbackProps)}
              >
                <span className={!itemConfig.showTitle ? 'sr-only' : ''}>
                  {itemConfig.title}
                </span>
              </ActionButton>
              <ToolbarItemTooltip
                itemConfig={itemConfig}
                configCallbackProps={configCallbackProps}
              />
            </div>
          )
        })}
      </ul>
      {state.matches('Sketch no face') && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
          <p className="text-xs">Select a plane or face to start sketching</p>
        </div>
      )}
    </menu>
  )
}

/**
 * The single button and dropdown button share content, so we extract it here
 * It contains a tooltip with the title, description, and links
 * and a hotkey listener
 */
const ToolbarItemTooltip = memo(function ToolbarItemContents({
  itemConfig,
  configCallbackProps,
}: {
  itemConfig: ToolbarItemResolved
  configCallbackProps: ToolbarItemCallbackProps
}) {
  const { state } = useModelingContext()

  useHotkeys(
    itemConfig.hotkey || '',
    () => {
      itemConfig.onClick(configCallbackProps)
    },
    {
      enabled:
        itemConfig.status === 'available' &&
        !!itemConfig.hotkey &&
        !itemConfig.disabled &&
        !itemConfig.disableHotkey,
    }
  )

  return (
    <Tooltip
      inert={false}
      wrapperStyle={
        isDesktop()
          ? ({ '-webkit-app-region': 'no-drag' } as React.CSSProperties)
          : {}
      }
      position="bottom"
      wrapperClassName="!p-4 !pointer-events-auto"
      contentClassName="!text-left text-wrap !text-xs !p-0 !pb-2 flex gap-2 !max-w-none !w-72 flex-col items-stretch"
    >
      <div className="rounded-top flex items-center gap-2 pt-3 pb-2 px-2 bg-chalkboard-20/50 dark:bg-chalkboard-80/50">
        <span
          className={`text-sm flex-1 ${
            itemConfig.status !== 'available'
              ? 'text-chalkboard-70 dark:text-chalkboard-40'
              : ''
          }`}
        >
          {itemConfig.title}
        </span>
        {itemConfig.status === 'available' && itemConfig.hotkey ? (
          <kbd className="flex-none hotkey">{itemConfig.hotkey}</kbd>
        ) : itemConfig.status === 'kcl-only' ? (
          <>
            <span className="text-wrap font-sans flex-0 text-chalkboard-70 dark:text-chalkboard-40">
              KCL code only
            </span>
            <CustomIcon
              name="code"
              className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
            />
          </>
        ) : (
          itemConfig.status === 'unavailable' && (
            <>
              <span className="text-wrap font-sans flex-0 text-chalkboard-70 dark:text-chalkboard-40">
                In development
              </span>
              <CustomIcon
                name="lockClosed"
                className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          )
        )}
      </div>
      <p className="px-2 text-ch font-sans">{itemConfig.description}</p>
      {/* Add disabled reason if item is disabled */}
      {itemConfig.disabled && itemConfig.disabledReason && (
        <>
          <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
          <p className="px-2 text-ch font-sans text-chalkboard-70 dark:text-chalkboard-40">
            {typeof itemConfig.disabledReason === 'function'
              ? itemConfig.disabledReason(state)
              : itemConfig.disabledReason}
          </p>
        </>
      )}
      {itemConfig.links.length > 0 && (
        <>
          <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
          <ul className="p-0 px-1 m-0 flex flex-col">
            {itemConfig.links.map((link) => (
              <li key={link.label} className="contents">
                <a
                  href={link.url}
                  onClick={openExternalBrowserIfDesktop(link.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center rounded-sm p-1 no-underline text-inherit hover:bg-primary/10 hover:text-primary dark:hover:bg-chalkboard-70 dark:hover:text-inherit"
                >
                  <span className="flex-1">Open {link.label}</span>
                  <CustomIcon name="link" className="w-4 h-4" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tooltip>
  )
})
