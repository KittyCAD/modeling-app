import { useSignals } from '@preact/signals-react/runtime'
import { useLayoutEffect, useRef, useState } from 'react'
import { ModelingDialogView } from '@src/components/ModelingDialog/ModelingDialogView'
import { EditorView } from '@src/lib/editors/EditorView'
import type { ModelingToolDialog as Dialog } from '@src/lib/kcl/modelingDialog'
import { isErr, reportRejection, trap } from '@src/lib/trap'

/** Adapt the editor draft and picking session to the existing dialog view. */
export default function ModelingToolDialog({ dialog }: { dialog: Dialog }) {
  useSignals()
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [formHeight, setFormHeight] = useState<number>()
  const state = dialog.editors.viewState(dialog.instance).value
  const codeMode = state.selected?.id === 'editors.code'
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || codeMode) return
    const measure = () => {
      const height = body.getBoundingClientRect().height
      if (height > 0)
        setFormHeight((previous) => (previous === height ? previous : height))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    measure()
    return () => observer.disconnect()
  }, [codeMode])
  const values = dialog.values.value
  const error =
    dialog.error.value?.message ??
    (isErr(values)
      ? values.message
      : dialog.invalidated.value
        ? 'Model changed. Select an argument and pick again.'
        : undefined)
  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute z-50 top-20 bottom-2 inset-x-2 flex min-h-0 items-start justify-end"
    >
      <ModelingDialogView
        containerRef={containerRef}
        command={dialog.command}
        canSubmit={dialog.canSubmit.value}
        checking={dialog.submitting.value}
        error={error}
        onCancel={dialog.cancel}
        onSubmit={(event) => {
          event.preventDefault()
          dialog.submit().catch(reportRejection)
        }}
        onFocusCapture={(event) => {
          if (
            event.target instanceof Element &&
            !event.target.closest('[data-modeling-dialog-selection]')
          )
            dialog.activate(undefined)
        }}
        footerAccessory={
          <select
            aria-label="Argument mode"
            value={state.selected?.id ?? ''}
            className="m-0 rounded-sm border b-4 bg-transparent px-2 py-1 text-xs"
            onChange={(event) => {
              trap(dialog.setMode(event.target.value))
            }}
          >
            {state.available.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        }
      >
        <div
          ref={bodyRef}
          style={codeMode ? { height: formHeight ?? '20rem' } : undefined}
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${state.selected?.id === 'editors.code' ? 'p-3' : ''}`}
        >
          <EditorView instance={dialog.instance} editors={dialog.editors} />
        </div>
      </ModelingDialogView>
    </div>
  )
}
