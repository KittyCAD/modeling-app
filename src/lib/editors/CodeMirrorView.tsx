import { useEffect, useRef } from 'react'
import type { EditorView as NativeEditorView } from '@codemirror/view'
import styles from './CodeMirrorView.module.css'

/** Attach the presentation-owned CodeMirror surface without resetting or destroying it on unmount. */
export function CodeMirrorView({
  view,
  active,
}: {
  view: NativeEditorView
  active: boolean
}) {
  const parent = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = parent.current
    if (!container) return
    container.appendChild(view.dom)
    return () => {
      if (view.dom.parentElement === container) container.removeChild(view.dom)
    }
  }, [view])
  useEffect(() => {
    if (active) view.requestMeasure()
  }, [view, active])
  return (
    <div ref={parent} className={`code-mirror-override ${styles.surface}`} />
  )
}
