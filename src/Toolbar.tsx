import { memo, use, useCallback, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useAppState } from '@src/AppState'
import { ActionButton } from '@src/components/ActionButton'
import { ActionButtonDropdown } from '@src/components/ActionButtonDropdown'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { isCursorInFunctionDefinition } from '@src/lang/queryAst'
import { isCursorInSketchCommandRange } from '@src/lang/util'
import { filterEscHotkey } from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { kclManager, commandBarActor } from '@src/lib/singletons'
import type {
  ToolbarDropdown,
  ToolbarItem,
  ToolbarItemCallbackProps,
  ToolbarItemResolved,
  ToolbarItemResolvedDropdown,
  ToolbarModeName,
} from '@src/lib/toolbar'
import { isToolbarItemResolvedDropdown, toolbarConfig } from '@src/lib/toolbar'
import { EngineConnectionStateType } from '@src/network/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type ToolbarProps = Omit<ReturnType<typeof useModelingContext>, 'theProject'> &
  Pick<
    ReturnType<typeof useNetworkContext>,
    'overallState' | 'immediateState'
  > &
  Pick<
    ReturnType<typeof useAppState>,
    'isStreamReady' | 'isStreamAcceptingInput'
  >

const Toolbar_ = memo(
  (props: ToolbarProps) => {
    const wasmInstance = use(kclManager.wasmInstancePromise)
    const iconClassName =
      'group-disabled:text-chalkboard-50 !text-inherit dark:group-enabled:group-hover:!text-inherit'
    const bgClassName = '!bg-transparent'
    const buttonBgClassName =
      'bg-chalkboard-transparent dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 pressed:!bg-primary pressed:enabled:hover:!text-chalkboard-10'
    const buttonBorderClassName = '!border-transparent'

    const isInTemporaryWorkspace = kclManager.isBufferMode

    const onClickSave = () => {
      kclManager.exitFromTemporaryWorkspaceMode()
    }

    const sketchPathId = useMemo(() => {
      if (
        isCursorInFunctionDefinition(
          kclManager.ast,
          props.context.selectionRanges.graphSelections[0],
          wasmInstance
        )
      )
        return false
      return isCursorInSketchCommandRange(
        kclManager.artifactGraph,
        props.context.selectionRanges
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [kclManager.artifactGraph, props.context.selectionRanges])

    const toolbarButtonsRef = useRef<HTMLUListElement>(null)
    const [showRichContent, setShowRichContent] = useState(false)

    const disableAllButtons =
      (props.overallState !== NetworkHealthState.Ok &&
        props.overallState !== NetworkHealthState.Weak) ||
      kclManager.isExecutingSignal.value ||
      props.immediateState.type !==
        EngineConnectionStateType.ConnectionEstablished ||
      !props.isStreamReady ||
      !props.isStreamAcceptingInput

    const currentMode =
      (Object.entries(toolbarConfig).find(([_, mode]) =>
        mode.check(props.state)
      )?.[0] as ToolbarModeName) || 'modeling'

    /** These are the props that will be passed to the callbacks in the toolbar config
     * They are memoized to prevent unnecessary re-renders,
     * but they still get a lot of churn from the state machine
     * so I think there's a lot of room for improvement here
     */
    const configCallbackProps: ToolbarItemCallbackProps = useMemo(
      () => ({
        modelingState: props.state,
        modelingSend: props.send,
        sketchPathId,
        editorHasFocus: kclManager.getEditorView()?.hasFocus,
        isActive: false, // Default value - individual items will override this
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
      [
        props.state,
        props.send,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- TODO: blanket-ignored fix me!
        commandBarActor.send,
        sketchPathId,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        kclManager.getEditorView()?.hasFocus,
      ]
    )

    const tooltipContentClassName = !showRichContent
      ? ''
      : '!text-left text-wrap !text-xs !p-0 !pb-2 flex !max-w-none !w-72 flex-col items-stretch'
    const richContentTimeout = useRef<number | null>(null)
    const richContentClearTimeout = useRef<number | null>(null)
    // On mouse enter, show rich content after a 1s delay
    const handleMouseEnter = useCallback(() => {
      // Cancel the clear timeout if it's already set
      if (richContentClearTimeout.current) {
        clearTimeout(richContentClearTimeout.current)
      }
      // Start our own timeout to show the rich content
      richContentTimeout.current = window.setTimeout(() => {
        setShowRichContent(true)
        if (richContentClearTimeout.current) {
          clearTimeout(richContentClearTimeout.current)
        }
      }, 1000)
    }, [setShowRichContent])
    // On mouse leave, clear the timeout and hide rich content
    const handleMouseLeave = useCallback(() => {
      // Clear the timeout to show rich content
      if (richContentTimeout.current) {
        clearTimeout(richContentTimeout.current)
      }
      // Start a timeout to hide the rich content
      richContentClearTimeout.current = window.setTimeout(() => {
        setShowRichContent(false)
        if (richContentClearTimeout.current) {
          clearTimeout(richContentClearTimeout.current)
        }
      }, 500)
    }, [setShowRichContent])

    /**
     * Resolve all the callbacks and values for the current mode,
     * so we don't need to worry about the other modes
     */
    const currentModeItems: (
      | ToolbarItemResolved
      | ToolbarItemResolvedDropdown
      | 'break'
    )[] = useMemo(() => {
      return toolbarConfig[currentMode].items.map((maybeIconConfig) => {
        if (maybeIconConfig === 'break') {
          return 'break'
        } else if (isToolbarDropdown(maybeIconConfig)) {
          return {
            id: maybeIconConfig.id,
            array: maybeIconConfig.array.map((item) =>
              resolveItemConfig(item, wasmInstance)
            ),
          }
        } else {
          return resolveItemConfig(maybeIconConfig, wasmInstance)
        }
      })

      function resolveItemConfig(
        maybeIconConfig: ToolbarItem,
        wasmInstance: ModuleType
      ): ToolbarItemResolved {
        const isConfiguredAvailable = ['available', 'experimental'].includes(
          maybeIconConfig.status
        )
        const isDisabled =
          disableAllButtons ||
          !isConfiguredAvailable ||
          maybeIconConfig.disabled?.(props.state, wasmInstance) === true

        // Calculate the isActive state for this specific item
        const itemIsActive = maybeIconConfig.isActive?.(props.state) || false

        // Create item-specific callback props with the correct isActive value
        const itemCallbackProps = {
          ...configCallbackProps,
          isActive: itemIsActive,
        }

        return {
          ...maybeIconConfig,
          title:
            typeof maybeIconConfig.title === 'string'
              ? maybeIconConfig.title
              : maybeIconConfig.title(itemCallbackProps),
          description: maybeIconConfig.description,
          links: maybeIconConfig.links || [],
          isActive: itemIsActive,
          hotkey:
            typeof maybeIconConfig.hotkey === 'string'
              ? maybeIconConfig.hotkey
              : maybeIconConfig.hotkey?.(props.state),
          disabled: isDisabled,
          disabledReason:
            typeof maybeIconConfig.disabledReason === 'function'
              ? maybeIconConfig.disabledReason(props.state)
              : maybeIconConfig.disabledReason,
          disableHotkey: maybeIconConfig.disableHotkey?.(props.state),
          status: maybeIconConfig.status,
          // Store the item-specific callback props for use in onClick handlers
          callbackProps: itemCallbackProps,
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [currentMode, disableAllButtons, configCallbackProps, wasmInstance])

    // To remember the last selected item in an ActionButtonDropdown
    const [lastSelectedMultiActionItem, _] = useState(
      new Map<
        number /* index in currentModeItems */,
        number /* index in maybeIconConfig */
      >()
    )

    return (
      <menu
        data-current-mode={currentMode}
        data-onboarding-id="toolbar"
        className="z-[19] max-w-full whitespace-nowrap rounded-b px-2 py-1 mx-auto bg-chalkboard-10 dark:bg-chalkboard-90 relative border border-chalkboard-30 dark:border-chalkboard-80 border-t-0 shadow-sm"
      >
        <ul
          ref={toolbarButtonsRef}
          className={
            'has-[[aria-expanded=true]]:!pointer-events-none m-0 py-1 rounded-l-sm flex gap-1.5 items-center '
          }
        >
          {/* A menu item will either be a vertical line break, a button with a dropdown, or a single button */}
          {currentModeItems.map((maybeIconConfig, i) => {
            // Vertical Line Break
            if (maybeIconConfig === 'break') {
              return (
                <div
                  key={'break-' + i}
                  className="h-5 w-[1px] block bg-chalkboard-30 dark:bg-chalkboard-80"
                />
              )
            } else if (isToolbarItemResolvedDropdown(maybeIconConfig)) {
              // A button with a dropdown
              const selectedIcon =
                maybeIconConfig.array.find((c) => c.isActive) ||
                maybeIconConfig.array[lastSelectedMultiActionItem.get(i) ?? 0]

              // Save the last selected item in the dropdown
              lastSelectedMultiActionItem.set(
                i,
                maybeIconConfig.array.indexOf(selectedIcon)
              )
              return (
                <ActionButtonDropdown
                  Element="button"
                  key={selectedIcon.id}
                  data-testid={selectedIcon.id + '-dropdown'}
                  data-onboarding-id={selectedIcon.id + '-dropdown'}
                  id={selectedIcon.id + '-dropdown'}
                  name={maybeIconConfig.id}
                  className={
                    (maybeIconConfig.array[0].alwaysDark
                      ? 'dark bg-chalkboard-90 '
                      : '!bg-transparent ') +
                    'group/wrapper ' +
                    buttonBorderClassName +
                    ' relative group !gap-0'
                  }
                  splitMenuItems={maybeIconConfig.array.map((itemConfig) => ({
                    id: itemConfig.id,
                    label: itemConfig.title,
                    hotkey: itemConfig.hotkey,
                    onClick: () => itemConfig.onClick(itemConfig.callbackProps),
                    disabled:
                      disableAllButtons ||
                      !['available', 'experimental'].includes(
                        itemConfig.status
                      ) ||
                      itemConfig.disabled === true ||
                      itemConfig.disableHotkey === true,
                    status: itemConfig.status,
                  }))}
                >
                  <div
                    className="contents"
                    // Mouse events do not fire on disabled buttons
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    <ActionButton
                      Element="button"
                      id={selectedIcon.id}
                      data-testid={selectedIcon.id}
                      data-onboarding-id={selectedIcon.id}
                      iconStart={{
                        icon: selectedIcon.icon,
                        iconColor: selectedIcon.iconColor,
                        className: iconClassName,
                        bgClassName: bgClassName,
                      }}
                      className={
                        '!border-transparent !px-0 pressed:!text-chalkboard-10 pressed:enabled:hovered:!text-chalkboard-10 ' +
                        buttonBgClassName
                      }
                      aria-pressed={selectedIcon.isActive}
                      disabled={
                        disableAllButtons ||
                        !['available', 'experimental'].includes(
                          selectedIcon.status
                        ) ||
                        selectedIcon.disabled
                      }
                      name={selectedIcon.title}
                      // aria-description is still in ARIA 1.3 draft.
                      // eslint-disable-next-line jsx-a11y/aria-props
                      aria-description={selectedIcon.description}
                      onClick={() =>
                        selectedIcon.onClick(selectedIcon.callbackProps)
                      }
                    >
                      <span
                        className={!selectedIcon.showTitle ? 'sr-only' : ''}
                      >
                        {selectedIcon.title}
                      </span>
                      <ToolbarItemTooltip
                        itemConfig={selectedIcon}
                        configCallbackProps={configCallbackProps}
                        wrapperClassName="ui-open:!hidden"
                        contentClassName={tooltipContentClassName}
                      >
                        {showRichContent ? (
                          <ToolbarItemTooltipRichContent
                            itemConfig={selectedIcon}
                            state={props.state}
                          />
                        ) : (
                          <ToolbarItemTooltipShortContent
                            status={selectedIcon.status}
                            title={selectedIcon.title}
                            hotkey={selectedIcon.hotkey}
                          />
                        )}
                      </ToolbarItemTooltip>
                    </ActionButton>
                  </div>
                </ActionButtonDropdown>
              )
            }
            const itemConfig = maybeIconConfig

            // A single button
            return (
              <div
                className={`relative ${itemConfig.alwaysDark ? ' dark bg-chalkboard-90 ' : ''}`}
                key={itemConfig.id}
                // Mouse events do not fire on disabled buttons
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <ActionButton
                  Element="button"
                  key={itemConfig.id}
                  id={itemConfig.id}
                  data-testid={itemConfig.id}
                  data-onboarding-id={itemConfig.id}
                  iconStart={{
                    icon: itemConfig.icon,
                    iconColor: itemConfig.iconColor,
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
                    !['available', 'experimental'].includes(
                      itemConfig.status
                    ) ||
                    itemConfig.disabled
                  }
                  onClick={() => itemConfig.onClick(itemConfig.callbackProps)}
                >
                  <span className={!itemConfig.showTitle ? 'sr-only' : ''}>
                    {itemConfig.title}
                  </span>
                </ActionButton>
                <ToolbarItemTooltip
                  itemConfig={itemConfig}
                  configCallbackProps={configCallbackProps}
                  contentClassName={tooltipContentClassName}
                >
                  {showRichContent ? (
                    <ToolbarItemTooltipRichContent
                      itemConfig={itemConfig}
                      state={props.state}
                    />
                  ) : (
                    <ToolbarItemTooltipShortContent
                      status={itemConfig.status}
                      title={itemConfig.title}
                      hotkey={itemConfig.hotkey}
                    />
                  )}
                </ToolbarItemTooltip>
              </div>
            )
          })}
        </ul>
        <div className="flex flex-col items-center absolute top-full left-1/2 -translate-x-1/2">
          {isInTemporaryWorkspace && (
            <div className="flex flex-row gap-2 justify-center">
              <div className="mt-2 animate-pulse w-fit uppercase text-xs rounded-full ml-2 px-2 py-1 border border-chalkboard-40 dark:text-chalkboard-40 bg-chalkboard-10 dark:bg-chalkboard-90 shadow-lg flex items-center">
                Temporary workspace
              </div>
              <button
                data-testid="tws-save"
                onClick={onClickSave}
                className="mt-2 py-1 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-90 px-2"
              >
                Save
              </button>
            </div>
          )}
          {props.state.matches('Sketch no face') && (
            <div className="mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
              <p className="text-xs">
                Select a plane or face to start sketching
              </p>
            </div>
          )}
          {props.state.matches('sketchSolveMode') && (
            <div className="mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
              <p className="text-xs">
                Sketch mode revamp, expect bugs, disable again in settings if
                you want normal sketch mode
              </p>
            </div>
          )}
        </div>
      </menu>
    )
  },
  (oldP, newP) =>
    oldP.state.value === newP.state.value &&
    oldP.overallState === newP.overallState &&
    oldP.immediateState?.type === newP.immediateState?.type &&
    oldP.isStreamReady === newP.isStreamReady &&
    oldP.isStreamAcceptingInput === newP.isStreamAcceptingInput &&
    oldP.context?.currentMode === newP.context?.currentMode &&
    oldP.context?.currentTool === newP.context?.currentTool
)

interface ToolbarItemContentsProps extends React.PropsWithChildren {
  itemConfig: ToolbarItemResolved
  configCallbackProps: ToolbarItemCallbackProps
  wrapperClassName?: string
  contentClassName?: string
}
/**
 * The single button and dropdown button share content, so we extract it here
 * It contains a tooltip with the title, description, and links
 * and a hotkey listener
 */
const ToolbarItemTooltip = memo(function ToolbarItemContents({
  itemConfig,
  configCallbackProps,
  wrapperClassName = '',
  contentClassName = '',
  children,
}: ToolbarItemContentsProps) {
  /**
   * GOTCHA: `useHotkeys` can only register one hotkey listener per component.
   * TODO: make a global hotkey registration system. make them editable.
   */
  useHotkeys(
    itemConfig.hotkey || '',
    () => {
      itemConfig.onClick(itemConfig.callbackProps)
    },
    {
      enabled:
        ['available', 'experimental'].includes(itemConfig.status) &&
        !!itemConfig.hotkey &&
        !itemConfig.disabled &&
        !itemConfig.disableHotkey,
    }
  )

  const onDesktop = isDesktop()
  const wrapperStyle = useMemo(
    () =>
      onDesktop
        ? // Without this, the tooltip disappears before being able to click on anything in it
          ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
        : {},
    [onDesktop]
  )

  return (
    <Tooltip
      inert={false}
      wrapperStyle={wrapperStyle}
      hoverOnly
      position="bottom"
      wrapperClassName={'!p-4 !pointer-events-auto ' + wrapperClassName}
      contentClassName={contentClassName}
    >
      {children}
    </Tooltip>
  )
})

const ToolbarItemTooltipShortContent = ({
  status,
  title,
  hotkey,
}: {
  status: string
  title: string
  hotkey?: string | string[]
}) => (
  <div
    className={`text-sm flex flex-col ${
      !['available', 'experimental'].includes(status)
        ? 'text-chalkboard-70 dark:text-chalkboard-40'
        : ''
    }`}
  >
    {status === 'experimental' && (
      <div className="text-xs flex justify-center item-center gap-1 pb-1 border-b border-chalkboard-50">
        <CustomIcon name="beaker" className="w-4 h-4" />
        <span>Experimental</span>
      </div>
    )}
    <div className={`flex gap-4 ${status === 'experimental' ? 'pt-1' : 'p-0'}`}>
      {title}
      {hotkey && (
        <kbd className="inline-block ml-2 flex-none hotkey">
          {filterEscHotkey(hotkey)}
        </kbd>
      )}
    </div>
  </div>
)

const ToolbarItemTooltipRichContent = memo(
  ({
    itemConfig,
    state,
  }: {
    itemConfig: ToolbarItemResolved
    state: ReturnType<typeof useModelingContext>['state']
  }) => {
    const shouldBeEnabled = ['available', 'experimental'].includes(
      itemConfig.status
    )
    return (
      <>
        {itemConfig.status === 'experimental' && (
          <div className="text-xs flex items-center justify-center self-stretch gap-1 p-1 border-b">
            <CustomIcon name="beaker" className="w-4 h-4" />
            <span className="block">Experimental</span>
          </div>
        )}
        <div className="rounded-top flex items-center gap-2 pt-3 pb-2 px-2 bg-chalkboard-20/50 dark:bg-chalkboard-80/50">
          {itemConfig.icon && (
            <CustomIcon
              className="w-5 h-5"
              style={{ color: itemConfig.iconColor }}
              name={itemConfig.icon}
            />
          )}
          <div
            className={`text-sm flex-1 flex flex-col gap-1 ${
              !shouldBeEnabled
                ? 'text-chalkboard-70 dark:text-chalkboard-40'
                : ''
            }`}
          >
            {itemConfig.title}
          </div>
          {shouldBeEnabled && itemConfig.hotkey ? (
            <kbd className="flex-none hotkey">
              {filterEscHotkey(itemConfig.hotkey)}
            </kbd>
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
        <p className="px-2 my-2 text-ch font-sans">{itemConfig.description}</p>
        {itemConfig.extraNote && (
          <p className="px-2 my-2 text-ch font-sans">
            <span className="font-semibold">Note: </span>
            {itemConfig.extraNote}
          </p>
        )}
        {/* Add disabled reason if item is disabled */}
        {itemConfig.disabled && itemConfig.disabledReason && (
          <>
            <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
            <p className="px-2 my-2 text-ch font-sans text-chalkboard-70 dark:text-chalkboard-40">
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
      </>
    )
  },
  (oldP, newP) =>
    oldP.state.value === newP.state.value && oldP.itemConfig === newP.itemConfig
)

// Making this toplevel Toolbar memo'd is no-op, because we use context
// inside that causes a render anyway. Instead we memo the inner.
export function Toolbar() {
  const { state, send, context } = useModelingContext()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady, isStreamAcceptingInput } = useAppState()
  return (
    <Toolbar_
      state={state}
      send={send}
      context={context}
      overallState={overallState}
      immediateState={immediateState}
      isStreamReady={isStreamReady}
      isStreamAcceptingInput={isStreamAcceptingInput}
    />
  )
}

function isToolbarDropdown(
  item: ToolbarItem | ToolbarDropdown
): item is ToolbarDropdown {
  return 'array' in item
}
