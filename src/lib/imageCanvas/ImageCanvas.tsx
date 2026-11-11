import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { reportRejection } from '@src/lib/trap'
import styles from './ImageCanvas.module.css'

/** Shared image surface; each mounted view owns its camera and object URL. */
export function ImageCanvas({
  blob,
  name,
  background = 'checkerboard',
  overlay,
  hint = 'Drag to pan, scroll to zoom',
  preserveView = false,
}: {
  blob: Blob
  name: string
  background?: 'checkerboard' | 'paper'
  overlay?: ReactNode
  hint?: string
  preserveView?: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const transform = useRef<ReactZoomPanPinchRef>(null)
  const fitted = useRef(false)
  const [source, setSource] = useState<{ blob: Blob; url: string }>()
  const [failed, setFailed] = useState<Blob>()
  const fitImage = useCallback((duration = 200) => {
    const el = viewport.current
    const img = image.current
    if (
      !el?.clientWidth ||
      !el.clientHeight ||
      !img?.naturalWidth ||
      !img.naturalHeight
    )
      return
    fitted.current = true
    const scale = Math.max(
      0.01,
      Math.min(
        1,
        (el.clientWidth - 64) / img.naturalWidth,
        (el.clientHeight - 64) / img.naturalHeight
      )
    )
    transform.current?.centerView(scale, duration).catch(reportRejection)
  }, [])

  useEffect(() => {
    const url = URL.createObjectURL(blob)
    if (!preserveView) fitted.current = false
    setFailed(undefined)
    setSource({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob, preserveView])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    // Images may finish loading in hidden tabs. Fit after the pane has a usable size.
    const observer = new ResizeObserver(() => {
      if (!fitted.current) fitImage(0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitImage])

  return (
    <div ref={viewport} className={styles.viewport} aria-label="Image canvas">
      <TransformWrapper
        ref={transform}
        minScale={0.01}
        maxScale={16}
        limitToBounds={false}
        centerZoomedOut={false}
        panning={{ excluded: ['input', 'textarea', 'button', 'select'] }}
        doubleClick={{ excluded: ['input', 'textarea', 'button', 'select'] }}
      >
        <TransformComponent wrapperClass={styles.canvas}>
          <div className={styles.content}>
            {source && failed !== blob && (
              <img
                key={source.url}
                ref={image}
                src={source.url}
                alt={name}
                draggable={false}
                className={`${styles.image} ${background === 'paper' ? styles.paper : ''}`}
                onLoad={() => {
                  if (!fitted.current) fitImage(0)
                }}
                onError={() => setFailed(blob)}
              />
            )}
            {source && failed !== blob && overlay}
          </div>
        </TransformComponent>
        {failed === blob ? (
          <p role="alert" className={styles.status}>
            Unable to display {name} as an image.
          </p>
        ) : (
          <>
            <div
              className={styles.controls}
              role="group"
              aria-label="Image navigation"
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
              <button type="button" onClick={() => fitImage()}>
                Fit image
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
            <p className={styles.hint}>{hint}</p>
          </>
        )}
      </TransformWrapper>
    </div>
  )
}
