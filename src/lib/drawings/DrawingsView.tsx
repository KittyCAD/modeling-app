import { useCallback, useEffect, useRef, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { Tabs } from '@kittycad/ui-components'
import { DrawingRulers } from '@src/lib/drawings/DrawingRulers'
import { PIXELS_PER_MM } from '@src/lib/drawings/rulers'
import type { Executor } from '@src/lib/executors/registry/contract'
import type {
  DrawingSheet,
  DrawingsExecutorCapability,
} from '@src/lib/drawings/executor'
import { reportRejection } from '@src/lib/trap'
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import styles from './DrawingsView.module.css'

/** One tab per top-level Sheet declaration in the bound file's evaluated output. */
export function DrawingsView({
  executor,
  capability,
}: {
  executor: Executor
  capability: DrawingsExecutorCapability
}) {
  useSignals()
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const output = executor.output.value
  const drawings = output.get(capability)
  const sheets = drawings?.sheets ?? []
  const error = output.errors[capability.id]
  const selectedId = sheets.some((sheet) => sheet.name === selectedName)
    ? selectedName
    : (sheets[0]?.name ?? null)
  if (error)
    return (
      <p role="alert" className="p-4">
        {error.message}
      </p>
    )
  if (output.running && !drawings)
    return (
      <p role="status" className="p-4">
        Loading drawings...
      </p>
    )
  return (
    <Tabs
      label="Drawing sheets"
      selectedId={selectedId}
      onChange={setSelectedName}
      emptyState={
        <p className="p-4 text-sm">
          No drawing sheets in this file. Create one with{' '}
          <code>drawing::sheet(drawing::PaperSize::A4)</code>.
        </p>
      }
      items={sheets.map((sheet) => ({
        id: sheet.name,
        label: sheet.name,
        title: `${sheet.size}: ${sheet.width} x ${sheet.height} mm`,
        renderPanel: () => <SheetCanvas sheet={sheet} />,
      }))}
    />
  )
}

/** Physical paper dimensions become CSS pixels before the viewport's pan and zoom transform. */
function SheetCanvas({ sheet }: { sheet: DrawingSheet }) {
  const width = sheet.width * PIXELS_PER_MM
  const height = sheet.height * PIXELS_PER_MM
  const viewport = useRef<HTMLDivElement>(null)
  const transform = useRef<ReactZoomPanPinchRef>(null)
  const fitSheet = useCallback(
    (duration = 200) => {
      const el = viewport.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      const scale = Math.max(
        0.1,
        Math.min(
          1,
          (el.clientWidth - 64) / width,
          (el.clientHeight - 64) / height
        )
      )
      transform.current?.centerView(scale, duration).catch(reportRejection)
    },
    [width, height]
  )

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    // Hidden executor panels have no size. Fit once when the view first becomes visible.
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      fitSheet(0)
      observer.disconnect()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitSheet])

  return (
    <div ref={viewport} className={styles.viewport} aria-label="Drawing canvas">
      <TransformWrapper
        ref={transform}
        minScale={0.1}
        maxScale={4}
        limitToBounds={false}
        centerZoomedOut={false}
      >
        <TransformComponent wrapperClass={styles.canvas}>
          <div
            role="img"
            aria-label={`${sheet.name} - ${sheet.size} drawing sheet`}
            className={styles.paper}
            style={{ width, height }}
          />
        </TransformComponent>
        <DrawingRulers sheet={sheet} />
        <div
          className={styles.controls}
          role="group"
          aria-label="Drawing navigation"
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              transform.current?.zoomOut().catch(reportRejection)
            }}
          >
            -
          </button>
          <button type="button" onClick={() => fitSheet()}>
            Fit sheet
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              transform.current?.zoomIn().catch(reportRejection)
            }}
          >
            +
          </button>
        </div>
        <p className={styles.hint}>Drag to pan, scroll to zoom</p>
      </TransformWrapper>
    </div>
  )
}
