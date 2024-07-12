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
} from 'machines/modelingMachine'

export function Toolbar({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { state, send, context } = useModelingContext()
  const { commandBarSend } = useCommandsContext()
  const iconClassName =
    'group-disabled:text-chalkboard-50 group-enabled:group-hover:!text-primary dark:group-enabled:group-hover:!text-inherit group-pressed:!text-chalkboard-10 group-ui-open:!text-chalkboard-10 dark:group-ui-open:!text-chalkboard-10'
  const bgClassName =
    'group-disabled:!bg-transparent group-enabled:group-hover:bg-primary/10 dark:group-enabled:group-hover:bg-primary group-pressed:bg-primary group-ui-open:bg-primary'
  const buttonClassName =
    'bg-chalkboard-10 dark:bg-chalkboard-100 enabled:hover:bg-chalkboard-10 dark:enabled:hover:bg-chalkboard-100 pressed:!border-primary ui-open:!border-primary'
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

  function handleToolbarButtonsWheelEvent(ev: WheelEvent<HTMLSpanElement>) {
    const span = toolbarButtonsRef.current
    if (!span) {
      return
    }

    span.scrollLeft = span.scrollLeft += ev.deltaY
  }
  const nextEvents = useMemo(() => state.nextEvents, [state.nextEvents])
  const splitMenuItems = useMemo(
    () =>
      nextEvents
        .filter(
          (eventName) =>
            eventName.includes('Make segment') ||
            eventName.includes('Constrain')
        )
        .sort((a, b) => {
          const aisEnabled = nextEvents
            .filter((event) => state.can(event as any))
            .includes(a)
          const bIsEnabled = nextEvents
            .filter((event) => state.can(event as any))
            .includes(b)
          if (aisEnabled && !bIsEnabled) {
            return -1
          }
          if (!aisEnabled && bIsEnabled) {
            return 1
          }
          return 0
        })
        .map((eventName) => ({
          label: eventName
            .replace('Make segment ', '')
            .replace('Constrain ', ''),
          onClick: () => send(eventName),
          disabled:
            !nextEvents
              .filter((event) => state.can(event as any))
              .includes(eventName) || disableAllButtons,
        })),

    [JSON.stringify(nextEvents), state]
  )
  return (
    <menu className="max-w-full whitespace-nowrap rounded px-1.5 py-0.5 backdrop-blur-sm bg-chalkboard-10/80 dark:bg-chalkboard-110/70 relative">
      <ul
        {...props}
        ref={toolbarButtonsRef}
        onWheel={handleToolbarButtonsWheelEvent}
        className={'m-0 py-1 rounded-l-sm flex gap-2 items-center ' + className}
        style={{ scrollbarWidth: 'thin' }}
      >
        {nextEvents.includes('Enter sketch') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() =>
                send({ type: 'Enter sketch', data: { forceNewSketch: true } })
              }
              iconStart={{
                icon: 'sketch',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              <span data-testid="start-sketch">Start Sketch</span>
              <Tooltip
                delay={1250}
                position="bottom"
                className="!px-2 !text-xs"
              >
                Shortcut: S
              </Tooltip>
            </ActionButton>
          </li>
        )}
        {nextEvents.includes('Enter sketch') && pathId && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() => send({ type: 'Enter sketch' })}
              iconStart={{
                icon: 'sketch',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              Edit Sketch
              <Tooltip
                delay={1250}
                position="bottom"
                className="!px-2 !text-xs"
              >
                Shortcut: S
              </Tooltip>
            </ActionButton>
          </li>
        )}
        {nextEvents.includes('Cancel') && !state.matches('idle') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() => send({ type: 'Cancel' })}
              iconStart={{
                icon: 'arrowLeft',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              Exit Sketch
              <Tooltip
                delay={1250}
                position="bottom"
                className="!px-2 !text-xs"
              >
                Shortcut: Esc
              </Tooltip>
            </ActionButton>
          </li>
        )}
        {state.matches('Sketch no face') && (
          <li className="contents">
            <div className="mx-2 text-sm">click plane or face to sketch on</div>
          </li>
        )}
        {state.matches('Sketch') && !state.matches('idle') && (
          <>
            <li className="contents" key="line-button">
              <ActionButton
                className={buttonClassName}
                Element="button"
                onClick={() =>
                  state?.matches('Sketch.Line tool')
                    ? send('CancelSketch')
                    : send({
                        type: 'change tool',
                        data: { tool: 'line' },
                      })
                }
                aria-pressed={state?.matches('Sketch.Line tool')}
                iconStart={{
                  icon: 'line',
                  iconClassName,
                  bgClassName,
                }}
                disabled={disableLineButton}
              >
                Line
                <Tooltip
                  delay={1250}
                  position="bottom"
                  className="!px-2 !text-xs"
                >
                  Shortcut: L
                </Tooltip>
              </ActionButton>
            </li>
            <li className="contents" key="tangential-arc-button">
              <ActionButton
                className={buttonClassName}
                Element="button"
                onClick={() =>
                  state.matches('Sketch.Tangential arc to')
                    ? send('CancelSketch')
                    : send({
                        type: 'change tool',
                        data: { tool: 'tangentialArc' },
                      })
                }
                aria-pressed={state.matches('Sketch.Tangential arc to')}
                iconStart={{
                  icon: 'arc',
                  iconClassName,
                  bgClassName,
                }}
                disabled={disableTangentialArc}
              >
                Tangential Arc
                <Tooltip
                  delay={1250}
                  position="bottom"
                  className="!px-2 !text-xs"
                >
                  Shortcut: A
                </Tooltip>
              </ActionButton>
            </li>
            <li className="contents" key="rectangle-button">
              <ActionButton
                className={buttonClassName}
                Element="button"
                onClick={() =>
                  state.matches('Sketch.Rectangle tool')
                    ? send('CancelSketch')
                    : send({
                        type: 'change tool',
                        data: { tool: 'rectangle' },
                      })
                }
                aria-pressed={state.matches('Sketch.Rectangle tool')}
                iconStart={{
                  icon: 'rectangle',
                  iconClassName,
                  bgClassName,
                }}
                disabled={disableRectangle}
                title={
                  canRectangleTool(context)
                    ? 'Rectangle'
                    : 'Can only be used when a sketch is empty currently'
                }
              >
                Rectangle
                <Tooltip
                  delay={1250}
                  position="bottom"
                  className="!px-2 !text-xs"
                >
                  Shortcut: R
                </Tooltip>
              </ActionButton>
            </li>
          </>
        )}
        {state.matches('Sketch.SketchIdle') &&
          nextEvents.filter(
            (eventName) =>
              eventName.includes('Make segment') ||
              eventName.includes('Constrain')
          ).length > 0 && (
            <ActionButtonDropdown
              splitMenuItems={splitMenuItems}
              className={buttonClassName}
              Element="button"
              iconStart={{
                icon: 'dimension',
                iconClassName,
                bgClassName,
              }}
            >
              Constraints
            </ActionButtonDropdown>
          )}
        {state.matches('idle') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() =>
                commandBarSend({
                  type: 'Find and select command',
                  data: { name: 'Extrude', groupId: 'modeling' },
                })
              }
              disabled={!state.can('Extrude') || disableAllButtons}
              title={
                state.can('Extrude')
                  ? 'extrude'
                  : 'sketches need to be closed, or not already extruded'
              }
              iconStart={{
                icon: 'extrude',
                iconClassName,
                bgClassName,
              }}
            >
              Extrude
              <Tooltip
                delay={1250}
                position="bottom"
                className="!px-2 !text-xs"
              >
                Shortcut: E
              </Tooltip>
            </ActionButton>
          </li>
        )}
      </ul>
    </menu>
  )
}
