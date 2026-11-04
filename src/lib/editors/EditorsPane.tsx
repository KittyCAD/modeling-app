import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel } from '@src/components/layout/Panel'
import Tooltip from '@src/components/Tooltip'
import { FilePaneEmptyState } from '@src/components/FilePaneEmptyState'
import { Tabs } from '@src/components/Tabs'
import type { Editor, EditorsService } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { useEffect, useRef, useState } from 'react'
import styles from './EditorsPane.module.css'

/**
 * The registry owns the views; a pane owns only its tab selection and DOM mounts.
 */
export function EditorsPane({
  editors: service,
  layout,
  onClose,
  onOpenEditor,
}: Pick<AreaTypeComponentProps, 'layout' | 'onClose'> & {
  editors: EditorsService
  onOpenEditor?: () => void
}) {
  useSignals()
  const editors = service.editors.value
  const previousEditors = useRef(editors)
  const [activeId, setActiveId] = useState<symbol | null>(
    () => editors.at(-1)?.id ?? null
  )
  useEffect(() => {
    const previous = previousEditors.current
    previousEditors.current = editors
    const opened = editors.filter(
      (editor) => !previous.some(({ id }) => id === editor.id)
    )
    setActiveId((current) => {
      const newest = opened.at(-1)
      if (newest) return newest.id
      if (editors.some(({ id }) => id === current)) return current
      const previousIndex = previous.findIndex(({ id }) => id === current)
      return (
        editors[Math.max(0, Math.min(previousIndex, editors.length - 1))]?.id ??
        null
      )
    })
  }, [editors])

  const selectedIndex = Math.max(
    0,
    editors.findIndex(({ id }) => id === activeId)
  )

  return (
    <LayoutPanel
      id={`${layout.id}-pane`}
      title={layout.label}
      className={styles.pane}
    >
      <Tabs
        label="Open editors"
        postfixAlign="end"
        postfix={
          <>
            {onOpenEditor && (
              <button
                type="button"
                aria-label="Open editor"
                onClick={onOpenEditor}
                className={styles.iconButton}
              >
                <CustomIcon name="plus" className="h-3.5 w-3.5" aria-hidden />
                <Tooltip position="bottom-right">Open editor</Tooltip>
              </button>
            )}
            {onClose && (
              <button
                type="button"
                aria-label="Close Editors pane"
                onClick={() => onClose()}
                className={styles.iconButton}
              >
                <CustomIcon name="close" className="h-3.5 w-3.5" aria-hidden />
                <Tooltip position="bottom-right">Close pane</Tooltip>
              </button>
            )}
          </>
        }
        emptyState={<FilePaneEmptyState icon="code" onOpen={onOpenEditor} />}
        selectedId={editors[selectedIndex]?.id ?? null}
        onChange={setActiveId}
        items={editors.map((editor) => ({
          id: editor.id,
          label: fsZds.basename(editor.src.value) || editor.src.value,
          title: editor.src.value,
          close: {
            label: `Close ${editor.src.value}`,
            tooltip: 'Close editor',
            onClose: () => service.closeEditor(editor.id),
          },
          renderPanel: (active) => (
            <EditorSurface editor={editor} active={active} />
          ),
        }))}
      />
    </LayoutPanel>
  )
}

/** Attach an existing view without transferring ownership or resetting its state. */
function EditorSurface({
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
      if (editor.view.dom.parentElement === container) {
        container.removeChild(editor.view.dom)
      }
    }
  }, [editor])
  useEffect(() => {
    if (active) editor.view.requestMeasure()
  }, [editor, active])
  return <div ref={parent} className={styles.surface} />
}
