import { useEffect, useRef } from 'react'
import type { Editor } from '@src/lib/editors/registry/contract'
import styles from './CodeMirrorView.module.css'

/** Attach the editor-owned CodeMirror view without resetting or destroying it on unmount. */
export function CodeMirrorView({
  editor,
  active,
}: {
  editor: Editor
  active: boolean
}) {
  const parent = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = parent.current
    if (!container) return
    container.appendChild(editor.view.dom)
    return () => {
      if (editor.view.dom.parentElement === container)
        container.removeChild(editor.view.dom)
    }
  }, [editor])
  useEffect(() => {
    if (active) editor.view.requestMeasure()
  }, [editor, active])
  return (
    <div ref={parent} className={`code-mirror-override ${styles.surface}`} />
  )
}
