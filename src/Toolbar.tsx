import { WheelEvent, useRef, useMemo } from 'react'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { useModelingContext } from 'hooks/useModelingContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from 'components/ActionButton'
import usePlatform from 'hooks/usePlatform'
import { isSingleCursorInPipe } from 'lang/queryAst'
import { useKclContext } from 'lang/KclProvider'
import {
  NetworkHealthState,
  useNetworkStatus,
} from 'components/NetworkHealthIndicator'
import { useStore } from 'useStore'

export const Toolbar = () => {
  const platform = usePlatform()
  const { commandBarSend } = useCommandsContext()
  const { state, send, context } = useModelingContext()
  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const iconClassName =
    'group-disabled:text-chalkboard-50 group-enabled:group-hover:!text-chalkboard-10 group-pressed:!text-chalkboard-10'
  const bgClassName =
    'group-disabled:!bg-transparent group-enabled:group-hover:bg-primary group-pressed:bg-primary'
  const buttonClassName =
    'bg-chalkboard-10 dark:bg-chalkboard-100 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100'
  const pathId = useMemo(() => {
    if (!isSingleCursorInPipe(context.selectionRanges, kclManager.ast)) {
      return false
    }
    return isCursorInSketchCommandRange(
      engineCommandManager.artifactMap,
      context.selectionRanges
    )
  }, [engineCommandManager.artifactMap, context.selectionRanges])
  const { overallState } = useNetworkStatus()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useStore((s) => ({
    isStreamReady: s.isStreamReady,
  }))
  const disableAllButtons =
    overallState !== NetworkHealthState.Ok || isExecuting || !isStreamReady

  function handleToolbarButtonsWheelEvent(ev: WheelEvent<HTMLSpanElement>) {
    const span = toolbarButtonsRef.current
    if (!span) {
      return
    }

    span.scrollLeft = span.scrollLeft += ev.deltaY
  }

  function ToolbarButtons({
    className = '',
    ...props
  }: React.HTMLAttributes<HTMLElement>) {
    return (
      <ul
        {...props}
        ref={toolbarButtonsRef}
        onWheel={handleToolbarButtonsWheelEvent}
        className={
          'm-0 py-1 rounded-l-sm flex gap-2 items-center overflow-x-auto ' +
          className
        }
        style={{ scrollbarWidth: 'thin' }}
      >
        {state.nextEvents.includes('Enter sketch') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() =>
                send({ type: 'Enter sketch', data: { forceNewSketch: true } })
              }
              icon={{
                icon: 'sketch',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              <span data-testid="start-sketch">Start Sketch</span>
            </ActionButton>
          </li>
        )}
        {state.nextEvents.includes('Enter sketch') && pathId && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() => send({ type: 'Enter sketch' })}
              icon={{
                icon: 'sketch',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              Edit Sketch
            </ActionButton>
          </li>
        )}
        {state.nextEvents.includes('Cancel') && !state.matches('idle') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() => send({ type: 'Cancel' })}
              icon={{
                icon: 'arrowLeft',
                iconClassName,
                bgClassName,
              }}
              disabled={disableAllButtons}
            >
              Exit Sketch
            </ActionButton>
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
                    : send('Equip Line tool')
                }
                aria-pressed={state?.matches('Sketch.Line tool')}
                icon={{
                  icon: 'line',
                  iconClassName,
                  bgClassName,
                }}
                disabled={disableAllButtons}
              >
                Line
              </ActionButton>
            </li>
            <li className="contents" key="tangential-arc-button">
              <ActionButton
                className={buttonClassName}
                Element="button"
                onClick={() =>
                  state.matches('Sketch.Tangential arc to')
                    ? send('CancelSketch')
                    : send('Equip tangential arc to')
                }
                aria-pressed={state.matches('Sketch.Tangential arc to')}
                icon={{
                  icon: 'arc',
                  iconClassName,
                  bgClassName,
                }}
                disabled={
                  (!state.can('Equip tangential arc to') &&
                    !state.matches('Sketch.Tangential arc to')) ||
                  disableAllButtons
                }
              >
                Tangential Arc
              </ActionButton>
            </li>
          </>
        )}
        {state.matches('Sketch.SketchIdle') &&
          state.nextEvents
            .filter(
              (eventName) =>
                eventName.includes('Make segment') ||
                eventName.includes('Constrain')
            )
            .sort((a, b) => {
              const aisEnabled = state.nextEvents
                .filter((event) => state.can(event as any))
                .includes(a)
              const bIsEnabled = state.nextEvents
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
            .map((eventName) => (
              <li className="contents" key={eventName}>
                <ActionButton
                  className={buttonClassName}
                  Element="button"
                  key={eventName}
                  onClick={() => send(eventName)}
                  disabled={
                    !state.nextEvents
                      .filter((event) => state.can(event as any))
                      .includes(eventName) || disableAllButtons
                  }
                  title={eventName}
                  icon={{
                    icon: 'line',
                    iconClassName,
                    bgClassName,
                  }}
                >
                  {eventName
                    .replace('Make segment ', '')
                    .replace('Constrain ', '')}
                </ActionButton>
              </li>
            ))}
        {state.matches('idle') && (
          <li className="contents">
            <ActionButton
              className={buttonClassName}
              Element="button"
              onClick={() =>
                commandBarSend({
                  type: 'Find and select command',
                  data: { name: 'Extrude', ownerMachine: 'modeling' },
                })
              }
              disabled={!state.can('Extrude') || disableAllButtons}
              title={
                state.can('Extrude')
                  ? 'extrude'
                  : 'sketches need to be closed, or not already extruded'
              }
              icon={{
                icon: 'extrude',
                iconClassName,
                bgClassName,
              }}
            >
              Extrude
            </ActionButton>
          </li>
        )}
      </ul>
    )
  }

  return (
    <div className="max-w-full flex items-stretch rounded-l-sm rounded-r-full bg-chalkboard-10/80 dark:bg-chalkboard-110/70 relative">
      <menu className="flex-1 pl-1 pr-2 py-0 overflow-hidden rounded-l-sm whitespace-nowrap border-solid border border-primary/30 dark:border-chalkboard-90 border-r-0">
        <ToolbarButtons />
      </menu>
      <ActionButton
        Element="button"
        onClick={() => commandBarSend({ type: 'Open' })}
        className="rounded-r-full pr-4 self-stretch border-primary/30 hover:border-primary dark:border-chalkboard-80 dark:bg-chalkboard-80 text-primary"
      >
        {platform === 'darwin' ? '⌘K' : 'Ctrl+/'}
      </ActionButton>
    </div>
  )
}
