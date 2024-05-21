import { WheelEvent, useRef, useMemo } from 'react'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { useModelingContext } from 'hooks/useModelingContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { ActionButton } from 'components/ActionButton'
import { isSingleCursorInPipe } from 'lang/queryAst'
import { useKclContext } from 'lang/KclProvider'
import {
  NetworkHealthState,
  useNetworkStatus,
} from 'components/NetworkHealthIndicator'
import { useStore } from 'useStore'
import { ActionButtonDropdown } from 'components/ActionButtonDropdown'
import { useHotkeys } from 'react-hotkeys-hook'
import Tooltip from 'components/Tooltip'

export const Toolbar = () => {
  const { commandBarSend } = useCommandsContext()
  const { state, send, context } = useModelingContext()
  const toolbarButtonsRef = useRef<HTMLUListElement>(null)
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
  const { overallState } = useNetworkStatus()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useStore((s) => ({
    isStreamReady: s.isStreamReady,
  }))
  const disableAllButtons =
    overallState !== NetworkHealthState.Ok || isExecuting || !isStreamReady

  useHotkeys(
    'l',
    () =>
      state.matches('Sketch.Line tool')
        ? send('CancelSketch')
        : send('Equip Line tool'),
    { enabled: !disableAllButtons, scopes: ['sketch'] }
  )
  useHotkeys(
    'a',
    () =>
      state.matches('Sketch.Tangential arc to')
        ? send('CancelSketch')
        : send('Equip tangential arc to'),
    { enabled: !disableAllButtons, scopes: ['sketch'] }
  )
  useHotkeys(
    'r',
    () =>
      state.matches('Sketch.Rectangle tool')
        ? send('CancelSketch')
        : send('Equip rectangle tool'),
    { enabled: !disableAllButtons, scopes: ['sketch'] }
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
      state.matches('Sketch.SketchIdle')
        ? send('Cancel')
        : send('CancelSketch'),
    { enabled: !disableAllButtons, scopes: ['sketch'] }
  )
  useHotkeys(
    'e',
    () =>
      commandBarSend({
        type: 'Find and select command',
        data: { name: 'Extrude', ownerMachine: 'modeling' },
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

  function ToolbarButtons({
    className = '',
    ...props
  }: React.HTMLAttributes<HTMLElement>) {
    return (
      <ul
        {...props}
        ref={toolbarButtonsRef}
        onWheel={handleToolbarButtonsWheelEvent}
        className={'m-0 py-1 rounded-l-sm flex gap-2 items-center ' + className}
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
        {state.nextEvents.includes('Enter sketch') && pathId && (
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
        {state.nextEvents.includes('Cancel') && !state.matches('idle') && (
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
                iconStart={{
                  icon: 'line',
                  iconClassName,
                  bgClassName,
                }}
                disabled={disableAllButtons}
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
                    : send('Equip tangential arc to')
                }
                aria-pressed={state.matches('Sketch.Tangential arc to')}
                iconStart={{
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
                    : send('Equip rectangle tool')
                }
                aria-pressed={state.matches('Sketch.Rectangle tool')}
                iconStart={{
                  icon: 'rectangle',
                  iconClassName,
                  bgClassName,
                }}
                disabled={
                  (!state.can('Equip rectangle tool') &&
                    !state.matches('Sketch.Rectangle tool')) ||
                  disableAllButtons
                }
                title={
                  state.can('Equip rectangle tool')
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
          state.nextEvents.filter(
            (eventName) =>
              eventName.includes('Make segment') ||
              eventName.includes('Constrain')
          ).length > 0 && (
            <ActionButtonDropdown
              splitMenuItems={state.nextEvents
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
                .map((eventName) => ({
                  label: eventName
                    .replace('Make segment ', '')
                    .replace('Constrain ', ''),
                  onClick: () => send(eventName),
                  disabled:
                    !state.nextEvents
                      .filter((event) => state.can(event as any))
                      .includes(eventName) || disableAllButtons,
                }))}
              className={buttonClassName}
              Element="button"
              iconStart={{
                icon: 'dimension',
                iconClassName,
                bgClassName,
              }}
            >
              Constrain
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
                  data: { name: 'Extrude', ownerMachine: 'modeling' },
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
    )
  }

  return (
    <menu className="max-w-full whitespace-nowrap rounded px-1.5 py-0.5 backdrop-blur-sm bg-chalkboard-10/80 dark:bg-chalkboard-110/70 relative">
      <ToolbarButtons />
    </menu>
  )
}
