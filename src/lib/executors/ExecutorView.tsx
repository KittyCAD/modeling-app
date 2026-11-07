import { editorMatchContext } from '@src/lib/editors/matching'
import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { FilePaneEmptyState } from '@src/components/FilePaneEmptyState'
import { Tabs } from '@src/components/Tabs'
import { TabViewPicker } from '@src/components/TabViewPicker'
import Tooltip from '@src/components/Tooltip'
import type {
  ExecutorCapability,
  ExecutorsService,
  ExecutorViewContribution,
} from '@src/lib/executors/registry/contract'
import { viewsForSource } from '@src/lib/executors/views'
import fsZds from '@src/lib/fs-zds'
import { useEffect, useRef, useState } from 'react'
import styles from './ExecutorView.module.css'

/** Registry-owned execution tabs keep their editor bindings independently of editor focus. */
export function ExecutorView({
  executors,
  capabilities,
  views,
  onOpenExecutor,
}: {
  executors: ExecutorsService
  capabilities: ReadonlySignal<readonly ExecutorCapability[]>
  views: ReadonlySignal<readonly ExecutorViewContribution[]>
  onOpenExecutor: () => void
}) {
  useSignals()
  const tabs = executors.viewTabs.value
  const previousTabs = useRef(tabs)
  const [activeId, setActiveId] = useState<symbol | null>(
    () => tabs.at(-1)?.executor.id ?? null
  )
  useEffect(() => {
    const previous = previousTabs.current
    previousTabs.current = tabs
    setActiveId((current) => {
      const newest = tabs
        .filter(
          (tab) =>
            !previous.some((other) => other.executor.id === tab.executor.id)
        )
        .at(-1)
      if (newest) return newest.executor.id
      if (tabs.some((tab) => tab.executor.id === current)) return current
      const index = previous.findIndex((tab) => tab.executor.id === current)
      return (
        tabs[Math.max(0, Math.min(index, tabs.length - 1))]?.executor.id ?? null
      )
    })
  }, [tabs])
  return (
    <main className="flex min-h-0 min-w-0 flex-1" aria-label="Executor view">
      <Tabs
        label="Open executors"
        position="top"
        selectedId={activeId}
        onChange={setActiveId}
        postfix={
          <button
            type="button"
            aria-label="Open executor"
            className={styles.iconButton}
            onClick={onOpenExecutor}
          >
            <CustomIcon name="plus" className="h-3.5 w-3.5" aria-hidden />
            <Tooltip position="bottom-right">Open executor</Tooltip>
          </button>
        }
        emptyState={
          <FilePaneEmptyState icon="extrude" onOpen={onOpenExecutor} />
        }
        items={tabs.map(({ executor, viewId }) => {
          const availableViews = viewsForSource(
            editorMatchContext(executor.editor),
            capabilities.value,
            views.value
          )
          const view = availableViews.find((view) => view.id === viewId)
          const Component = view?.Component
          const src = executor.editor.src.value ?? ''
          const name = fsZds.basename(src) || 'Untitled'
          const viewLabel = view?.label ?? 'Unavailable view'
          const label = `${name} - ${viewLabel}`
          return {
            id: executor.id,
            label: (
              <>
                {name}
                <span className="sr-only"> - {viewLabel}</span>
              </>
            ),
            title: src,
            accessory: (
              <TabViewPicker
                name={name}
                view={view}
                views={availableViews}
                onFocus={() => setActiveId(executor.id)}
                onChange={(viewId) => executors.setView(executor.id, viewId)}
              />
            ),
            close: {
              label: `Close ${label}`,
              tooltip: 'Close executor',
              onClose: () => executors.closeExecutor(executor.id),
            },
            renderPanel: () =>
              Component ? (
                <div className="flex h-full min-h-0 min-w-0">
                  <Component key={viewId} executor={executor} />
                </div>
              ) : (
                <p className="p-3 text-sm">
                  No executor view is available for this file.
                </p>
              ),
          }
        })}
      />
    </main>
  )
}
