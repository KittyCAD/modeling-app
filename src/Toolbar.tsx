import { useRef, useMemo } from 'react'
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
import {
  canRectangleTool,
  isEditingExistingSketch,
} from 'machines/modelingMachine'
import { CustomIcon } from 'components/CustomIcon'
import { toolbarConfig, ToolbarItem, ToolbarModeName } from 'lib/toolbar'

export function Toolbar({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { state, send, context } = useModelingContext()
  const { commandBarSend } = useCommandsContext()
  const iconClassName =
    'group-disabled:text-chalkboard-50 group-enabled:group-hover:!text-primary dark:group-enabled:group-hover:!text-inherit group-pressed:!text-chalkboard-10 group-ui-open:!text-chalkboard-10 dark:group-ui-open:!text-chalkboard-10'
  const bgClassName = '!bg-transparent'
  const buttonClassName =
    'bg-chalkboard-transparent dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 !border-transparent hover:!border-chalkboard-20 dark:enabled:hover:!border-primary pressed:!border-primary pressed:!bg-primary ui-open:!border-primary ui-open:!bg-primary'
  const pathId = useMemo(() => {
    if (!isSingleCursorInPipe(context.selectionRanges, kclManager.ast)) {
      return false
    }
    return isCursorInSketchCommandRange(
      engineCommandManager.artifactMap,
      context.selectionRanges
    )
  }, [engineCommandManager.artifactMap, context.selectionRanges])

  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const { overallState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  const disableAllButtons =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    !isStreamReady

  const currentMode =
    (Object.entries(toolbarConfig).find(([modeName, mode]) =>
      mode.check(state)
    )?.[0] as ToolbarModeName) || 'modeling'

  return (
    <menu className="max-w-full whitespace-nowrap rounded-b px-2 py-1 bg-chalkboard-10 dark:bg-chalkboard-90 relative border border-chalkboard-20 dark:border-chalkboard-80 border-t-0 shadow-sm">
      <ul
        {...props}
        ref={toolbarButtonsRef}
        className={'m-0 py-1 rounded-l-sm flex gap-2 items-center ' + className}
      >
        {toolbarConfig[currentMode].items.map((maybeIconConfig, i) => {
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
                className={'group !gap-0 ' + buttonClassName}
                iconStart={{
                  icon: maybeIconConfig[0].icon,
                  className: iconClassName,
                  bgClassName: bgClassName,
                }}
                splitMenuItems={maybeIconConfig.map((itemConfig) => ({
                  label: itemConfig.title,
                  shortcut: itemConfig.shortcut,
                  onClick: () =>
                    itemConfig.onClick({
                      modelingState: state,
                      modelingSend: send,
                      commandBarSend,
                    }),
                  disabled:
                    disableAllButtons || itemConfig.status !== 'available',
                }))}
              >
                <ToolbarItemContents {...maybeIconConfig[0]} />
              </ActionButtonDropdown>
            )
          }
          const itemConfig = maybeIconConfig

          return (
            <ActionButton
              Element="button"
              key={itemConfig.id}
              id={itemConfig.id}
              iconStart={{
                icon: itemConfig.icon,
                className: iconClassName,
                bgClassName: bgClassName,
              }}
              className={
                'group ' +
                buttonClassName +
                (!itemConfig.showTitle ? ' !px-0' : '')
              }
              aria-pressed={itemConfig.isActive?.(state)}
              disabled={disableAllButtons || itemConfig.status !== 'available'}
              onClick={() =>
                itemConfig.onClick({
                  modelingState: state,
                  modelingSend: send,
                  commandBarSend,
                })
              }
            >
              <ToolbarItemContents {...itemConfig} />
            </ActionButton>
          )
        })}
      </ul>
    </menu>
  )
}

function ToolbarItemContents(itemConfig: ToolbarItem) {
  const { state, send } = useModelingContext()
  const { commandBarSend } = useCommandsContext()
  useHotkeys(
    itemConfig.shortcut || '',
    () => {
      itemConfig.onClick({
        modelingState: state,
        modelingSend: send,
        commandBarSend,
      })
    },
    {
      enabled:
        itemConfig.status === 'available' &&
        !!itemConfig.shortcut &&
        itemConfig.disabled?.(state) !== true,
    }
  )

  return (
    <>
      {itemConfig.showTitle && <span>{itemConfig.title}</span>}
      <Tooltip
        position="bottom"
        wrapperClassName="p-4 !pointer-events-auto"
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
          {itemConfig.status === 'available' && itemConfig.shortcut ? (
            <kbd className="flex-none hotkey">{itemConfig.shortcut}</kbd>
          ) : itemConfig.status === 'kcl-only' ? (
            <>
              <span className="text-wrap flex-0 text-chalkboard-70 dark:text-chalkboard-40">
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
                <span className="text-wrap flex-0 text-chalkboard-70 dark:text-chalkboard-40">
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
        <p className="px-2 text-ch">{itemConfig.description}</p>
        {itemConfig.links.length > 0 && (
          <>
            <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
            <ul className="p-0 m-0 flex flex-col">
              {itemConfig.links.map((link) => (
                <li key={link.label} className="contents">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center px-2 py-1 no-underline text-inherit hover:bg-primary/10 hover:text-primary dark:hover:bg-chalkboard-70 dark:hover:text-inherit"
                    onClickCapture={(e) =>
                      e.nativeEvent.stopImmediatePropagation()
                    }
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
    </>
  )
}
