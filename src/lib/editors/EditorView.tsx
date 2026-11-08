import { useSignals } from '@preact/signals-react/runtime'
import type { Editor, EditorsService } from '@src/lib/editors/registry/contract'

/** Render the selected contribution while the editor retains its buffer and resources. */
export function EditorView({
  editor,
  editors,
  active = true,
}: {
  editor: Editor
  editors: EditorsService
  active?: boolean
}) {
  useSignals()
  const { selected, binding } = editors.viewState(editor).value
  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
      {binding.type === 'ready' ? (
        <binding.Component key={selected?.id} editor={editor} active={active} />
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
