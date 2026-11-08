import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel } from '@src/components/layout/Panel'
import Tooltip from '@src/components/Tooltip'
import { FilePaneEmptyState } from '@src/components/FilePaneEmptyState'
import { Tabs } from '@kittycad/ui-components'
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
 * The registry owns the views; each tab owns a view instance, while its backing document can be shared.
 * TODO: Consolidate this pane with `LayoutType.Panes` once it supports labeled tabs
 * and closing content independently from hiding the pane.
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
  const views = service.views.value
  const previousViews = useRef(views)
  const [activeId, setActiveId] = useState<symbol | null>(
    () => views.at(-1)?.id ?? null
  )
  useEffect(() => {
    const previous = previousViews.current
    previousViews.current = views
    const opened = views.filter(
      (editor) => !previous.some(({ id }) => id === editor.id)
    )
    setActiveId((current) => {
      const newest = opened.at(-1)
      if (newest) return newest.id
      if (views.some(({ id }) => id === current)) return current
      const previousIndex = previous.findIndex(({ id }) => id === current)
      return (
        views[Math.max(0, Math.min(previousIndex, views.length - 1))]?.id ??
        null
      )
    })
  }, [views])

  const tabIndicators = [...(indicators?.value ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
  const selectedIndex = Math.max(
    0,
    views.findIndex(({ id }) => id === activeId)
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
              onClick={() =>
                service.createView(service.createEditor(), 'editors.code')
              }
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
        selectedId={views[selectedIndex]?.id ?? null}
        onChange={setActiveId}
        items={views.map((instance) => {
          const editor = instance.editor
          return {
            id: instance.id,
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
                  editor.src.value
                    ? fsZds.basename(editor.src.value)
                    : 'Untitled'
                }
                view={service.viewState(instance).value.selected}
                views={service.viewState(instance).value.available}
                onFocus={() => setActiveId(instance.id)}
                onChange={(viewId) => service.setView(instance.id, viewId)}
              />
            ),
            close: {
              label: `Close ${editor.src.value ?? 'Untitled'}`,
              tooltip: 'Close editor',
              onClose: () => service.closeView(instance.id),
            },
            renderPanel: (active) => (
              <EditorView
                instance={instance}
                editors={service}
                active={active}
              />
            ),
          }
        })}
      />
    </LayoutPanel>
  )
}
