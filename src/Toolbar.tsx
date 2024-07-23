import { WheelEvent, useRef, useMemo } from 'react'
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
  modelingMachine,
} from 'machines/modelingMachine'
import { DEV } from 'env'
import { EventFrom, StateFrom } from 'xstate'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { commandBarMachine } from 'machines/commandBarMachine'

type ToolbarModeName = 'modeling' | 'sketching'
type ToolbarMode = {
  check: (state: StateFrom<typeof modelingMachine>) => boolean
  items: (ToolbarItem | ToolbarItem[] | 'break')[]
}

interface ToolbarItemClickProps {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  commandBarSend: (event: EventFrom<typeof commandBarMachine>) => void
}

type ToolbarItem = {
  id: string
  onClick: (props: ToolbarItemClickProps) => void
  icon: CustomIconName
  status: 'available' | 'unavailable' | 'kcl-only'
  title: string
  showTitle?: boolean
  shortcut?: string
  description: string
  links: { label: string; url: string }[]
  isActive?: (state: StateFrom<typeof modelingMachine>) => boolean
}

const toolbarConfig: Record<ToolbarModeName, ToolbarMode> = {
  modeling: {
    check: (state) => !state.matches('Sketch'),
    items: [
      {
        id: 'sketch',
        onClick: ({ modelingSend }) => modelingSend({ type: 'Enter sketch' }),
        icon: 'sketch',
        status: 'available',
        title: 'Sketch',
        showTitle: true,
        shortcut: 'Shift + S',
        description: 'Start drawing a 2D sketch',
        links: [
          { label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/startSketchOn' },
        ],
      },
      'break',
      {
        id: 'extrude',
        onClick: ({ commandBarSend }) =>
          commandBarSend({
            type: 'Find and select command',
            data: { name: 'Extrude', groupId: 'modeling' },
          }),
        icon: 'extrude',
        status: 'available',
        title: 'Extrude',
        shortcut: 'Shift + E',
        description: 'Pull a sketch into 3D along its normal or perpendicular.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/extrude' }],
      },
      [
        {
          id: 'boolean-union',
          onClick: () => console.error('Boolean union not yet implemented'),
          icon: 'booleanUnion',
          status: 'unavailable',
          title: 'Union',
          shortcut: 'Shift + B U',
          description: 'Combine two or more solids into a single solid.',
          links: [
            {
              label: 'GitHub discussion',
              url: 'https://github.com/KittyCAD/modeling-app/discussions/509',
            },
          ],
        },
        {
          id: 'boolean-subtract',
          onClick: () => console.error('Boolean subtract not yet implemented'),
          icon: 'booleanSubtract',
          status: 'unavailable',
          title: 'Subtract',
          shortcut: 'Shift + B S',
          description: 'Subtract one solid from another.',
          links: [
            {
              label: 'GitHub discussion',
              url: 'https://github.com/KittyCAD/modeling-app/discussions/510',
            },
          ],
        },
        {
          id: 'boolean-intersect',
          onClick: () => console.error('Boolean intersect not yet implemented'),
          icon: 'booleanIntersect',
          status: 'unavailable',
          title: 'Intersect',
          shortcut: 'Shift + B I',
          description: 'Create a solid from the intersection of two solids.',
          links: [
            {
              label: 'GitHub discussion',
              url: 'https://github.com/KittyCAD/modeling-app/discussions/511',
            },
          ],
        },
      ],
    ],
  },
  sketching: {
    check: (state) => state.matches('Sketch'),
    items: [
      {
        id: 'exit',
        onClick: ({ modelingSend }) => modelingSend({ type: 'Cancel' }),
        icon: 'arrowLeft',
        status: 'available',
        title: 'Exit sketch',
        showTitle: true,
        shortcut: 'Esc',
        description: 'Exit the current sketch',
        links: [],
      },
      {
        id: 'line',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Line tool')
                ? 'line'
                : 'none',
            },
          }),
        icon: 'line',
        status: 'available',
        title: 'Line',
        shortcut: 'L',
        description: 'Start drawing straight lines',
        links: [],
        isActive: (state) => state.matches('Sketch.Line tool'),
      },
      {
        id: 'tangential-arc',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Tangential arc to')
                ? 'tangentialArc'
                : 'none',
            },
          }),
        icon: 'arc',
        status: 'available',
        title: 'Tangential Arc',
        shortcut: 'A',
        description: 'Start drawing an arc tangent to the current segment',
        links: [],
        isActive: (state) => state.matches('Sketch.Tangential arc to'),
      },
      {
        id: 'rectangle',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Rectangle tool')
                ? 'rectangle'
                : 'none',
            },
          }),
        icon: 'rectangle',
        status: 'available',
        title: 'Rectangle',
        shortcut: 'R',
        description: 'Start drawing a rectangle',
        links: [],
        isActive: (state) => state.matches('Sketch.Rectangle tool'),
      },
    ],
  },
}

export function Toolbar({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { state, send, context } = useModelingContext()
  const { commandBarSend } = useCommandsContext()
  const iconClassName =
    'group-disabled:text-chalkboard-50 group-enabled:group-hover:!text-primary dark:group-enabled:group-hover:!text-inherit group-pressed:!text-chalkboard-10 group-ui-open:!text-chalkboard-10 dark:group-ui-open:!text-chalkboard-10'
  const bgClassName =
    'group-disabled:!bg-transparent group-enabled:bg-transparent group-enabled:group-hover:bg-primary/10 dark:group-enabled:group-hover:bg-primary/50 group-pressed:!bg-primary group-ui-open:bg-primary'
  const buttonClassName =
    'bg-chalkboard-10 dark:bg-chalkboard-100 disabled:bg-transparent enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 !border-transparent hover:!border-chalkboard-20 dark:enabled:hover:!border-primary pressed:!border-primary ui-open:!border-primary'
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

  const currentMode = useMemo(() => {
    return (
      (Object.entries(toolbarConfig).find(([modeName, mode]) =>
        mode.check(state)
      )?.[0] as ToolbarModeName) || 'modeling'
    )
  }, [state])

  const disableLineButton =
    state.matches('Sketch.Rectangle tool.Awaiting second corner') ||
    disableAllButtons
  useHotkeys(
    'l',
    () =>
      state.matches('Sketch.Line tool')
        ? send('CancelSketch')
        : send({
            type: 'change tool',
            data: { tool: 'line' },
          }),
    { enabled: !disableLineButton, scopes: ['sketch'] }
  )
  const disableTangentialArc =
    (!isEditingExistingSketch(context) &&
      !state.matches('Sketch.Tangential arc to')) ||
    disableAllButtons
  useHotkeys(
    'a',
    () =>
      state.matches('Sketch.Tangential arc to')
        ? send('CancelSketch')
        : send({
            type: 'change tool',
            data: { tool: 'tangentialArc' },
          }),
    { enabled: !disableTangentialArc, scopes: ['sketch'] }
  )
  const disableRectangle =
    (!canRectangleTool(context) && !state.matches('Sketch.Rectangle tool')) ||
    disableAllButtons
  useHotkeys(
    'r',
    () =>
      state.matches('Sketch.Rectangle tool')
        ? send('CancelSketch')
        : send({
            type: 'change tool',
            data: { tool: 'rectangle' },
          }),
    { enabled: !disableRectangle, scopes: ['sketch'] }
  )
  useHotkeys(
    's',
    () =>
      state.nextEvents.includes('Enter sketch') && pathId
        ? send({ type: 'Enter sketch' })
        : send({ type: 'Enter sketch', data: { forceNewSketch: true } }),
    { enabled: !disableAllButtons, scopes: ['modeling'] }
  )
  useHotkeys(
    'esc',
    () =>
      ['Sketch no face', 'Sketch.SketchIdle'].some(state.matches)
        ? send('Cancel')
        : send('CancelSketch'),
    { enabled: !disableAllButtons, scopes: ['sketch'] }
  )
  useHotkeys(
    'e',
    () =>
      commandBarSend({
        type: 'Find and select command',
        data: { name: 'Extrude', groupId: 'modeling' },
      }),
    { enabled: !disableAllButtons, scopes: ['modeling'] }
  )
  const disableFillet = !state.can('Fillet') || disableAllButtons
  useHotkeys(
    'f',
    () =>
      commandBarSend({
        type: 'Find and select command',
        data: { name: 'Fillet', groupId: 'modeling' },
      }),
    { enabled: !disableFillet, scopes: ['modeling'] }
  )

  return (
    <menu className="max-w-full whitespace-nowrap rounded-b px-2 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 relative border border-chalkboard-20 dark:border-chalkboard-90 border-t-0 shadow-sm">
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
                disabled={
                  disableAllButtons ||
                  maybeIconConfig.every((item) => item.status !== 'available')
                }
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
              disabled={disableAllButtons}
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
  return (
    <>
      {itemConfig.showTitle && <span>{itemConfig.title}</span>}
      <Tooltip
        position="bottom"
        wrapperClassName="p-4 !pointer-events-auto"
        contentClassName="!text-left text-wrap !text-xs !p-0 !pb-2 flex gap-2 !max-w-none !w-56 flex-col items-stretch"
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
              <span className="text-chalkboard-70 dark:text-chalkboard-40">
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
                <span className="text-chalkboard-70 dark:text-chalkboard-40">
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
                    <span className="flex-1">{link.label}</span>
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
