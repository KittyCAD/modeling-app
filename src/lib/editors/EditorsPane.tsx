import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel } from '@src/components/layout/Panel'
import Tooltip from '@src/components/Tooltip'
import { FilePaneEmptyState } from '@src/components/FilePaneEmptyState'
import { Tabs } from '@src/components/Tabs'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  EditorTabIndicator,
  EditorsService,
} from '@src/lib/editors/registry/contract'
import { EditorView } from '@src/lib/editors/EditorView'
import { TabViewPicker } from '@src/components/TabViewPicker'
import fsZds from '@src/lib/fs-zds'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { useEffect, useRef, useState } from 'react'
import styles from './EditorsPane.module.css'

/**
 * The registry owns the views; a pane owns only its tab selection and DOM mounts.
 */
export function EditorsPane({
  editors: service,
  indicators,
  layout,
  onClose,
  onOpenEditor,
}: Pick<AreaTypeComponentProps, 'layout' | 'onClose'> & {
  editors: EditorsService
  indicators?: ReadonlySignal<readonly EditorTabIndicator[]>
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

  const tabIndicators = [...(indicators?.value ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
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
            <button
              type="button"
              aria-label="New editor"
              className={styles.iconButton}
              onClick={() => service.createEditor()}
            >
              <CustomIcon name="plus" className="h-3.5 w-3.5" aria-hidden />
              <Tooltip position="bottom-right">New editor</Tooltip>
            </button>
            {onOpenEditor && (
              <button
                type="button"
                aria-label="Open editor"
                onClick={onOpenEditor}
                className={styles.iconButton}
              >
                <CustomIcon
                  name="folderOpen"
                  className="h-3.5 w-3.5"
                  aria-hidden
                />
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
          label: (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="truncate">
                {editor.src.value
                  ? fsZds.basename(editor.src.value)
                  : 'Untitled'}
              </span>
              {tabIndicators.map(({ id, component: Indicator }) => (
                <Indicator key={id} editor={editor} />
              ))}
            </span>
          ),
          title: editor.src.value ?? 'Untitled',
          accessory: (
            <TabViewPicker
              name={
                editor.src.value ? fsZds.basename(editor.src.value) : 'Untitled'
              }
              view={service.viewState(editor).value.selected}
              views={service.viewState(editor).value.available}
              onFocus={() => setActiveId(editor.id)}
              onChange={(viewId) => service.setView(editor.id, viewId)}
            />
          ),
          close: {
            label: `Close ${editor.src.value ?? 'Untitled'}`,
            tooltip: 'Close editor',
            onClose: () => service.closeEditor(editor.id),
          },
          renderPanel: (active) => (
            <EditorView editor={editor} editors={service} active={active} />
          ),
        }))}
      />
    </LayoutPanel>
  )
}
