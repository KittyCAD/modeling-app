import { WheelEvent, useRef, useMemo } from 'react'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager } from './lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from 'components/ActionButton'
import usePlatform from 'hooks/usePlatform'
import { isSingleCursorInPipe } from 'lang/queryAst'
import { kclManager } from 'lang/KclSingleton'

export const Toolbar = () => {
  const platform = usePlatform()
  const { commandBarSend } = useCommandsContext()
  const { state, send, context } = useModelingContext()
  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const bgClassName =
    'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10 dark:group-enabled:group-hover:bg-chalkboard-80 dark:group-pressed:bg-chalkboard-80'
  const pathId = useMemo(() => {
    if (!isSingleCursorInPipe(context.selectionRanges, kclManager.ast)) {
      return false
    }
    return isCursorInSketchCommandRange(
      engineCommandManager.artifactMap,
      context.selectionRanges
    )
  }, [engineCommandManager.artifactMap, context.selectionRanges])

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
              Element="button"
              onClick={() =>
                send({ type: 'Enter sketch', data: { forceNewSketch: true } })
              }
              icon={{
                icon: 'sketch',
                bgClassName,
              }}
            >
              <span data-testid="start-sketch">Start Sketch</span>
            </ActionButton>
          </li>
        )}
        {state.nextEvents.includes('Enter sketch') && pathId && (
          <li className="contents">
            <ActionButton
              Element="button"
              onClick={() => send({ type: 'Enter sketch' })}
              icon={{
                icon: 'sketch',
                bgClassName,
              }}
            >
              Edit Sketch
            </ActionButton>
          </li>
        )}
        {state.nextEvents.includes('Cancel') && !state.matches('idle') && (
          <li className="contents">
            <ActionButton
              Element="button"
              onClick={() => send({ type: 'Cancel' })}
              icon={{
                icon: 'arrowLeft',
                bgClassName,
              }}
            >
              Exit Sketch
            </ActionButton>
          </li>
        )}
        {state.matches('Sketch') && !state.matches('idle') && (
          <>
            <li className="contents" key="line-button">
              <ActionButton
                Element="button"
                onClick={() =>
                  state?.matches('Sketch.Line tool')
                    ? send('CancelSketch')
                    : send('Equip Line tool')
                }
                aria-pressed={state?.matches('Sketch.Line tool')}
                className="pressed:bg-energy-10/20 dark:pressed:bg-energy-80"
                icon={{
                  icon: 'line',
                  bgClassName,
                }}
              >
                Line
              </ActionButton>
            </li>
            <li className="contents" key="tangential-arc-button">
              <ActionButton
                Element="button"
                onClick={() =>
                  state.matches('Sketch.Tangential arc to')
                    ? send('CancelSketch')
                    : send('Equip tangential arc to')
                }
                aria-pressed={state.matches('Sketch.Tangential arc to')}
                className="pressed:bg-energy-10/20 dark:pressed:bg-energy-80"
                icon={{
                  icon: 'line',
                  bgClassName,
                }}
                disabled={
                  !state.can('Equip tangential arc to') &&
                  !state.matches('Sketch.Tangential arc to')
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
                  Element="button"
                  className="text-sm"
                  key={eventName}
                  onClick={() => send(eventName)}
                  disabled={
                    !state.nextEvents
                      .filter((event) => state.can(event as any))
                      .includes(eventName)
                  }
                  title={eventName}
                  icon={{
                    icon: 'line',
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
              Element="button"
              className="text-sm"
              onClick={() =>
                commandBarSend({
                  type: 'Find and select command',
                  data: { name: 'Extrude', ownerMachine: 'modeling' },
                })
              }
              disabled={!state.can('Extrude')}
              title={
                state.can('Extrude')
                  ? 'extrude'
                  : 'sketches need to be closed, or not already extruded'
              }
              icon={{
                icon: 'extrude',
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
    <div className="max-w-full flex items-stretch rounded-l-sm rounded-r-full bg-chalkboard-10 dark:bg-chalkboard-100 relative">
      <menu className="flex-1 pl-1 pr-2 py-0 overflow-hidden rounded-l-sm whitespace-nowrap bg-chalkboard-10 dark:bg-chalkboard-100 border-solid border border-energy-10 dark:border-chalkboard-90 border-r-0">
        <ToolbarButtons />
      </menu>
      <ActionButton
        Element="button"
        onClick={() => commandBarSend({ type: 'Open' })}
        className="rounded-r-full pr-4 self-stretch border-energy-10 hover:border-energy-10 dark:border-chalkboard-80 bg-energy-10/50 hover:bg-energy-10 dark:bg-chalkboard-80 dark:text-energy-10"
      >
        {platform === 'darwin' ? '⌘K' : 'Ctrl+/'}
      </ActionButton>
    </div>
  )
}
