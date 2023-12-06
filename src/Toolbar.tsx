import { WheelEvent, useRef, useMemo } from 'react'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager } from './lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from 'components/ActionButton'

export const Toolbar = () => {
  const { setCommandBarOpen } = useCommandsContext()
  const { state, send, context } = useModelingContext()
  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
  const pathId = useMemo(
    () =>
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        context.selectionRanges
      ),
    [engineCommandManager.artifactMap, context.selectionRanges]
  )

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
          'm-0 py-1 rounded-l-sm flex gap-2 items-center overflow-x-auto ' + className
        }
        style={{ scrollbarWidth: 'thin' }}
      >
        {state.nextEvents.includes('Enter sketch') && (
          <li className="contents">
            <ActionButton
              Element="button"
              className="text-sm"
              onClick={() => send({ type: 'Enter sketch' })}
              icon={{
                icon: 'sketch',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
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
              className="text-sm"
              onClick={() => send({ type: 'Enter sketch' })}
              icon={{
                icon: 'sketch',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
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
              className="text-sm"
              onClick={() => send({ type: 'Cancel' })}
              icon={{
                icon: 'arrowLeft',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
              }}
            >
              Exit Sketch
            </ActionButton>
          </li>
        )}
        {state.matches('Sketch') && !state.matches('idle') && (
          <li className="contents">
            <ActionButton
              Element="button"
              className="text-sm"
              onClick={() =>
                state.matches('Sketch.Line Tool')
                  ? send('CancelSketch')
                  : send('Equip tool')
              }
              aria-pressed={state.matches('Sketch.Line Tool')}
              className="pressed:bg-energy-10/20 dark:pressed:bg-energy-80"
              icon={{
                icon: 'line',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
              }}
            >
              Line
            </ActionButton>
          </li>
        )}
        {state.matches('Sketch') && (
          <li className="contents">
            <ActionButton
              Element="button"
              className="text-sm"
              onClick={() =>
                state.matches('Sketch.Move Tool')
                  ? send('CancelSketch')
                  : send('Equip move tool')
              }
              aria-pressed={state.matches('Sketch.Move Tool')}
              className="pressed:bg-energy-10/20 dark:pressed:bg-energy-80"
              icon={{
                icon: 'move',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
              }}
            >
              Move
            </ActionButton>
          </li>
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
              <li className="contents">
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
                    bgClassName:
                      'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
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
              onClick={() => send('extrude intent')}
              disabled={!state.can('extrude intent')}
              title={
                state.can('extrude intent')
                  ? 'extrude'
                  : 'sketches need to be closed, or not already extruded'
              }
              icon={{
                icon: 'extrude',
                bgClassName:
                  'group-enabled:group-hover:bg-energy-10 group-pressed:bg-energy-10',
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
      <menu className="flex-1 px-1 py-0 overflow-hidden rounded-l-sm whitespace-nowrap bg-chalkboard-10 dark:bg-chalkboard-100 border-solid border border-energy-10 dark:border-chalkboard-90 border-r-0">
        <ToolbarButtons />
      </menu>
      <ActionButton
        Element="button"
        className="text-sm"
        onClick={() => setCommandBarOpen(true)}
        className="rounded-r-full pr-4 self-stretch border-energy-10 hover:border-energy-10 dark:border-chalkboard-80 bg-energy-10/50 hover:bg-energy-10 dark:bg-chalkboard-80 dark:text-energy-10"
      >
        ⌘K
      </ActionButton>
    </div>
  )
}
