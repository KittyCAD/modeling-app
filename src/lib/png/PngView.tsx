import { useSignals } from '@preact/signals-react/runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import type { Editor } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { isErr, reportRejection } from '@src/lib/trap'
import styles from './PngView.module.css'

/** The surface owns its binary read and object URL; decoded editor text is never image data. */
export function PngView({
  editor,
  readFile,
}: {
  editor: Editor
  readFile: (src: string) => Promise<Uint8Array>
}) {
  useSignals()
  const src = editor.src.value
  const [result, setResult] = useState<{ src: string; value: Blob | Error }>()
  useEffect(() => {
    if (!src) return
    const lifetime = new AbortController()
    void readFile(src)
      .then((bytes) => {
        if (!lifetime.signal.aborted)
          setResult({
            src,
            value: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          })
      })
      .catch((cause) => {
        if (!lifetime.signal.aborted)
          setResult({
            src,
            value: isErr(cause) ? cause : new Error(String(cause)),
          })
      })
    return () => lifetime.abort()
  }, [src, readFile])
  if (!src)
    return (
      <p role="status" className="p-4">
        Assign a PNG file path to this buffer to view its image.
      </p>
    )
  if (!result || result.src !== src)
    return (
      <p role="status" className="p-4">
        Loading image...
      </p>
    )
  if (isErr(result.value))
    return (
      <p role="alert" className="p-4">
        {result.value.message}
      </p>
    )
  return <PngCanvas blob={result.value} name={fsZds.basename(src)} />
}

function PngCanvas({ blob, name }: { blob: Blob; name: string }) {
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
    fitted.current = false
    setFailed(undefined)
    setSource({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
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
      >
        <TransformComponent wrapperClass={styles.canvas}>
          {source?.blob === blob && failed !== blob && (
            <img
              key={source.url}
              ref={image}
              src={source.url}
              alt={name}
              draggable={false}
              className={styles.image}
              onLoad={() => fitImage(0)}
              onError={() => setFailed(blob)}
            />
          )}
        </TransformComponent>
        {failed === blob ? (
          <p role="alert" className={styles.status}>
            Unable to display {name} as a PNG image.
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
            <p className={styles.hint}>Drag to pan, scroll to zoom</p>
          </>
        )}
      </TransformWrapper>
    </div>
  )
}
