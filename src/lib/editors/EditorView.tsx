import type { Signal } from '@preact/signals-core'
import { useEffect, useRef } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import type {
  EditorViewInstance,
  EditorsService,
} from '@src/lib/editors/registry/contract'

/** Render the selected contribution while the editor retains its buffer and resources. */
export function EditorView({
  instance,
  editors,
  active = true,
}: {
  instance: EditorViewInstance
  editors: EditorsService
  active?: boolean
}) {
  useSignals()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = instance.element as Signal<HTMLElement | undefined>
    const mounted = root.current ?? undefined
    element.value = mounted
    return () => {
      if (element.peek() === mounted) element.value = undefined
    }
  }, [instance])
  const { selected, binding } = editors.viewState(instance).value
  return (
    <div
      ref={root}
      tabIndex={-1}
      className="flex h-full min-h-0 w-full min-w-0 outline-none"
      onPointerDownCapture={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const control = target.closest(
          'button, input, textarea, select, a[href], [contenteditable="true"], [tabindex]'
        )
        if (!control || control === event.currentTarget)
          event.currentTarget.focus({ preventScroll: true })
      }}
    >
      {binding.type === 'ready' ? (
        <binding.Component
          key={selected?.id}
          editor={instance.editor}
          instance={instance}
          active={active}
        />
      ) : (
        <p className="p-3 text-sm">
          {binding.type === 'error'
            ? binding.error.message
            : selected
              ? 'Preparing mode...'
              : 'No mode is available for this buffer.'}
        </p>
      )}
    </div>
  )
}
