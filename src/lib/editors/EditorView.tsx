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
  const { selected, binding } = editors.viewState(instance).value
  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
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
