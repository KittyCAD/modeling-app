import { useStore, toolTips, ToolTip } from './useStore'
import { extrudeSketch, sketchOnExtrudedFace } from './lang/modifyAst'
import { getNodePathFromSourceRange } from './lang/queryAst'
// import { HorzVert } from './components/Toolbar/HorzVert'
// import { RemoveConstrainingValues } from './components/Toolbar/RemoveConstrainingValues'
// import { EqualLength } from './components/Toolbar/EqualLength'
// import { EqualAngle } from './components/Toolbar/EqualAngle'
// import { Intersect } from './components/Toolbar/Intersect'
// import { SetHorzVertDistance } from './components/Toolbar/SetHorzVertDistance'
// import { SetAngleLength } from './components/Toolbar/setAngleLength'
// import { SetAbsDistance } from './components/Toolbar/SetAbsDistance'
// import { SetAngleBetween } from './components/Toolbar/SetAngleBetween'
import { Fragment, WheelEvent, useRef, useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch, faX } from '@fortawesome/free-solid-svg-icons'
import { Popover, Transition } from '@headlessui/react'
import styles from './Toolbar.module.css'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange, useAppMode } from 'hooks/useAppMode'
import { ActionIcon } from 'components/ActionIcon'
import { engineCommandManager } from './lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager } from 'lang/KclSinglton'

export const sketchButtonClassnames = {
  background:
    'bg-chalkboard-100 group-hover:bg-chalkboard-90 hover:bg-chalkboard-90 dark:bg-fern-20 dark:group-hover:bg-fern-10 dark:hover:bg-fern-10 group-disabled:bg-chalkboard-50 dark:group-disabled:bg-chalkboard-60 group-hover:group-disabled:bg-chalkboard-50 dark:group-hover:group-disabled:bg-chalkboard-50',
  icon: 'text-fern-20 h-auto group-hover:text-fern-10 hover:text-fern-10 dark:text-chalkboard-100 dark:group-hover:text-chalkboard-100 dark:hover:text-chalkboard-100 group-disabled:bg-chalkboard-60 hover:group-disabled:text-inherit',
}

const sketchFnLabels: Record<ToolTip | 'sketch_line' | 'move', string> = {
  sketch_line: 'Line',
  line: 'Line',
  move: 'Move',
  angledLine: 'Angled Line',
  angledLineThatIntersects: 'Angled Line That Intersects',
  angledLineOfXLength: 'Angled Line Of X Length',
  angledLineOfYLength: 'Angled Line Of Y Length',
  angledLineToX: 'Angled Line To X',
  angledLineToY: 'Angled Line To Y',
  lineTo: 'Line to Point',
  xLine: 'Horizontal Line',
  yLine: 'Vertical Line',
  xLineTo: 'Horizontal Line to Point',
  yLineTo: 'Vertical Line to Point',
}

export const Toolbar = () => {
  useAppMode()
  const { state, send, context } = useModelingContext()
  const toolbarButtonsRef = useRef<HTMLSpanElement>(null)
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

  function ToolbarButtons({ className }: React.HTMLAttributes<HTMLElement>) {
    return (
      <span
        ref={toolbarButtonsRef}
        onWheel={handleToolbarButtonsWheelEvent}
        className={styles.toolbarButtons + ' ' + className}
      >
        {state.nextEvents.includes('Enter sketch') && (
          <button
            onClick={() => send({ type: 'Enter sketch' })}
            className="group"
          >
            <ActionIcon icon="sketch" className="!p-0.5" size="md" />
            Start Sketch
          </button>
        )}
        {state.nextEvents.includes('Enter sketch') && pathId && (
          <button
            onClick={() => send({ type: 'Enter sketch' })}
            className="group"
          >
            <ActionIcon icon="sketch" className="!p-0.5" size="md" />
            Edit Sketch
          </button>
        )}
        {state.nextEvents.includes('Cancel') && !state.matches('idle') && (
          <button onClick={() => send({ type: 'Cancel' })} className="group">
            <ActionIcon icon="exit" className="!p-0.5" size="md" />
            Exit Sketch
          </button>
        )}
        {state.matches('Sketch') && !state.matches('idle') && (
          <button
            onClick={() =>
              state.matches('Sketch.Line Tool')
                ? send('CancelSketch')
                : send('Equip tool')
            }
            className={
              'group ' +
              (state.matches('Sketch.Line Tool')
                ? '!text-fern-70 !bg-fern-10 !dark:text-fern-20 !border-fern-50'
                : '')
            }
          >
            <ActionIcon icon="line" className="!p-0.5" size="md" />
            Line
          </button>
        )}
        {state.matches('Sketch') && (
          <button
            onClick={() =>
              state.matches('Sketch.Move Tool')
                ? send('CancelSketch')
                : send('Equip move tool')
            }
            className={
              'group ' +
              (state.matches('Sketch.Move Tool')
                ? '!text-fern-70 !bg-fern-10 !dark:text-fern-20 !border-fern-50'
                : '')
            }
          >
            <ActionIcon icon="move" className="!p-0.5" size="md" />
            Move
          </button>
        )}
        {state.matches('Sketch.SketchIdle') &&
          state.nextEvents
            .filter(
              (eventName) =>
                eventName.includes('Make segment') ||
                eventName.includes('Constrain')
            )
            .map((eventName) => (
              <button
                key={eventName}
                onClick={() => send(eventName)}
                className="group"
                disabled={
                  !state.nextEvents
                    .filter((event) => state.can(event as any))
                    .includes(eventName)
                }
                title={eventName}
              >
                <ActionIcon
                  icon={'line'} // TODO
                  bgClassName={sketchButtonClassnames.background}
                  iconClassName={sketchButtonClassnames.icon}
                  size="md"
                />
                {eventName
                  .replace('Make segment ', '')
                  .replace('Constrain ', '')}
              </button>
            ))}
        {state.matches('idle') && (
          <button
            onClick={() => send('extrude intent')}
            disabled={!state.can('extrude intent')}
            className="group"
            title={
              state.can('extrude intent')
                ? 'extrude'
                : 'sketches need to be closed, or not already extruded'
            }
          >
            <ActionIcon icon="extrude" className="!p-0.5" size="md" />
            Extrude
          </button>
        )}

        {/* <HorzVert horOrVert="horizontal" />
        <HorzVert horOrVert="vertical" />
        <EqualLength />
        <EqualAngle />
        <SetHorzVertDistance buttonType="alignEndsVertically" />
        <SetHorzVertDistance buttonType="setHorzDistance" />
        <SetAbsDistance buttonType="snapToYAxis" />
        <SetAbsDistance buttonType="xAbs" />
        <SetHorzVertDistance buttonType="alignEndsHorizontally" />
        <SetAbsDistance buttonType="snapToXAxis" />
        <SetHorzVertDistance buttonType="setVertDistance" />
        <SetAbsDistance buttonType="yAbs" />
        <SetAngleLength angleOrLength="setAngle" />
        <SetAngleLength angleOrLength="setLength" />
        <Intersect />
        <RemoveConstrainingValues />
        <SetAngleBetween /> */}
      </span>
    )
  }

  return (
    <Popover className={styles.toolbarWrapper}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarCap + ' ' + styles.label}>
          {state.matches('Sketch') ? '2D' : '3D'}
        </span>
        <menu className="flex-1 gap-2 py-0.5 overflow-hidden whitespace-nowrap">
          <ToolbarButtons />
        </menu>
        <Popover.Button
          className={styles.toolbarCap + ' ' + styles.popoverToggle}
        >
          <FontAwesomeIcon icon={faSearch} />
        </Popover.Button>
      </div>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition ease-out duration-100"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Popover.Overlay className="fixed inset-0 bg-chalkboard-110/20 dark:bg-chalkboard-110/50" />
      </Transition>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 translate-y-1 scale-95"
        enterTo="opacity-100 translate-y-0 scale-100"
        leave="transition ease-out duration-75"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-2"
      >
        <Popover.Panel className="absolute top-0 w-screen max-w-xl left-1/2 -translate-x-1/2 flex flex-col gap-8 bg-chalkboard-10 dark:bg-chalkboard-100 p-5 rounded border border-chalkboard-20/30 dark:border-chalkboard-70/50">
          <section className="flex justify-between items-center">
            <p
              className={`${styles.toolbarCap} ${styles.label} !self-center rounded-r-full w-fit`}
            >
              You're in {state.matches('Sketch') ? '2D' : '3D'}
            </p>
            <Popover.Button className="p-2 flex items-center justify-center rounded-sm bg-chalkboard-20 text-chalkboard-110 dark:bg-chalkboard-70 dark:text-chalkboard-20 border-none hover:bg-chalkboard-30 dark:hover:bg-chalkboard-60">
              <FontAwesomeIcon icon={faX} className="w-4 h-4" />
            </Popover.Button>
          </section>
          <section>
            <ToolbarButtons className="flex-wrap" />
          </section>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}
