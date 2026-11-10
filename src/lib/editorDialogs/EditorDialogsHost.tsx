import { useSignals } from '@preact/signals-react/runtime'
import { Draggable } from '@kittycad/ui-components'
import { Suspense, useEffect, useRef } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { EditorDialogsService } from '@src/lib/editorDialogs/registry/contract'

/** Compact, nonmodal host so a modeling form can still collect selections from its scene. */
export function EditorDialogsHost({
  dialogs,
}: {
  dialogs: EditorDialogsService
}) {
  useSignals()
  const container = useRef<HTMLDivElement>(null)
  const dialog = dialogs.active.value
  useEffect(() => () => dialogs.close(), [dialogs])
  if (!dialog) return null
  const state = dialog.editors.viewState(dialog.instance).value
  const Surface =
    state.binding.type === 'ready' ? state.binding.Component : undefined
  return (
    <div
      ref={container}
      className="pointer-events-none fixed inset-x-2 top-20 bottom-10 z-40 flex min-h-0 items-start justify-end"
    >
      <Draggable
        key={dialog.id}
        containerRef={container}
        role="dialog"
        aria-modal={false}
        aria-label={dialog.title}
        className="pointer-events-auto flex h-[min(75vh,36rem)] min-h-0 max-h-full w-[26rem] max-w-full flex-col overflow-hidden rounded border border-3 bg-default text-default shadow-lg"
        Handle={
          <header className="flex cursor-move items-center justify-between border-b border-3 px-3 py-2 text-sm">
            <span>{dialog.title}</span>
            <button
              type="button"
              aria-label="Cancel dialog"
              className="m-0 border-0 bg-transparent p-0"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={dialog.cancel}
            >
              <CustomIcon name="close" className="h-4 w-4" />
            </button>
          </header>
        }
        onKeyDown={(event) => {
          if (!event.defaultPrevented && event.key === 'Escape') {
            event.preventDefault()
            dialog.cancel()
          }
        }}
        onKeyDownCapture={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            ['z', 'y'].includes(event.key.toLowerCase()) &&
            !(
              event.target instanceof HTMLElement &&
              event.target.closest('[data-editor-code]')
            )
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (event.shiftKey || event.key.toLowerCase() === 'y')
              dialog.editor.redo()
            else dialog.editor.undo()
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            void dialog.submit()
          }
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          <Suspense fallback={<p role="status">Loading editor…</p>}>
            {Surface ? (
              <Surface
                editor={dialog.editor}
                instance={dialog.instance}
                active
              />
            ) : (
              <p role="status">Loading mode…</p>
            )}
          </Suspense>
        </div>
        {dialog.error.value && (
          <p
            role="alert"
            className="px-3 py-2 text-sm text-destroy-80 dark:text-destroy-30"
          >
            {dialog.error.value.message}
          </p>
        )}
        <footer className="flex shrink-0 items-center gap-2 border-t border-3 p-3 text-xs">
          <label className="flex items-center gap-2">
            Mode
            <select
              aria-label="Dialog mode"
              value={state.selected?.id ?? ''}
              onChange={(event) =>
                dialog.editors.setView(dialog.instance.id, event.target.value)
              }
              className="m-0 rounded border border-3 bg-transparent px-2 py-1"
            >
              {state.available.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="m-0 ml-auto rounded border border-3 px-2 py-1"
            onClick={dialog.cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="m-0 rounded border border-transparent bg-primary px-3 py-1 text-white disabled:opacity-50"
            disabled={!dialog.canSubmit.value}
            onClick={() => void dialog.submit()}
          >
            {dialog.submitting.value ? 'Checking…' : 'Submit'}
          </button>
        </footer>
      </Draggable>
    </div>
  )
}
