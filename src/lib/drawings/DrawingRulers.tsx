import { useEffect, useRef, useState } from 'react'
import {
  useTransformComponent,
  type ReactZoomPanPinchContextState,
} from 'react-zoom-pan-pinch'
import { PIXELS_PER_MM, RULER_SIZE, rulerTicks } from '@src/lib/drawings/rulers'
import type { DrawingSheet } from '@src/lib/drawings/executor'
import styles from './DrawingRulers.module.css'

const readTransform = ({ state }: ReactZoomPanPinchContextState) => ({
  ...state,
})

const millimeterFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
})

/** Fixed viewport rulers measure from the sheet's top-left corner as the canvas moves beneath them. */
export function DrawingRulers({ sheet }: { sheet: DrawingSheet }) {
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const { scale, positionX, positionY } = useTransformComponent(readTransform)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const pixelsPerMm = scale * PIXELS_PER_MM
  const axes = [
    {
      id: 'horizontal',
      length: Math.max(0, size.width - RULER_SIZE),
      origin: positionX,
      extent: sheet.width,
    },
    {
      id: 'vertical',
      length: Math.max(0, size.height - RULER_SIZE),
      origin: positionY - RULER_SIZE,
      extent: sheet.height,
    },
  ] as const
  return (
    <div ref={root} className={styles.rulers}>
      {axes.map(({ id, length, origin, extent }) => {
        const horizontal = id === 'horizontal'
        const edges = [0, extent]
          .map((value) => ({ value, position: origin + value * pixelsPerMm }))
          .filter((edge) => edge.position >= 0 && edge.position <= length)
        return (
          <svg
            key={id}
            role="img"
            aria-label={`${horizontal ? 'Top' : 'Right'} ruler in millimeters`}
            className={horizontal ? styles.topRuler : styles.rightRuler}
            width={horizontal ? length : RULER_SIZE}
            height={horizontal ? RULER_SIZE : length}
          >
            {rulerTicks(length, origin, pixelsPerMm).map(
              ({ position, value, major }) => (
                <g
                  key={value}
                  transform={
                    horizontal
                      ? `translate(${position},0)`
                      : `translate(0,${position})`
                  }
                >
                  <line
                    x1={0}
                    y1={horizontal ? RULER_SIZE : 0}
                    x2={horizontal ? 0 : major ? 9 : 4}
                    y2={horizontal ? RULER_SIZE - (major ? 9 : 4) : 0}
                  />
                  {major &&
                    !edges.some(
                      (edge) => Math.abs(edge.position - position) < 48
                    ) && (
                      <text
                        x={horizontal ? 3 : 15}
                        y={horizontal ? 10 : 3}
                        transform={horizontal ? undefined : 'rotate(90 15 3)'}
                      >
                        {millimeterFormat.format(value)}
                      </text>
                    )}
                </g>
              )
            )}
            {edges.map(({ value, position }) => (
              <g
                key={value}
                className={styles.sheetEdge}
                transform={
                  horizontal
                    ? `translate(${position},0)`
                    : `translate(0,${position})`
                }
              >
                <line
                  x1={0}
                  y1={0}
                  x2={horizontal ? 0 : RULER_SIZE}
                  y2={horizontal ? RULER_SIZE : 0}
                />
                <text
                  x={horizontal ? (value === 0 ? 3 : -3) : 15}
                  y={horizontal ? 10 : value === 0 ? 3 : -3}
                  textAnchor={value === 0 ? 'start' : 'end'}
                  transform={
                    horizontal
                      ? undefined
                      : `rotate(90 15 ${value === 0 ? 3 : -3})`
                  }
                >
                  {millimeterFormat.format(value)}
                </text>
              </g>
            ))}
          </svg>
        )
      })}
      <span className={styles.rulerUnit}>mm</span>
    </div>
  )
}
